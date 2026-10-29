import fs from 'node:fs';
import path from 'node:path';
import { EmailIntelligenceService } from '../src/services/emailIntelligenceService.js';
import { assessSenderAuthenticity } from '../src/services/authenticityService.js';
import {
  CATEGORY_METADATA,
  EMAIL_INTELLIGENCE_CATEGORIES,
  LabeledEmailExample,
  LabeledEmailExampleSchema,
  PreDeclaredAcceptanceThresholdsSchema,
} from '../src/ml/schema.js';
import {
  ComprehensiveEvaluationSummary,
  evaluatePredictionsComprehensively,
  PredictionRecordForEval,
  verifyZeroGroupLeakage,
} from '../src/ml/evaluationMetrics.js';
import { loadOrInitializeSplitCorpus } from '../src/ml/trainerPipeline.js';

const SYNTHETIC_REGRESSION_FIXTURES: Array<{
  id: string;
  subject: string;
  body: string;
  from: string;
  expectedActionable: boolean;
}> = [
  { id: 'syn-01', subject: 'Campus Hiring 2026: Software Development Engineer at Zoho', body: 'Eligible branches: B.Tech CSE, IT. CGPA >= 7.5. CTC 12 LPA. Apply by 15 Nov.', from: 'campus@zohocorp.com', expectedActionable: true },
  { id: 'syn-02', subject: 'Summer Internship 2026 — Data Science Intern (Stipend 60k/month)', body: 'Open for M.Tech AI/DS and B.Tech CSE pre-final year students. Remote.', from: 'talent@analyticsfirm.io', expectedActionable: true },
  { id: 'syn-03', subject: 'Graduate Engineer Trainee Recruitment Drive — Core Mechanical & Electrical', body: 'Hiring final year B.Tech Mechanical and EEE students. Minimum 65% aggregate.', from: 'hr@industrialcorp.in', expectedActionable: true },
  { id: 'syn-04', subject: 'Updated Job Description & Revised CTC Addendum attached', body: 'Please find attached the updated JD PDF and eligibility addendum for the upcoming drive.', from: 'university.relations@techcorp.com', expectedActionable: true },
  { id: 'syn-05', subject: 'Off-Campus Full Stack Developer Role — 2026 Batch', body: 'React, Node.js, PostgreSQL. Location: Bengaluru. Apply via portal link.', from: 'careers@cloudstartup.dev', expectedActionable: true },
  { id: 'syn-06', subject: 'Pre-Placement Offer (PPO) & 6-Month Internship Opportunity', body: 'Eligible: B.Tech ECE/CSE with 8.0 CGPA and zero active backlogs.', from: 'campus-team@semicon.com', expectedActionable: true },
  { id: 'syn-07', subject: 'Analyst Hiring — Business & Operations (All Engineering Branches)', body: 'Compensation 9.5 LPA. Final year students from any branch may register.', from: 'earlycareers@consultingpartners.com', expectedActionable: true },
  { id: 'syn-08', subject: 'Research & Development Intern — Embedded Systems & VLSI', body: 'Looking for M.Tech VLSI / B.Tech ECE candidates with Verilog experience.', from: 'university@chipdesign.org', expectedActionable: true },
  { id: 'syn-09', subject: 'Weekly Tech Digest: Top 50 Jobs & Career Tips Unsubscribe anytime', body: 'View in browser. Promotional newsletter and sponsored coding bootcamps at 50% discount. Unsubscribe.', from: 'newsletter@promo-mailer.com', expectedActionable: false },
  { id: 'syn-10', subject: 'Flash Sale: 70% Off Premium Resume Templates!', body: 'Limited time offer! Buy now. Click here to unsubscribe from marketing emails.', from: 'deals@resumebuilder.shop', expectedActionable: false },
  { id: 'syn-11', subject: 'Re: Interview Panel Room Booking & Projector Setup for Tomorrow', body: 'We have booked Seminar Hall 2 and arranged lunch for the visiting interviewers.', from: 'admin@university.ac.in', expectedActionable: false },
  { id: 'syn-12', subject: 'Cafeteria Menu Update & Parking Notice', body: 'The south campus parking lot will be closed for maintenance on Saturday.', from: 'facilities@university.ac.in', expectedActionable: false },
  { id: 'syn-13', subject: 'URGENT: Direct Offer Letter — Pay INR 3500 Security Deposit Today', body: 'Congratulations! You are selected. Pay refundable laptop registration fee via UPI immediately.', from: 'tcs.hr.recruitment2026@gmail.com', expectedActionable: true },
  { id: 'syn-14', subject: 'Library Book Return Reminder', body: 'Your borrowed book Introduction to Algorithms is due next Tuesday.', from: 'library@university.ac.in', expectedActionable: false },
  { id: 'syn-15', subject: 'Cybersecurity Analyst Campus Drive — B.Tech CSE / IT', body: 'Role: SOC & AppSec Analyst. CTC 11 LPA. Assessment on 20 Nov.', from: 'hiring@secopsglobal.com', expectedActionable: true },
  { id: 'syn-16', subject: 'Daily Job Alert Digest: 25 new developer postings near you', body: 'Manage email preferences or unsubscribe at the bottom of this digest.', from: 'alerts@jobboard-digest.example', expectedActionable: false },
  { id: 'syn-17', subject: 'Quantitative Researcher & Algo Developer — Campus Recruitment', body: 'Open to B.Tech CSE/MnC with strong probability & C++. CTC 28 LPA.', from: 'campus@quanttrading.co', expectedActionable: true },
  { id: 'syn-18', subject: 'Annual Sports Meet Volunteer Registration', body: 'Sign up to volunteer for track and field events next month.', from: 'sportsclub@university.ac.in', expectedActionable: false },
  { id: 'syn-19', subject: 'Corrigendum: Eligibility relaxed to 7.0 CGPA for SDE Drive', body: 'In continuation to our earlier hiring mail, ECE students and 7.0+ CGPA are now eligible.', from: 'campus@zohocorp.com', expectedActionable: true },
  { id: 'syn-20', subject: 'Product Management Intern — Final Year Undergraduates', body: '6-month internship in Mumbai with 45k stipend and PPO opportunity.', from: 'talent@consumerapp.in', expectedActionable: true },
];

