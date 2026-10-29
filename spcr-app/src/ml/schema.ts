import { z } from 'zod';
import { ScreeningClass } from '../services/localClassifier.js';

/**
 * Mandatory Addendum Section 2:
 * Explicit architectural distinction between the 5 components in SPCR so no component is misrepresented.
 */
export const CLASSIFIER_COMPONENT_KINDS = [
  'pretrained_embedding_backbone',
  'deterministic_screening_rules',
  'exemplar_similarity_classifier',
  'supervised_trained_classifier',
  'optional_drafting_llm',
] as const;

export type ClassifierComponentKind = (typeof CLASSIFIER_COMPONENT_KINDS)[number];

export const ARCHITECTURE_COMPONENT_REGISTRY: Record<
  ClassifierComponentKind,
  {
    kind: ClassifierComponentKind;
    name: string;
    isTrainedForSpcrLabels: boolean;
    requiresExternalApi: boolean;
    costInr: 0;
    description: string;
  }
> = {
  pretrained_embedding_backbone: {
    kind: 'pretrained_embedding_backbone',
    name: 'Xenova/all-MiniLM-L6-v2 (Quantized ONNX Sentence Encoder, Apache-2.0)',
    isTrainedForSpcrLabels: false,
    requiresExternalApi: false,
    costInr: 0,
    description:
      'General-purpose 384-dimensional English sentence embedding model running locally on CPU. Provides dense semantic features only; NOT a recruitment classifier on its own.',
  },
  deterministic_screening_rules: {
    kind: 'deterministic_screening_rules',
    name: 'SPCR Deterministic Header, Authenticity & Structural Rules',
    isTrainedForSpcrLabels: false,
    requiresExternalApi: false,
    costInr: 0,
    description:
      'Auditable rule checks for SPF/DKIM/DMARC headers, domain lookalikes, fee-scam demands, bulk List-Unsubscribe headers, and missing/malformed message indicators.',
  },
  exemplar_similarity_classifier: {
    kind: 'exemplar_similarity_classifier',
    name: 'Unsupervised MiniLM Cosine-Similarity Exemplar Baseline',
    isTrainedForSpcrLabels: false,
    requiresExternalApi: false,
    costInr: 0,
    description:
      'Zero-shot similarity scorer comparing embeddings to hand-written reference sentences. Retained strictly as an evaluation baseline, NOT the production supervised model.',
  },
  supervised_trained_classifier: {
    kind: 'supervised_trained_classifier',
    name: 'SPCR Supervised Multi-Label Recruitment Email Classifier (L2 OvR Logistic Regression)',
    isTrainedForSpcrLabels: true,
    requiresExternalApi: false,
    costInr: 0,
    description:
      'Supervised 14-class multi-label linear classifier trained specifically on SPCR group-disjoint labeled data (comparing TF-IDF vs Hybrid MiniLM + TF-IDF + Thread/Structural features).',
  },
  optional_drafting_llm: {
    kind: 'optional_drafting_llm',
    name: 'OPTIONAL_GROQ Post-Screen Announcement Formatter (Disabled by Default)',
    isTrainedForSpcrLabels: false,
    requiresExternalApi: true,
    costInr: 0,
    description:
      'Optional post-screening plain-text formatter (GROQ_LIVE_ENABLED=false by default). Never used for email classification, screening, or mandatory extraction.',
  },
};

/**
 * Mandatory Addendum Section 3:
 * All 14 required recruitment email categories.
 */
export const EMAIL_INTELLIGENCE_CATEGORIES = [
  'relevant_opportunity',
  'recruiter_outreach',
  'jd_or_details_followup',
  'application_acknowledgement',
  'screening_or_eligibility',
  'online_assessment',
  'interview_invitation',
  'interview_followup',
  'offer',
  'rejection',
  'job_alert_newsletter',
  'unrelated_email',
  'spam_or_scam',
  'uncertain',
] as const;

export type EmailIntelligenceCategory = (typeof EMAIL_INTELLIGENCE_CATEGORIES)[number];

export const CATEGORY_METADATA: Record<
  EmailIntelligenceCategory,
  {
    label: EmailIntelligenceCategory;
    displayName: string;
    recruitmentStage: string | null;
    isRecruitmentRelevant: boolean;
    createsOrUpdatesOpportunity: boolean;
    legacyScreeningClass: ScreeningClass;
  }
