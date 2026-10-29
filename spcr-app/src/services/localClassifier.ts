import fs from 'node:fs';
import path from 'node:path';
import { env, pipeline } from '@huggingface/transformers';
import { sha256Hex } from '../utils/crypto.js';

export type ScreeningClass =
  | 'candidate_opportunity'
  | 'related_jd_followup'
  | 'office_coordination'
  | 'newsletter_promo'
  | 'low_relevance'
  | 'suspicious_needs_review'
  | 'uncertain_needs_review';

export const PINNED_CLASSIFIER_SPEC = {
  modelId: 'Xenova/all-MiniLM-L6-v2',
  dtype: 'q8' as const,
  license: 'Apache-2.0',
  expectedChecksums: {
    'Xenova/all-MiniLM-L6-v2/onnx/model_quantized.onnx':
      'afdb6f1a0e45b715d0bb9b11772f032c399babd23bfc31fed1c170afc848bdb1',
    'Xenova/all-MiniLM-L6-v2/tokenizer.json':
      'da0e79933b9ed51798a3ae27893d3c5fa4a201126cef75586296df9b4d2c62a0',
  },
} as const;

type SemanticBucket =
  | 'candidate_opportunity'
  | 'related_jd_followup'
  | 'office_coordination'
  | 'newsletter_promo'
  | 'low_relevance';

/**
 * Curated multi-aspect English recruitment-triage reference exemplars.
 * Embedded once at startup using the local quantized ONNX MiniLM-L6-v2 transformer.
 */
const CLASS_EXEMPLARS: Record<SemanticBucket, string[]> = {
  candidate_opportunity: [
    'Campus Recruitment Drive invitation for B.Tech BE M.Tech MCA graduating batch students for Software Engineer full-time and internship roles with CTC stipend eligibility criteria and application deadline.',
    'We are hiring final year engineering and management students from your college for Graduate Engineer Trainee Analyst Product Intern positions. Eligible branches CSE IT ECE EEE Mechanical.',
    'Internship and PPO opportunity at our startup for 2026 and 2027 batch students. Stipend per month, zero active backlogs, minimum CGPA 7.0, registration link enclosed.',
    'Off-campus and pool campus placement drive opportunity for freshers: Data Scientist, Frontend Developer, QA Automation Engineer. Apply via careers portal before deadline.',
  ],
  related_jd_followup: [
    'Please find attached the detailed Job Description PDF and updated eligibility criteria for the campus hiring role shared earlier.',
    'Follow-up regarding our recruitment drive: updated application deadline, revised CTC compensation breakup, and attached JD document for shortlisted branches.',
    'Forwarding the JD DOCX attachment and registration Google Form link for the Software Developer role discussed in the previous thread.',
    'Corrigendum to job opening: backlog rule relaxed and deadline extended to Friday; updated job description attached.',
  ],
  office_coordination: [
    'Confirming interview panel room booking, projector setup, hospitality, and campus visit schedule for tomorrow placement interview rounds.',
    'Sharing list of shortlisted students for technical round 2 and HR interview slots along with attendance sheet for Training and Placement Office.',
    'Requesting MoU signature, invoice reimbursement, or TPO phone call to discuss next semester academic industry partnership.',
  ],
  newsletter_promo: [
    'Weekly tech digest newsletter! Top 10 AI trends, cloud webinars, paid bootcamp discount coupons, and marketing summit early-bird tickets. Unsubscribe anytime.',
    'Sponsored promotional offer: Upskill with our paid certification course, masterclass registration fee, and promotional SaaS trial subscription.',
    'Monthly digest from developer community, blog updates, product launch announcement, manage email preferences.',
  ],
  low_relevance: [
    'Personal email regarding faculty leave application, library book overdue notice, hostel mess menu, semester exam timetable, or electricity maintenance.',
    'Automated receipt for personal online order delivery, flight booking itinerary, bank statement alert, or password reset code.',
    'Departmental meeting minutes about syllabus revision, lab equipment purchase order, and NAAC accreditation paperwork unrelated to company job openings.',
  ],
};

function dotProduct(a: Float32Array | number[], b: Float32Array | number[]): number {
  let sum = 0;
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    sum += (a[i] || 0) * (b[i] || 0);
  }
  return sum;
}

export interface DeterministicRuleSignals {
  placementKeywordHits: string[];
  jdFollowupHits: string[];
  coordinationHits: string[];
  newsletterHits: string[];
  unrelatedAdminHits: string[];
  hasSupportedJdAttachment: boolean;
  hasReplyOrForwardPrefix: boolean;
}

