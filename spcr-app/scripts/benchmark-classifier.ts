import fs from 'node:fs';
import path from 'node:path';
import { createDatabase, runMigrations } from '../src/db/database.js';
import { assessSenderAuthenticity } from '../src/services/authenticityService.js';
import { LocalOnnxRecruitmentClassifier, PINNED_CLASSIFIER_SPEC, ScreeningClass } from '../src/services/localClassifier.js';
import { SCREENING_BENCHMARK_FIXTURES } from '../src/fixtures/screeningBenchmarkFixtures.js';

export interface BenchmarkReport {
  generatedAt: string;
  disclaimer: string;
  model: typeof PINNED_CLASSIFIER_SPEC;
  totalFixtures: number;
  exactClassMatches: number;
  exactAccuracy: number;
  officerQueueSafetyRate: number;
  silentFalseDiscards: number;
  perClassMetrics: Record<string, { tp: number; fp: number; fn: number; precision: number; recall: number; f1: number }>;
  rows: Array<{
    id: string;
    category: string;
    expectedClass: ScreeningClass;
    predictedClass: ScreeningClass;
    confidence: number;
    margin: number;
    authenticityLabel: string;
    passedQueueSafety: boolean;
  }>;
}

export async function runClassifierBenchmark(cacheDir = './.models_cache'): Promise<BenchmarkReport> {
  const db = await createDatabase('pglite://memory');
  await runMigrations(db);

  const classifier = new LocalOnnxRecruitmentClassifier({ cacheDir });
  await classifier.ensureLoaded();

  const classes: ScreeningClass[] = [
    'candidate_opportunity',
    'related_jd_followup',
    'office_coordination',
    'newsletter_promo',
    'low_relevance',
    'suspicious_needs_review',
    'uncertain_needs_review',
  ];

  const counts: Record<string, { tp: number; fp: number; fn: number }> = {};
  for (const c of classes) {
    counts[c] = { tp: 0, fp: 0, fn: 0 };
  }

  let exactClassMatches = 0;
  let safeQueueCount = 0;
  let silentFalseDiscards = 0;
  const rows: BenchmarkReport['rows'] = [];

  const queuedClasses = new Set<ScreeningClass>([
    'candidate_opportunity',
    'related_jd_followup',
    'suspicious_needs_review',
    'uncertain_needs_review',
  ]);

  for (const fx of SCREENING_BENCHMARK_FIXTURES) {
    const auth = await assessSenderAuthenticity(db, {
      fromRaw: fx.fromRaw,
      replyToRaw: fx.replyToRaw,
      authHeadersRaw: fx.authHeadersRaw,
      subject: fx.subject,
      bodyOrSnippet: fx.bodyText,
    });

    const pred = await classifier.classify({
      subject: fx.subject,
      bodyOrSnippet: fx.bodyText,
      attachmentFilenames: fx.attachmentFilenames,
      inReplyTo: fx.inReplyTo,
      isSuspiciousSender: auth.isSuspicious,
      riskFlags: auth.riskFlags,
    });

    if (pred.classification === fx.expectedClass) {
      exactClassMatches++;
      counts[fx.expectedClass]!.tp++;
    } else {
      counts[fx.expectedClass]!.fn++;
      counts[pred.classification]!.fp++;
    }

    const wasQueued = queuedClasses.has(pred.classification);
    const passedQueueSafety = fx.mustQueueForOfficer ? wasQueued : !wasQueued;
    if (passedQueueSafety) {
      safeQueueCount++;
    }
    if (fx.mustQueueForOfficer && !wasQueued) {
      silentFalseDiscards++;
    }

    rows.push({
      id: fx.id,
      category: fx.category,
      expectedClass: fx.expectedClass,
      predictedClass: pred.classification,
      confidence: pred.confidence,
      margin: pred.margin,
      authenticityLabel: auth.label,
      passedQueueSafety,
    });
  }

  await db.close();

  const perClassMetrics: BenchmarkReport['perClassMetrics'] = {};
  for (const c of classes) {
    const { tp, fp, fn } = counts[c]!;
    const precision = tp + fp === 0 ? 1 : Number((tp / (tp + fp)).toFixed(4));
    const recall = tp + fn === 0 ? 1 : Number((tp / (tp + fn)).toFixed(4));
    const f1 = precision + recall === 0 ? 0 : Number(((2 * precision * recall) / (precision + recall)).toFixed(4));
    perClassMetrics[c] = { tp, fp, fn, precision, recall, f1 };
  }

  return {
    generatedAt: new Date().toISOString(),
    disclaimer:
      'SYNTHETIC & ADVERSARIAL FIXTURE METRICS ONLY — NOT REAL-WORLD PRODUCTION ACCURACY. Real mailbox distributions vary; low-confidence and ambiguous items route conservatively to Needs review.',
    model: PINNED_CLASSIFIER_SPEC,
    totalFixtures: SCREENING_BENCHMARK_FIXTURES.length,
    exactClassMatches,
    exactAccuracy: Number((exactClassMatches / SCREENING_BENCHMARK_FIXTURES.length).toFixed(4)),
    officerQueueSafetyRate: Number((safeQueueCount / SCREENING_BENCHMARK_FIXTURES.length).toFixed(4)),
    silentFalseDiscards,
    perClassMetrics,
    rows,
  };
}

if (process.argv[1]?.endsWith('benchmark-classifier.ts')) {
  runClassifierBenchmark()
    .then((report) => {
      const outPath = path.resolve('./docs/CLASSIFIER_BENCHMARK_REPORT.json');
      fs.writeFileSync(outPath, JSON.stringify(report, null, 2), 'utf8');
      console.log('=== SPCR Self-Hosted ONNX Classifier Benchmark (SYNTHETIC FIXTURES) ===');
      console.log(`Model: ${report.model.modelId} (${report.model.license})`);
      console.log(`Fixtures: ${report.exactClassMatches}/${report.totalFixtures} exact (${(report.exactAccuracy * 100).toFixed(1)}%)`);
      console.log(`Queue Safety Rate: ${(report.officerQueueSafetyRate * 100).toFixed(1)}% | Silent False Discards: ${report.silentFalseDiscards}`);
      console.table(report.perClassMetrics);
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}

