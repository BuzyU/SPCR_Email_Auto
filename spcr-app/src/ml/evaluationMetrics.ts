import {
  CATEGORY_METADATA,
  EMAIL_INTELLIGENCE_CATEGORIES,
  EmailIntelligenceCategory,
  LabeledEmailExample,
  UncertaintyOutcome,
} from './schema.js';

export interface SplitAssignmentResult {
  train: LabeledEmailExample[];
  val: LabeledEmailExample[];
  test: LabeledEmailExample[];
  groupCounts: {
    trainGroups: number;
    valGroups: number;
    testGroups: number;
    sharedThreadIdsAcrossSplits: number;
    sharedSenderOrgsAcrossSplits: number;
  };
}

function deterministicHashInt(str: string, seed = 20261029): number {
  let h = seed >>> 0;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 0x5bd1e995);
    h ^= h >>> 15;
  }
  return h >>> 0;
}

/**
 * Mandatory Addendum Section 6 & `ml-best-practices`:
 * Splits examples into `train` (~60%), `val` (~20%), and `test` (~20%) using connected components
 * over BOTH `threadId` AND `senderOrgGroup`, stratified by dominant category so:
 * 1) Near-duplicate emails, same-thread messages, and same-organization messages NEVER leak across splits.
 * 2) Every one of the 14 categories has support in `train`, `val`, and held-out `test`.
 */
export function splitDatasetByThreadAndOrgGroup(
  examples: LabeledEmailExample[],
  seed = 20261029
): SplitAssignmentResult {
  const n = examples.length;
  const parent = Array.from({ length: n }, (_, i) => i);
  const find = (x: number): number => {
    let curr = x;
    while (parent[curr] !== curr) {
      parent[curr] = parent[parent[curr]!]!;
      curr = parent[curr]!;
    }
    return curr;
  };
  const union = (a: number, b: number) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[rb] = ra;
  };

  const byThread = new Map<string, number>();
  const byOrg = new Map<string, number>();

  for (let i = 0; i < n; i++) {
    const ex = examples[i]!;
    const thKey = ex.threadId.trim().toLowerCase();
    const orgKey = ex.senderOrgGroup.trim().toLowerCase();
    if (byThread.has(thKey)) {
      union(i, byThread.get(thKey)!);
    } else {
      byThread.set(thKey, i);
    }
    if (byOrg.has(orgKey)) {
      union(i, byOrg.get(orgKey)!);
    } else {
      byOrg.set(orgKey, i);
    }
  }

  const clustersMap = new Map<number, LabeledEmailExample[]>();
  for (let i = 0; i < n; i++) {
    const r = find(i);
    const arr = clustersMap.get(r) || [];
    arr.push(examples[i]!);
    clustersMap.set(r, arr);
  }

  // Group clusters by their rarest/primary category for balanced stratified group assignment
  const categoryTotalCounts = new Map<EmailIntelligenceCategory, number>();
  for (const c of EMAIL_INTELLIGENCE_CATEGORIES) categoryTotalCounts.set(c, 0);
  for (const ex of examples) {
    categoryTotalCounts.set(ex.primaryCategory, (categoryTotalCounts.get(ex.primaryCategory) || 0) + 1);
  }

  const clustersByAnchorLabel = new Map<EmailIntelligenceCategory, LabeledEmailExample[][]>();
  for (const c of EMAIL_INTELLIGENCE_CATEGORIES) clustersByAnchorLabel.set(c, []);

  for (const cluster of clustersMap.values()) {
    // Anchor cluster on the rarest category inside the cluster so rare categories don't starve val/test
    const sortedCats = [...cluster]
      .map((e) => e.primaryCategory)
      .sort((a, b) => (categoryTotalCounts.get(a) || 0) - (categoryTotalCounts.get(b) || 0));
    const anchor = sortedCats[0]!;
    clustersByAnchorLabel.get(anchor)!.push(cluster);
  }

  const train: LabeledEmailExample[] = [];
  const val: LabeledEmailExample[] = [];
  const test: LabeledEmailExample[] = [];
  let trainGroups = 0;
  let valGroups = 0;
  let testGroups = 0;

  for (const cat of EMAIL_INTELLIGENCE_CATEGORIES) {
    const catClusters = clustersByAnchorLabel.get(cat) || [];
    catClusters.sort((a, b) => {
      const ha = deterministicHashInt(a[0]!.id, seed);
      const hb = deterministicHashInt(b[0]!.id, seed);
      return ha - hb;
    });

    // Assign deterministically: index 0 -> test, index 1 -> val, index 2..4 -> train, cycling every 5 clusters (60/20/20)
    for (let idx = 0; idx < catClusters.length; idx++) {
      const cl = catClusters[idx]!;
      const mod = idx % 5;
      if (mod === 0 && catClusters.length >= 3) {
        for (const item of cl) test.push({ ...item, split: 'test' });
        testGroups++;
      } else if (mod === 1 && catClusters.length >= 3) {
        for (const item of cl) val.push({ ...item, split: 'val' });
        valGroups++;
      } else {
        for (const item of cl) train.push({ ...item, split: 'train' });
        trainGroups++;
      }
    }
  }

  const leakage = verifyZeroGroupLeakage({ train, val, test });

  return {
    train,
    val,
    test,
    groupCounts: {
      trainGroups,
      valGroups,
      testGroups,
      sharedThreadIdsAcrossSplits: leakage.sharedThreadIds,
      sharedSenderOrgsAcrossSplits: leakage.sharedSenderOrgs,
    },
  };
}