> = {
  relevant_opportunity: {
    label: 'relevant_opportunity',
    displayName: 'Relevant job or internship opportunity',
    recruitmentStage: 'opportunity_announced',
    isRecruitmentRelevant: true,
    createsOrUpdatesOpportunity: true,
    legacyScreeningClass: 'candidate_opportunity',
  },
  recruiter_outreach: {
    label: 'recruiter_outreach',
    displayName: 'Recruiter outreach or direct hiring communication',
    recruitmentStage: 'recruiter_outreach',
    isRecruitmentRelevant: true,
    createsOrUpdatesOpportunity: true,
    legacyScreeningClass: 'candidate_opportunity',
  },
  jd_or_details_followup: {
    label: 'jd_or_details_followup',
    displayName: 'Job description or job-details follow-up',
    recruitmentStage: 'jd_details_updated',
    isRecruitmentRelevant: true,
    createsOrUpdatesOpportunity: true,
    legacyScreeningClass: 'related_jd_followup',
  },
  application_acknowledgement: {
    label: 'application_acknowledgement',
    displayName: 'Application submitted or application acknowledgement',
    recruitmentStage: 'application_acknowledged',
    isRecruitmentRelevant: true,
    createsOrUpdatesOpportunity: false,
    legacyScreeningClass: 'office_coordination',
  },
  screening_or_eligibility: {
    label: 'screening_or_eligibility',
    displayName: 'Screening or eligibility request',
    recruitmentStage: 'screening_or_eligibility',
    isRecruitmentRelevant: true,
    createsOrUpdatesOpportunity: true,
    legacyScreeningClass: 'related_jd_followup',
  },
  online_assessment: {
    label: 'online_assessment',
    displayName: 'Online assessment, coding test or assignment',
    recruitmentStage: 'online_assessment',
    isRecruitmentRelevant: true,
    createsOrUpdatesOpportunity: false,
    legacyScreeningClass: 'office_coordination',
  },
  interview_invitation: {
    label: 'interview_invitation',
    displayName: 'Interview invitation, scheduling, rescheduling or confirmation',
    recruitmentStage: 'interview_scheduled',
    isRecruitmentRelevant: true,
    createsOrUpdatesOpportunity: false,
    legacyScreeningClass: 'office_coordination',
  },
  interview_followup: {
    label: 'interview_followup',
    displayName: 'Interview follow-up or next-round update',
    recruitmentStage: 'interview_followup',
    isRecruitmentRelevant: true,
    createsOrUpdatesOpportunity: false,
    legacyScreeningClass: 'office_coordination',
  },
  offer: {
    label: 'offer',
    displayName: 'Job offer or internship offer',
    recruitmentStage: 'offer_extended',
    isRecruitmentRelevant: true,
    createsOrUpdatesOpportunity: false,
    legacyScreeningClass: 'office_coordination',
  },
  rejection: {
    label: 'rejection',
    displayName: 'Rejection or unsuccessful application',
    recruitmentStage: 'rejected',
    isRecruitmentRelevant: true,
    createsOrUpdatesOpportunity: false,
    legacyScreeningClass: 'office_coordination',
  },
  job_alert_newsletter: {
    label: 'job_alert_newsletter',
    displayName: 'Job alert or bulk recruitment newsletter',
    recruitmentStage: null,
    isRecruitmentRelevant: false,
    createsOrUpdatesOpportunity: false,
    legacyScreeningClass: 'newsletter_promo',
  },
  unrelated_email: {
    label: 'unrelated_email',
    displayName: 'Unrelated email',
    recruitmentStage: null,
    isRecruitmentRelevant: false,
    createsOrUpdatesOpportunity: false,
    legacyScreeningClass: 'low_relevance',
  },
  spam_or_scam: {
    label: 'spam_or_scam',
    displayName: 'Spam, suspicious recruitment message or possible scam',
    recruitmentStage: 'flagged_suspicious',
    isRecruitmentRelevant: false,
    createsOrUpdatesOpportunity: true,
    legacyScreeningClass: 'suspicious_needs_review',
  },
  uncertain: {
    label: 'uncertain',
    displayName: 'Uncertain, insufficient evidence or unknown category',
    recruitmentStage: 'pending_human_review',
    isRecruitmentRelevant: false,
    createsOrUpdatesOpportunity: true,
    legacyScreeningClass: 'uncertain_needs_review',
  },
};

/**
 * Mandatory Addendum Section 5:
 * Three explicit uncertainty handling outcomes.
 */
export const UNCERTAINTY_OUTCOMES = [
  'HIGH_CONFIDENCE',
  'REVIEW_REQUIRED',
  'LOW_CONFIDENCE_OR_SUSPICIOUS',
] as const;

export type UncertaintyOutcome = (typeof UNCERTAINTY_OUTCOMES)[number];

export const EmailIntelligenceCategoryZod = z.enum(EMAIL_INTELLIGENCE_CATEGORIES);
export const UncertaintyOutcomeZod = z.enum(UNCERTAINTY_OUTCOMES);

export const HARD_CASE_TAGS = [
  'unusual_wording_no_standard_keywords',
  'third_party_assessment_or_interview_platform',
  'jd_or_followup_update',
  'multi_message_thread',
  'newsletter_with_recruitment_keywords',
  'unrelated_with_recruitment_terminology',
  'offer_or_rejection_stage',
  'spoofed_or_scam_recruiting',
  'empty_malformed_short_or_html_only',
  'genuinely_uncertain_ambiguous',
  'standard_recruitment_communication',
] as const;