export interface FullEvaluationReport {
  generatedAt: string;
  modelVersion: string;
  architectureType: string;
  datasetVersion: string;
  artifactSha256: string;
  calibrationDisclosure: {
    isCalibratedProbability: false;
    statement: string;
  };
  leakageAudit: {
    sharedThreadIdsAcrossSplits: number;
    sharedSenderOrgsAcrossSplits: number;
    passedZeroLeakage: boolean;
  };
  preDeclaredAcceptanceThresholds: ReturnType<typeof PreDeclaredAcceptanceThresholdsSchema.parse>;
  thresholdCheckResults: {
    heldOutMacroF1Passed: boolean;
    relevantOpportunityRecallPassed: boolean;
    silentOpportunityDiscardRatePassed: boolean;
    zeroLeakagePassed: boolean;
    allThresholdsPassed: boolean;
  };
  heldOutTestEvaluation: ComprehensiveEvaluationSummary;
  validationComparisonSummary: unknown;
  syntheticRegressionSuite: {
    disclaimer: string;
    totalFixtures: number;
    actionableRoutingAccuracy: number;
    silentActionableDiscards: number;
  };
  realInboxConsentedEvaluation: {
    status: 'EVALUATED' | 'UNVERIFIED_NO_REAL_MAILBOX_DATA';
    sampleCount: number;
    statement: string;
    summary: ComprehensiveEvaluationSummary | null;
  };
}