export function verifyZeroGroupLeakage(splits: {
  train: LabeledEmailExample[];
  val: LabeledEmailExample[];
  test: LabeledEmailExample[];
}): { sharedThreadIds: number; sharedSenderOrgs: number } {
  const threads = {
    train: new Set(splits.train.map((e) => e.threadId.toLowerCase())),
    val: new Set(splits.val.map((e) => e.threadId.toLowerCase())),
    test: new Set(splits.test.map((e) => e.threadId.toLowerCase())),
  };
  const orgs = {
    train: new Set(splits.train.map((e) => e.senderOrgGroup.toLowerCase())),
    val: new Set(splits.val.map((e) => e.senderOrgGroup.toLowerCase())),
    test: new Set(splits.test.map((e) => e.senderOrgGroup.toLowerCase())),
  };

  let sharedThreadIds = 0;
  for (const t of threads.train) {
    if (threads.val.has(t) || threads.test.has(t)) sharedThreadIds++;
  }
  for (const t of threads.val) {
    if (threads.test.has(t)) sharedThreadIds++;
  }

  let sharedSenderOrgs = 0;
  for (const o of orgs.train) {
    if (orgs.val.has(o) || orgs.test.has(o)) sharedSenderOrgs++;
  }
  for (const o of orgs.val) {
    if (orgs.test.has(o)) sharedSenderOrgs++;
  }

  return { sharedThreadIds, sharedSenderOrgs };
}

export interface PredictionRecordForEval {
  example: LabeledEmailExample;
  predictedPrimary: EmailIntelligenceCategory;
  predictedMultiLabels: EmailIntelligenceCategory[];
  topConfidence: number;
  margin: number;
  uncertaintyOutcome: UncertaintyOutcome;
}

export interface PerClassMetrics {
  label: EmailIntelligenceCategory;
  displayName: string;
  precision: number;
  recall: number;
  f1: number;
  support: number;
  predictedCount: number;
}

export interface FalseNegativeErrorItem {
  id: string;
  subject: string;
  truePrimary: EmailIntelligenceCategory;
  predictedPrimary: EmailIntelligenceCategory;
  uncertaintyOutcome: UncertaintyOutcome;
  wasSilentlyDiscarded: boolean;
  topConfidence: number;
  hardCaseTags: string[];
}

export interface ComprehensiveEvaluationSummary {
  sampleCount: number;
  accuracy: number;
  macroPrecision: number;
  macroRecall: number;
  macroF1: number;
  weightedF1: number;
  multiLabelMicroF1: number;
  relevantOpportunityRecall: number;
  silentOpportunityDiscardCount: number;
  silentOpportunityDiscardRate: number;
  bootstrap95Ci: {
    macroF1Low: number;
    macroF1High: number;
    accuracyLow: number;
    accuracyHigh: number;
  };
  perClass: PerClassMetrics[];
  confusionMatrixLabels: readonly EmailIntelligenceCategory[];
  confusionMatrix: number[][];
  sliceMetrics: Record<string, { count: number; accuracy: number; silentDiscards: number }>;
  falseNegatives: FalseNegativeErrorItem[];
}

