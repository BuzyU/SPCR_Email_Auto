# SPCR Recruitment Email Intelligence — Model Evaluation Report

- **Model Version:** `spcr-email-intel-v1.0.0`
- **Selected Architecture:** `hybrid_minilm_tfidf_logreg` (`supervised_trained_classifier`)
- **Dataset Version:** `spcr-curated-v1.0.0-258aca8317`
- **Artifact SHA-256:** `815d8ff57f14835a39657613bc11c941f50921bda98e1a7f7d2f9ba340fb7347`
- **Generated At:** `2026-10-29T18:55:02.285Z`
- **Recurring Inference Cost:** **₹0** (100% local CPU execution; zero Groq / zero paid API dependence)

## 1. Uncalibrated Score Disclosure & Data Separation Statement

1. **Uncalibrated Scores:** Confidence scores are uncalibrated logistic sigmoid outputs from class-balanced L2 One-vs-Rest linear classifiers. They are NOT calibrated probabilities and must not be interpreted as empirical likelihoods.
2. **Strict Separation of Curated Held-Out, Synthetic Regression, and Real-World Mailbox Data:**
   - **Curated Anonymized Multi-Thread Benchmark (`ml/data/curated_recruitment_corpus_v1.jsonl`):** Group-disjoint split by **both** `threadId` AND `senderOrgGroup` (`sharedThreadIds=0`, `sharedSenderOrgs=0`). Vocabulary (`fitTfIdfVectorizer`) and feature scalers (`fitStandardScaler`) were fitted **exclusively** on `train`.
   - **Phase-1 Synthetic Smoke Fixtures (20 items):** Reported separately below for regression continuity only — **not** treated as evidence of real-world accuracy.
   - **Consented Real-World Mailbox Data (`ml/data/real_inbox_consented_eval.jsonl`):** Status = `UNVERIFIED_NO_REAL_MAILBOX_DATA` (0 consented real-world mailbox examples are currently present in ml/data/real_inbox_consented_eval.jsonl. Real-inbox accuracy remains UNVERIFIED until the placement office connects Gmail and approves anonymized feedback examples.)

## 2. Validation Split Model Comparison (Used for Architecture & Hyperparameter Selection)

| Candidate | Component Kind | Supervised? | Val Macro-F1 | Val Accuracy | Val Opp Recall | Val Silent Discard Rate | Avg CPU Latency | Est. RAM |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `naive_majority` | `deterministic_screening_rules` | No | 0.0115 | 0.0877 | 1.0000 | 0.0000 | 0.001 ms | ~0.1 MB |
| `minilm_exemplar_zero_shot` | `exemplar_similarity_classifier` | No | 0.2963 | 0.3860 | 0.7778 | 0.0000 | 4.719 ms | ~85 MB |
| `tfidf_ovr_logreg` | `supervised_trained_classifier` | Yes | 0.8627 | 0.8596 | 1.0000 | 0.0000 | 0.129 ms | ~8 MB |
| `hybrid_minilm_tfidf_logreg` | `supervised_trained_classifier` | Yes | 0.8972 | 0.8947 | 1.0000 | 0.0000 | 8.543 ms | ~92 MB |

**Selection Rationale:** Selected "hybrid_minilm_tfidf_logreg" (lambda=0.003) because on the group-disjoint validation split it improved Macro-F1 from 0.8627 to 0.8972 (delta=+0.0345, silentDiscardRate=0.0000) while keeping local CPU latency at ~8.543 ms/email and ₹0 cost using the already-pinned local ONNX MiniLM cache.

## 3. Pre-Declared Acceptance Thresholds vs Held-Out Test Split (`n = 63`)

| Criterion | Pre-Declared Threshold | Held-Out Test Measured | Status |
| --- | --- | --- | --- |
| Held-Out Macro-F1 | `>= 0.80` | **`0.9048`** (95% bootstrap CI: `[0.8046, 0.9712]`) | **PASS** |
| Relevant Opportunity Recall | `>= 0.85` | **`1.0000`** | **PASS** |
| Silent Opportunity Discard Rate | `<= 0.02` | **`0.0000`** (`0` silent discards) | **PASS** |
| Group Leakage Across Splits | `== 0` | **`0`** | **PASS** |

- **Held-Out Exact Primary Accuracy:** `0.9048` (95% bootstrap CI: `[0.8254, 0.9683]`)
- **Held-Out Weighted-F1:** `0.9012`
- **Held-Out Multi-Label Micro-F1:** `0.8905`

## 4. Per-Class Precision, Recall, F1 & Support (Held-Out Test Split)

