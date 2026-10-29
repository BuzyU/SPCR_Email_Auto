import fs from 'node:fs';
import path from 'node:path';
import { env, pipeline } from '@huggingface/transformers';
import { sha256Hex } from '../utils/crypto.js';
import { PINNED_CLASSIFIER_SPEC, ScreeningClass } from './localClassifier.js';
import {
  ARCHITECTURE_COMPONENT_REGISTRY,
  CATEGORY_METADATA,
  EMAIL_INTELLIGENCE_CATEGORIES,
  EmailIntelligenceCategory,
  ModelArtifactIntegrityError,
  TrainedEmailModelArtifact,
  UncertaintyOutcome,
} from '../ml/schema.js';
import { EmailFeatureInput, extractEmailRepresentation, NormalizedEmailRepresentation } from '../ml/preprocessing.js';
import {
  FittedStandardScaler,
  FittedTfIdfVectorizer,
  loadAndVerifyTrainedArtifact,
  predictScoresFromTrainedWeights,
  transformStandardScaler,
  transformTfIdfSparse,
} from '../ml/tfidfAndLinearModel.js';

export interface EmailIntelligencePrediction {
  primaryCategory: EmailIntelligenceCategory;
  primaryDisplayName: string;
  multiLabels: EmailIntelligenceCategory[];
  legacyScreeningClass: ScreeningClass;
  confidenceTier: 'high' | 'standard' | 'uncertain' | 'suspicious';
  uncertaintyOutcome: UncertaintyOutcome;
  uncertaintyReasons: string[];
  topConfidence: number;
  margin: number;
  isCalibratedProbability: false;
  calibrationNote: string;
  categoryScores: Record<EmailIntelligenceCategory, number>;
  classifierKind: 'supervised_trained_classifier';
  architectureType: 'tfidf_ovr_logreg' | 'hybrid_minilm_tfidf_logreg';
  modelVersion: string;
  datasetVersion: string;
  representation: NormalizedEmailRepresentation;
  explanation: string[];
}

/**
 * Shared local MiniLM-L6-v2 ONNX embedding helper (`Apache-2.0`).
 * Used ONLY when `architectureType === 'hybrid_minilm_tfidf_logreg'` or during model comparison in training.
 */
export class LocalMiniLmEmbeddingProvider {
  private extractorPromise: Promise<any> | null = null;
  private verified = false;
  private readonly lruCache = new Map<string, Float32Array>();
  private readonly maxCacheEntries = 1024;

  constructor(
    private readonly options: {
      cacheDir: string;
      offlineOnly?: boolean;
    }
  ) {}

  async ensureLoaded(): Promise<void> {
    if (this.extractorPromise && this.verified) return;
    const resolvedCacheDir = path.resolve(this.options.cacheDir);
    fs.mkdirSync(resolvedCacheDir, { recursive: true });

    for (const [relFile, expectedSha] of Object.entries(PINNED_CLASSIFIER_SPEC.expectedChecksums)) {
      const fullPath = path.join(resolvedCacheDir, relFile);
      if (fs.existsSync(fullPath)) {
        const actualSha = sha256Hex(fs.readFileSync(fullPath));
        if (actualSha !== expectedSha) {
          throw new ModelArtifactIntegrityError(
            `Pinned ONNX embedding backbone checksum mismatch for ${relFile}: expected ${expectedSha}, got ${actualSha}`,
            'EMBEDDING_BACKBONE_INTEGRITY_ERROR'
          );
        }
      } else if (this.options.offlineOnly) {
        throw new ModelArtifactIntegrityError(
          `Offline ONNX embedding file missing: ${fullPath}. Run "npm run preload:model".`,
          'EMBEDDING_BACKBONE_INTEGRITY_ERROR'
        );
      }
    }

    env.cacheDir = resolvedCacheDir;
    env.allowLocalModels = true;
    const allPresent = Object.keys(PINNED_CLASSIFIER_SPEC.expectedChecksums).every((rel) =>
      fs.existsSync(path.join(resolvedCacheDir, rel))
    );
    env.allowRemoteModels = !allPresent && !this.options.offlineOnly;

    if (!this.extractorPromise) {
      this.extractorPromise = pipeline('feature-extraction', PINNED_CLASSIFIER_SPEC.modelId, {
        dtype: PINNED_CLASSIFIER_SPEC.dtype,
      });
    }
    await this.extractorPromise;
    this.verified = true;
    env.allowRemoteModels = false;
  }