export function evaluateDeterministicRules(input: {
  subject: string;
  bodyOrSnippet: string;
  attachmentFilenames: string[];
  inReplyTo?: string | null;
}): DeterministicRuleSignals {
  const text = `${input.subject}\n${input.bodyOrSnippet}`;
  const placementPatterns: Array<[string, RegExp]> = [
    ['campus_drive', /\b(campus\s+(?:drive|hiring|recruitment|placement)|placement\s+drive|pool\s+campus)\b/i],
    ['hiring_role', /\b(hiring|job\s+opening|open\s+role|internship\s+opportunity|full[\s-]?time\s+(?:role|opportunity)|graduate\s+engineer\s+trainee|get\s+role|ppo)\b/i],
    ['compensation', /\b(ctc|lpa|stipend|package\s+of|per\s+annum|inr\s*\d+)\b/i],
    ['eligibility', /\b(eligibility|b\.?\s*tech|m\.?\s*tech|mca|mba|cgpa|active\s+backlogs?|graduating\s+batch|202[5-9]\s+batch)\b/i],
    ['apply_deadline', /\b(last\s+date\s+to\s+apply|application\s+deadline|apply\s+(?:by|before|here|link)|registration\s+link)\b/i],
  ];

  const jdFollowupPatterns: Array<[string, RegExp]> = [
    ['pfa_jd', /\b(pfa\s+(?:the\s+)?(?:jd|job\s+description)|attached\s+(?:herewith\s+)?(?:the\s+)?(?:jd|job\s+description)|find\s+attached\s+(?:the\s+)?(?:updated\s+)?jd)\b/i],
    ['updated_criteria', /\b(updated\s+(?:jd|deadline|eligibility|ctc|link)|corrigendum|revised\s+(?:jd|deadline|eligibility)|extension\s+of\s+deadline)\b/i],
    ['followup_phrase', /\b(following\s+up\s+on\s+our\s+(?:previous|earlier)\s+mail|further\s+to\s+our\s+earlier\s+email|separate\s+email\s+with\s+jd)\b/i],
  ];

  const coordinationPatterns: Array<[string, RegExp]> = [
    ['interview_logistics', /\b(interview\s+panel|auditorium|room\s+booking|shortlisted\s+candidates\s+list|slot\s+confirmation|hospitality|mou\s+signing)\b/i],
  ];

  const newsletterPatterns: Array<[string, RegExp]> = [
    ['unsubscribe', /\b(unsubscribe|manage\s+preferences|view\s+in\s+browser|weekly\s+digest|monthly\s+newsletter)\b/i],
    ['paid_course_promo', /\b(paid\s+bootcamp|enroll\s+now\s+at\s+\d+%\s+off|early[\s-]?bird\s+ticket|sponsored\s+webinar)\b/i],
  ];

  const unrelatedPatterns: Array<[string, RegExp]> = [
    ['internal_campus_admin', /\b(hostel\s+mess|library\s+overdue|casual\s+leave|electricity\s+shutdown|exam\s+invigilation\s+duty)\b/i],
  ];

  const placementKeywordHits = placementPatterns.filter(([, rx]) => rx.test(text)).map(([k]) => k);
  const jdFollowupHits = jdFollowupPatterns.filter(([, rx]) => rx.test(text)).map(([k]) => k);
  const coordinationHits = coordinationPatterns.filter(([, rx]) => rx.test(text)).map(([k]) => k);
  const newsletterHits = newsletterPatterns.filter(([, rx]) => rx.test(text)).map(([k]) => k);
  const unrelatedAdminHits = unrelatedPatterns.filter(([, rx]) => rx.test(text)).map(([k]) => k);

  const hasSupportedJdAttachment = input.attachmentFilenames.some((f) => /\.(pdf|docx)$/i.test(f));
  const hasReplyOrForwardPrefix = /^(re|fw|fwd)\s*:/i.test(input.subject.trim()) || Boolean(input.inReplyTo);

  return {
    placementKeywordHits,
    jdFollowupHits,
    coordinationHits,
    newsletterHits,
    unrelatedAdminHits,
    hasSupportedJdAttachment,
    hasReplyOrForwardPrefix,
  };
}

export interface LocalClassificationResult {
  classification: ScreeningClass;
  confidence: number;
  margin: number;
  confidenceTier: 'high' | 'standard' | 'uncertain' | 'suspicious';
  modelScores: Record<SemanticBucket, number>;
  ruleSignals: DeterministicRuleSignals;
  explanation: string[];
}

export class LocalOnnxRecruitmentClassifier {
  private extractorPromise: Promise<any> | null = null;
  private exemplarEmbeddings: Record<SemanticBucket, Float32Array[]> | null = null;
  private checksumVerified = false;

  constructor(
    private readonly options: {
      cacheDir: string;
      offlineOnly?: boolean;
    }
  ) {}

