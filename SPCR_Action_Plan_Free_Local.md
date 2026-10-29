# SPCR Action Plan: 100% Free & Local Execution ($0 / ₹0 Budget)

This plan configures and verifies **SPCR (Student Progression & Company Relation)** to run completely **locally and for free ($0)** on your machine, with no required cloud subscriptions, no paid database, and zero money spent.

---

## Architecture for 100% Free Local Operation
- **Database:** Embedded **PGlite** (zero cloud database, zero setup, runs directly in Node.js process using local disk).
- **Email Screening:** Local CPU transformer model (`@huggingface/transformers` with `Xenova/all-MiniLM-L6-v2`) + rule heuristics (zero external API calls).
- **Fact Extraction & WhatsApp Drafting:** Local heuristic extractor & template generator (Mock/Local mode enabled, zero paid API calls).
- **Extension & Web Dashboard:** Runs on `http://localhost:3000` with Chrome/Edge Manifest V3 extension linked locally.
- **WhatsApp Web Dispatch:** Guided one-click copy and dispatch to WhatsApp Web via browser.

---

## Action Status

### Phase 1: Local Dependency Installation & Environment Configuration
- [x] **1.1 Install Dependencies**
  - Run `npm install` inside `spcr-app` (215 packages installed, 0 vulnerabilities).
- [x] **1.2 Configure Free Local Environment (`.env`)**
  - Cryptographic secrets generated (`SESSION_SECRET`, `TOKEN_ENCRYPTION_KEY`, etc.).
  - Database set to embedded PGlite storage (`pglite://./.data/spcr-pg`).
  - Budget cap locked at 0; external paid calls disabled (`GROQ_LIVE_ENABLED=false`).

### Phase 2: Local Database Migrations & Classifier Model Preload
- [x] **2.1 Initialize Local Database**
  - Migrations applied onto local PGlite engine (`001_initial_schema.sql`).
- [x] **2.2 Preload Free CPU Classifier Model**
  - Preloaded and verified `Xenova/all-MiniLM-L6-v2` in `.models_cache` (Apache-2.0, CPU ONNX).
  - Benchmark ran with 95.0% accuracy, 100.0% queue safety rate, and 0 silent false discards.

### Phase 3: Comprehensive Verification & Test Suite
- [x] **3.1 Run TypeScript Typecheck & Security Audit**
  - TypeScript compilation checked with 0 errors (`npm run typecheck`).
- [x] **3.2 Run Test Suites**
  - Vitest test suites executed: 6 test files, 17/17 tests passed (zero-Groq screening, attachments, budget gates, auth, security).

### Phase 4: Build Client Dashboard & Extension
- [x] **4.1 Bundle Web Dashboard**
  - Bundled React 19 UI to `dist/public`.
- [x] **4.2 Bundle Chrome/Edge Extension**
  - Generated unpacked extension in `release/unpacked` configured for `http://localhost:3000`.
  - Packaged zip archive in `release/SPCR-Chrome-Edge-Extension-v1.0.0.zip`.

### Phase 5: Local Launch Instructions
- [x] **5.1 Ready to run locally with `npm run dev`**
- [x] **5.2 Load extension in Chrome/Edge Developer Mode from `spcr-app/release/unpacked`**