  async embedNormalized(text: string, bypassCache = false): Promise<Float32Array> {
    const bounded = (text || 'empty').slice(0, 2000);
    if (!bypassCache) {
      const hit = this.lruCache.get(bounded);
      if (hit) return hit;
    }
    await this.ensureLoaded();
    const extractor = await this.extractorPromise!;
    const out = await extractor(bounded, { pooling: 'mean', normalize: true });
    const vec = Float32Array.from(out.data as Float32Array);
    if (!bypassCache) {
      if (this.lruCache.size >= this.maxCacheEntries) {
        const firstKey = this.lruCache.keys().next().value;
        if (firstKey !== undefined) this.lruCache.delete(firstKey);
      }
      this.lruCache.set(bounded, vec);
    }
    return vec;
  }
}

/**
 * Local Supervised Recruitment Email Intelligence Service.
 * - Zero Groq / Zero external LLM / Zero paid API calls.
 * - Strictly validates trained model artifact integrity (`ModelArtifactIntegrityError` if missing or corrupted).
 * - Evaluates 14 recruitment categories, multi-label assignments, thread context, and 3-tier uncertainty safely.
 */
export class EmailIntelligenceService {
  private artifactPath: string;
  private loadedArtifact: TrainedEmailModelArtifact | null = null;
  private loadedFileSha256: string | null = null;
  private vectorizer: FittedTfIdfVectorizer | null = null;
  private scaler: FittedStandardScaler | null = null;
  private readonly embeddingProvider: LocalMiniLmEmbeddingProvider;

  constructor(options: {
    artifactPath: string;
    cacheDir: string;
    offlineOnly?: boolean;
    embeddingProvider?: LocalMiniLmEmbeddingProvider;
  }) {
    this.artifactPath = path.resolve(options.artifactPath);
    this.embeddingProvider =
      options.embeddingProvider ||
      new LocalMiniLmEmbeddingProvider({
        cacheDir: options.cacheDir,
        offlineOnly: options.offlineOnly,
      });
  }

  getArchitectureBreakdown() {
    return {
      activeProductionClassifierKind: 'supervised_trained_classifier' as const,
      loadedModelVersion: this.loadedArtifact?.modelVersion || null,
      loadedArchitectureType: this.loadedArtifact?.architectureType || null,
      loadedDatasetVersion: this.loadedArtifact?.datasetVersion || null,
      artifactPath: this.artifactPath,
      artifactSha256: this.loadedFileSha256,
      components: ARCHITECTURE_COMPONENT_REGISTRY,
    };
  }

  async ensureLoaded(): Promise<TrainedEmailModelArtifact> {
    if (!this.loadedArtifact || !this.vectorizer || !this.scaler) {
      this.reloadFromArtifactPath(this.artifactPath);
    }
    if (this.loadedArtifact!.architectureType === 'hybrid_minilm_tfidf_logreg') {
      await this.embeddingProvider.ensureLoaded();
    }
    return this.loadedArtifact!;
  }

  reloadFromArtifactPath(nextArtifactPath: string): TrainedEmailModelArtifact {
    const resolved = path.resolve(nextArtifactPath);
    const { artifact, fileSha256 } = loadAndVerifyTrainedArtifact(resolved);
    this.applyVerifiedArtifact(artifact, resolved, fileSha256);
    return artifact;
  }

