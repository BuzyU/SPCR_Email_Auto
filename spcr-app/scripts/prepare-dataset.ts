import fs from 'node:fs';
import path from 'node:path';
import { sha256Hex } from '../src/utils/crypto.js';
import { buildCuratedCorpusPart1 } from '../src/ml/curatedCorpusPart1.js';
import { buildCuratedCorpusPart2 } from '../src/ml/curatedCorpusPart2.js';
import { buildCuratedCorpusPart3 } from '../src/ml/curatedCorpusPart3.js';
import {
  EMAIL_INTELLIGENCE_CATEGORIES,
  LabeledEmailExample,
  LabeledEmailExampleSchema,
} from '../src/ml/schema.js';
import { extractEmailRepresentation } from '../src/ml/preprocessing.js';
import { splitDatasetByThreadAndOrgGroup } from '../src/ml/evaluationMetrics.js';

export interface DatasetPreparationSummary {
  datasetVersion: string;
  generatedAt: string;
  corpusFileSha256: string;
  totalCuratedExamples: number;
  totalRealConsentedExamples: number;
  missingAndQualityCounts: {
    emptyBodyCount: number;
    veryShortBodyCount: number;
    missingSubjectCount: number;
    htmlOnlyCount: number;
    malformedEncodingCount: number;
    missingHandlingPolicy: string;
  };
  splitCounts: {
    train: number;
    val: number;
    test: number;
  };
  groupLeakageVerification: {
    sharedThreadIdsAcrossSplits: number;
    sharedSenderOrgsAcrossSplits: number;
  };
  perCategorySupport: Record<string, { train: number; val: number; test: number; total: number }>;
}

export function prepareRecruitmentDataset(rootDir = process.cwd()): DatasetPreparationSummary {
  const dataDir = path.join(rootDir, 'ml', 'data');
  fs.mkdirSync(dataDir, { recursive: true });

  const rawExamples: LabeledEmailExample[] = [
    ...buildCuratedCorpusPart1(),
    ...buildCuratedCorpusPart2(),
    ...buildCuratedCorpusPart3(),
  ];

  // Validate every example against strict Zod schema and check unique IDs (`ml-best-practices` data hygiene check)
  const seenIds = new Set<string>();
  const validatedExamples: LabeledEmailExample[] = [];
  for (const ex of rawExamples) {
    const parsed = LabeledEmailExampleSchema.parse(ex);
    if (seenIds.has(parsed.id)) {
      throw new Error(`Duplicate dataset example ID detected: ${parsed.id}`);
    }
    seenIds.add(parsed.id);
    if (!parsed.multiLabels.includes(parsed.primaryCategory)) {
      parsed.multiLabels = [parsed.primaryCategory, ...parsed.multiLabels];
    }
    validatedExamples.push(parsed);
  }

  // Analyze missing/NULL/malformed values (`ml-best-practices`: inspect frequency, keep & represent as missingness features!)
  let emptyBodyCount = 0;
  let veryShortBodyCount = 0;
  let missingSubjectCount = 0;
  let htmlOnlyCount = 0;
  let malformedEncodingCount = 0;

  for (const ex of validatedExamples) {
    const rep = extractEmailRepresentation(ex);
    if (rep.missingAndQualityIndicators.isEmptyBody) emptyBodyCount++;
    if (rep.missingAndQualityIndicators.isVeryShortBody) veryShortBodyCount++;
    if (rep.missingAndQualityIndicators.hasMissingSubject) missingSubjectCount++;
    if (rep.missingAndQualityIndicators.isHtmlOnlySource) htmlOnlyCount++;
    if (rep.missingAndQualityIndicators.hasMalformedEncoding) malformedEncodingCount++;
  }

  // Group-disjoint split by BOTH `threadId` AND `senderOrgGroup` BEFORE any featurization!
  const splitResult = splitDatasetByThreadAndOrgGroup(validatedExamples, 20261029);
  if (
    splitResult.groupCounts.sharedThreadIdsAcrossSplits !== 0 ||
    splitResult.groupCounts.sharedSenderOrgsAcrossSplits !== 0
  ) {
    throw new Error('FATAL LEAKAGE ERROR: Non-zero thread or sender organization overlap across splits!');
  }

  const allSplitExamples = [...splitResult.train, ...splitResult.val, ...splitResult.test];
  const jsonlContent = allSplitExamples.map((e) => JSON.stringify(e)).join('\n') + '\n';
  const corpusPath = path.join(dataDir, 'curated_recruitment_corpus_v1.jsonl');
  fs.writeFileSync(corpusPath, jsonlContent, 'utf8');
  const corpusFileSha256 = sha256Hex(jsonlContent);

  // Ensure optional consented real-inbox evaluation file exists (empty until owner approves real mailbox feedback)
  const realConsentedPath = path.join(dataDir, 'real_inbox_consented_eval.jsonl');
  if (!fs.existsSync(realConsentedPath)) {
    fs.writeFileSync(realConsentedPath, '', 'utf8');
  }
  const realLines = fs
    .readFileSync(realConsentedPath, 'utf8')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  const perCategorySupport: Record<string, { train: number; val: number; test: number; total: number }> = {};
  for (const cat of EMAIL_INTELLIGENCE_CATEGORIES) {
    const tr = splitResult.train.filter((e) => e.primaryCategory === cat).length;
    const va = splitResult.val.filter((e) => e.primaryCategory === cat).length;
    const te = splitResult.test.filter((e) => e.primaryCategory === cat).length;
    perCategorySupport[cat] = { train: tr, val: va, test: te, total: tr + va + te };
  }

  const summary: DatasetPreparationSummary = {
    datasetVersion: `spcr-curated-v1.0.0-${corpusFileSha256.slice(0, 10)}`,
    generatedAt: new Date().toISOString(),
    corpusFileSha256,
    totalCuratedExamples: allSplitExamples.length,
    totalRealConsentedExamples: realLines.length,
    missingAndQualityCounts: {
      emptyBodyCount,
      veryShortBodyCount,
      missingSubjectCount,
      htmlOnlyCount,
      malformedEncodingCount,
      missingHandlingPolicy:
        'Retained intentionally (0 rows dropped): empty bodies, missing subjects, HTML-only bodies, and malformed MIME encodings are genuine inbox failure modes mapped to explicit binary indicator features so the classifier routes ambiguous/incomplete messages to uncertain / REVIEW_REQUIRED instead of crashing or silently discarding.',
    },
    splitCounts: {
      train: splitResult.train.length,
      val: splitResult.val.length,
      test: splitResult.test.length,
    },
    groupLeakageVerification: {
      sharedThreadIdsAcrossSplits: splitResult.groupCounts.sharedThreadIdsAcrossSplits,
      sharedSenderOrgsAcrossSplits: splitResult.groupCounts.sharedSenderOrgsAcrossSplits,
    },
    perCategorySupport,
  };

  fs.writeFileSync(path.join(dataDir, 'dataset_manifest_v1.json'), JSON.stringify(summary, null, 2), 'utf8');
  return summary;
}

if (import.meta.url === `file:///${process.argv[1]?.replace(/\\/g, '/')}` || process.argv[1]?.endsWith('prepare-dataset.ts')) {
  const out = prepareRecruitmentDataset();
  console.log(
    `[ml:prepare] Prepared ${out.totalCuratedExamples} examples (${out.splitCounts.train} train / ${out.splitCounts.val} val / ${out.splitCounts.test} held-out test). Leakage: ${out.groupLeakageVerification.sharedThreadIdsAcrossSplits} threads, ${out.groupLeakageVerification.sharedSenderOrgsAcrossSplits} orgs.`
  );
}