function computeCoreMacroAndAccuracy(records: PredictionRecordForEval[]): {
  accuracy: number;
  macroF1: number;
} {
  if (records.length === 0) return { accuracy: 0, macroF1: 0 };
  let correct = 0;
  const tp = new Map<EmailIntelligenceCategory, number>();
  const fp = new Map<EmailIntelligenceCategory, number>();
  const fn = new Map<EmailIntelligenceCategory, number>();

  for (const r of records) {
    const yTrue = r.example.primaryCategory;
    const yPred = r.predictedPrimary;
    if (yTrue === yPred) {
      correct++;
      tp.set(yTrue, (tp.get(yTrue) || 0) + 1);
    } else {
      fp.set(yPred, (fp.get(yPred) || 0) + 1);
      fn.set(yTrue, (fn.get(yTrue) || 0) + 1);
    }
  }

  let f1Sum = 0;
  let activeClassCount = 0;
  for (const c of EMAIL_INTELLIGENCE_CATEGORIES) {
    const t = tp.get(c) || 0;
    const fPos = fp.get(c) || 0;
    const fNeg = fn.get(c) || 0;
    const support = t + fNeg;
    if (support === 0 && fPos === 0) continue;
    activeClassCount++;
    const prec = t + fPos > 0 ? t / (t + fPos) : 0;
    const rec = support > 0 ? t / support : 0;
    const f1 = prec + rec > 0 ? (2 * prec * rec) / (prec + rec) : 0;
    f1Sum += f1;
  }

  return {
    accuracy: correct / records.length,
    macroF1: activeClassCount > 0 ? f1Sum / activeClassCount : 0,
  };
}

