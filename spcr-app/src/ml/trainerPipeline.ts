import fs from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { sha256Hex } from '../utils/crypto.js';
import { LocalOnnxRecruitmentClassifier } from '../services/localClassifier.js';
import { EmailIntelligenceService, LocalMiniLmEmbeddingProvider } from '../services/emailIntelligenceService.js';
import { assessSenderAuthenticity } from '../services/authenticityService.js';
import { buildCuratedCorpusPart1 } from './curatedCorpusPart1.js';
import { buildCuratedCorpusPart2 } from './curatedCorpusPart2.js';
import { buildCuratedCorpusPart3 } from './curatedCorpusPart3.js';
import { DENSE_STRUCTURAL_FEATURE_NAMES, extractEmailRepresentation } from './preprocessing.js';
import {
  EMAIL_INTELLIGENCE_CATEGORIES,
  EmailIntelligenceCategory,
  LabeledEmailExample,
  LabeledEmailExampleSchema,
  PreprocessingConfig,
  TrainedEmailModelArtifact,
} from './schema.js';
import {
  computeArtifactWeightsChecksum,
  fitStandardScaler,
  fitTfIdfVectorizer,
  loadAndVerifyTrainedArtifact,
  predictScoresFromTrainedWeights,
  SparsePlusDenseVector,
  trainOneVsRestLogisticRegression,
  transformStandardScaler,
  transformTfIdfSparse,
} from './tfidfAndLinearModel.js';
import {
  ComprehensiveEvaluationSummary,
  evaluatePredictionsComprehensively,
  PredictionRecordForEval,
  splitDatasetByThreadAndOrgGroup,
  verifyZeroGroupLeakage,
} from './evaluationMetrics.js';

export interface CandidateModelBenchmarkEntry {
  candidateName:
    | 'naive_majority'
    | 'minilm_exemplar_zero_shot'
    | 'tfidf_ovr_logreg'
    | 'hybrid_minilm_tfidf_logreg';
  classifierKind:
    | 'deterministic_screening_rules'
    | 'exemplar_similarity_classifier'
    | 'supervised_trained_classifier';
  isTrainedSupervisedModel: boolean;
  selectedBestLambda: number | null;
  valMacroF1: number;
  valAccuracy: number;
  valMultiLabelMicroF1: number;
  valRelevantOpportunityRecall: number;
  valSilentOpportunityDiscardRate: number;
  avgCpuLatencyMsPerEmail: number;
  estimatedResidentRamMb: number;
  artifactSizeBytes: number | null;
  notes: string;
}

export interface TrainModelPipelineResult {
  artifact: TrainedEmailModelArtifact;
  artifactPath: string;
  artifactFileSha256: string;
  datasetVersion: string;
  splitCounts: {
    train: number;
    val: number;
    test: number;
    extraApprovedFeedbackUsed: number;
  };
  valComparison: CandidateModelBenchmarkEntry[];
  selectionRationale: string;
  selectedValSummary: ComprehensiveEvaluationSummary;
}

export function loadOrInitializeSplitCorpus(rootDir: string): {
  train: LabeledEmailExample[];
  val: LabeledEmailExample[];
  test: LabeledEmailExample[];
  datasetVersion: string;
} {
  const corpusPath = path.join(rootDir, 'ml', 'data', 'curated_recruitment_corpus_v1.jsonl');
  const manifestPath = path.join(rootDir, 'ml', 'data', 'dataset_manifest_v1.json');

  if (fs.existsSync(corpusPath)) {
    const rawContent = fs.readFileSync(corpusPath, 'utf8');
    const lines = rawContent
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);
    const examples = lines.map((l) => LabeledEmailExampleSchema.parse(JSON.parse(l)));
    const train = examples.filter((e) => e.split === 'train');
    const val = examples.filter((e) => e.split === 'val');
    const test = examples.filter((e) => e.split === 'test');
    let datasetVersion = `spcr-curated-v1.0.0-${sha256Hex(rawContent).slice(0, 10)}`;
    if (fs.existsSync(manifestPath)) {
      try {
        const m = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
        if (m.datasetVersion) datasetVersion = m.datasetVersion;
      } catch {
        // ignore manifest parse fallback
      }
    }
    return { train, val, test, datasetVersion };
  }

  const rawAll = [
    ...buildCuratedCorpusPart1(),
    ...buildCuratedCorpusPart2(),
    ...buildCuratedCorpusPart3(),
  ].map((e) => LabeledEmailExampleSchema.parse(e));
  const split = splitDatasetByThreadAndOrgGroup(rawAll, 20261029);
  const all = [...split.train, ...split.val, ...split.test];
  const content = all.map((e) => JSON.stringify(e)).join('\n') + '\n';
  fs.mkdirSync(path.dirname(corpusPath), { recursive: true });
  fs.writeFileSync(corpusPath, content, 'utf8');
  return {
    train: split.train,
    val: split.val,
    test: split.test,
    datasetVersion: `spcr-curated-v1.0.0-${sha256Hex(content).slice(0, 10)}`,
  };
}

