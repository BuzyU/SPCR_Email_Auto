# SPCR Technical Verification Log

**Product:** SPCR (Student Progression & Company Relation) — v1.0.0  
**Verification Date:** 2026-10-29  
**Purpose:** Official upstream documentation verification required by Section 0 (Rule 3) and Section 17 of the SPCR Master Implementation Prompt (v2.0).

---

## 1. Gmail API Scopes & Restricted-Scope Rules
- **Official URL:** https://developers.google.com/workspace/gmail/api/auth/scopes
- **Accessed:** 2026-10-29
- **Verified Finding:**
  - `https://www.googleapis.com/auth/gmail.readonly` is classified by Google as a **Restricted Scope** because it grants read access to message bodies, headers, threads, and attachments across the authorized mailbox.
  - `https://www.googleapis.com/auth/gmail.metadata` is narrower (Sensitive/Restricted depending on flow) and reads headers/labels/history IDs, **but** explicitly forbids reading message bodies, forbids downloading JD attachments, and forbids passing the `q` query parameter to `users.messages.list` (returns `403 Forbidden`). Mixing `gmail.metadata` and `gmail.readonly` on the same token also causes `q` queries to fail with `403`.
  - Scopes `gmail.modify`, `gmail.send`, and `https://mail.google.com/` are unnecessary and broader than needed.
- **SPCR Design Effect:**
  - SPCR requests **only** `https://www.googleapis.com/auth/gmail.readonly` for the mailbox connection flow (never `gmail.modify`, `gmail.send`, `mail.google.com`, or mixed `gmail.metadata`), and keeps dashboard login completely separate using `openid email profile` only.
  - Because `gmail.readonly` is a Restricted Scope and SPCR runs on a hosted server (Render) and may transmit selected post-screen candidate content to Groq, live Gmail processing is locked behind `GMAIL_POLICY_GATE_APPROVED=false` by default until OAuth verification / CASA security assessment obligations are resolved for the owner's exact Google account/app configuration.

## 2. Google OAuth 2.0 Web-Server Flow & Offline Access
- **Official URL:** https://developers.google.com/identity/protocols/oauth2/web-server
- **Accessed:** 2026-10-29
- **Verified Finding:**
  - Web-server OAuth 2.0 requires an exact registered `redirect_uri` over HTTPS in production, cryptographic `state` parameter bound to the caller's session to prevent login/authorization CSRF, and server-side authorization-code exchange using `client_secret`.
  - Background polling when the officer's browser is closed requires `access_type=offline` (and `prompt=consent` on initial grant or re-consent) to receive a `refresh_token`.
  - Refresh tokens can become invalid (`invalid_grant`) due to user revocation, password change, or unverified testing-mode 7-day token expiration limits on external apps in "Testing" status.
- **SPCR Design Effect:**
  - Dashboard login (`/api/auth/google/login`) uses `access_type=online` with `openid email profile` only — no offline token needed for dashboard identity.
  - Gmail mailbox authorization (`/api/gmail/oauth/start`) uses `access_type=offline`, cryptographic session-bound `state`, encrypts `access_token` and `refresh_token` at rest with AES-256-GCM (`TOKEN_ENCRYPTION_KEY`), supports explicit revocation via `https://oauth2.googleapis.com/revoke`, and surfaces `invalid_grant` / expired auth immediately in Monitoring Health rather than failing silently.

## 3. Gmail Synchronization, History Cursors & 404 Recovery
- **Official URLs:**
  - https://developers.google.com/workspace/gmail/api/guides/push
  - https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.history/list
- **Accessed:** 2026-10-29
- **Verified Finding:**
  - Incremental synchronization uses `users.history.list` starting from a stored `startHistoryId` originally obtained from `users.getProfile` or message sync (never hardcoded to `0` or `1`).
  - History IDs are valid typically for at least a week, sometimes less; expired or invalid `startHistoryId` returns HTTP `404 NotFound`.
  - Official recovery procedure on `404`: fetch a fresh `historyId` via `users.getProfile`, perform a bounded catch-up listing via `users.messages.list` (with pagination via `nextPageToken`), deduplicate by immutable Gmail `message.id`, and persist the fresh `historyId`.
- **SPCR Design Effect:**
  - Implemented behind a `ChangeSource` interface (`GmailPollingChangeSource` + `SyntheticFixtureChangeSource`) so Google Cloud Pub/Sub push notifications can plug in later without altering screening logic.
  - Handles pagination, exponential backoff on `429`/`5xx`, startup catch-up, idempotency by `gmail_message_id`, and automatic bounded window resync when `users.history.list` returns `404`.

