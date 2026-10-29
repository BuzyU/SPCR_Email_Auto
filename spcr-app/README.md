# SPCR — Student Progression & Company Relation

**v1 Scope:** Single-owner hosted placement-email triage, sender authenticity signaling, independent zero-Groq local screening, Email/JD opportunity matching, gated Groq structured extraction & announcement drafting, and guided manual WhatsApp group dispatch for a college **Training & Placement Officer (TPO)**.

> **Scope Boundary (v1):** SPCR v1 covers placement communication triage, opportunity review, and manual WhatsApp group dispatch only. Student progression/academic record databases are intentionally out of scope for v1 unless explicitly commissioned later.

---

## Architecture Summary (Option A — Render-First + Companion Extension)

1. **`spcr-web` (Node.js 22+ / TypeScript / Express + React SPA):**
   - Single-owner dashboard protected by Google OpenID Connect (`openid email profile`) allowlisted strictly to `SPCR_OWNER_EMAIL` (separate from Gmail mailbox OAuth), `HttpOnly; SameSite=Lax; Secure` signed session cookies, `X-CSRF-Token` validation, strict Origin/CORS checks, and rate limiting.
2. **`spcr-worker` (Continuous Render Background Worker):**
   - Polls Gmail (`gmail.readonly` only, gated behind `GMAIL_POLICY_GATE_APPROVED`) via `ChangeSource` abstraction with PostgreSQL `worker_leases` single-worker coordination, incremental `users.history.list` sync, automatic HTTP `404` expired-`historyId` bounded resync recovery, and exponential backoff.
   - Runs scheduled data-retention cleanup across raw bodies and encrypted attachments.
3. **Independent Zero-Groq Email Screening (`src/services/localClassifier.ts` + `authenticityService.ts`):**
   - Automatic monitoring and manual `Scan Email` make **zero Groq requests**.
   - Combines deterministic RFC header/domain/URL/fee-scam/prompt-injection checks with self-hosted quantized ONNX semantic embeddings (`Xenova/all-MiniLM-L6-v2`, Apache-2.0, pinned SHA-256 checksums).
4. **Shared Private Encrypted Attachment Storage (`src/services/attachmentService.ts`):**
   - Because Render Persistent Disks attach to only a single service instance, PDF/DOCX attachments are encrypted with **AES-256-GCM** (`TOKEN_ENCRYPTION_KEY`) and stored in PostgreSQL `attachment_blobs` (`BYTEA`) so `spcr-worker` writes and `spcr-web` owner-authenticated downloads work seamlessly across services with zero public URLs.
   - Isolated `node:worker_threads` parser enforces timeouts (`worker.terminate()`), magic-byte verification, `pdfjs-dist` (`isEvalSupported: false`), DOCX `zlib.inflateRawSync({ maxOutputLength })` ZIP-bomb defense, and macro/VBA rejection.
5. **Post-Screen Groq Extraction & Concurrency-Safe Budget Ledger (`src/services/groqDraftingService.ts`):**
   - Default model: `openai/gpt-oss-20b` (`strict: true` JSON Schema).
   - Separate `Automatically format high-confidence placement candidates with Groq` toggle defaults **OFF**.
   - Concurrency-safe `SELECT ... FOR UPDATE` reservation on `groq_monthly_budgets` prevents parallel overspend ahead of Groq's 10–15 minute delayed org spend limit.
6. **Chrome & Edge Manifest V3 Companion Extension (`extension/` -> `release/`):**
   - Narrow permissions (`storage`, `activeTab`, `https://mail.google.com/*`, and exact SPCR backend origin), one-time pairing code flow, Gmail action bar (`Scan Email`, `Format Announcement with Groq`, `Review/Edit in SPCR`, `Choose WhatsApp Groups`), and full toolbar popup fallback.

---

## Quick Local Run (Zero Paid Cloud Services / Zero Live Credentials Needed)

```powershell
cd d:\Projects\SPCR\spcr-app

# 1. Install dependencies (if not already installed)
npm install

# 2. Download & verify pinned SHA-256 checksums for local ONNX screening model
npm run preload:model

# 3. Apply PostgreSQL schema migrations (uses local embedded PGlite by default)
npm run migrate

# 4. Build server, worker, React dashboard, and Chrome/Edge MV3 extension
npm run build

# 5. Start SPCR web workstation on http://localhost:3000
npm start
```

Open `http://localhost:3000`, click **Sign In as Owner (Local Demo / Synthetic Mode)**, navigate to **Overview & First-Run Consent** or **Opportunity Inbox & Review**, and click **Seed Synthetic Demo Data (Zero Groq Calls)** to explore all 15 screens end-to-end.

---

## Verification & Test Commands

```powershell
npm run typecheck             # Strict TypeScript check across server, worker, client, extension, scripts, and tests
npm run lint                  # Security & architectural invariant audit (zero-Groq screening, no WhatsApp DOM scripts, no UI emojis, narrow MV3 permissions)
npm test                      # Full Vitest acceptance test suite (Section 16 matrix)
npm run benchmark:classifier  # Synthetic & adversarial classifier evaluation report -> docs/CLASSIFIER_BENCHMARK_REPORT.json
npm audit                     # Dependency vulnerability audit
```

---

## Key Documentation

- [`INSTALL_EXTENSION.md`](./INSTALL_EXTENSION.md) — Step-by-step Chrome & Edge installation, pairing, update, and removal guide.
- [`docs/TECHNICAL_VERIFICATION.md`](./docs/TECHNICAL_VERIFICATION.md) — Verified official documentation sources (Groq models/pricing/retention, Gmail API scopes/history, Render pricing/disks, MV3).
- [`docs/THREAT_MODEL_AND_RECOVERY.md`](./docs/THREAT_MODEL_AND_RECOVERY.md) — Threat model, shared encrypted storage design, backup/PITR recovery, secret rotation, and v2 mobile roadmap.
- [`docs/UNVERIFIED.md`](./docs/UNVERIFIED.md) — Unresolved owner launch gates (CASA/restricted-scope verification, monthly Groq budget cap, Render paid tier approval, extension store publication).

