# SPCR Unresolved Launch Gates, Free-Tier Limits & Honest Disclosures (`UNVERIFIED.md`)

**Date:** 2026-10-30  
**Status:** `LOCAL_ZERO_COST` Mode Verified End-to-End at ₹0 Recurring Cost; Live External Mailbox & Consented Real-Inbox Benchmark Pending Owner Action

This document records compliance, real-mailbox evaluation, and free-tier operational limits that **cannot and must not be fabricated or silently assumed**.

---

## 1. Real-World Consented Mailbox Evaluation (`UNVERIFIED_NO_REAL_MAILBOX_DATA`)
- **Current State:** `UNVERIFIED_NO_REAL_MAILBOX_DATA` (`0` real mailbox examples in `ml/data/real_inbox_consented_eval.jsonl`)
- **Why Unresolved:**
  - Per Mandatory Addendum Sections 2 & 6, synthetic fixtures and our curated 275-example anonymized corpus (`ml/data/curated_recruitment_corpus_v1.jsonl`, held-out Macro-F1 `0.9048`, Relevant Opportunity Recall `1.0000`, Silent Discard Rate `0.0000`) validate pipeline engineering and hard-case coverage, **not** live real-world distribution accuracy on the placement office's actual inbox.
  - Confidence outputs from the L2 One-vs-Rest logistic classifier are explicitly marked `isCalibratedProbability: false` (uncalibrated ranking scores, not empirical probabilities).
- **How to Verify Safely at ₹0 Cost:**
  - Connect the placement mailbox locally (`LOCAL_ZERO_COST`), review incoming emails in SPCR, use the **Controlled Correction** buttons (`Correct` / `Uncertain` / `Correct to...`), approve verified PII-redacted examples in the **Email Intelligence & Retraining** tab, and evaluate on consented real-inbox examples via `npm run ml:evaluate`.

## 2. Google Restricted-Scope (`gmail.readonly`) & CASA Policy Gate
- **Current State:** `BLOCKED BY POLICY` (`GMAIL_POLICY_GATE_APPROVED=false` by default)
- **Why Unresolved:**
  - Reading placement emails and JD attachments requires `https://www.googleapis.com/auth/gmail.readonly` (a **Restricted Scope**).
  - Running SPCR in **`LOCAL_ZERO_COST`** mode on the TPO's own computer or as an **Internal** Google Workspace app inside the college's Google Workspace organization avoids remote third-party server storage and paid CASA lab assessments, whereas publishing an **External** cloud-hosted OAuth app storing restricted Gmail data generally triggers annual CASA assessment requirements (and 7-day refresh-token expiry while in Google OAuth "Testing" status).
- **Required Before Live Mailbox Enablement:**
  1. Confirm whether SPCR will run in `LOCAL_ZERO_COST` mode / college-internal Google Workspace mode.
  2. Register free Google Cloud OAuth 2.0 credentials (`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`) and set `GMAIL_POLICY_GATE_APPROVED=true` only after confirming organizational policy compliance.

## 3. Deployment Distinction: `LOCAL_ZERO_COST` vs `FREE_CLOUD_OPTIONAL`
- **`LOCAL_ZERO_COST` (Default, ₹0/month, Persistent Local Disk):**
  - Runs on the owner's computer with embedded open-source `PGlite` (`pglite://./data/pglite`).
  - Automatic sync (`LOCAL_SYNC_INTERVAL_SECONDS`) operates **only while the owner's computer and local SPCR server process are running**.
- **`FREE_CLOUD_OPTIONAL` (`render.yaml`, ₹0/month Free Tier, Non-Continuous):**
  - Uses Render `plan: free` Web Service + Render `plan: free` PostgreSQL (`0` paid worker services; no payment method required where eligible under Render's free tier).
  - **Enforced Operational Disclosures:**
    1. Free web instances spin down after ~15 minutes of inactivity and do **not** run continuous background Gmail polling while asleep.
    2. Render Free PostgreSQL databases **expire and delete after 30 days** unless exported and recreated or pointed to a local/institutional database.
    3. Free-tier terms are controlled by external providers and may change; SPCR treats ₹0 cost as an enforced operational constraint (`plan: free` lint check + hard quota safety stops), never an automatic upgrade to paid plans.

## 4. Optional Groq Enhancement (`GROQ_LIVE_ENABLED=false` Default)
- **Current State:** `DISABLED` by default (`OPTIONAL_GROQ` is completely unnecessary for classification, structured extraction, thread stage tracking, matching, or manual WhatsApp dispatch).
- **Zero-Cost Safeguard:** Even if the owner optionally supplies a free Groq API key (`GROQ_FREE_TIER_ONLY=true`), SPCR halts requests at `25 RPM` / `900 RPD` / `180,000 TPD` (`GROQ_FREE_TIER_SAFETY_STOP`) and never switches to a paid provider or paid tier.

## 5. Browser Extension Distribution (`₹0` Unpacked Developer Mode vs Store Fee)
- **Current State:** `CONFIGURED FOR ₹0 DEVELOPER MODE UNPACKED INSTALL`
- **Details:**
  - `release/unpacked/` and `release/SPCR-Chrome-Edge-Extension-v1.0.0.zip` install locally in Chrome (`chrome://extensions`) and Edge (`edge://extensions`) via **Developer mode -> Load unpacked** at **₹0 cost**.
  - Microsoft Edge Add-ons Partner Center registration is `$0`, whereas Chrome Web Store public developer registration charges a `$5` one-time fee; therefore SPCR does **not** require Chrome Web Store registration.

## 6. Explicit v1 Product Scope Boundary ("Student Progression")
- Student academic databases, progression analytics, and placement-outcome tracking remain intentionally excluded from v1 unless commissioned later.