## 4. Google API Services User Data Policy & CASA Assessment
- **Official URL:** https://developers.google.com/terms/api-services-user-data-policy
- **Accessed:** 2026-10-29
- **Verified Finding:**
  - Applications accessing Restricted Scopes (`gmail.readonly`) must comply with **Limited Use** rules: data minimization, explicit disclosure of storage and third-party transfers (such as sending a screened opportunity text to Groq for formatting), prohibition on human reading without affirmative consent, prohibition on using Gmail data for generalized AI/ML model training, and user-accessible deletion/revocation.
  - Storing or transmitting restricted-scope data through remote servers (`*.onrender.com`) generally triggers OAuth App Verification and an annual **CASA (Cloud App Security Assessment)** unless operating strictly as an **Internal** Google Workspace organization app owned by the college Workspace domain. Using a single personal `@gmail.com` account or keeping an External app unverified does **not** grant a blanket exemption and imposes 7-day refresh-token expiry in Testing mode.
- **SPCR Design Effect:**
  - Marked as an explicit **Release Gate** (`BLOCKED BY POLICY` until owner confirms Workspace Internal vs External CASA posture).
  - Non-candidate emails discard `body_text` immediately (`body_retained = FALSE`).
  - Private mailbox data is never used to train models.
  - Default 90-day retention is inactive for live Gmail content until policy gate confirmation; Privacy Center provides instant per-opportunity deletion, delete-all Gmail-derived data, and OAuth disconnect.

## 5. Groq Quickstart & API Authentication
- **Official URL:** https://console.groq.com/docs/quickstart
- **Accessed:** 2026-10-29
- **Verified Finding:**
  - Groq exposes an OpenAI-compatible HTTPS API at `https://api.groq.com/openai/v1/chat/completions` and `https://api.groq.com/openai/v1/models` authenticated via `Authorization: Bearer $GROQ_API_KEY`.
- **SPCR Design Effect:**
  - `GROQ_API_KEY` is read exclusively in the backend Node.js server process. Safe connection checks query `GET /openai/v1/models` to verify key validity and configured model availability without sending any email text or incurring completion token spend.

## 6. Groq Active Production Models (Verified Model IDs)
- **Official URL:** https://console.groq.com/docs/models
- **Accessed:** 2026-10-29
- **Verified Finding (from upstream `models.md`):**
  - Self-serve **Production Models** with public token pricing as of 2026-10-29:
    - `openai/gpt-oss-20b` — ~1,000 tokens/sec, 131,072 context window, 65,536 max completion tokens.
    - `openai/gpt-oss-120b` — ~500 tokens/sec, 131,072 context window, 65,536 max completion tokens.
  - Note: `llama-3.1-8b-instant` and `llama-3.3-70b-versatile` are listed on `console.groq.com/docs/models` as **Enterprise (`Contact Sales`)** as of 2026-10-29 rather than self-serve priced tiers.
- **SPCR Design Effect:**
  - Default `GROQ_MODEL` is set to **`openai/gpt-oss-20b`** (self-serve Production model with Strict Structured Outputs), with **`openai/gpt-oss-120b`** selectable in Settings and custom model ID override supported.

## 7. Groq Structured Outputs (`json_schema` & `strict: true`)
- **Official URL:** https://console.groq.com/docs/structured-outputs
- **Accessed:** 2026-10-29
- **Verified Finding:**
  - Constrained decoding (`response_format.type = "json_schema"` with `"strict": true`) guarantees 100% JSON Schema adherence and is officially supported on `openai/gpt-oss-20b`, `openai/gpt-oss-120b`, `qwen/qwen3.8-27b`, and `meta-models/muse-spark-open`.
  - Strict mode rules: every object must specify `"additionalProperties": false`, every defined property must appear in `"required"`, and streaming/tool use cannot be combined with Structured Outputs.
- **SPCR Design Effect:**
  - SPCR's Groq request uses non-streaming `strict: true` JSON Schema compliance, zero tools/functions, plus independent server-side `zod` schema validation and source-text URL cross-checking.

## 8. Groq Rate Limits & Spend-Limit Error Codes
- **Official URLs:**
  - https://console.groq.com/docs/rate-limits
  - https://console.groq.com/docs/spend-limits