export async function runComprehensiveEvaluation(rootDir = process.cwd()): Promise<FullEvaluationReport> {
  const thresholdsPath = path.join(rootDir, 'ml', 'config', 'acceptance_thresholds.json');
  const thresholds = PreDeclaredAcceptanceThresholdsSchema.parse(
    JSON.parse(fs.readFileSync(thresholdsPath, 'utf8'))
  );

  const artifactPath = path.join(rootDir, 'ml', 'artifacts', 'recruitment_email_model_v1.json');
  const cacheDir = path.join(rootDir, '.models_cache');
  const service = new EmailIntelligenceService({ artifactPath, cacheDir });
  const artifact = await service.ensureLoaded();
  const breakdown = service.getArchitectureBreakdown();

  const corpus = loadOrInitializeSplitCorpus(rootDir);
  const leakage = verifyZeroGroupLeakage({
    train: corpus.train,
    val: corpus.val,
    test: corpus.test,
  });

  // 1. Evaluate Held-Out Group-Disjoint Test Split (`test`)
  const testRecords: PredictionRecordForEval[] = [];
  for (const ex of corpus.test) {
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
    testRecords.push({
      example: ex,
      predictedPrimary: pred.primaryCategory,
      predictedMultiLabels: pred.multiLabels,
      topConfidence: pred.topConfidence,
      margin: pred.margin,
      uncertaintyOutcome: pred.uncertaintyOutcome,
    });
  }
  const heldOutTestEvaluation = evaluatePredictionsComprehensively(testRecords, 400);

  // 2. Evaluate Synthetic Phase-1 Regression Fixtures SEPARATELY
  let synCorrect = 0;
  let synSilentDiscards = 0;
  for (const fx of SYNTHETIC_REGRESSION_FIXTURES) {
    const auth = await assessSenderAuthenticity(null, {
      fromRaw: fx.from,
      subject: fx.subject,
      bodyOrSnippet: fx.body,
    });
    const pred = await service.classifyEmail({
      fromRaw: fx.from,
      subject: fx.subject,
      rawBody: fx.body,
      isSuspiciousSender: auth.isSuspicious,
      riskFlags: auth.riskFlags,
    });
    const predictedActionable =
      CATEGORY_METADATA[pred.primaryCategory].isRecruitmentRelevant ||
      pred.primaryCategory === 'spam_or_scam' ||
      pred.primaryCategory === 'uncertain';
    if (predictedActionable === fx.expectedActionable) {
      synCorrect++;
    }
    if (
      fx.expectedActionable &&
      (pred.primaryCategory === 'unrelated_email' || pred.primaryCategory === 'job_alert_newsletter') &&
      pred.uncertaintyOutcome === 'HIGH_CONFIDENCE'
    ) {
      synSilentDiscards++;
    }
  }

  // 3. Evaluate Consented Real-Inbox Dataset SEPARATELY (`real_inbox_consented_eval.jsonl`)
  const realPath = path.join(rootDir, 'ml', 'data', 'real_inbox_consented_eval.jsonl');
  const realLines = fs.existsSync(realPath)
    ? fs
        .readFileSync(realPath, 'utf8')
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter(Boolean)
    : [];

  let realSummary: ComprehensiveEvaluationSummary | null = null;
  if (realLines.length > 0) {
    const realExamples: LabeledEmailExample[] = realLines.map((l) =>
      LabeledEmailExampleSchema.parse(JSON.parse(l))
    );
    const realRecs: PredictionRecordForEval[] = [];
    for (const ex of realExamples) {
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
      realRecs.push({
        example: ex,
        predictedPrimary: pred.primaryCategory,
        predictedMultiLabels: pred.multiLabels,
        topConfidence: pred.topConfidence,
        margin: pred.margin,
        uncertaintyOutcome: pred.uncertaintyOutcome,
      });
    }
    realSummary = evaluatePredictionsComprehensively(realRecs, 200);
  }

  const valCompPath = path.join(rootDir, 'ml', 'artifacts', 'model_comparison_val.json');
  const valCompData = fs.existsSync(valCompPath) ? JSON.parse(fs.readFileSync(valCompPath, 'utf8')) : null;

  const heldOutMacroF1Passed = heldOutTestEvaluation.macroF1 >= thresholds.minimumHeldOutMacroF1;
  const relevantOpportunityRecallPassed =
    heldOutTestEvaluation.relevantOpportunityRecall >= thresholds.minimumRelevantOpportunityRecall;
  const silentOpportunityDiscardRatePassed =
    heldOutTestEvaluation.silentOpportunityDiscardRate <= thresholds.maximumSilentOpportunityDiscardRate;
  const zeroLeakagePassed =
    leakage.sharedThreadIds === thresholds.maximumLeakageGroupsAcrossSplits &&
    leakage.sharedSenderOrgs === thresholds.maximumLeakageGroupsAcrossSplits;

  const report: FullEvaluationReport = {
    generatedAt: new Date().toISOString(),
    modelVersion: artifact.modelVersion,
    architectureType: artifact.architectureType,
    datasetVersion: artifact.datasetVersion,
    artifactSha256: breakdown.artifactSha256 || '',
    calibrationDisclosure: {
      isCalibratedProbability: false,
      statement:
        'Confidence scores are uncalibrated logistic sigmoid outputs from class-balanced L2 One-vs-Rest linear classifiers. They are NOT calibrated probabilities and must not be interpreted as empirical likelihoods.',
    },
    leakageAudit: {
      sharedThreadIdsAcrossSplits: leakage.sharedThreadIds,
      sharedSenderOrgsAcrossSplits: leakage.sharedSenderOrgs,
      passedZeroLeakage: zeroLeakagePassed,
    },
    preDeclaredAcceptanceThresholds: thresholds,
    thresholdCheckResults: {
      heldOutMacroF1Passed,
      relevantOpportunityRecallPassed,
      silentOpportunityDiscardRatePassed,
      zeroLeakagePassed,
      allThresholdsPassed:
        heldOutMacroF1Passed &&
        relevantOpportunityRecallPassed &&
        silentOpportunityDiscardRatePassed &&
        zeroLeakagePassed,
    },
    heldOutTestEvaluation,
    validationComparisonSummary: valCompData,
    syntheticRegressionSuite: {
      disclaimer:
        'Synthetic 20-fixture regression suite from Phase 1. Retained strictly for smoke regression testing; NOT proof of reliable real-world mailbox performance.',
      totalFixtures: SYNTHETIC_REGRESSION_FIXTURES.length,
      actionableRoutingAccuracy: Number((synCorrect / SYNTHETIC_REGRESSION_FIXTURES.length).toFixed(4)),
      silentActionableDiscards: synSilentDiscards,
    },
    realInboxConsentedEvaluation:
      realSummary !== null
        ? {
            status: 'EVALUATED',
            sampleCount: realLines.length,
            statement: `Evaluated on ${realLines.length} consented real-inbox examples.`,
            summary: realSummary,
          }
        : {
            status: 'UNVERIFIED_NO_REAL_MAILBOX_DATA',
            sampleCount: 0,
            statement:
              '0 consented real-world mailbox examples are currently present in ml/data/real_inbox_consented_eval.jsonl. Real-inbox accuracy remains UNVERIFIED until the placement office connects Gmail and approves anonymized feedback examples.',
            summary: null,
          },
  };

  const outJsonPath = path.join(rootDir, 'ml', 'artifacts', 'evaluation_report_v1.json');
  fs.mkdirSync(path.dirname(outJsonPath), { recursive: true });
  fs.writeFileSync(outJsonPath, JSON.stringify(report, null, 2), 'utf8');

  const md = renderMarkdownEvaluationReport(report, valCompData);
  const outMdPath = path.join(rootDir, 'docs', 'MODEL_EVALUATION_REPORT.md');
  fs.mkdirSync(path.dirname(outMdPath), { recursive: true });
  fs.writeFileSync(outMdPath, md, 'utf8');

  return report;
}