export type HardCaseTag = (typeof HARD_CASE_TAGS)[number];

export const LabeledEmailExampleSchema = z.object({
  id: z.string().min(3),
  threadId: z.string().min(2),
  senderOrgGroup: z.string().min(2),
  datasetSource: z.enum(['curated_anonymized_corpus', 'consented_real_inbox_feedback', 'synthetic_regression_fixture']),
  split: z.enum(['train', 'val', 'test']).optional(),
  fromRaw: z.string(),
  replyToRaw: z.string().nullable().optional(),
  authHeadersRaw: z.string().nullable().optional(),
  listUnsubscribeHeader: z.string().nullable().optional(),
  inReplyTo: z.string().nullable().optional(),
  subject: z.string(),
  rawBody: z.string(),
  isHtmlOnly: z.boolean().default(false),
  attachmentFilenames: z.array(z.string()).default([]),
  priorThreadCategories: z.array(EmailIntelligenceCategoryZod).default([]),
  primaryCategory: EmailIntelligenceCategoryZod,
  multiLabels: z.array(EmailIntelligenceCategoryZod).min(1),
  hardCaseTags: z.array(z.enum(HARD_CASE_TAGS)).default([]),
});

export type LabeledEmailExample = z.infer<typeof LabeledEmailExampleSchema>;

export const PreprocessingConfigSchema = z.object({
  maxVocabSize: z.number().int().positive(),
  minDocFreq: z.number().int().positive(),
  ngramRange: z.tuple([z.literal(1), z.literal(2)]),
  sublinearTf: z.boolean(),
  lowercase: z.boolean(),
  separateFreshAndQuotedText: z.boolean(),
  htmlDecodeEnabled: z.boolean(),
});

export type PreprocessingConfig = z.infer<typeof PreprocessingConfigSchema>;

export const TrainedEmailModelArtifactSchema = z.object({
  artifactFormatVersion: z.literal('spcr-email-ml-v1'),
  modelVersion: z.string().min(3),
  classifierKind: z.literal('supervised_trained_classifier'),
  architectureType: z.enum(['tfidf_ovr_logreg', 'hybrid_minilm_tfidf_logreg']),
  embeddingBackbone: z
    .object({
      modelId: z.literal('Xenova/all-MiniLM-L6-v2'),
      dimensions: z.literal(384),
      license: z.literal('Apache-2.0'),
    })
    .nullable(),
  license: z.string().min(3),
  datasetVersion: z.string().min(3),
  trainedAt: z.string(),
  randomSeed: z.number().int(),
  regularizationLambda: z.number().positive(),
  labels: z.array(EmailIntelligenceCategoryZod).length(EMAIL_INTELLIGENCE_CATEGORIES.length),
  preprocessingConfig: PreprocessingConfigSchema,
  vocabulary: z.array(z.string()).min(10),
  idfVector: z.array(z.number()).min(10),
  denseFeatureNames: z.array(z.string()).min(5),
  denseMeans: z.array(z.number()).min(5),
  denseStds: z.array(z.number()).min(5),
  weightsByLabel: z.record(z.string(), z.array(z.number())),
  biasByLabel: z.record(z.string(), z.number()),
  multiLabelThresholds: z.record(z.string(), z.number()),
  uncertaintyThresholds: z.object({
    highConfidenceMinScore: z.number().min(0.1).max(0.99),
    highConfidenceMinMargin: z.number().min(0.01).max(0.95),
    lowConfidenceMaxScore: z.number().min(0.05).max(0.9),
  }),
  calibrationDisclosure: z.object({
    isCalibratedProbability: z.literal(false),
    note: z.string(),
  }),
  weightsPayloadSha256: z.string().regex(/^[0-9a-f]{64}$/),
});

export type TrainedEmailModelArtifact = z.infer<typeof TrainedEmailModelArtifactSchema>;

export class ModelArtifactIntegrityError extends Error {
  constructor(
    message: string,
    public readonly reasonCode:
      | 'ARTIFACT_MISSING'
      | 'ARTIFACT_MALFORMED_JSON'
      | 'ARTIFACT_SCHEMA_INVALID'
      | 'ARTIFACT_CHECKSUM_MISMATCH'
      | 'EMBEDDING_BACKBONE_INTEGRITY_ERROR'
  ) {
    super(message);
    this.name = 'ModelArtifactIntegrityError';
  }
}

export const PreDeclaredAcceptanceThresholdsSchema = z.object({
  declaredBeforeFinalTestRunAt: z.string(),
  policyNote: z.string(),
  minimumHeldOutMacroF1: z.number(),
  minimumRelevantOpportunityRecall: z.number(),
  maximumSilentOpportunityDiscardRate: z.number(),
  maximumLeakageGroupsAcrossSplits: z.literal(0),
});

export type PreDeclaredAcceptanceThresholds = z.infer<typeof PreDeclaredAcceptanceThresholdsSchema>;