  private verifyPinnedChecksumsIfCached(resolvedCacheDir: string): void {
    for (const [relFile, expectedSha] of Object.entries(PINNED_CLASSIFIER_SPEC.expectedChecksums)) {
      const fullPath = path.join(resolvedCacheDir, relFile);
      if (fs.existsSync(fullPath)) {
        const actualSha = sha256Hex(fs.readFileSync(fullPath));
        if (actualSha !== expectedSha) {
          throw new Error(
            `Pinned ONNX classifier artifact integrity failure for ${relFile}: expected ${expectedSha}, got ${actualSha}`
          );
        }
      } else if (this.options.offlineOnly) {
        throw new Error(`Required offline ONNX classifier file missing: ${fullPath}. Run npm run preload:model first.`);
      }
    }
    this.checksumVerified = true;
  }

  async ensureLoaded(): Promise<void> {
    if (this.extractorPromise && this.exemplarEmbeddings) return;

    const resolvedCacheDir = path.resolve(this.options.cacheDir);
    fs.mkdirSync(resolvedCacheDir, { recursive: true });
    this.verifyPinnedChecksumsIfCached(resolvedCacheDir);

    env.cacheDir = resolvedCacheDir;
    env.allowLocalModels = true;
    // Once model artifacts exist locally, disable remote model downloads completely so zero external calls occur!
    const allPresent = Object.keys(PINNED_CLASSIFIER_SPEC.expectedChecksums).every((rel) =>
      fs.existsSync(path.join(resolvedCacheDir, rel))
    );
    env.allowRemoteModels = !allPresent && !this.options.offlineOnly;

    if (!this.extractorPromise) {
      this.extractorPromise = pipeline('feature-extraction', PINNED_CLASSIFIER_SPEC.modelId, {
        dtype: PINNED_CLASSIFIER_SPEC.dtype,
      });
    }

    const extractor = await this.extractorPromise;

    if (!this.checksumVerified || !allPresent) {
      this.verifyPinnedChecksumsIfCached(resolvedCacheDir);
      env.allowRemoteModels = false;
    }

    if (!this.exemplarEmbeddings) {
      const buckets = Object.keys(CLASS_EXEMPLARS) as SemanticBucket[];
      const map = {} as Record<SemanticBucket, Float32Array[]>;
      for (const bucket of buckets) {
        map[bucket] = [];
        for (const text of CLASS_EXEMPLARS[bucket]) {
          const out = await extractor(text, { pooling: 'mean', normalize: true });
          map[bucket].push(Float32Array.from(out.data as Float32Array));
        }
      }
      this.exemplarEmbeddings = map;
    }
  }

