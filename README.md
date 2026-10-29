# SPCR — Student Progression & Company Relation (Zero-Cost Architecture)

Single-owner placement-email intelligence, 14-category supervised local classification, validated structured extraction with verbatim supporting evidence, multi-turn Gmail thread stage tracking, and human-verified WhatsApp group dispatch for a college **Training & Placement Officer (TPO)** — engineered to run with a **₹0 recurring third-party software and API bill**.

## Operating Modes (`₹0` Recurring Software & API Bill)

1. **`LOCAL_ZERO_COST` (Default):** 100% local CPU classification (`hybrid_minilm_tfidf_logreg` + `Xenova/all-MiniLM-L6-v2` Apache-2.0 ONNX), local deterministic structured extraction with verbatim evidence, and local embedded `PGlite` PostgreSQL storage (`pglite://./data/pglite`). Optional periodic Gmail sync runs while the owner's computer and local process are running. No payment method or paid API required.
2. **`FREE_CLOUD_OPTIONAL` (`render.yaml` — `plan: free` only):** Free-tier web + database Blueprint (`0` paid worker services). Documented free-tier operational limits: ~15-minute idle spin-down (non-continuous background sync while asleep) and 30-day Render Free PostgreSQL expiration.
3. **`OPTIONAL_GROQ` (`GROQ_LIVE_ENABLED=false` default):** Disabled by default and never required for classification, extraction, matching, correction, retraining, or manual WhatsApp dispatch. Bounded by hard pre-call free-tier safety stops (`25 RPM`, `900 RPD`, `180,000 TPD`) when optionally enabled.

## Quick Start (`LOCAL_ZERO_COST`)

See [`spcr-app/README.md`](spcr-app/README.md) and [`spcr-app/docs/MODEL_EVALUATION_REPORT.md`](spcr-app/docs/MODEL_EVALUATION_REPORT.md) for full details:

```powershell
cd spcr-app
npm install
npm run preload:model
npm run ml:prepare
npm run ml:train
npm run ml:evaluate
npm run migrate
npm run build
npm start
```