function tunePerLabelMultiLabelThresholdsOnVal(
  valVectors: SparsePlusDenseVector[],
  valExamples: LabeledEmailExample[],
  artifactDraft: Pick<
    TrainedEmailModelArtifact,
    'labels' | 'vocabulary' | 'denseFeatureNames' | 'weightsByLabel' | 'biasByLabel'
  >
): Record<EmailIntelligenceCategory, number> {
  const valRawScores = valVectors.map((v) => predictScoresFromTrainedWeights(v, artifactDraft));
  const grid = [0.34, 0.4, 0.46, 0.52, 0.58, 0.64];
  const tuned = {} as Record<EmailIntelligenceCategory, number>;

  for (const label of EMAIL_INTELLIGENCE_CATEGORIES) {
    let bestT = 0.48;
    let bestF1 = -1;
    for (const candT of grid) {
      let tp = 0;
      let fp = 0;
      let fn = 0;
      for (let i = 0; i < valExamples.length; i++) {
        const yTrue = valExamples[i]!.multiLabels.includes(label);
        const yPred = (valRawScores[i]![label] || 0) >= candT;
        if (yTrue && yPred) tp++;
        else if (!yTrue && yPred) fp++;
        else if (yTrue && !yPred) fn++;
      }
      const f1 = 2 * tp + fp + fn > 0 ? (2 * tp) / (2 * tp + fp + fn) : 0;
      if (f1 > bestF1) {
        bestF1 = f1;
        bestT = candT;
      }
    }
    tuned[label] = bestT;
  }
  return tuned;
}

function assembleSignedArtifact(params: {
  modelVersion: string;
  architectureType: 'tfidf_ovr_logreg' | 'hybrid_minilm_tfidf_logreg';
  datasetVersion: string;
  regularizationLambda: number;
  preprocessingConfig: PreprocessingConfig;
  vocabulary: string[];
  idfVector: number[];
  denseMeans: number[];
  denseStds: number[];
  weightsByLabel: Record<EmailIntelligenceCategory, number[]>;
  biasByLabel: Record<EmailIntelligenceCategory, number>;
  multiLabelThresholds: Record<EmailIntelligenceCategory, number>;
}): TrainedEmailModelArtifact {
  const unsigned: Omit<TrainedEmailModelArtifact, 'weightsPayloadSha256'> = {
    artifactFormatVersion: 'spcr-email-ml-v1',
    modelVersion: params.modelVersion,
    classifierKind: 'supervised_trained_classifier',
    architectureType: params.architectureType,
    embeddingBackbone:
      params.architectureType === 'hybrid_minilm_tfidf_logreg'
        ? {
            modelId: 'Xenova/all-MiniLM-L6-v2',
            dimensions: 384,
            license: 'Apache-2.0',
          }
        : null,
    license:
      params.architectureType === 'hybrid_minilm_tfidf_logreg'
        ? 'MIT (SPCR linear weights) + Apache-2.0 (Xenova/all-MiniLM-L6-v2 ONNX backbone)'
        : 'MIT (SPCR local supervised linear model & vocabulary)',
    datasetVersion: params.datasetVersion,
    trainedAt: new Date().toISOString(),
    randomSeed: 20261029,
    regularizationLambda: params.regularizationLambda,
    labels: [...EMAIL_INTELLIGENCE_CATEGORIES],
    preprocessingConfig: params.preprocessingConfig,
    vocabulary: params.vocabulary,
    idfVector: params.idfVector,
    denseFeatureNames: [...DENSE_STRUCTURAL_FEATURE_NAMES],
    denseMeans: params.denseMeans,
    denseStds: params.denseStds,
    weightsByLabel: params.weightsByLabel,
    biasByLabel: params.biasByLabel,
    multiLabelThresholds: params.multiLabelThresholds,
    uncertaintyThresholds: {
      highConfidenceMinScore: 0.52,
      highConfidenceMinMargin: 0.12,
      lowConfidenceMaxScore: 0.35,
    },
    calibrationDisclosure: {
      isCalibratedProbability: false,
      note: 'Raw logistic sigmoid outputs from class-balanced L2 OvR linear decision functions. Useful for relative ranking and threshold routing, NOT calibrated empirical probabilities.',
    },
  };

  return {
    ...unsigned,
    weightsPayloadSha256: computeArtifactWeightsChecksum(unsigned),
  };
}