  async classify(
    input: {
      subject: string;
      bodyOrSnippet: string;
      attachmentFilenames: string[];
      inReplyTo?: string | null;
      isSuspiciousSender: boolean;
      riskFlags: string[];
    },
    thresholds: { candidateMinConfidence: number; reviewMinMargin: number } = {
      candidateMinConfidence: 0.42,
      reviewMinMargin: 0.05,
    }
  ): Promise<LocalClassificationResult> {
    await this.ensureLoaded();
    const extractor = await this.extractorPromise!;
    const exemplars = this.exemplarEmbeddings!;

    const rules = evaluateDeterministicRules(input);
    const truncatedInput = `${input.subject}\n${input.bodyOrSnippet}`.slice(0, 2000);
    const embTensor = await extractor(truncatedInput, { pooling: 'mean', normalize: true });
    const vec = Float32Array.from(embTensor.data as Float32Array);

    const rawLogits: Record<SemanticBucket, number> = {
      candidate_opportunity: 0,
      related_jd_followup: 0,
      office_coordination: 0,
      newsletter_promo: 0,
      low_relevance: 0,
    };

    const temperature = 0.14;
    for (const bucket of Object.keys(exemplars) as SemanticBucket[]) {
      const sims = exemplars[bucket].map((ex) => dotProduct(vec, ex)).sort((a, b) => b - a);
      const topSim = sims[0] ?? 0;
      const secondSim = sims[1] ?? topSim;
      const blendedSim = 0.7 * topSim + 0.3 * secondSim;
      rawLogits[bucket] = blendedSim / temperature;
    }

    // Calibrated fusion with deterministic domain signals (transparent, zero external calls)
    if (rules.placementKeywordHits.length >= 2) {
      rawLogits.candidate_opportunity += 0.85 + 0.25 * Math.min(rules.placementKeywordHits.length - 2, 3);
    } else if (rules.placementKeywordHits.length === 1) {
      rawLogits.candidate_opportunity += 0.35;
    }

    if (rules.jdFollowupHits.length >= 1) {
      rawLogits.related_jd_followup += 1.25 + (rules.hasSupportedJdAttachment ? 0.55 : 0);
    } else if (rules.hasReplyOrForwardPrefix && rules.hasSupportedJdAttachment && rules.placementKeywordHits.length <= 2) {
      rawLogits.related_jd_followup += 0.75;
    }

    if (rules.coordinationHits.length >= 1 && rules.placementKeywordHits.length <= 1 && !rules.hasSupportedJdAttachment) {
      rawLogits.office_coordination += 1.1;
    }

    if (rules.newsletterHits.length >= 1 && rules.placementKeywordHits.length <= 1) {
      rawLogits.newsletter_promo += 1.35;
    }

    if (rules.unrelatedAdminHits.length >= 1 && rules.placementKeywordHits.length === 0) {
      rawLogits.low_relevance += 1.25;
    }

    // Softmax normalization
    const maxLogit = Math.max(...Object.values(rawLogits));
    const expEntries = (Object.entries(rawLogits) as Array<[SemanticBucket, number]>).map(([k, v]) => [
      k,
      Math.exp(v - maxLogit),
    ] as const);
    const sumExp = expEntries.reduce((acc, [, e]) => acc + e, 0);

    const modelScores = {} as Record<SemanticBucket, number>;
    for (const [k, e] of expEntries) {
      modelScores[k] = Number((e / sumExp).toFixed(4));
    }

    const sorted = (Object.entries(modelScores) as Array<[SemanticBucket, number]>).sort((a, b) => b[1] - a[1]);
    const [topBucket, topScore] = sorted[0]!;
    const [, secondScore] = sorted[1]!;
    const margin = Number((topScore - secondScore).toFixed(4));

    const explanation: string[] = [
      `Self-hosted ONNX (${PINNED_CLASSIFIER_SPEC.modelId}) top bucket: ${topBucket} (${topScore.toFixed(3)}, margin ${margin.toFixed(3)}).`,
    ];
    if (rules.placementKeywordHits.length > 0) {
      explanation.push(`Recruitment signals matched: ${rules.placementKeywordHits.join(', ')}`);
    }
    if (rules.jdFollowupHits.length > 0) {
      explanation.push(`JD/follow-up signals matched: ${rules.jdFollowupHits.join(', ')}`);
    }
    if (rules.newsletterHits.length > 0) {
      explanation.push(`Newsletter/promotional signals matched: ${rules.newsletterHits.join(', ')}`);
    }

    // Rule 1: Suspicious/spoofed/scam/injection indicators ALWAYS go to `suspicious_needs_review` (never auto-formatted, never silently dropped!)
    if (input.isSuspiciousSender) {
      explanation.push(`Routed to suspicious_needs_review due to risk flags: ${input.riskFlags.join(', ')}`);
      return {
        classification: 'suspicious_needs_review',
        confidence: topScore,
        margin,
        confidenceTier: 'suspicious',
        modelScores,
        ruleSignals: rules,
        explanation,
      };
    }

    // Rule 2: Conservative safeguard — NEVER silently discard if placement/JD signal exists or model confidence/margin is low!
    const hasAnyRecruitmentHint =
      rules.placementKeywordHits.length > 0 ||
      rules.jdFollowupHits.length > 0 ||
      rules.hasSupportedJdAttachment ||
      modelScores.candidate_opportunity >= 0.25 ||
      modelScores.related_jd_followup >= 0.25;

    if (
      (topBucket === 'candidate_opportunity' || topBucket === 'related_jd_followup') &&
      (topScore < thresholds.candidateMinConfidence || margin < thresholds.reviewMinMargin)
    ) {
      explanation.push('Ambiguous or low-margin recruitment prediction — conservatively routed to Needs review.');
      return {
        classification: 'uncertain_needs_review',
        confidence: topScore,
        margin,
        confidenceTier: 'uncertain',
        modelScores,
        ruleSignals: rules,
        explanation,
      };
    }

    if (
      (topBucket === 'low_relevance' || topBucket === 'newsletter_promo') &&
      hasAnyRecruitmentHint &&
      rules.newsletterHits.length === 0 &&
      (topScore < 0.65 || margin < 0.15)
    ) {
      explanation.push(
        'Non-candidate top prediction had weak certainty alongside recruitment/attachment hints — conservatively routed to Needs review instead of discarding.'
      );
      return {
        classification: 'uncertain_needs_review',
        confidence: topScore,
        margin,
        confidenceTier: 'uncertain',
        modelScores,
        ruleSignals: rules,
        explanation,
      };
    }

    let confidenceTier: 'high' | 'standard' | 'uncertain' = 'standard';
    if (
      topBucket === 'candidate_opportunity' &&
      topScore >= 0.58 &&
      margin >= 0.18 &&
      rules.placementKeywordHits.length >= 2 &&
      input.riskFlags.length === 0
    ) {
      confidenceTier = 'high';
    } else if (topBucket === 'uncertain_needs_review' as string) {
      confidenceTier = 'uncertain';
    }

    return {
      classification: topBucket,
      confidence: topScore,
      margin,
      confidenceTier,
      modelScores,
      ruleSignals: rules,
      explanation,
    };
  }
}