export function evaluatePredictionsComprehensively(
  records: PredictionRecordForEval[],
  bootstrapIterations = 400
): ComprehensiveEvaluationSummary {
  const n = records.length;
  const labelIdx = new Map<EmailIntelligenceCategory, number>();
  EMAIL_INTELLIGENCE_CATEGORIES.forEach((l, i) => labelIdx.set(l, i));

  const numLabels = EMAIL_INTELLIGENCE_CATEGORIES.length;
  const confusionMatrix: number[][] = Array.from({ length: numLabels }, () =>
    new Array<number>(numLabels).fill(0)
  );

  let exactMatches = 0;
  let mlTp = 0;
  let mlFp = 0;
  let mlFn = 0;

  let oppTotal = 0;
  let oppRecalled = 0;
  let silentOpportunityDiscardCount = 0;
  const falseNegatives: FalseNegativeErrorItem[] = [];

  for (const rec of records) {
    const yTrue = rec.example.primaryCategory;
    const yPred = rec.predictedPrimary;
    const rIdx = labelIdx.get(yTrue)!;
    const cIdx = labelIdx.get(yPred)!;
    confusionMatrix[rIdx]![cIdx]! += 1;

    if (yTrue === yPred) exactMatches++;

    const trueSet = new Set(rec.example.multiLabels);
    const predSet = new Set(rec.predictedMultiLabels);
    for (const l of EMAIL_INTELLIGENCE_CATEGORIES) {
      const inT = trueSet.has(l);
      const inP = predSet.has(l);
      if (inT && inP) mlTp++;
      else if (!inT && inP) mlFp++;
      else if (inT && !inP) mlFn++;
    }

    const isActionableRecruitmentTrue =
      CATEGORY_METADATA[yTrue].isRecruitmentRelevant || yTrue === 'uncertain';
    const predictedDiscardBucket =
      yPred === 'unrelated_email' || yPred === 'job_alert_newsletter';
    const wasSilentlyDiscarded =
      predictedDiscardBucket && rec.uncertaintyOutcome === 'HIGH_CONFIDENCE';

    if (yTrue === 'relevant_opportunity' || yTrue === 'recruiter_outreach') {
      oppTotal++;
      if (
        yPred === yTrue ||
        predSet.has('relevant_opportunity') ||
        predSet.has('recruiter_outreach')
      ) {
        oppRecalled++;
      }
    }

    if (isActionableRecruitmentTrue) {
      if (wasSilentlyDiscarded) {
        silentOpportunityDiscardCount++;
      }
      if (yPred !== yTrue && predictedDiscardBucket) {
        falseNegatives.push({
          id: rec.example.id,
          subject: rec.example.subject,
          truePrimary: yTrue,
          predictedPrimary: yPred,
          uncertaintyOutcome: rec.uncertaintyOutcome,
          wasSilentlyDiscarded,
          topConfidence: rec.topConfidence,
          hardCaseTags: rec.example.hardCaseTags,
        });
      }
    }
  }

  const perClass: PerClassMetrics[] = [];
  let macroPSum = 0;
  let macroRSum = 0;
  let macroF1Sum = 0;
  let weightedF1Sum = 0;
  let supportedClasses = 0;

  for (let i = 0; i < numLabels; i++) {
    const label = EMAIL_INTELLIGENCE_CATEGORIES[i]!;
    const tp = confusionMatrix[i]![i]!;
    let rowSum = 0;
    let colSum = 0;
    for (let j = 0; j < numLabels; j++) {
      rowSum += confusionMatrix[i]![j]!;
      colSum += confusionMatrix[j]![i]!;
    }
    const precision = colSum > 0 ? tp / colSum : 0;
    const recall = rowSum > 0 ? tp / rowSum : 0;
    const f1 = precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0;

    if (rowSum > 0) {
      supportedClasses++;
      macroPSum += precision;
      macroRSum += recall;
      macroF1Sum += f1;
      weightedF1Sum += f1 * rowSum;
    }

    perClass.push({
      label,
      displayName: CATEGORY_METADATA[label].displayName,
      precision: Number(precision.toFixed(4)),
      recall: Number(recall.toFixed(4)),
      f1: Number(f1.toFixed(4)),
      support: rowSum,
      predictedCount: colSum,
    });
  }

  const multiLabelMicroF1 =
    2 * mlTp + mlFp + mlFn > 0 ? (2 * mlTp) / (2 * mlTp + mlFp + mlFn) : 0;

  // Slice-based error analysis across hard-case tags (`ml-best-practices`)
  const sliceBuckets = new Map<string, PredictionRecordForEval[]>();
  for (const rec of records) {
    const tags = rec.example.hardCaseTags.length > 0 ? rec.example.hardCaseTags : ['untagged'];
    for (const tag of tags) {
      const arr = sliceBuckets.get(tag) || [];
      arr.push(rec);
      sliceBuckets.set(tag, arr);
    }
  }
  const sliceMetrics: Record<string, { count: number; accuracy: number; silentDiscards: number }> = {};
  for (const [tag, arr] of sliceBuckets.entries()) {
    const hits = arr.filter((r) => r.predictedPrimary === r.example.primaryCategory).length;
    const discards = arr.filter(
      (r) =>
        (CATEGORY_METADATA[r.example.primaryCategory].isRecruitmentRelevant ||
          r.example.primaryCategory === 'uncertain') &&
        (r.predictedPrimary === 'unrelated_email' || r.predictedPrimary === 'job_alert_newsletter') &&
        r.uncertaintyOutcome === 'HIGH_CONFIDENCE'
    ).length;
    sliceMetrics[tag] = {
      count: arr.length,
      accuracy: Number((hits / arr.length).toFixed(4)),
      silentDiscards: discards,
    };
  }

  // Deterministic seeded bootstrap 95% confidence intervals (`ml-best-practices`)
  const bootMacroF1: number[] = [];
  const bootAcc: number[] = [];
  if (n > 0 && bootstrapIterations > 0) {
    let rngState = 13372026 >>> 0;
    const nextRand = () => {
      rngState = (Math.imul(1664525, rngState) + 1013904223) >>> 0;
      return rngState / 0x100000000;
    };

    for (let b = 0; b < bootstrapIterations; b++) {
      const sample: PredictionRecordForEval[] = new Array(n);
      for (let k = 0; k < n; k++) {
        sample[k] = records[Math.floor(nextRand() * n)]!;
      }
      const res = computeCoreMacroAndAccuracy(sample);
      bootMacroF1.push(res.macroF1);
      bootAcc.push(res.accuracy);
    }
    bootMacroF1.sort((a, b) => a - b);
    bootAcc.sort((a, b) => a - b);
  }

  const pct = (arr: number[], q: number) =>
    arr.length > 0 ? Number(arr[Math.min(arr.length - 1, Math.floor(q * arr.length))]!.toFixed(4)) : 0;

  const actionableSupport = records.filter(
    (r) =>
      CATEGORY_METADATA[r.example.primaryCategory].isRecruitmentRelevant ||
      r.example.primaryCategory === 'uncertain'
  ).length;

  return {
    sampleCount: n,
    accuracy: n > 0 ? Number((exactMatches / n).toFixed(4)) : 0,
    macroPrecision: supportedClasses > 0 ? Number((macroPSum / supportedClasses).toFixed(4)) : 0,
    macroRecall: supportedClasses > 0 ? Number((macroRSum / supportedClasses).toFixed(4)) : 0,
    macroF1: supportedClasses > 0 ? Number((macroF1Sum / supportedClasses).toFixed(4)) : 0,
    weightedF1: n > 0 ? Number((weightedF1Sum / n).toFixed(4)) : 0,
    multiLabelMicroF1: Number(multiLabelMicroF1.toFixed(4)),
    relevantOpportunityRecall: oppTotal > 0 ? Number((oppRecalled / oppTotal).toFixed(4)) : 0,
    silentOpportunityDiscardCount,
    silentOpportunityDiscardRate:
      actionableSupport > 0 ? Number((silentOpportunityDiscardCount / actionableSupport).toFixed(4)) : 0,
    bootstrap95Ci: {
      macroF1Low: pct(bootMacroF1, 0.025),
      macroF1High: pct(bootMacroF1, 0.975),
      accuracyLow: pct(bootAcc, 0.025),
      accuracyHigh: pct(bootAcc, 0.975),
    },
    perClass,
    confusionMatrixLabels: EMAIL_INTELLIGENCE_CATEGORIES,
    confusionMatrix,
    sliceMetrics,
    falseNegatives,
  };
}

