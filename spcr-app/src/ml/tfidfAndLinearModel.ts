import fs from 'node:fs';
import { sha256Hex } from '../utils/crypto.js';
import {
  EMAIL_INTELLIGENCE_CATEGORIES,
  EmailIntelligenceCategory,
  ModelArtifactIntegrityError,
  PreprocessingConfig,
  TrainedEmailModelArtifact,
  TrainedEmailModelArtifactSchema,
} from './schema.js';

export interface FittedTfIdfVectorizer {
  vocabulary: string[];
  tokenToIndex: Map<string, number>;
  idfVector: number[];
  sublinearTf: boolean;
}

export interface FittedStandardScaler {
  means: number[];
  stds: number[];
}

/**
 * STRICT FEATURIZATION ORDERING (`ml-best-practices`):
 * Fits vocabulary and IDF weights EXCLUSIVELY on the training split (`trainTokenLists`).
 * Validation and held-out test documents MUST NEVER be passed to `fitTfIdfVectorizer`.
 */
export function fitTfIdfVectorizer(
  trainTokenLists: string[][],
  config: PreprocessingConfig
): FittedTfIdfVectorizer {
  const nDocs = trainTokenLists.length;
  if (nDocs === 0) {
    throw new Error('Cannot fit TF-IDF vectorizer on an empty training split.');
  }

  const docFreq = new Map<string, number>();
  for (const tokens of trainTokenLists) {
    const uniqueInDoc = new Set(tokens);
    for (const tok of uniqueInDoc) {
      docFreq.set(tok, (docFreq.get(tok) || 0) + 1);
    }
  }

  // Filter by minDocFreq and rank by document frequency (tie-broken lexicographically for 100% deterministic export)
  const candidates = Array.from(docFreq.entries())
    .filter(([, df]) => df >= config.minDocFreq)
    .sort((a, b) => (b[1] !== a[1] ? b[1] - a[1] : a[0].localeCompare(b[0])))
    .slice(0, config.maxVocabSize);

  const vocabulary = candidates.map(([tok]) => tok).sort();
  const tokenToIndex = new Map<string, number>();
  const idfVector: number[] = [];

  for (let i = 0; i < vocabulary.length; i++) {
    const tok = vocabulary[i]!;
    const df = docFreq.get(tok) || 1;
    tokenToIndex.set(tok, i);
    const idf = Math.log((1 + nDocs) / (1 + df)) + 1;
    idfVector.push(Number(idf.toFixed(6)));
  }

  return {
    vocabulary,
    tokenToIndex,
    idfVector,
    sublinearTf: config.sublinearTf,
  };
}

export function transformTfIdfSparse(
  tokens: string[],
  vectorizer: FittedTfIdfVectorizer
): Array<[number, number]> {
  const tfCounts = new Map<number, number>();
  for (const tok of tokens) {
    const idx = vectorizer.tokenToIndex.get(tok);
    if (idx !== undefined) {
      tfCounts.set(idx, (tfCounts.get(idx) || 0) + 1);
    }
  }

  const entries: Array<[number, number]> = [];
  let sumSq = 0;
  for (const [idx, count] of tfCounts.entries()) {
    const tf = vectorizer.sublinearTf ? 1 + Math.log(count) : count;
    const val = tf * (vectorizer.idfVector[idx] || 1);
    entries.push([idx, val]);
    sumSq += val * val;
  }

  if (sumSq > 0) {
    const norm = Math.sqrt(sumSq);
    for (let i = 0; i < entries.length; i++) {
      entries[i] = [entries[i]![0], entries[i]![1] / norm];
    }
  }

  entries.sort((a, b) => a[0] - b[0]);
  return entries;
}

/**
 * STRICT FEATURIZATION ORDERING (`ml-best-practices`):
 * Fits mean and standard deviation EXCLUSIVELY on the training split's dense features.
 */
