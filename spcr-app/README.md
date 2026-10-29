# SPCR — Student Progression & Company Relation

**v1 Scope (Zero-Cost Architecture & Local Recruitment Email Intelligence Model):** Single-owner placement-email intelligence, sender authenticity signaling, 14-category supervised local classification, validated structured extraction with verbatim supporting evidence, multi-turn Gmail thread stage tracking, JD attachment security/matching, optional announcement polishing, and guided manual WhatsApp group dispatch for a college **Training & Placement Officer (TPO)** — operating at a **₹0 recurring third-party software and API bill**.

> **Scope Boundary (v1):** SPCR v1 covers placement communication triage, opportunity review, controlled classifier feedback/retraining, and manual WhatsApp group dispatch only. Student progression/academic record databases are intentionally out of scope for v1 unless explicitly commissioned later.

---

## Explicit Operating Modes (₹0 Recurring Software Cost)

SPCR enforces three explicit runtime postures via environment configuration (with **no payment method required** to run the core application):

1. **`LOCAL_ZERO_COST` (Default — `SPCR_OPERATING_MODE=LOCAL_ZERO_COST`):**
   - Classification, structured extraction, thread matching, attachment parsing, and encrypted storage execute 100% locally on CPU using open-source software (`PGlite` embedded PostgreSQL or local PostgreSQL + `Xenova/all-MiniLM-L6-v2` Apache-2.0 ONNX + SPCR's trained 14-label supervised linear classifier).
   - Optional local periodic Gmail sync (`LOCAL_SYNC_INTERVAL_SECONDS`) runs **while the owner's computer and local SPCR process are running** (it does not claim 24/7 cloud polling while powered off).
2. **`FREE_CLOUD_OPTIONAL` (`SPCR_OPERATING_MODE=FREE_CLOUD_OPTIONAL`):**
   - Uses only free-tier cloud resources (`plan: free` web service + `plan: free` PostgreSQL in `render.yaml` — zero paid background worker).
   - **Documented Free-Tier Operational Limits:** Render Free Web Services sleep after ~15 minutes of HTTP inactivity (cold-start delay on wake; background sync does **not** run while asleep), have a 750 free instance-hour/month ceiling, ephemeral container disk, and Render Free PostgreSQL **expires after 30 days** unless exported/recreated.
3. **`OPTIONAL_GROQ` (`GROQ_LIVE_ENABLED=false` -> `DISABLED` by default):**
   - Completely optional and **never** used for email classification, screening, or core structured extraction.
   - When disabled, missing, rate-limited, or unavailable, 100% of classification, extraction, matching, search, correction, retraining, and manual WhatsApp dispatch features operate normally.
   - When explicitly enabled by the owner on Groq's free tier (`GROQ_FREE_TIER_ONLY=true`), SPCR enforces hard pre-call safety stops (`25 RPM`, `900 RPD`, `180,000 TPD`) so usage halts cleanly at ₹0 rather than risking paid overages.

---

## Local Recruitment Email Intelligence Architecture

SPCR explicitly distinguishes five components (never conflating pretrained embeddings or rules with a trained classifier):

| Component Kind | Implementation | Trained for SPCR Labels? | Required for Core Operation? | License |
| --- | --- | --- | --- | --- |
| `pretrained_embedding_backbone` | `Xenova/all-MiniLM-L6-v2` (384-d quantized ONNX, SHA-256 pinned) | No (pretrained encoder) | Yes (local CPU feature extractor) | Apache-2.0 |
| `deterministic_screening_rules` | `authenticityService.ts` + `structuredEmailExtractor.ts` | No (deterministic RFC/URL/regex) | Yes (local CPU authenticity & extraction) | MIT |
| `exemplar_similarity_classifier` | `localClassifier.ts` (zero-shot cosine prototype baseline) | No (benchmark baseline only) | No | MIT |
| `supervised_trained_classifier` | `ml/artifacts/recruitment_email_model_v1.json` (`hybrid_minilm_tfidf_logreg`) | **YES** (trained on 14 SPCR labels) | **Yes** (primary production classifier) | MIT + Apache-2.0 |
| `optional_drafting_llm` | `groqDraftingService.ts` (`openai/gpt-oss-20b`) | No | **No** (`GROQ_LIVE_ENABLED=false` default) | Optional API |

### 14 Supported Recruitment Categories & Multi-Label Thread Tracking
`relevant_opportunity`, `recruiter_outreach`, `jd_or_details_followup`, `application_acknowledgement`, `screening_or_eligibility`, `online_assessment`, `interview_invitation`, `interview_followup`, `offer`, `rejection`, `job_alert_newsletter`, `unrelated_email`, `spam_or_scam`, `uncertain`.
- Supports multi-label predictions and preserves Gmail `threadId` / `In-Reply-To` linkage so later assessments, interviews, offers, or rejections advance the existing opportunity's `recruitment_stage` without creating duplicate opportunities.
- Fails safely with `ModelArtifactIntegrityError` (HTTP `503`) if the model artifact is missing, malformed, schema-invalid, or checksum-tampered.

---

## Quick Local Run (`LOCAL_ZERO_COST` — ₹0 Cost, Zero Paid Cloud or API Keys Needed)

```powershell
cd d:\Projects\SPCR\spcr-app

# 1. Install dependencies
npm install

# 2. Verify local ONNX backbone checksums (.models_cache)
npm run preload:model

# 3. Prepare group-disjoint dataset, train supervised 14-label model, and run held-out evaluation
npm run ml:prepare
npm run ml:train
npm run ml:evaluate

# 4. Apply PostgreSQL schema migrations (uses local embedded PGlite by default)
npm run migrate

# 5. Build server, worker, React dashboard, and Chrome/Edge MV3 extension
npm run build

# 6. Start SPCR web workstation on http://localhost:3000
npm start
```

---

## Verification, ML Reproducibility & Test Commands

```powershell
npm run ml:prepare            # Build & verify group-disjoint (threadId + senderOrgGroup) dataset splits
npm run ml:train              # Train & compare TF-IDF OvR LogReg vs Hybrid MiniLM+TF-IDF LogReg on CPU
npm run ml:evaluate           # Single-pass held-out test evaluation -> ml/artifacts/evaluation_report_v1.json & docs/MODEL_EVALUATION_REPORT.md
npm run ml:retrain            # Controlled retraining incorporating explicitly approved PII-redacted user corrections
npm run ml:rollback           # Reversible rollback to previous active model version
npm run typecheck             # Strict TypeScript check across server, worker, client, extension, scripts, and tests
npm run lint                  # Security, zero-cost, zero-Groq-in-screening, zero-emoji, and MV3 permission audit
npm test                      # Full Vitest acceptance suite (all Phase-1 + Zero-Cost & ML Addendum demonstrations)
npm audit                     # Dependency vulnerability audit
```

---

## Key Documentation

- [`docs/MODEL_EVALUATION_REPORT.md`](./docs/MODEL_EVALUATION_REPORT.md) — Group-disjoint dataset design, candidate model comparison, per-class P/R/F1, 14x14 confusion matrix, false-negative audit, uncalibrated-score disclosure, and separate real-inbox status.
- [`INSTALL_EXTENSION.md`](./INSTALL_EXTENSION.md) — Step-by-step Chrome & Edge unpacked Developer Mode installation, pairing, update, and removal guide (`₹0` local install).
- [`docs/TECHNICAL_VERIFICATION.md`](./docs/TECHNICAL_VERIFICATION.md) — Verified official documentation sources, free-tier quotas/billing matrix, staged Gmail sync rules, and deployment mode comparison.
- [`docs/THREAT_MODEL_AND_RECOVERY.md`](./docs/THREAT_MODEL_AND_RECOVERY.md) — Threat model, shared encrypted storage design, backup/recovery, and secret rotation.
- [`docs/UNVERIFIED.md`](./docs/UNVERIFIED.md) — Honest disclosures of unresolved live external gates (`UNVERIFIED_NO_REAL_MAILBOX_DATA`, CASA/Workspace verification, free-cloud sleep/30-day DB expiry).