function renderMarkdownEvaluationReport(report: FullEvaluationReport, valCompData: any): string {
  const t = report.heldOutTestEvaluation;
  const th = report.preDeclaredAcceptanceThresholds;
  const chk = report.thresholdCheckResults;

  const valRows = Array.isArray(valCompData?.candidates)
    ? valCompData.candidates
        .map(
          (c: any) =>
            `| \`${c.candidateName}\` | \`${c.classifierKind}\` | ${c.isTrainedSupervisedModel ? 'Yes' : 'No'} | ${c.valMacroF1.toFixed(4)} | ${c.valAccuracy.toFixed(4)} | ${c.valRelevantOpportunityRecall.toFixed(4)} | ${c.valSilentOpportunityDiscardRate.toFixed(4)} | ${c.avgCpuLatencyMsPerEmail} ms | ~${c.estimatedResidentRamMb} MB |`
        )
        .join('\n')
    : '';

  const perClassRows = t.perClass
    .map(
      (p) =>
        `| \`${p.label}\` | ${p.displayName} | ${p.precision.toFixed(4)} | ${p.recall.toFixed(4)} | ${p.f1.toFixed(4)} | ${p.support} | ${p.predictedCount} |`
    )
    .join('\n');

  const shortHeaders = EMAIL_INTELLIGENCE_CATEGORIES.map((_, idx) => `C${idx + 1}`);
  const cmHeader = `| True \\ Pred | ${shortHeaders.join(' | ')} |\n| --- | ${shortHeaders.map(() => '---').join(' | ')} |`;
  const cmRows = t.confusionMatrix
    .map((row, idx) => `| **C${idx + 1}** \`${EMAIL_INTELLIGENCE_CATEGORIES[idx]}\` | ${row.join(' | ')} |`)
    .join('\n');

  const sliceRows = Object.entries(t.sliceMetrics)
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([slice, m]) => `| \`${slice}\` | ${m.count} | ${m.accuracy.toFixed(4)} | ${m.silentDiscards} |`)
    .join('\n');

  const fnSection =
    t.falseNegatives.length === 0
      ? 'Zero actionable recruitment emails in the held-out test split were misrouted into `unrelated_email` or `job_alert_newsletter`.'
      : t.falseNegatives
          .map(
            (fn) =>
              `- \`${fn.id}\` ("${fn.subject}"): true=\`${fn.truePrimary}\`, predicted=\`${fn.predictedPrimary}\`, outcome=\`${fn.uncertaintyOutcome}\`, silentlyDiscarded=\`${fn.wasSilentlyDiscarded}\`, score=${fn.topConfidence.toFixed(3)}`
          )
          .join('\n');

  return `# SPCR Recruitment Email Intelligence — Model Evaluation Report

- **Model Version:** \`${report.modelVersion}\`
- **Selected Architecture:** \`${report.architectureType}\` (\`supervised_trained_classifier\`)
- **Dataset Version:** \`${report.datasetVersion}\`
- **Artifact SHA-256:** \`${report.artifactSha256}\`
- **Generated At:** \`${report.generatedAt}\`
- **Recurring Inference Cost:** **₹0** (100% local CPU execution; zero Groq / zero paid API dependence)

## 1. Uncalibrated Score Disclosure & Data Separation Statement

1. **Uncalibrated Scores:** ${report.calibrationDisclosure.statement}
2. **Strict Separation of Curated Held-Out, Synthetic Regression, and Real-World Mailbox Data:**
   - **Curated Anonymized Multi-Thread Benchmark (\`ml/data/curated_recruitment_corpus_v1.jsonl\`):** Group-disjoint split by **both** \`threadId\` AND \`senderOrgGroup\` (\`sharedThreadIds=${report.leakageAudit.sharedThreadIdsAcrossSplits}\`, \`sharedSenderOrgs=${report.leakageAudit.sharedSenderOrgsAcrossSplits}\`). Vocabulary (\`fitTfIdfVectorizer\`) and feature scalers (\`fitStandardScaler\`) were fitted **exclusively** on \`train\`.
   - **Phase-1 Synthetic Smoke Fixtures (20 items):** Reported separately below for regression continuity only — **not** treated as evidence of real-world accuracy.
   - **Consented Real-World Mailbox Data (\`ml/data/real_inbox_consented_eval.jsonl\`):** Status = \`${report.realInboxConsentedEvaluation.status}\` (${report.realInboxConsentedEvaluation.statement})

## 2. Validation Split Model Comparison (Used for Architecture & Hyperparameter Selection)

| Candidate | Component Kind | Supervised? | Val Macro-F1 | Val Accuracy | Val Opp Recall | Val Silent Discard Rate | Avg CPU Latency | Est. RAM |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
${valRows}

**Selection Rationale:** ${valCompData?.selectionRationale || 'See ml/artifacts/model_comparison_val.json'}

## 3. Pre-Declared Acceptance Thresholds vs Held-Out Test Split (\`n = ${t.sampleCount}\`)

| Criterion | Pre-Declared Threshold | Held-Out Test Measured | Status |
| --- | --- | --- | --- |
| Held-Out Macro-F1 | \`>= ${th.minimumHeldOutMacroF1.toFixed(2)}\` | **\`${t.macroF1.toFixed(4)}\`** (95% bootstrap CI: \`[${t.bootstrap95Ci.macroF1Low.toFixed(4)}, ${t.bootstrap95Ci.macroF1High.toFixed(4)}]\`) | **${chk.heldOutMacroF1Passed ? 'PASS' : 'FAIL'}** |
| Relevant Opportunity Recall | \`>= ${th.minimumRelevantOpportunityRecall.toFixed(2)}\` | **\`${t.relevantOpportunityRecall.toFixed(4)}\`** | **${chk.relevantOpportunityRecallPassed ? 'PASS' : 'FAIL'}** |
| Silent Opportunity Discard Rate | \`<= ${th.maximumSilentOpportunityDiscardRate.toFixed(2)}\` | **\`${t.silentOpportunityDiscardRate.toFixed(4)}\`** (\`${t.silentOpportunityDiscardCount}\` silent discards) | **${chk.silentOpportunityDiscardRatePassed ? 'PASS' : 'FAIL'}** |
| Group Leakage Across Splits | \`== 0\` | **\`${report.leakageAudit.sharedThreadIdsAcrossSplits + report.leakageAudit.sharedSenderOrgsAcrossSplits}\`** | **${chk.zeroLeakagePassed ? 'PASS' : 'FAIL'}** |

- **Held-Out Exact Primary Accuracy:** \`${t.accuracy.toFixed(4)}\` (95% bootstrap CI: \`[${t.bootstrap95Ci.accuracyLow.toFixed(4)}, ${t.bootstrap95Ci.accuracyHigh.toFixed(4)}]\`)
- **Held-Out Weighted-F1:** \`${t.weightedF1.toFixed(4)}\`
- **Held-Out Multi-Label Micro-F1:** \`${t.multiLabelMicroF1.toFixed(4)}\`

## 4. Per-Class Precision, Recall, F1 & Support (Held-Out Test Split)

| Category ID | Category Meaning | Precision | Recall | F1 | Support | Predicted |
| --- | --- | --- | --- | --- | --- | --- |
${perClassRows}

## 5. Held-Out 14x14 Confusion Matrix

${cmHeader}
${cmRows}

## 6. Hard-Case Slice Performance (Held-Out Test Split)

| Hard-Case Slice | Test Count | Primary Accuracy | Silent Opportunity Discards |
| --- | --- | --- | --- |
${sliceRows}

## 7. False-Negative & Discard Error Inspection

${fnSection}

## 8. Separate Synthetic Smoke Regression Check (Non-Proof Regression Guard Only)

- **Disclaimer:** ${report.syntheticRegressionSuite.disclaimer}
- **Fixtures:** ${report.syntheticRegressionSuite.totalFixtures}
- **Actionable vs Non-Actionable Routing Accuracy:** \`${report.syntheticRegressionSuite.actionableRoutingAccuracy.toFixed(4)}\`
- **Silent Actionable Discards:** \`${report.syntheticRegressionSuite.silentActionableDiscards}\`
`;
}

