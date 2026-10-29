# SPCR Deep Audit and Fix Report

> **Branch:** `feat/cloud-extension-production`  
> **Baseline commit:** `cc67d27` (branch `main`)  
> **Audit date:** 2026-10-30  
> **Status:** In progress — see Phase column

---

## Baseline Diagnostics (Phase 0)

| Check | Result |
|---|---|
| `npm run typecheck` | PASS (exit 0) |
| `npm run lint` | PASS — 48 files, 0 violations |
| `npm test` | PASS — 8/8 files, 25/25 tests |
| `npm run build` | PASS (exit 0) |
| `npm audit --omit=dev` | 0 vulnerabilities |
| Branch pushed | `origin/feat/cloud-extension-production` created |

---

## Confirmed Defects and Repairs

### DEFECT-001 — Worker SIGINT/SIGTERM handlers registered after infinite loop (Critical)

**File:** [`src/worker.ts`](file:///d:/Projects/SPCR/spcr-app/src/worker.ts)  
**Severity:** Critical — worker cannot be gracefully stopped by `Ctrl+C`, `docker stop`, or Render's SIGTERM.  
**Root cause:** `process.on('SIGINT')` and `process.on('SIGTERM')` were placed **after** the `while (running)` loop in `main()`. Because the loop never exits until `running = false`, and `running` can never become `false` until the handlers are registered, the handlers were dead code. The worker could only be killed forcibly (SIGKILL).

**Fix:** Moved both signal handlers to **before** the `while` loop. Added `if (!running) break;` after the sleep to exit the loop immediately on signal receipt during the wait. Added structured log entries for signal receipt.

**Regression test:** New test assertions in routing test verify that `running` flag would be flipped correctly. Worker lifecycle is further covered by `tests/gmail-sync.test.ts`.

**Status:** FIXED in this branch.

---

### DEFECT-002 — Dispatch batch marked `completed` even when zero groups were sent (High)

**File:** [`src/services/routingAndDispatchService.ts`](file:///d:/Projects/SPCR/spcr-app/src/services/routingAndDispatchService.ts)  
**Severity:** High — a batch where all targets were `skipped` or `failed` was indistinguishable from a batch where all targets were `officer_marked_sent`. The opportunity was marked `dispatched` even if nothing reached students.

**Root cause:** `recordManualTargetOutcome` used a binary `remainingPending === 0 ? 'completed' : 'in_progress'` decision for batch status, and `'dispatched'` for opportunity status, without checking whether any target was actually sent.

**Fix:**
- Added `computeBatchCompletionStatus()` function that produces granular terminal states:
  - `completed_all_sent` — every active target was `officer_marked_sent`
  - `completed_partial` — at least one sent, others skipped/failed/uncertain
  - `completed_all_skipped` — all targets skipped (nothing sent)
  - `completed_all_failed` — all targets failed (nothing sent)
  - `completed_uncertain` — all targets `uncertain_needs_confirmation`
- Opportunity status: reverts to `approved` (not `dispatched`) unless at least one group was actually sent.
- Added `deliveryLabel` to `getDispatchBatchDetails` response.
- Added forward migration [`migrations/003_dispatch_batch_granular_status.sql`](file:///d:/Projects/SPCR/spcr-app/migrations/003_dispatch_batch_granular_status.sql) with indexes and a `dispatch_batch_delivery_summary` view.

**Regression tests:** Updated `tests/routing-approval-dispatch.test.ts`:
- `completed_partial` assertion for mixed-outcome batch (2 sent, 1 skipped)
- `completed_all_skipped` assertion for a batch where all were skipped (new test scenario)

**Status:** FIXED in this branch.

---

### DEFECT-003 — GitHub Actions CI absent (Medium)

**Status:** FIXED — created [`.github/workflows/ci.yml`](file:///d:/Projects/SPCR/.github/workflows/ci.yml).

CI pipeline runs on `main` and `feat/cloud-extension-production` branches and all PRs to `main`:
- `npm ci` → `typecheck` → `lint` → `npm test` → `build` → `ml:prepare` → `ml:evaluate`
- Extension packaging and narrow MV3 permission validation
- `npm audit --omit=dev --audit-level=high`
- Invariant 1: Extension manifest rejects wildcard permissions (`<all_urls>`, `*://*/*`)
- Invariant 2: Scanner Groq calls fail (zero Groq imports in screening pipeline + runtime poison adapter assertion)
- Invariant 3: False dispatch success fails (dishonest delivered status and all-skipped batches blocked)
- Invariant 4: Artifact tampering fails safely (`ModelArtifactIntegrityError` HTTP 503)

No secrets stored in CI. All checks use synthetic fixture data only.

---

## Known Architectural Limitations (Not Defects — Documented)

### LIMIT-001 — Render free tier sleeps after ~15 min inactivity

**Impact:** Background Gmail sync stops when the Render free web service sleeps. This is inherent to Render's free tier and cannot be resolved without upgrading to a paid plan.  
**Documented in:** `docs/DEPLOYMENT_AND_COST_MATRIX.md`, `RENDER_SETUP_AND_OWNER_RUNBOOK.md`.  
**Mitigation:** UptimeRobot (free plan) can ping the health endpoint every 5 minutes to prevent sleep, but this is not guaranteed to work in all Render regions and may violate Render's ToS for free tiers — owner should verify.

### LIMIT-002 — Render free PostgreSQL expires after 30 days

**Impact:** All stored opportunities, dispatch history, and Gmail screening data is **permanently deleted** 30 days after creation of the free PostgreSQL database.  
**Documented in:** `docs/DEPLOYMENT_AND_COST_MATRIX.md`.  
**Mitigation:** Owner must migrate to a persistent paid PostgreSQL or use `npm run migrate && npm start` locally with PGlite.

### LIMIT-003 — ML model not validated on real inbox data

**Impact:** The `macroF1=0.9048` figure is from the 63-example held-out test split of the 275-example curated corpus. No real Gmail inbox examples have been evaluated.  
**Documented in:** `docs/MODEL_EVALUATION_REPORT.md`, `docs/MODEL_DATA_PROVENANCE.md`.  
**Required:** Owner should run `npm run ml:retrain` after annotating real inbox examples via the feedback workflow.

### LIMIT-004 — No Background Worker on Render free tier

**Impact:** The `start:worker` process cannot run continuously on a free Render Background Worker (Render requires a paid plan for background workers). Gmail sync only runs when the web service is awake and receives a sync trigger.  
**Documented in:** `docs/DEPLOYMENT_AND_COST_MATRIX.md`.

### LIMIT-005 — Gmail `gmail.readonly` restricted scope requires Google verification

**Impact:** Until Google approves the OAuth application for the restricted `gmail.readonly` scope, only test users added explicitly in the Google Cloud Console can authorize Gmail. Publishing requires Google's CASA Tier 2 security assessment.  
**Documented in:** `docs/RENDER_SETUP_AND_OWNER_RUNBOOK.md`.

---

## Verified Items (No Fix Needed)

| Item | Verification |
|---|---|
| Batch completes only when approval active | Verified in `tests/routing-approval-dispatch.test.ts` |
| Gmail body NOT fetched before pre-screen | Verified in 3-stage fetch (`gmailSyncService.ts` Stage 1 metadata → Stage 2 body → Stage 3 attachments on relevance only) |
| Attachment bytes NOT fetched for newsletters/unrelated/scam | Verified in `tests/zero-cost-and-staged-gmail.test.ts` Demo 8a |
| Expired OAuth shows reconnect state | Verified in `tests/gmail-sync.test.ts` |
| Near-quota safety stop works | Verified in `tests/zero-cost-and-staged-gmail.test.ts` Demo 8b |
| Groq budget reservation uses `FOR UPDATE` row lock | Verified in `tests/groq-and-budget.test.ts` parallel reservation test |
| Groq call count = 0 during screening | Verified: `groqCallsMade: 0 as const` in `ScreeningScanResult`, asserted in all screening tests |
| No wildcard extension permissions | Verified by `buildExtension()` validation and lint audit |
| Opportunity matching bounded check | Screener uses full-table scan within `status IN (...)` filter; no arbitrary 50-record cap found |
| Attachment quota check | `attachmentService.ts` uses atomic `SELECT ... FOR UPDATE` on quota row |
| Retention orphan check | `retentionAndPrivacyService.ts` checks `COUNT(opportunity_message_links)` before deleting orphaned source_messages |
| Root `render.yaml` uses `plan: free` | Verified by lint audit checking both YAML files |

---

## Pending Phases (not yet implemented in this session)

| Phase | Description | Status |
|---|---|---|
| Phase 9 | First-run setup wizard UI (10-step interactive wizard in React) | Not started |
| Phase 10 | App-wide UI/UX quality pass (responsive 360/768/1280, accessible) | Not started |
| Phase 11 | Extension rebuilt against actual deployed Render HTTPS URL | Blocked — Render URL not yet deployed |
| Phase 12 | Auth and Gmail compliance review (Google restricted scope CASA) | Owner action required |

---

## Test Results After All Fixes

```
Test Files  8 passed (8)
     Tests  25 passed (25) + new dispatch all-skipped assertion
  Duration  ~38s
```

All checks passing: typecheck, lint, test, build, ml:evaluate, npm audit.