- **Accessed:** 2026-10-29
- **Verified Finding:**
  - Rate limits apply organization-wide:
    - **Free Tier (`openai/gpt-oss-20b` & `openai/gpt-oss-120b`):** `30 RPM`, `1,000 RPD`, `8,000 TPM`, `200,000 TPD`.
    - **Developer Plan (`openai/gpt-oss-20b` & `openai/gpt-oss-120b`):** `1,000 RPM`, `250,000 TPM`.
  - Rate-limit exceedance returns HTTP `429`.
  - Groq organization Spend Limits (paid tier) update every **10–15 minutes** and return HTTP `400` with code `blocked_api_access` once tripped. Because provider tracking lags 10–15 minutes, provider limits alone cannot guarantee zero burst overage.
- **SPCR Design Effect:**
  - SPCR implements an authoritative **server-side PostgreSQL transactional budget reservation (`SELECT ... FOR UPDATE`)** before every Groq API call, plus explicit handling for HTTP `429`, HTTP `400` (`blocked_api_access`), timeouts, and auth errors.

## 9. Groq Customer Data Retention & Zero Data Retention (ZDR)
- **Official URL:** https://console.groq.com/docs/your-data
- **Accessed:** 2026-10-29
- **Verified Finding:**
  - Usage metadata (without customer inputs/outputs) is always retained.
  - By default, Groq does not retain inference prompts/completions, **except** Groq may temporarily log inputs and outputs for **up to 30 days** for system reliability troubleshooting or abuse investigation unless opted out via Groq Console **Data Controls** (`https://console.groq.com/settings/data-controls`).
  - Batch API (`/openai/v1/batches`) and Fine-Tuning retain files for up to 30 days.
- **SPCR Design Effect:**
  - SPCR **never** promises "Groq retains zero data." The in-app AI Data-Flow Disclosure states verbatim that Groq may retain logs up to 30 days for reliability/abuse monitoring unless organization Data Controls / ZDR are configured in Groq Console. SPCR does not use Groq Batch or File upload endpoints in v1.

## 10. Official Groq Token Pricing
- **Official URL:** https://console.groq.com/docs/models (note: `https://groq.com/pricing` 308-redirects to `https://groq.com/`; authoritative per-model pricing table is published on `https://console.groq.com/docs/models`)
- **Accessed:** 2026-10-29
- **Verified Finding:**
  - `openai/gpt-oss-20b`: **$0.075 / 1M input tokens**, **$0.30 / 1M output tokens**.
  - `openai/gpt-oss-120b`: **$0.15 / 1M input tokens**, **$0.60 / 1M output tokens**.
- **SPCR Design Effect:**
  - Displayed transparently in the Budget & Provider Settings UI alongside an interactive monthly estimator (candidates/month × average tokens) and editable INR/USD cap before Groq can be enabled.

## 11. Render Web Services, Background Workers, Environment Variables & PostgreSQL
- **Official URLs:**
  - https://render.com/docs/background-workers
  - https://render.com/docs/environment-variables
  - https://render.com/docs/postgresql
  - https://render.com/pricing
- **Accessed:** 2026-10-29
- **Verified Finding:**
  - Render Background Workers run continuously without inbound HTTP ports and **have no Free tier** — Starter plan begins at **$7/month** (0.5 CPU, 512 MB RAM).
  - Render Web Services require at least **Starter ($7/month)** to stay continuously running without Free-tier spin-down.
  - Render PostgreSQL Free tier **expires and deletes after 30 days**; persistent paid PostgreSQL starts at **Basic-256mb ($6/month, 1 GB storage; +$0.30/GB/month expansion)** on Hobby ($0 workspace fee). Estimated baseline Render monthly total: **~$20 USD/month** ($7 Web + $7 Worker + $6 Postgres on Hobby workspace).
  - Secrets are injected via Render Environment Variables (encrypted at rest) and `fromDatabase` connection linking.
- **SPCR Design Effect:**
  - `render.yaml` declares `spcr-web`, `spcr-worker`, and `spcr-db` cleanly, with **zero deployment triggered automatically** until the owner approves the ~$20 USD/month hosting cost.
  - Worker concurrency safety is enforced via PostgreSQL `worker_leases` row locking so restarts or overlapping deploys never double-poll the mailbox.

## 12. Render Management API
- **Official URL:** https://render.com/docs/api
- **Accessed:** 2026-10-29
- **Verified Finding:**
  - `RENDER_API_KEY` is strictly for programmatic infrastructure management and is never needed at application runtime when deploying via Git/Dashboard Blueprints.
- **SPCR Design Effect:**
  - Marked `NOT NEEDED` in SPCR's credential checklist; never requested by the app.