if (import.meta.url === `file:///${process.argv[1]?.replace(/\\/g, '/')}` || process.argv[1]?.endsWith('evaluate-email-model.ts')) {
  runComprehensiveEvaluation()
    .then((rep) => {
      console.log(
        `[ml:evaluate] Held-Out Test (n=${rep.heldOutTestEvaluation.sampleCount}): macroF1=${rep.heldOutTestEvaluation.macroF1.toFixed(
          4
        )} (95% CI [${rep.heldOutTestEvaluation.bootstrap95Ci.macroF1Low.toFixed(4)}, ${rep.heldOutTestEvaluation.bootstrap95Ci.macroF1High.toFixed(
          4
        )}]), acc=${rep.heldOutTestEvaluation.accuracy.toFixed(4)}, oppRecall=${rep.heldOutTestEvaluation.relevantOpportunityRecall.toFixed(
          4
        )}, silentDiscardRate=${rep.heldOutTestEvaluation.silentOpportunityDiscardRate.toFixed(
          4
        )}, allThresholdsPassed=${rep.thresholdCheckResults.allThresholdsPassed}`
      );
      if (!rep.thresholdCheckResults.allThresholdsPassed) {
        process.exitCode = 1;
      }
    })
    .catch((err) => {
      console.error('[ml:evaluate] Evaluation failed:', err);
      process.exitCode = 1;
    });
}