  loadVerifiedArtifactObject(artifact: TrainedEmailModelArtifact, sourceLabel = '<in-memory>'): void {
    this.applyVerifiedArtifact(artifact, sourceLabel, artifact.weightsPayloadSha256);
  }

  private applyVerifiedArtifact(
    artifact: TrainedEmailModelArtifact,
    resolvedPath: string,
    fileSha256: string
  ): void {
    const tokenToIndex = new Map<string, number>();
    artifact.vocabulary.forEach((tok, idx) => tokenToIndex.set(tok, idx));

    this.artifactPath = resolvedPath;
    this.loadedArtifact = artifact;
    this.loadedFileSha256 = fileSha256;
    this.vectorizer = {
      vocabulary: artifact.vocabulary,
      tokenToIndex,
      idfVector: artifact.idfVector,
      sublinearTf: artifact.preprocessingConfig.sublinearTf,
    };
    this.scaler = {
      means: artifact.denseMeans,
      stds: artifact.denseStds,
    };
  }

  async classifyEmail(
    input: EmailFeatureInput & {
      isSuspiciousSender?: boolean;
      riskFlags?: string[];
    },
    overrideThresholds?: { candidateMinConfidence?: number; reviewMinMargin?: number }
  ): Promise<EmailIntelligencePrediction> {
    const artifact = await this.ensureLoaded();
    const vectorizer = this.vectorizer!;
    const scaler = this.scaler!;

    const rep = extractEmailRepresentation(input);
    const sparseTfIdf = transformTfIdfSparse(rep.tokens, vectorizer);
    const scaledDense = transformStandardScaler(rep.denseFeatures, scaler);

    let embeddingVec: Float32Array | undefined;
    if (artifact.architectureType === 'hybrid_minilm_tfidf_logreg') {
      const embText = `${rep.cleanSubject}\n${rep.freshBodyText || rep.combinedPlainText}`.trim() || '(empty)';
      embeddingVec = await this.embeddingProvider.embedNormalized(embText);
    }

    const rawScores = predictScoresFromTrainedWeights(
      { sparseTfIdf, scaledDense, embeddingVec },
      artifact
    );

    const sorted = (Object.entries(rawScores) as Array<[EmailIntelligenceCategory, number]>).sort(
      (a, b) => b[1] - a[1]
    );
    let primaryCategory = sorted[0]![0];
    const topConfidence = Number(sorted[0]![1].toFixed(4));
    const secondConfidence = Number((sorted[1]?.[1] || 0).toFixed(4));
    const margin = Number(Math.max(0, topConfidence - secondConfidence).toFixed(4));

    const riskFlags = input.riskFlags || [];
    const isSuspicious =
      Boolean(input.isSuspiciousSender) ||
      rep.structuralSignals.hasFeeOrScamDemandSignal ||
      (rep.structuralSignals.hasAuthFailureSignal && rep.structuralSignals.hasLookalikeOrReplyMismatchSignal);

    const uncertaintyReasons: string[] = [];
    const explanation: string[] = [
      `Supervised local model (${artifact.modelVersion}, ${artifact.architectureType}) top prediction: ${primaryCategory} (score=${topConfidence.toFixed(3)}, margin=${margin.toFixed(3)}, uncalibrated).`,
    ];

    // Guardrail 1: Empty, malformed, or ultra-short context-free messages without prior thread MUST NOT be overconfidently discarded
    if (
      (rep.missingAndQualityIndicators.isEmptyBody ||
        rep.missingAndQualityIndicators.hasMalformedEncoding ||
        (rep.missingAndQualityIndicators.isVeryShortBody && !rep.structuralSignals.hasPriorThread)) &&
      primaryCategory !== 'spam_or_scam'
    ) {
      if (rep.missingAndQualityIndicators.isEmptyBody) {
        uncertaintyReasons.push('Message body is empty or contains no extractable text (e.g. image-only banner or blank body).');
      }
      if (rep.missingAndQualityIndicators.hasMalformedEncoding) {
        uncertaintyReasons.push('Message contains malformed or truncated MIME character encoding.');
      }
      if (rep.missingAndQualityIndicators.isVeryShortBody && !rep.structuralSignals.hasPriorThread) {
        uncertaintyReasons.push('Message text is very short (<24 chars) without prior Gmail thread history.');
      }
      if (primaryCategory === 'unrelated_email' || primaryCategory === 'job_alert_newsletter' || topConfidence < 0.65) {
        primaryCategory = 'uncertain';
        explanation.push('Promoted to "uncertain" due to empty/malformed/short content lacking sufficient evidence.');
      }
    }

    // Build multi-label set (Section 3: an email may carry multiple valid recruitment meanings)
    const multiLabelsSet = new Set<EmailIntelligenceCategory>([primaryCategory]);
    const incompatibleWithRelevant = new Set<EmailIntelligenceCategory>(['unrelated_email', 'job_alert_newsletter']);

    for (const [cat, score] of sorted) {
      const thresh = artifact.multiLabelThresholds[cat] ?? 0.48;
      if (score >= thresh) {
        if (incompatibleWithRelevant.has(primaryCategory) && !incompatibleWithRelevant.has(cat)) {
          continue;
        }
        if (!incompatibleWithRelevant.has(primaryCategory) && incompatibleWithRelevant.has(cat)) {
          continue;
        }
        multiLabelsSet.add(cat);
      }
    }

    // If sender authenticity / scam risk flags fired, separate authenticity risk while ensuring spam_or_scam visibility
    if (isSuspicious) {
      uncertaintyReasons.push(
        `Source authenticity or scam risk flags detected: ${
          riskFlags.length > 0 ? riskFlags.join(', ') : 'fee_or_spoof_signal'
        }.`
      );
      if (rep.structuralSignals.hasFeeOrScamDemandSignal || rep.structuralSignals.hasLookalikeOrReplyMismatchSignal) {
        multiLabelsSet.add('spam_or_scam');
        primaryCategory = 'spam_or_scam';
      }
    }

    const highScoreThresh = overrideThresholds?.candidateMinConfidence ?? artifact.uncertaintyThresholds.highConfidenceMinScore;
    const highMarginThresh = overrideThresholds?.reviewMinMargin ?? artifact.uncertaintyThresholds.highConfidenceMinMargin;

    // Check if a predicted discard category (`unrelated_email` / `job_alert_newsletter`) has competing recruitment signals
    const maxActionableRecruitmentScore = Math.max(
      rawScores.relevant_opportunity,
      rawScores.recruiter_outreach,
      rawScores.jd_or_details_followup,
      rawScores.screening_or_eligibility,
      rawScores.online_assessment,
      rawScores.interview_invitation,
      rawScores.interview_followup,
      rawScores.offer
    );

    const hasCompetingRecruitmentEvidence =
      (primaryCategory === 'unrelated_email' || primaryCategory === 'job_alert_newsletter') &&
      !rep.structuralSignals.hasBulkOrUnsubscribeSignal &&
      !rep.structuralSignals.hasInternalAcademicOrAdminContext &&
      (maxActionableRecruitmentScore >= 0.25 ||
        rep.structuralSignals.hasPdfOrDocxAttachment ||
        rep.structuralSignals.hasUnusualCohortOrResidencyHiringCue);

    if (hasCompetingRecruitmentEvidence) {
      uncertaintyReasons.push(
        `Top class was ${primaryCategory}, but competing recruitment/attachment signal (max score ${maxActionableRecruitmentScore.toFixed(
          3
        )}) requires human review to prevent false-negative discard.`
      );
    }

    if (topConfidence < highScoreThresh) {
      uncertaintyReasons.push(
        `Top uncalibrated confidence (${topConfidence.toFixed(3)}) is below high-confidence threshold (${highScoreThresh.toFixed(2)}).`
      );
    }
    if (margin < highMarginThresh) {
      uncertaintyReasons.push(
        `Score margin (${margin.toFixed(3)}) between top two categories (${sorted[0]![0]} vs ${sorted[1]?.[0]}) is narrow (<${highMarginThresh.toFixed(2)}).`
      );
    }

    // Determine the 3 explicit Section 5 outcomes:
    let uncertaintyOutcome: UncertaintyOutcome;
    if (isSuspicious || primaryCategory === 'spam_or_scam') {
      uncertaintyOutcome = 'LOW_CONFIDENCE_OR_SUSPICIOUS';
    } else if (
      primaryCategory === 'uncertain' ||
      hasCompetingRecruitmentEvidence ||
      topConfidence < highScoreThresh ||
      margin < highMarginThresh ||
      (rep.structuralSignals.isFreeWebmailDomain && CATEGORY_METADATA[primaryCategory].isRecruitmentRelevant)
    ) {
      if (rep.structuralSignals.isFreeWebmailDomain && CATEGORY_METADATA[primaryCategory].isRecruitmentRelevant) {
        uncertaintyReasons.push('Sender uses a consumer webmail domain; human verification of recruiter identity required.');
      }
      if (topConfidence < artifact.uncertaintyThresholds.lowConfidenceMaxScore && primaryCategory === 'uncertain') {
        uncertaintyOutcome = 'LOW_CONFIDENCE_OR_SUSPICIOUS';
      } else {
        uncertaintyOutcome = 'REVIEW_REQUIRED';
      }
    } else {
      uncertaintyOutcome = 'HIGH_CONFIDENCE';
    }

    // Map cleanly to legacy 7-class `ScreeningClass` while NEVER allowing uncertain emails to be silently discarded!
    let legacyScreeningClass: ScreeningClass = CATEGORY_METADATA[primaryCategory].legacyScreeningClass;
    if (isSuspicious || primaryCategory === 'spam_or_scam') {
      legacyScreeningClass = 'suspicious_needs_review';
    } else if (
      (legacyScreeningClass === 'low_relevance' || legacyScreeningClass === 'newsletter_promo') &&
      uncertaintyOutcome !== 'HIGH_CONFIDENCE' &&
      hasCompetingRecruitmentEvidence
    ) {
      legacyScreeningClass = 'uncertain_needs_review';
      primaryCategory = 'uncertain';
      multiLabelsSet.add('uncertain');
    } else if (
      (legacyScreeningClass === 'candidate_opportunity' || legacyScreeningClass === 'related_jd_followup') &&
      topConfidence < 0.35 &&
      margin < 0.05
    ) {
      legacyScreeningClass = 'uncertain_needs_review';
    }

    let confidenceTier: 'high' | 'standard' | 'uncertain' | 'suspicious' = 'standard';
    if (uncertaintyOutcome === 'LOW_CONFIDENCE_OR_SUSPICIOUS') {
      confidenceTier = isSuspicious || primaryCategory === 'spam_or_scam' ? 'suspicious' : 'uncertain';
    } else if (primaryCategory === 'uncertain' || legacyScreeningClass === 'uncertain_needs_review') {
      confidenceTier = 'uncertain';
    } else if (uncertaintyOutcome === 'HIGH_CONFIDENCE') {
      confidenceTier = 'high';
    }

    return {
      primaryCategory,
      primaryDisplayName: CATEGORY_METADATA[primaryCategory].displayName,
      multiLabels: Array.from(multiLabelsSet),
      legacyScreeningClass,
      confidenceTier,
      uncertaintyOutcome,
      uncertaintyReasons,
      topConfidence,
      margin,
      isCalibratedProbability: false,
      calibrationNote: artifact.calibrationDisclosure.note,
      categoryScores: rawScores,
      classifierKind: 'supervised_trained_classifier',
      architectureType: artifact.architectureType,
      modelVersion: artifact.modelVersion,
      datasetVersion: artifact.datasetVersion,
      representation: rep,
      explanation,
    };
  }
}