export function fitStandardScaler(trainDenseRows: number[][]): FittedStandardScaler {
  const n = trainDenseRows.length;
  const dim = trainDenseRows[0]?.length || 0;
  const means = new Array<number>(dim).fill(0);
  const stds = new Array<number>(dim).fill(1);

  if (n === 0 || dim === 0) return { means, stds };

  for (const row of trainDenseRows) {
    for (let j = 0; j < dim; j++) {
      means[j] = (means[j] || 0) + (row[j] || 0);
    }
  }
  for (let j = 0; j < dim; j++) {
    means[j] = (means[j] || 0) / n;
  }

  const variances = new Array<number>(dim).fill(0);
  for (const row of trainDenseRows) {
    for (let j = 0; j < dim; j++) {
      const diff = (row[j] || 0) - (means[j] || 0);
      variances[j]! += diff * diff;
    }
  }

  for (let j = 0; j < dim; j++) {
    const s = Math.sqrt((variances[j] || 0) / Math.max(1, n));
    means[j] = Number((means[j] || 0).toFixed(6));
    stds[j] = s > 1e-6 ? Number(s.toFixed(6)) : 1;
  }

  return { means, stds };
}

export function transformStandardScaler(row: number[], scaler: FittedStandardScaler, scaleFactor = 0.35): number[] {
  const out = new Array<number>(scaler.means.length);
  for (let j = 0; j < scaler.means.length; j++) {
    const z = ((row[j] || 0) - (scaler.means[j] || 0)) / (scaler.stds[j] || 1);
    // Clip extreme z-scores and apply block weight so dense structural features complement unit-norm TF-IDF/MiniLM vectors
    const clipped = Math.max(-5, Math.min(5, z));
    out[j] = clipped * scaleFactor;
  }
  return out;
}

export interface SparsePlusDenseVector {
  sparseTfIdf: Array<[number, number]>;
  scaledDense: number[];
  embeddingVec?: Float32Array | number[];
}

function sigmoid(z: number): number {
  if (z >= 35) return 1;
  if (z <= -35) return 0;
  return 1 / (1 + Math.exp(-z));
}

export function computeLinearLogit(
  x: SparsePlusDenseVector,
  weights: number[],
  bias: number,
  vocabLen: number,
  denseLen: number
): number {
  let z = bias;
  for (const [idx, val] of x.sparseTfIdf) {
    z += (weights[idx] || 0) * val;
  }
  for (let j = 0; j < denseLen; j++) {
    z += (weights[vocabLen + j] || 0) * (x.scaledDense[j] || 0);
  }
  if (x.embeddingVec) {
    const embOffset = vocabLen + denseLen;
    for (let k = 0; k < x.embeddingVec.length; k++) {
      z += (weights[embOffset + k] || 0) * (x.embeddingVec[k] || 0);
    }
  }
  return z;
}

export interface TrainedOvRWeights {
  weightsByLabel: Record<EmailIntelligenceCategory, number[]>;
  biasByLabel: Record<EmailIntelligenceCategory, number>;
}

/**
 * Deterministic Class-Balanced L2-Regularized One-vs-Rest Logistic Regression Trainer.
 * Optimizes convex L2-penalized binary cross-entropy for each of the 14 recruitment categories
 * using Nesterov Accelerated Gradient Descent on CPU (zero GPU / zero paid dependencies).
 */
