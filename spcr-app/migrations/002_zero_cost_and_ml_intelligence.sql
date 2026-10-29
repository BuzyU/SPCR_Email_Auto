-- SPCR Migration 002: Zero-Cost Operating Architecture, 14-Category Multi-Label Email Intelligence,
-- Validated Structured Extraction, Controlled User Feedback & Retraining Registry, and Gmail/Groq Free-Tier Quota Guards.

ALTER TABLE screening_outcomes
  ADD COLUMN IF NOT EXISTS primary_category TEXT CHECK (primary_category IN (
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
    'uncertain'
  ));

ALTER TABLE screening_outcomes
  ADD COLUMN IF NOT EXISTS multi_labels_json JSONB NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE screening_outcomes
  ADD COLUMN IF NOT EXISTS uncertainty_outcome TEXT NOT NULL DEFAULT 'REVIEW_REQUIRED' CHECK (uncertainty_outcome IN (
    'HIGH_CONFIDENCE',
    'REVIEW_REQUIRED',
    'LOW_CONFIDENCE_OR_SUSPICIOUS'
  ));

ALTER TABLE screening_outcomes
  ADD COLUMN IF NOT EXISTS uncertainty_reasons_json JSONB NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE screening_outcomes
  ADD COLUMN IF NOT EXISTS classifier_kind TEXT NOT NULL DEFAULT 'supervised_trained_classifier' CHECK (classifier_kind IN (
    'supervised_trained_classifier',
    'exemplar_similarity_classifier',
    'deterministic_screening_rules'
  ));

ALTER TABLE screening_outcomes
  ADD COLUMN IF NOT EXISTS model_version TEXT;

ALTER TABLE screening_outcomes
  ADD COLUMN IF NOT EXISTS structured_extraction_json JSONB;

ALTER TABLE opportunities
  ADD COLUMN IF NOT EXISTS recruitment_stage TEXT NOT NULL DEFAULT 'opportunity_identified';

ALTER TABLE opportunities
  ADD COLUMN IF NOT EXISTS latest_stage_updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

CREATE TABLE IF NOT EXISTS training_feedback_examples (
  id TEXT PRIMARY KEY,
  source_message_id TEXT REFERENCES source_messages(id) ON DELETE SET NULL,
  gmail_thread_id TEXT,
  sender_org_group TEXT NOT NULL,
  verdict TEXT NOT NULL CHECK (verdict IN ('correct', 'incorrect', 'uncertain')),
  predicted_primary_category TEXT NOT NULL,
  corrected_primary_category TEXT NOT NULL CHECK (corrected_primary_category IN (
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
    'uncertain'
  )),
  corrected_multi_labels_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  redacted_subject TEXT NOT NULL,
  redacted_body TEXT NOT NULL,
  sender_domain TEXT NOT NULL DEFAULT 'unknown',
  attachment_filenames_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  prior_thread_categories_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  privacy_redacted BOOLEAN NOT NULL DEFAULT TRUE,
  officer_note TEXT,
  review_status TEXT NOT NULL DEFAULT 'staged_unverified' CHECK (review_status IN (
    'staged_unverified',
    'approved_for_training',
    'rejected'
  )),
  created_by_email TEXT NOT NULL,
  reviewed_by_email TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reviewed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_feedback_review_status ON training_feedback_examples(review_status, created_at DESC);

CREATE TABLE IF NOT EXISTS ml_model_registry (
  model_version TEXT PRIMARY KEY,
  classifier_kind TEXT NOT NULL,
  architecture_summary TEXT NOT NULL,
  artifact_path TEXT NOT NULL,
  artifact_sha256 TEXT NOT NULL,
  dataset_version TEXT NOT NULL,
  held_out_macro_f1 NUMERIC(6,4) NOT NULL,
  metrics_summary_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  is_active BOOLEAN NOT NULL DEFAULT FALSE,
  previous_version TEXT,
  created_by_email TEXT NOT NULL DEFAULT 'system',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  activated_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS gmail_quota_usage (
  day_key TEXT PRIMARY KEY,
  units_used INTEGER NOT NULL DEFAULT 0,
  requests_count INTEGER NOT NULL DEFAULT 0,
  metadata_calls INTEGER NOT NULL DEFAULT 0,
  full_message_calls INTEGER NOT NULL DEFAULT 0,
  attachment_calls INTEGER NOT NULL DEFAULT 0,
  attachments_skipped_by_staging INTEGER NOT NULL DEFAULT 0,
  hard_stop_triggered BOOLEAN NOT NULL DEFAULT FALSE,
  last_stop_reason TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS groq_free_tier_usage (
  day_key TEXT PRIMARY KEY,
  requests_count INTEGER NOT NULL DEFAULT 0,
  tokens_used INTEGER NOT NULL DEFAULT 0,
  minute_bucket TEXT,
  minute_requests_count INTEGER NOT NULL DEFAULT 0,
  hard_stop_triggered BOOLEAN NOT NULL DEFAULT FALSE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