| Category ID | Category Meaning | Precision | Recall | F1 | Support | Predicted |
| --- | --- | --- | --- | --- | --- | --- |
| `relevant_opportunity` | Relevant job or internship opportunity | 0.7143 | 1.0000 | 0.8333 | 5 | 7 |
| `recruiter_outreach` | Recruiter outreach or direct hiring communication | 0.7500 | 0.6000 | 0.6667 | 5 | 4 |
| `jd_or_details_followup` | Job description or job-details follow-up | 1.0000 | 0.8000 | 0.8889 | 5 | 4 |
| `application_acknowledgement` | Application submitted or application acknowledgement | 1.0000 | 1.0000 | 1.0000 | 4 | 4 |
| `screening_or_eligibility` | Screening or eligibility request | 1.0000 | 0.8000 | 0.8889 | 5 | 4 |
| `online_assessment` | Online assessment, coding test or assignment | 0.7143 | 1.0000 | 0.8333 | 5 | 7 |
| `interview_invitation` | Interview invitation, scheduling, rescheduling or confirmation | 1.0000 | 1.0000 | 1.0000 | 5 | 5 |
| `interview_followup` | Interview follow-up or next-round update | 1.0000 | 1.0000 | 1.0000 | 5 | 5 |
| `offer` | Job offer or internship offer | 1.0000 | 1.0000 | 1.0000 | 4 | 4 |
| `rejection` | Rejection or unsuccessful application | 1.0000 | 0.5000 | 0.6667 | 4 | 2 |
| `job_alert_newsletter` | Job alert or bulk recruitment newsletter | 1.0000 | 1.0000 | 1.0000 | 4 | 4 |
| `unrelated_email` | Unrelated email | 1.0000 | 1.0000 | 1.0000 | 4 | 4 |
| `spam_or_scam` | Spam, suspicious recruitment message or possible scam | 1.0000 | 1.0000 | 1.0000 | 4 | 4 |
| `uncertain` | Uncertain, insufficient evidence or unknown category | 0.8000 | 1.0000 | 0.8889 | 4 | 5 |

## 5. Held-Out 14x14 Confusion Matrix

| True \ Pred | C1 | C2 | C3 | C4 | C5 | C6 | C7 | C8 | C9 | C10 | C11 | C12 | C13 | C14 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| **C1** `relevant_opportunity` | 5 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| **C2** `recruiter_outreach` | 2 | 3 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| **C3** `jd_or_details_followup` | 0 | 1 | 4 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| **C4** `application_acknowledgement` | 0 | 0 | 0 | 4 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| **C5** `screening_or_eligibility` | 0 | 0 | 0 | 0 | 4 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 1 |
| **C6** `online_assessment` | 0 | 0 | 0 | 0 | 0 | 5 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| **C7** `interview_invitation` | 0 | 0 | 0 | 0 | 0 | 0 | 5 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| **C8** `interview_followup` | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 5 | 0 | 0 | 0 | 0 | 0 | 0 |
| **C9** `offer` | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 4 | 0 | 0 | 0 | 0 | 0 |
| **C10** `rejection` | 0 | 0 | 0 | 0 | 0 | 2 | 0 | 0 | 0 | 2 | 0 | 0 | 0 | 0 |
| **C11** `job_alert_newsletter` | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 4 | 0 | 0 | 0 |
| **C12** `unrelated_email` | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 4 | 0 | 0 |
| **C13** `spam_or_scam` | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 4 | 0 |
| **C14** `uncertain` | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 4 |

## 6. Hard-Case Slice Performance (Held-Out Test Split)

| Hard-Case Slice | Test Count | Primary Accuracy | Silent Opportunity Discards |
| --- | --- | --- | --- |
| `empty_malformed_short_or_html_only` | 3 | 1.0000 | 0 |
| `genuinely_uncertain_ambiguous` | 4 | 1.0000 | 0 |
| `jd_or_followup_update` | 5 | 0.8000 | 0 |
| `multi_message_thread` | 7 | 0.8571 | 0 |
| `newsletter_with_recruitment_keywords` | 4 | 1.0000 | 0 |
| `offer_or_rejection_stage` | 8 | 0.7500 | 0 |
| `spoofed_or_scam_recruiting` | 4 | 1.0000 | 0 |
| `standard_recruitment_communication` | 21 | 0.9048 | 0 |
| `third_party_assessment_or_interview_platform` | 10 | 1.0000 | 0 |
| `unrelated_with_recruitment_terminology` | 2 | 1.0000 | 0 |
| `unusual_wording_no_standard_keywords` | 3 | 0.6667 | 0 |

## 7. False-Negative & Discard Error Inspection

Zero actionable recruitment emails in the held-out test split were misrouted into `unrelated_email` or `job_alert_newsletter`.

## 8. Separate Synthetic Smoke Regression Check (Non-Proof Regression Guard Only)

- **Disclaimer:** Synthetic 20-fixture regression suite from Phase 1. Retained strictly for smoke regression testing; NOT proof of reliable real-world mailbox performance.
- **Fixtures:** 20
- **Actionable vs Non-Actionable Routing Accuracy:** `1.0000`
- **Silent Actionable Discards:** `0`