export function trainOneVsRestLogisticRegression(params: {
  trainVectors: SparsePlusDenseVector[];
  trainMultiLabels: Set<EmailIntelligenceCategory>[];
  vocabLen: number;
  denseLen: number;
  embeddingLen: number;
  regularizationLambda: number;
  epochs?: number;
  baseLr?: number;
}): TrainedOvRWeights {
  const {
    trainVectors,
    trainMultiLabels,
    vocabLen,
    denseLen,
    embeddingLen,
    regularizationLambda,
    epochs = 260,
    baseLr = 0.85,
  } = params;

  const nSamples = trainVectors.length;
  const totalDim = vocabLen + denseLen + embeddingLen;

  const weightsByLabel = {} as Record<EmailIntelligenceCategory, number[]>;
  const biasByLabel = {} as Record<EmailIntelligenceCategory, number>;

  for (const label of EMAIL_INTELLIGENCE_CATEGORIES) {
    const w = new Float64Array(totalDim);
    const vW = new Float64Array(totalDim);
    let b = 0;
    let vB = 0;

    let posCount = 0;
    const targets = new Uint8Array(nSamples);
    for (let i = 0; i < nSamples; i++) {
      if (trainMultiLabels[i]!.has(label)) {
        targets[i] = 1;
        posCount++;
      }
    }

    const negCount = Math.max(1, nSamples - posCount);
    // Gentle balanced positive weight (sqrt-damped so rare classes get strong recall without destroying precision)
    const posWeight = posCount > 0 ? Math.min(6.0, Math.max(1.0, Math.sqrt(negCount / posCount))) : 1.0;
    const momentum = 0.85;
    const gradW = new Float64Array(totalDim);

    for (let ep = 0; ep < epochs; ep++) {
      gradW.fill(0);
      let gradB = 0;

      // Nesterov lookahead point
      const lookB = b + momentum * vB;
      for (let i = 0; i < nSamples; i++) {
        const x = trainVectors[i]!;
        let z = lookB;
        for (const [idx, val] of x.sparseTfIdf) {
          z += (w[idx]! + momentum * vW[idx]!) * val;
        }
        for (let j = 0; j < denseLen; j++) {
          const idx = vocabLen + j;
          z += (w[idx]! + momentum * vW[idx]!) * (x.scaledDense[j] || 0);
        }
        if (embeddingLen > 0 && x.embeddingVec) {
          const embOffset = vocabLen + denseLen;
          for (let k = 0; k < embeddingLen; k++) {
            const idx = embOffset + k;
            z += (w[idx]! + momentum * vW[idx]!) * (x.embeddingVec[k] || 0);
          }
        }

        const p = sigmoid(z);
        const y = targets[i]!;
        const sampleWeight = y === 1 ? posWeight : 1.0;
        const err = ((p - y) * sampleWeight) / nSamples;

        gradB += err;
        for (const [idx, val] of x.sparseTfIdf) {
          gradW[idx]! += err * val;
        }
        for (let j = 0; j < denseLen; j++) {
          gradW[vocabLen + j]! += err * (x.scaledDense[j] || 0);
        }
        if (embeddingLen > 0 && x.embeddingVec) {
          const embOffset = vocabLen + denseLen;
          for (let k = 0; k < embeddingLen; k++) {
            gradW[embOffset + k]! += err * (x.embeddingVec[k] || 0);
          }
        }
      }

      const lr = baseLr / (1 + 0.006 * ep);
      vB = momentum * vB - lr * gradB;
      b += vB;

      for (let d = 0; d < totalDim; d++) {
        const g = gradW[d]! + regularizationLambda * w[d]!;
        vW[d] = momentum * vW[d]! - lr * g;
        w[d]! += vW[d]!;
      }
    }

    weightsByLabel[label] = Array.from(w, (val) => Number(val.toFixed(6)));
    biasByLabel[label] = Number(b.toFixed(6));
  }

  return { weightsByLabel, biasByLabel };
}

export function predictScoresFromTrainedWeights(
  x: SparsePlusDenseVector,
  artifact: Pick<
    TrainedEmailModelArtifact,
    'labels' | 'vocabulary' | 'denseFeatureNames' | 'weightsByLabel' | 'biasByLabel'
  >
): Record<EmailIntelligenceCategory, number> {
  const vocabLen = artifact.vocabulary.length;
  const denseLen = artifact.denseFeatureNames.length;
  const scores = {} as Record<EmailIntelligenceCategory, number>;

  for (const label of artifact.labels) {
    const w = artifact.weightsByLabel[label];
    const b = artifact.biasByLabel[label];
    if (!w || typeof b !== 'number') {
      throw new ModelArtifactIntegrityError(
        `Trained model artifact is missing weight vector or bias for required label "${label}".`,
        'ARTIFACT_SCHEMA_INVALID'
      );
    }
    const z = computeLinearLogit(x, w, b, vocabLen, denseLen);
    scores[label] = Number(sigmoid(z).toFixed(6));
  }
  return scores;
}

export function computeArtifactWeightsChecksum(
  payload: Omit<TrainedEmailModelArtifact, 'weightsPayloadSha256'>
): string {
  const canonical = JSON.stringify({
    artifactFormatVersion: payload.artifactFormatVersion,
    modelVersion: payload.modelVersion,
    architectureType: payload.architectureType,
    labels: payload.labels,
    vocabulary: payload.vocabulary,
    idfVector: payload.idfVector,
    denseFeatureNames: payload.denseFeatureNames,
    denseMeans: payload.denseMeans,
    denseStds: payload.denseStds,
    weightsByLabel: payload.weightsByLabel,
    biasByLabel: payload.biasByLabel,
    multiLabelThresholds: payload.multiLabelThresholds,
    uncertaintyThresholds: payload.uncertaintyThresholds,
  });
  return sha256Hex(canonical);
}