async function evaluateServiceOnSplit(
  service: EmailIntelligenceService,
  examples: LabeledEmailExample[]
): Promise<{ records: PredictionRecordForEval[]; summary: ComprehensiveEvaluationSummary; avgLatencyMs: number }> {
  const records: PredictionRecordForEval[] = [];
  const t0 = performance.now();
  for (const ex of examples) {
    const auth = await assessSenderAuthenticity(null, {
      fromRaw: ex.fromRaw,
      replyToRaw: ex.replyToRaw || null,
      authHeadersRaw: ex.authHeadersRaw || null,
      subject: ex.subject,
      bodyOrSnippet: ex.rawBody,
    });
    const pred = await service.classifyEmail({
      fromRaw: ex.fromRaw,
      replyToRaw: ex.replyToRaw || null,
      authHeadersRaw: ex.authHeadersRaw || null,
      listUnsubscribeHeader: ex.listUnsubscribeHeader || null,
      inReplyTo: ex.inReplyTo || null,
      subject: ex.subject,
      rawBody: ex.rawBody,
      isHtmlOnly: ex.isHtmlOnly,
      attachmentFilenames: ex.attachmentFilenames,
      priorThreadCategories: ex.priorThreadCategories,
      isSuspiciousSender: auth.isSuspicious,
      riskFlags: auth.riskFlags,
    });
    records.push({
      example: ex,
      predictedPrimary: pred.primaryCategory,
      predictedMultiLabels: pred.multiLabels,
      topConfidence: pred.topConfidence,
      margin: pred.margin,
      uncertaintyOutcome: pred.uncertaintyOutcome,
    });
  }
  const elapsed = performance.now() - t0;
  return {
    records,
    summary: evaluatePredictionsComprehensively(records, 250),
    avgLatencyMs: examples.length > 0 ? Number((elapsed / examples.length).toFixed(3)) : 0,
  };
}

