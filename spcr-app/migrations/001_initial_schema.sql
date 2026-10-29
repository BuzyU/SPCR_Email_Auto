-- SPCR (Student Progression & Company Relation) — PostgreSQL Schema Migration 001
-- Covers users, sessions, extension pairings, Gmail OAuth encrypted tokens, worker leases,
-- source messages, zero-Groq screening outcomes, opportunities & versions, email/JD links,
-- encrypted shared attachment blobs, fact provenance & conflicts, drafts, approvals,
-- sections/WhatsApp groups, manual dispatch queue, concurrency-safe Groq budget ledger, and audit trail.

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  display_name TEXT,
  oidc_sub TEXT,
  is_owner BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_login_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_sha256 TEXT NOT NULL UNIQUE,
  csrf_token TEXT NOT NULL,
  auth_method TEXT NOT NULL CHECK (auth_method IN ('google_oidc', 'local_demo')),
  user_agent TEXT,
  ip_address TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_sessions_token ON sessions(token_sha256);

CREATE TABLE IF NOT EXISTS extension_pairings (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  pairing_code_sha256 TEXT UNIQUE,
  pairing_expires_at TIMESTAMPTZ NOT NULL,
  extension_token_sha256 TEXT UNIQUE,
  csrf_token TEXT NOT NULL,
  label TEXT NOT NULL,
  origin TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  claimed_at TIMESTAMPTZ,
  last_used_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value_json JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS gmail_connections (
  id TEXT PRIMARY KEY,
  mailbox_email TEXT NOT NULL UNIQUE,
  encrypted_access_token TEXT NOT NULL,
  encrypted_refresh_token TEXT,
  token_expiry_at TIMESTAMPTZ,
  granted_scopes TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('connected', 'expired_or_revoked', 'disconnected', 'policy_blocked')),
  last_history_id TEXT,
  last_poll_at TIMESTAMPTZ,
  last_success_at TIMESTAMPTZ,
  last_error TEXT,
  connected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  disconnected_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS worker_leases (
  lease_key TEXT PRIMARY KEY,
  holder_id TEXT NOT NULL,
  acquired_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  heartbeat_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  last_status_json JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS sender_notes (
  id TEXT PRIMARY KEY,
  domain_or_email TEXT NOT NULL UNIQUE,
  category TEXT NOT NULL CHECK (category IN ('known_company', 'recruitment_agency', 'caution', 'general_note')),
  note TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS source_messages (
  id TEXT PRIMARY KEY,
  gmail_message_id TEXT NOT NULL UNIQUE,
  gmail_thread_id TEXT,
  rfc_message_id TEXT,
  in_reply_to TEXT,
  references_header TEXT,
  from_raw TEXT NOT NULL,
  from_email TEXT NOT NULL,
  from_domain TEXT NOT NULL,
  from_display_name TEXT,
  reply_to_email TEXT,
  subject TEXT NOT NULL,
  received_at TIMESTAMPTZ NOT NULL,
  snippet TEXT,
  body_text TEXT,
  body_retained BOOLEAN NOT NULL DEFAULT FALSE,
  auth_headers_raw TEXT,
  extracted_urls_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  message_sha256 TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  source_origin TEXT NOT NULL CHECK (source_origin IN ('gmail_api', 'synthetic_fixture')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_source_messages_thread ON source_messages(gmail_thread_id);
CREATE INDEX IF NOT EXISTS idx_source_messages_domain ON source_messages(from_domain);
CREATE INDEX IF NOT EXISTS idx_source_messages_received ON source_messages(received_at DESC);

CREATE TABLE IF NOT EXISTS screening_outcomes (
  id TEXT PRIMARY KEY,
  source_message_id TEXT NOT NULL UNIQUE REFERENCES source_messages(id) ON DELETE CASCADE,
  classification TEXT NOT NULL CHECK (classification IN (
    'candidate_opportunity',
    'related_jd_followup',
    'office_coordination',
    'low_relevance',
    'newsletter_promo',
    'suspicious_needs_review',
    'uncertain_needs_review'
  )),
  confidence NUMERIC(6,4) NOT NULL,
  margin NUMERIC(6,4) NOT NULL,
  model_scores_json JSONB NOT NULL,
  rule_signals_json JSONB NOT NULL,
  authenticity_label TEXT NOT NULL,
  transport_auth_status TEXT NOT NULL CHECK (transport_auth_status IN ('passed', 'failed', 'partial', 'unavailable')),
  authenticity_signals_json JSONB NOT NULL,
  risk_flags_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  groq_calls_made INTEGER NOT NULL DEFAULT 0 CHECK (groq_calls_made = 0),
  scan_trigger TEXT NOT NULL CHECK (scan_trigger IN ('auto_monitor', 'manual_scan')),
  officer_feedback TEXT CHECK (officer_feedback IN ('relevant_placement', 'related_jd', 'not_relevant', 'suspicious')),
  feedback_recorded_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS opportunities (
  id TEXT PRIMARY KEY,
  company_name TEXT NOT NULL,
  role_title TEXT NOT NULL,
  opportunity_type TEXT NOT NULL DEFAULT 'Not specified',
  status TEXT NOT NULL CHECK (status IN (
    'needs_review',
    'ready_for_draft',
    'draft_in_review',
    'approved',
    'dispatch_in_progress',
    'dispatched',
    'archived'
  )),
  screening_confidence_tier TEXT NOT NULL DEFAULT 'standard' CHECK (screening_confidence_tier IN ('high', 'standard', 'uncertain', 'suspicious')),
  current_version INTEGER NOT NULL DEFAULT 1,
  material_hash TEXT NOT NULL,
  eligibility_summary_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  suggested_section_ids_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  review_flags_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_opportunities_updated ON opportunities(updated_at DESC);

CREATE TABLE IF NOT EXISTS opportunity_versions (
  id TEXT PRIMARY KEY,
  opportunity_id TEXT NOT NULL REFERENCES opportunities(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  material_hash TEXT NOT NULL,
  change_summary TEXT NOT NULL,
  snapshot_json JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(opportunity_id, version)
);

CREATE TABLE IF NOT EXISTS opportunity_message_links (
  id TEXT PRIMARY KEY,
  opportunity_id TEXT NOT NULL REFERENCES opportunities(id) ON DELETE CASCADE,
  source_message_id TEXT NOT NULL REFERENCES source_messages(id) ON DELETE CASCADE,
  link_state TEXT NOT NULL CHECK (link_state IN ('confirmed', 'proposed', 'rejected')),
  match_score NUMERIC(6,4) NOT NULL,
  evidence_json JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  confirmed_at TIMESTAMPTZ,
  UNIQUE(opportunity_id, source_message_id)
);

CREATE TABLE IF NOT EXISTS attachments (
  id TEXT PRIMARY KEY,
  source_message_id TEXT NOT NULL REFERENCES source_messages(id) ON DELETE CASCADE,
  opportunity_id TEXT REFERENCES opportunities(id) ON DELETE SET NULL,
  filename TEXT NOT NULL,
  declared_mime TEXT,
  verified_type TEXT NOT NULL CHECK (verified_type IN ('pdf', 'docx', 'macro_rejected', 'unsupported', 'corrupt')),
  byte_size INTEGER NOT NULL,
  sha256_hash TEXT NOT NULL,
  parse_status TEXT NOT NULL CHECK (parse_status IN (
    'parsed',
    'not_parsed_encrypted',
    'not_parsed_scanned_or_image_only',
    'not_parsed_corrupt',
    'not_parsed_oversized',
    'not_parsed_quota_exceeded',
    'not_parsed_macro_rejected',
    'not_parsed_zip_bomb_rejected',
    'not_parsed_timeout',
    'not_parsed_unsupported'
  )),
  parse_reason TEXT NOT NULL,
  extracted_text TEXT,
  page_count INTEGER,
  blob_stored BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_attachments_opp ON attachments(opportunity_id);

CREATE TABLE IF NOT EXISTS attachment_blobs (
  attachment_id TEXT PRIMARY KEY REFERENCES attachments(id) ON DELETE CASCADE,
  encrypted_bytes BYTEA NOT NULL,
  plaintext_sha256 TEXT NOT NULL,
  byte_size INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS extracted_facts (
  id TEXT PRIMARY KEY,
  opportunity_id TEXT NOT NULL REFERENCES opportunities(id) ON DELETE CASCADE,
  opportunity_version INTEGER NOT NULL,
  field_name TEXT NOT NULL,
  field_value TEXT NOT NULL,
  source_kind TEXT NOT NULL CHECK (source_kind IN ('email', 'attachment', 'manual_officer', 'missing')),
  source_ref_id TEXT,
  source_label TEXT,
  source_excerpt TEXT,
  conflicts_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  extraction_method TEXT NOT NULL CHECK (extraction_method IN ('deterministic_local', 'groq_structured', 'officer_edit')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_extracted_facts_opp ON extracted_facts(opportunity_id, opportunity_version);

CREATE TABLE IF NOT EXISTS draft_versions (
  id TEXT PRIMARY KEY,
  opportunity_id TEXT NOT NULL REFERENCES opportunities(id) ON DELETE CASCADE,
  opportunity_version INTEGER NOT NULL,
  draft_number INTEGER NOT NULL,
  draft_text TEXT NOT NULL,
  draft_sha256 TEXT NOT NULL,
  generated_by TEXT NOT NULL CHECK (generated_by IN ('groq_live', 'groq_mock_demo', 'deterministic_template', 'officer_manual_edit')),
  authorization_source TEXT,
  model_id TEXT,
  missing_fields_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  conflicts_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  review_flags_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS approvals (
  id TEXT PRIMARY KEY,
  opportunity_id TEXT NOT NULL REFERENCES opportunities(id) ON DELETE CASCADE,
  draft_version_id TEXT NOT NULL REFERENCES draft_versions(id) ON DELETE CASCADE,
  opportunity_version INTEGER NOT NULL,
  draft_sha256 TEXT NOT NULL,
  attachment_hashes_json JSONB NOT NULL,
  target_section_ids_json JSONB NOT NULL,
  target_group_ids_json JSONB NOT NULL,
  approved_by_email TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('active', 'invalidated', 'superseded')),
  invalidation_reason TEXT,
  approved_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  invalidated_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_approvals_opp ON approvals(opportunity_id, status);

CREATE TABLE IF NOT EXISTS sections (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  description TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  eligibility_tags_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS whatsapp_groups (
  id TEXT PRIMARY KEY,
  visible_name TEXT NOT NULL,
  alias_or_notes TEXT,
  unverified_invite_link TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  last_verified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS section_group_mappings (
  section_id TEXT NOT NULL REFERENCES sections(id) ON DELETE CASCADE,
  group_id TEXT NOT NULL REFERENCES whatsapp_groups(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (section_id, group_id)
);

CREATE TABLE IF NOT EXISTS dispatch_batches (
  id TEXT PRIMARY KEY,
  opportunity_id TEXT NOT NULL REFERENCES opportunities(id) ON DELETE CASCADE,
  approval_id TEXT NOT NULL REFERENCES approvals(id) ON DELETE CASCADE,
  opportunity_version INTEGER NOT NULL,
  approved_draft_text TEXT NOT NULL,
  approved_draft_sha256 TEXT NOT NULL,
  selected_sections_snapshot_json JSONB NOT NULL,
  destinations_snapshot_json JSONB NOT NULL,
  jd_attachment_id TEXT REFERENCES attachments(id) ON DELETE SET NULL,
  jd_source_url TEXT,
  status TEXT NOT NULL CHECK (status IN ('ready', 'in_progress', 'completed', 'cancelled', 'stale_invalidated')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS dispatch_targets (
  id TEXT PRIMARY KEY,
  batch_id TEXT NOT NULL REFERENCES dispatch_batches(id) ON DELETE CASCADE,
  opportunity_id TEXT NOT NULL REFERENCES opportunities(id) ON DELETE CASCADE,
  opportunity_version INTEGER NOT NULL,
  group_id TEXT NOT NULL,
  group_visible_name_snapshot TEXT NOT NULL,
  group_notes_snapshot TEXT,
  contributing_sections_json JSONB NOT NULL,
  sort_index INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN (
    'pending',
    'officer_marked_sent',
    'skipped',
    'failed',
    'uncertain_needs_confirmation',
    'stale_approval_invalidated'
  )),
  officer_note TEXT,
  idempotency_key TEXT NOT NULL UNIQUE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_dispatch_targets_batch ON dispatch_targets(batch_id, sort_index);

CREATE TABLE IF NOT EXISTS groq_monthly_budgets (
  month_key TEXT PRIMARY KEY,
  cap_inr NUMERIC(12,2) NOT NULL,
  usd_to_inr_rate NUMERIC(10,4) NOT NULL,
  cap_usd NUMERIC(12,6) NOT NULL,
  spent_usd NUMERIC(12,6) NOT NULL DEFAULT 0,
  reserved_usd NUMERIC(12,6) NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS groq_usage_ledger (
  id TEXT PRIMARY KEY,
  month_key TEXT NOT NULL,
  opportunity_id TEXT REFERENCES opportunities(id) ON DELETE SET NULL,
  model_id TEXT NOT NULL,
  authorization_source TEXT NOT NULL CHECK (authorization_source IN (
    'manual_format_button',
    'auto_high_confidence_setting',
    'manual_suspicious_override'
  )),
  status TEXT NOT NULL CHECK (status IN ('reserved', 'settled', 'released', 'rejected_cap')),
  reserved_usd NUMERIC(12,6) NOT NULL DEFAULT 0,
  prompt_tokens INTEGER NOT NULL DEFAULT 0,
  completion_tokens INTEGER NOT NULL DEFAULT 0,
  actual_cost_usd NUMERIC(12,6) NOT NULL DEFAULT 0,
  actual_cost_inr NUMERIC(12,4) NOT NULL DEFAULT 0,
  error_code TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  settled_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_groq_ledger_month ON groq_usage_ledger(month_key, created_at DESC);

CREATE TABLE IF NOT EXISTS audit_events (
  id TEXT PRIMARY KEY,
  actor_email TEXT,
  event_type TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT,
  metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_audit_events_created ON audit_events(created_at DESC);