/**
 * Mandatory Addendum Section 8 & Section 10.5:
 * Loads and strictly validates the local supervised model artifact.
 * Missing, truncated, schema-invalid, or checksum-tampered artifacts MUST throw `ModelArtifactIntegrityError`
 * — NEVER silently misclassifying or discarding emails!
 */
export function loadAndVerifyTrainedArtifact(artifactPath: string): {
  artifact: TrainedEmailModelArtifact;
  fileSha256: string;
} {
  if (!artifactPath || !fs.existsSync(artifactPath)) {
    throw new ModelArtifactIntegrityError(
      `Recruitment email model artifact not found at "${artifactPath}". Run "npm run ml:train" to build or restore the verified model artifact.`,
      'ARTIFACT_MISSING'
    );
  }

  let rawText: string;
  try {
    rawText = fs.readFileSync(artifactPath, 'utf8');
  } catch (err: any) {
    throw new ModelArtifactIntegrityError(
      `Unable to read model artifact at "${artifactPath}": ${err?.message || 'read error'}`,
      'ARTIFACT_MISSING'
    );
  }

  const fileSha256 = sha256Hex(rawText);

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(rawText);
  } catch (err: any) {
    throw new ModelArtifactIntegrityError(
      `Model artifact at "${artifactPath}" contains malformed JSON (${err?.message || 'parse error'}). Halting classification safely.`,
      'ARTIFACT_MALFORMED_JSON'
    );
  }

  const zodResult = TrainedEmailModelArtifactSchema.safeParse(parsedJson);
  if (!zodResult.success) {
    throw new ModelArtifactIntegrityError(
      `Model artifact at "${artifactPath}" failed schema validation: ${zodResult.error.issues
        .slice(0, 3)
        .map((i) => `${i.path.join('.')}: ${i.message}`)
        .join('; ')}`,
      'ARTIFACT_SCHEMA_INVALID'
    );
  }

  const artifact = zodResult.data;
  const expectedDim =
    artifact.vocabulary.length +
    artifact.denseFeatureNames.length +
    (artifact.embeddingBackbone ? artifact.embeddingBackbone.dimensions : 0);

  if (artifact.idfVector.length !== artifact.vocabulary.length) {
    throw new ModelArtifactIntegrityError(
      `Model artifact vocabulary length (${artifact.vocabulary.length}) does not match idfVector length (${artifact.idfVector.length}).`,
      'ARTIFACT_SCHEMA_INVALID'
    );
  }
  if (
    artifact.denseMeans.length !== artifact.denseFeatureNames.length ||
    artifact.denseStds.length !== artifact.denseFeatureNames.length
  ) {
    throw new ModelArtifactIntegrityError(
      `Model artifact dense feature scaler dimensions do not match denseFeatureNames (${artifact.denseFeatureNames.length}).`,
      'ARTIFACT_SCHEMA_INVALID'
    );
  }

  for (const label of EMAIL_INTELLIGENCE_CATEGORIES) {
    const w = artifact.weightsByLabel[label];
    if (!w || w.length !== expectedDim) {
      throw new ModelArtifactIntegrityError(
        `Weight vector for "${label}" has length ${w?.length ?? 0}, expected ${expectedDim}.`,
        'ARTIFACT_SCHEMA_INVALID'
      );
    }
    if (w.some((v) => !Number.isFinite(v)) || !Number.isFinite(artifact.biasByLabel[label])) {
      throw new ModelArtifactIntegrityError(
        `Weight vector or bias for "${label}" contains NaN/Infinity.`,
        'ARTIFACT_SCHEMA_INVALID'
      );
    }
  }

  const { weightsPayloadSha256, ...rest } = artifact;
  const computedWeightsSha = computeArtifactWeightsChecksum(rest);
  if (computedWeightsSha !== weightsPayloadSha256) {
    throw new ModelArtifactIntegrityError(
      `Model artifact checksum mismatch for "${artifactPath}": expected ${weightsPayloadSha256}, computed ${computedWeightsSha}.`,
      'ARTIFACT_CHECKSUM_MISMATCH'
    );
  }

  return { artifact, fileSha256 };
}