export async function trainAndCompareEmailIntelligenceModels(options: {
  rootDir?: string;
  cacheDir?: string;
  modelVersion?: string;
  outputArtifactPath?: string;
  extraApprovedTrainExamples?: LabeledEmailExample[];
  compareHybridMiniLm?: boolean;
}): Promise<TrainModelPipelineResult> {
  const rootDir = options.rootDir || process.cwd();
  const cacheDir = options.cacheDir || path.join(rootDir, '.models_cache');
  const modelVersion = options.modelVersion || 'spcr-email-intel-v1.0.0';
  const outputArtifactPath =
    options.outputArtifactPath || path.join(rootDir, 'ml', 'artifacts', 'recruitment_email_model_v1.json');
  const compareHybridMiniLm = options.compareHybridMiniLm !== false;

  const baseCorpus = loadOrInitializeSplitCorpus(rootDir);

  // Filter any extra approved user feedback examples so they NEVER leak into held-out `val` or `test` threads/orgs
  const valAndTestThreads = new Set(
    [...baseCorpus.val, ...baseCorpus.test].map((e) => e.threadId.trim().toLowerCase())
  );
  const valAndTestOrgs = new Set(
    [...baseCorpus.val, ...baseCorpus.test].map((e) => e.senderOrgGroup.trim().toLowerCase())
  );
  const safeExtraTrain = (options.extraApprovedTrainExamples || []).filter(
    (ex) =>
      !valAndTestThreads.has(ex.threadId.trim().toLowerCase()) &&
      !valAndTestOrgs.has(ex.senderOrgGroup.trim().toLowerCase())
  );

  const trainExamples = [...baseCorpus.train, ...safeExtraTrain];
  const valExamples = baseCorpus.val;
  const testExamples = baseCorpus.test;

  const leakage = verifyZeroGroupLeakage({ train: trainExamples, val: valExamples, test: testExamples });
  if (leakage.sharedThreadIds !== 0 || leakage.sharedSenderOrgs !== 0) {
    throw new Error(
      `FATAL GROUP LEAKAGE DETECTED before training: sharedThreadIds=${leakage.sharedThreadIds}, sharedSenderOrgs=${leakage.sharedSenderOrgs}`
    );
  }

  const datasetVersion =
    safeExtraTrain.length > 0
      ? `${baseCorpus.datasetVersion}+feedback${safeExtraTrain.length}`
      : baseCorpus.datasetVersion;

  const preprocessingConfig: PreprocessingConfig = {
    maxVocabSize: 5500,
    minDocFreq: 2,
    ngramRange: [1, 2],
    sublinearTf: true,
    lowercase: true,
    separateFreshAndQuotedText: true,
    htmlDecodeEnabled: true,
  };

  // STRICT FEATURIZATION ORDERING (`ml-best-practices`):
  // Extract representations, then fit TF-IDF vocabulary & standard scaler EXCLUSIVELY on `trainExamples`!
  const trainReps = trainExamples.map((e) => extractEmailRepresentation(e));
  const valReps = valExamples.map((e) => extractEmailRepresentation(e));

  const vectorizer = fitTfIdfVectorizer(
    trainReps.map((r) => r.tokens),
    preprocessingConfig
  );
  const scaler = fitStandardScaler(trainReps.map((r) => r.denseFeatures));

  const trainTfIdfVectors: SparsePlusDenseVector[] = trainReps.map((r) => ({
    sparseTfIdf: transformTfIdfSparse(r.tokens, vectorizer),
    scaledDense: transformStandardScaler(r.denseFeatures, scaler),
  }));
  const valTfIdfVectors: SparsePlusDenseVector[] = valReps.map((r) => ({
    sparseTfIdf: transformTfIdfSparse(r.tokens, vectorizer),
    scaledDense: transformStandardScaler(r.denseFeatures, scaler),
  }));
  const trainMultiLabelSets = trainExamples.map((e) => new Set<EmailIntelligenceCategory>(e.multiLabels));

  const valComparison: CandidateModelBenchmarkEntry[] = [];

  // ---------------------------------------------------------------------------
  // Baseline 0: Naive Majority-Class Predictor (`ml-best-practices` sanity check)
  // ---------------------------------------------------------------------------
  const trainClassCounts = new Map<EmailIntelligenceCategory, number>();
  for (const ex of trainExamples) {
    trainClassCounts.set(ex.primaryCategory, (trainClassCounts.get(ex.primaryCategory) || 0) + 1);
  }
  const majorityLabel =
    Array.from(trainClassCounts.entries()).sort((a, b) => b[1] - a[1])[0]?.[0] || 'unrelated_email';
  const majorityRecords: PredictionRecordForEval[] = valExamples.map((ex) => ({
    example: ex,
    predictedPrimary: majorityLabel,
    predictedMultiLabels: [majorityLabel],
    topConfidence: 1,
    margin: 1,
    uncertaintyOutcome: 'HIGH_CONFIDENCE',
  }));
  const majorityValSummary = evaluatePredictionsComprehensively(majorityRecords, 0);
  valComparison.push({
    candidateName: 'naive_majority',
    classifierKind: 'deterministic_screening_rules',
    isTrainedSupervisedModel: false,
    selectedBestLambda: null,
    valMacroF1: majorityValSummary.macroF1,
    valAccuracy: majorityValSummary.accuracy,
    valMultiLabelMicroF1: majorityValSummary.multiLabelMicroF1,
    valRelevantOpportunityRecall: majorityValSummary.relevantOpportunityRecall,
    valSilentOpportunityDiscardRate: majorityValSummary.silentOpportunityDiscardRate,
    avgCpuLatencyMsPerEmail: 0.001,
    estimatedResidentRamMb: 0.1,
    artifactSizeBytes: null,
    notes: `Predicts most frequent training label (${majorityLabel}) for every message. Fails completely on minority stages and silently discards real opportunities.`,
  });

  // ---------------------------------------------------------------------------
  // Baseline 1: Unsupervised MiniLM Cosine-Similarity Exemplar Classifier
  // ---------------------------------------------------------------------------
  const sharedEmbeddingProvider = new LocalMiniLmEmbeddingProvider({ cacheDir });
  if (compareHybridMiniLm) {
    const legacyClassifier = new LocalOnnxRecruitmentClassifier({ cacheDir });
    await legacyClassifier.ensureLoaded();
    const legacyMap: Record<string, EmailIntelligenceCategory> = {
      candidate_opportunity: 'relevant_opportunity',
      related_jd_followup: 'jd_or_details_followup',
      office_coordination: 'interview_invitation',
      newsletter_promo: 'job_alert_newsletter',
      low_relevance: 'unrelated_email',
      uncertain_needs_review: 'uncertain',
      suspicious_needs_review: 'spam_or_scam',
    };
    const tLegacy0 = performance.now();
    const exemplarRecords: PredictionRecordForEval[] = [];
    for (const ex of valExamples) {
      const auth = await assessSenderAuthenticity(null, {
        fromRaw: ex.fromRaw,
        replyToRaw: ex.replyToRaw || null,
        authHeadersRaw: ex.authHeadersRaw || null,
        subject: ex.subject,
        bodyOrSnippet: ex.rawBody,
      });
      const res = await legacyClassifier.classify({
        subject: ex.subject,
        bodyOrSnippet: ex.rawBody,
        attachmentFilenames: ex.attachmentFilenames,
        inReplyTo: ex.inReplyTo || null,
        isSuspiciousSender: auth.isSuspicious,
        riskFlags: auth.riskFlags,
      });
      const mappedPrimary = legacyMap[res.classification] || 'uncertain';
      exemplarRecords.push({
        example: ex,
        predictedPrimary: mappedPrimary,
        predictedMultiLabels: [mappedPrimary],
        topConfidence: res.confidence,
        margin: res.margin,
        uncertaintyOutcome:
          res.confidenceTier === 'suspicious'
            ? 'LOW_CONFIDENCE_OR_SUSPICIOUS'
            : res.confidenceTier === 'uncertain'
              ? 'REVIEW_REQUIRED'
              : 'HIGH_CONFIDENCE',
      });
    }
    const legacyElapsed = performance.now() - tLegacy0;
    const exemplarValSummary = evaluatePredictionsComprehensively(exemplarRecords, 0);
    valComparison.push({
      candidateName: 'minilm_exemplar_zero_shot',
      classifierKind: 'exemplar_similarity_classifier',
      isTrainedSupervisedModel: false,
      selectedBestLambda: null,
      valMacroF1: exemplarValSummary.macroF1,
      valAccuracy: exemplarValSummary.accuracy,
      valMultiLabelMicroF1: exemplarValSummary.multiLabelMicroF1,
      valRelevantOpportunityRecall: exemplarValSummary.relevantOpportunityRecall,
      valSilentOpportunityDiscardRate: exemplarValSummary.silentOpportunityDiscardRate,
      avgCpuLatencyMsPerEmail: Number((legacyElapsed / Math.max(1, valExamples.length)).toFixed(3)),
      estimatedResidentRamMb: 85,
      artifactSizeBytes: 23_100_000,
      notes:
        'Zero-shot cosine similarity over Xenova/all-MiniLM-L6-v2 embeddings against hand-written exemplars. Cannot separate all 14 fine-grained recruitment stages (e.g. OA vs interview follow-up vs offer vs rejection vs acknowledgement).',
    });
  }

  // ---------------------------------------------------------------------------
  // Supervised Model A: TF-IDF + 42 Structural/Thread Features + L2 OvR LogReg
  // ---------------------------------------------------------------------------
  const evalService = new EmailIntelligenceService({
    artifactPath: outputArtifactPath,
    cacheDir,
    embeddingProvider: sharedEmbeddingProvider,
  });

  const tfidfLambdas = [0.0025, 0.006, 0.015, 0.035];
  let bestTfidfArtifact: TrainedEmailModelArtifact | null = null;
  let bestTfidfValSummary: ComprehensiveEvaluationSummary | null = null;
  let bestTfidfScore = -Infinity;
  let bestTfidfLambda = tfidfLambdas[0]!;
  let bestTfidfLatencyMs = 0;

  for (const lam of tfidfLambdas) {
    const trained = trainOneVsRestLogisticRegression({
      trainVectors: trainTfIdfVectors,
      trainMultiLabels: trainMultiLabelSets,
      vocabLen: vectorizer.vocabulary.length,
      denseLen: DENSE_STRUCTURAL_FEATURE_NAMES.length,
      embeddingLen: 0,
      regularizationLambda: lam,
      epochs: 280,
      baseLr: 0.9,
    });
    const draftThresholds = tunePerLabelMultiLabelThresholdsOnVal(valTfIdfVectors, valExamples, {
      labels: [...EMAIL_INTELLIGENCE_CATEGORIES],
      vocabulary: vectorizer.vocabulary,
      denseFeatureNames: [...DENSE_STRUCTURAL_FEATURE_NAMES],
      weightsByLabel: trained.weightsByLabel,
      biasByLabel: trained.biasByLabel,
    });
    const candidateArtifact = assembleSignedArtifact({
      modelVersion,
      architectureType: 'tfidf_ovr_logreg',
      datasetVersion,
      regularizationLambda: lam,
      preprocessingConfig,
      vocabulary: vectorizer.vocabulary,
      idfVector: vectorizer.idfVector,
      denseMeans: scaler.means,
      denseStds: scaler.stds,
      weightsByLabel: trained.weightsByLabel,
      biasByLabel: trained.biasByLabel,
      multiLabelThresholds: draftThresholds,
    });

    evalService.loadVerifiedArtifactObject(candidateArtifact);
    const valRes = await evaluateServiceOnSplit(evalService, valExamples);
    const composite =
      valRes.summary.macroF1 +
      0.15 * valRes.summary.relevantOpportunityRecall -
      1.5 * valRes.summary.silentOpportunityDiscardRate;
    if (composite > bestTfidfScore) {
      bestTfidfScore = composite;
      bestTfidfArtifact = candidateArtifact;
      bestTfidfValSummary = valRes.summary;
      bestTfidfLambda = lam;
      bestTfidfLatencyMs = valRes.avgLatencyMs;
    }
  }

  const tfidfBytes = Buffer.byteLength(JSON.stringify(bestTfidfArtifact!), 'utf8');
  valComparison.push({
    candidateName: 'tfidf_ovr_logreg',
    classifierKind: 'supervised_trained_classifier',
    isTrainedSupervisedModel: true,
    selectedBestLambda: bestTfidfLambda,
    valMacroF1: bestTfidfValSummary!.macroF1,
    valAccuracy: bestTfidfValSummary!.accuracy,
    valMultiLabelMicroF1: bestTfidfValSummary!.multiLabelMicroF1,
    valRelevantOpportunityRecall: bestTfidfValSummary!.relevantOpportunityRecall,
    valSilentOpportunityDiscardRate: bestTfidfValSummary!.silentOpportunityDiscardRate,
    avgCpuLatencyMsPerEmail: bestTfidfLatencyMs,
    estimatedResidentRamMb: 8,
    artifactSizeBytes: tfidfBytes,
    notes:
      'Supervised L2 One-vs-Rest Logistic Regression over sublinear unigram/bigram zone TF-IDF + 42 thread/structural/missingness features. Sub-millisecond CPU inference, tiny memory footprint, 100% deterministic.',
  });

  // ---------------------------------------------------------------------------
  // Supervised Model B: Hybrid MiniLM-384d + TF-IDF + 42 Structural/Thread + L2 OvR LogReg
  // ---------------------------------------------------------------------------
  let bestHybridArtifact: TrainedEmailModelArtifact | null = null;
  let bestHybridValSummary: ComprehensiveEvaluationSummary | null = null;
  let bestHybridLambda = 0.01;
  let bestHybridLatencyMs = 0;

  if (compareHybridMiniLm) {
    await sharedEmbeddingProvider.ensureLoaded();
    const trainEmbeddings: Float32Array[] = [];
    for (const rep of trainReps) {
      const embText = `${rep.cleanSubject}\n${rep.freshBodyText || rep.combinedPlainText}`.trim() || '(empty)';
      trainEmbeddings.push(await sharedEmbeddingProvider.embedNormalized(embText));
    }
    const valEmbeddings: Float32Array[] = [];
    const tEmb0 = performance.now();
    for (const rep of valReps) {
      const embText = `${rep.cleanSubject}\n${rep.freshBodyText || rep.combinedPlainText}`.trim() || '(empty)';
      valEmbeddings.push(await sharedEmbeddingProvider.embedNormalized(embText, true));
    }
    const uncachedEmbMsPerEmail = (performance.now() - tEmb0) / Math.max(1, valReps.length);

    const trainHybridVectors: SparsePlusDenseVector[] = trainTfIdfVectors.map((v, idx) => ({
      ...v,
      embeddingVec: trainEmbeddings[idx]!,
    }));
    const valHybridVectors: SparsePlusDenseVector[] = valTfIdfVectors.map((v, idx) => ({
      ...v,
      embeddingVec: valEmbeddings[idx]!,
    }));

    const hybridLambdas = [0.003, 0.008, 0.02, 0.045];
    let bestHybridScore = -Infinity;

    for (const lam of hybridLambdas) {
      const trained = trainOneVsRestLogisticRegression({
        trainVectors: trainHybridVectors,
        trainMultiLabels: trainMultiLabelSets,
        vocabLen: vectorizer.vocabulary.length,
        denseLen: DENSE_STRUCTURAL_FEATURE_NAMES.length,
        embeddingLen: 384,
        regularizationLambda: lam,
        epochs: 280,
        baseLr: 0.85,
      });
      const draftThresholds = tunePerLabelMultiLabelThresholdsOnVal(valHybridVectors, valExamples, {
        labels: [...EMAIL_INTELLIGENCE_CATEGORIES],
        vocabulary: vectorizer.vocabulary,
        denseFeatureNames: [...DENSE_STRUCTURAL_FEATURE_NAMES],
        weightsByLabel: trained.weightsByLabel,
        biasByLabel: trained.biasByLabel,
      });
      const candidateArtifact = assembleSignedArtifact({
        modelVersion,
        architectureType: 'hybrid_minilm_tfidf_logreg',
        datasetVersion,
        regularizationLambda: lam,
        preprocessingConfig,
        vocabulary: vectorizer.vocabulary,
        idfVector: vectorizer.idfVector,
        denseMeans: scaler.means,
        denseStds: scaler.stds,
        weightsByLabel: trained.weightsByLabel,
        biasByLabel: trained.biasByLabel,
        multiLabelThresholds: draftThresholds,
      });

      evalService.loadVerifiedArtifactObject(candidateArtifact);
      const valRes = await evaluateServiceOnSplit(evalService, valExamples);
      const composite =
        valRes.summary.macroF1 +
        0.15 * valRes.summary.relevantOpportunityRecall -
        1.5 * valRes.summary.silentOpportunityDiscardRate;
      if (composite > bestHybridScore) {
        bestHybridScore = composite;
        bestHybridArtifact = candidateArtifact;
        bestHybridValSummary = valRes.summary;
        bestHybridLambda = lam;
        bestHybridLatencyMs = Number((uncachedEmbMsPerEmail + valRes.avgLatencyMs).toFixed(3));
      }
    }

    const hybridBytes = Buffer.byteLength(JSON.stringify(bestHybridArtifact!), 'utf8');
    valComparison.push({
      candidateName: 'hybrid_minilm_tfidf_logreg',
      classifierKind: 'supervised_trained_classifier',
      isTrainedSupervisedModel: true,
      selectedBestLambda: bestHybridLambda,
      valMacroF1: bestHybridValSummary!.macroF1,
      valAccuracy: bestHybridValSummary!.accuracy,
      valMultiLabelMicroF1: bestHybridValSummary!.multiLabelMicroF1,
      valRelevantOpportunityRecall: bestHybridValSummary!.relevantOpportunityRecall,
      valSilentOpportunityDiscardRate: bestHybridValSummary!.silentOpportunityDiscardRate,
      avgCpuLatencyMsPerEmail: bestHybridLatencyMs,
      estimatedResidentRamMb: 92,
      artifactSizeBytes: hybridBytes,
      notes:
        'Supervised L2 One-vs-Rest Logistic Regression combining 384-d Xenova/all-MiniLM-L6-v2 sentence embeddings + zone TF-IDF + 42 thread/structural/missingness features. Captures dense semantic paraphrases alongside exact lexical & thread cues.',
    });
  }

  // ---------------------------------------------------------------------------
  // Principled Model Selection on Validation Split (`Section 2`)
  // ---------------------------------------------------------------------------
  let selectedArtifact = bestTfidfArtifact!;
  let selectedValSummary = bestTfidfValSummary!;
  let selectionRationale: string;

  if (bestHybridArtifact && bestHybridValSummary) {
    const f1Delta = bestHybridValSummary.macroF1 - bestTfidfValSummary!.macroF1;
    const discardBetter =
      bestHybridValSummary.silentOpportunityDiscardRate < bestTfidfValSummary!.silentOpportunityDiscardRate;

    if (discardBetter || f1Delta >= 0.015) {
      selectedArtifact = bestHybridArtifact;
      selectedValSummary = bestHybridValSummary;
      selectionRationale = `Selected "hybrid_minilm_tfidf_logreg" (lambda=${bestHybridLambda}) because on the group-disjoint validation split it improved Macro-F1 from ${bestTfidfValSummary!.macroF1.toFixed(
        4
      )} to ${bestHybridValSummary.macroF1.toFixed(4)} (delta=${f1Delta >= 0 ? '+' : ''}${f1Delta.toFixed(
        4
      )}, silentDiscardRate=${bestHybridValSummary.silentOpportunityDiscardRate.toFixed(
        4
      )}) while keeping local CPU latency at ~${bestHybridLatencyMs} ms/email and ₹0 cost using the already-pinned local ONNX MiniLM cache.`;
    } else {
      selectedArtifact = bestTfidfArtifact!;
      selectedValSummary = bestTfidfValSummary!;
      selectionRationale = `Selected "tfidf_ovr_logreg" (lambda=${bestTfidfLambda}) over "hybrid_minilm_tfidf_logreg" on engineering parsimony grounds: TF-IDF + structural/thread L2 LogReg achieved validation Macro-F1=${bestTfidfValSummary!.macroF1.toFixed(
        4
      )} vs Hybrid Macro-F1=${bestHybridValSummary.macroF1.toFixed(
        4
      )} (delta=${f1Delta.toFixed(4)} < +0.015 threshold) and silentDiscardRate=${bestTfidfValSummary!.silentOpportunityDiscardRate.toFixed(
        4
      )}, while running in ${bestTfidfLatencyMs} ms/email (~8 MB RAM) without requiring ONNX embedding execution on free-tier 512 MB hosts.`;
    }
  } else {
    selectionRationale = `Selected "tfidf_ovr_logreg" (lambda=${bestTfidfLambda}) with validation Macro-F1=${bestTfidfValSummary!.macroF1.toFixed(
      4
    )} and silentDiscardRate=${bestTfidfValSummary!.silentOpportunityDiscardRate.toFixed(4)}.`;
  }

  fs.mkdirSync(path.dirname(outputArtifactPath), { recursive: true });
  fs.writeFileSync(outputArtifactPath, JSON.stringify(selectedArtifact, null, 2), 'utf8');

  // Verify the exported artifact strictly on disk before returning
  const verifiedOnDisk = loadAndVerifyTrainedArtifact(outputArtifactPath);

  const comparisonOutPath = path.join(path.dirname(outputArtifactPath), 'model_comparison_val.json');
  fs.writeFileSync(
    comparisonOutPath,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        modelVersion,
        datasetVersion,
        splitCounts: {
          train: trainExamples.length,
          val: valExamples.length,
          test: testExamples.length,
          extraApprovedFeedbackUsed: safeExtraTrain.length,
        },
        selectedArchitecture: selectedArtifact.architectureType,
        selectionRationale,
        candidates: valComparison,
      },
      null,
      2
    ),
    'utf8'
  );

  return {
    artifact: verifiedOnDisk.artifact,
    artifactPath: outputArtifactPath,
    artifactFileSha256: verifiedOnDisk.fileSha256,
    datasetVersion,
    splitCounts: {
      train: trainExamples.length,
      val: valExamples.length,
      test: testExamples.length,
      extraApprovedFeedbackUsed: safeExtraTrain.length,
    },
    valComparison,
    selectionRationale,
    selectedValSummary,
  };
}