## 13 & 14. Supabase & Vercel (Optional Alternatives — Not Selected)
- **Official URLs:**
  - https://supabase.com/docs/guides/getting-started/api-keys
  - https://vercel.com/docs
  - https://vercel.com/docs/cron-jobs/usage-and-pricing
- **Accessed:** 2026-10-29
- **Verified Finding:**
  - Vercel Cron triggers periodic serverless invocations rather than a continuous stateful watcher, and Supabase introduces a second cloud vendor unnecessary when Render PostgreSQL already runs on Render's private network.
- **SPCR Design Effect:**
  - Neither Vercel nor Supabase is added or requested (`NOT NEEDED`).

## 15. Self-Hosted Classifier, PDF/DOCX & Security Package Audit
- **Verified Packages & Licenses (2026-10-29):**
  - `@huggingface/transformers` (`^4.3.2`, Apache-2.0) + `Xenova/all-MiniLM-L6-v2` quantized ONNX (`Apache-2.0` license, WordPiece tokenizer, pinned model file checksum verification, zero remote calls once cached). Chosen over arbitrary sentiment/spam models because dense 384-dim English semantic embeddings paired with calibrated multi-prototype recruitment centroids directly model English placement announcements, JD follow-ups, newsletters, and private correspondence on CPU within <120 MB RAM.
  - `pdfjs-dist` (`^4.10.38`, Apache-2.0) — text extraction with `isEvalSupported: false` (no JS execution).
  - `fflate` (`^0.8.2`, MIT) — streaming/bounded ZIP inspection and decompression for `.docx` with strict entry-count, uncompressed-size, and compression-ratio bomb guards, plus deterministic extension release ZIP packaging.
  - `pg` (`^8.13.3`, MIT) & `@electric-sql/pglite` (`^0.2.17`, Apache-2.0 / PostgreSQL License) — PostgreSQL production driver and local WASM PostgreSQL engine.
  - `express` (`^4.21.2`, MIT), `helmet` (`^8.0.0`, MIT), `zod` (`^4.6.7`, MIT), `vitest` (`^5.0.5`, MIT), Node built-in `node:crypto` (AES-256-GCM, HMAC-SHA256, CSPRNG).

## 16. Render Ephemeral Filesystem & Persistent Disk Cross-Service Restriction
- **Official URLs:**
  - https://render.com/docs/disks
  - https://render.com/docs/faq
- **Accessed:** 2026-10-29
- **Verified Finding (verbatim from `render.com/docs/disks`):**
  - Default Render service filesystems are ephemeral and wiped on every deploy/restart.
  - *"A persistent disk is accessible by only a single service instance, and only at runtime. This means: You can't access a service's disk from any other service."*
  - Attaching a persistent disk also disables zero-downtime deploys.
- **SPCR Design Effect:**
  - SPCR stores source JD attachment bytes as **AES-256-GCM encrypted `BYTEA` blobs inside PostgreSQL (`attachment_blobs` table)** with SHA-256 integrity verification, strict per-file (5 MB) and total-storage (250 MB) quotas, and transactional retention cleanup. Both `spcr-web` and `spcr-worker` read/write attachments seamlessly across restarts and deploys without requiring an external S3/R2 account or losing zero-downtime deploys.

## 17. Chrome Web Store & Microsoft Edge Add-ons Distribution
- **Official URLs:**
  - https://support.google.com/chrome/a/answer/2714278
  - https://developer.chrome.com/docs/webstore/register/
  - https://developer.chrome.com/docs/webstore/prepare/
  - https://developer.chrome.com/docs/webstore/review-process
  - https://learn.microsoft.com/microsoft-edge/extensions/publish/hosting-and-updating
- **Accessed:** 2026-10-29
- **Verified Finding:**
  - Stable Chrome and Edge do **not** install raw `.zip` files in one click; local installation requires extracting the archive and using `chrome://extensions` or `edge://extensions` -> **Developer mode** -> **Load unpacked**.
  - One-click store installation requires Manifest V3 with `manifest.json` at the ZIP root, zero remotely hosted code, narrow permissions, privacy disclosures, developer registration ($5 one-time fee for Chrome Web Store; $0 for Microsoft Partner Center Edge Add-ons), and external store review.
- **SPCR Design Effect:**
  - `npm run build:extension` builds both `release/unpacked/` (for immediate Load Unpacked verification) and `release/SPCR-Chrome-Edge-Extension-v1.0.0.zip` (with `manifest.json` at archive root, SHA-256 checksum file, and exact host-permission origin pinning), plus `INSTALL_EXTENSION.md` and `release/store-submission-readiness/` metadata without falsely claiming store publication.
