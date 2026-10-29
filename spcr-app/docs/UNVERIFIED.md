# SPCR Unresolved Launch Gates & Scope Boundaries (`UNVERIFIED.md`)

**Date:** 2026-10-29  
**Status:** Mock/Synthetic Mode Ready & Verified; Live External Production Gates Pending Owner Action

This document records compliance, cost, credential, and product-scope decisions that **cannot and must not be silently assumed** by the implementation. Live external integrations remain safely disabled behind explicit code gates until resolved.

---

## 1. Google Restricted-Scope (`gmail.readonly`) & CASA Policy Gate
- **Current State:** `BLOCKED BY POLICY` (`GMAIL_POLICY_GATE_APPROVED=false` by default)
- **Why Unresolved:**
  - Reading placement emails and JD attachments requires `https://www.googleapis.com/auth/gmail.readonly`, which Google classifies as a **Restricted Scope**.
  - Hosting SPCR on Render stores candidate Gmail metadata/content on remote servers and (when formatting is authorized) transmits selected candidate text to Groq.
  - Under the [Google API Services User Data Policy](https://developers.google.com/terms/api-services-user-data-policy), an **External** OAuth app storing/transmitting restricted data generally requires OAuth App Verification and an annual **CASA (Cloud App Security Assessment)** (~$500+/year via an authorized lab), whereas an **Internal** Google Workspace app restricted to a college's own Google Workspace organization has different internal governance rules.
- **Required Before Live Mailbox Enablement:**
  1. Owner confirms whether the TPO mailbox is a **college Google Workspace account** (eligible for Internal OAuth app type) or a **personal `@gmail.com` account** (External OAuth app).
  2. Owner confirms OAuth verification / CASA applicability and approves the 90-day (or shorter) server retention window under institutional and Google policy.
  3. Only after confirmation should `GMAIL_POLICY_GATE_APPROVED=true` be set in Render Environment settings.

## 2. Single-Owner Dashboard Identity (`SPCR_OWNER_EMAIL`)
- **Current State:** `NEEDED — OWNER ACTION`
- **Why Unresolved:**
  - Production dashboard login enforces strict single-owner Google OpenID Connect (`openid email profile`) verification against `SPCR_OWNER_EMAIL`.
  - Local development/demo mode provides an explicit Demo TPO Sign-In (`SPCR_DEMO_AUTH_ENABLED=true`), which is **hard-disabled in code** whenever `NODE_ENV=production`.
- **Required Before Live Hosting:**
  - Owner sets the exact authorized officer email address in `SPCR_OWNER_EMAIL` and registers `GOOGLE_OIDC_REDIRECT_URI` (`https://<service>.onrender.com/api/auth/google/callback`) in Google Cloud Console.

## 3. Monthly Groq Budget Cap & Auto-Drafting Consent
- **Current State:** `NEEDED — OWNER ACTION` (Groq Live Mode `OFF`, Budget `UNSET`, Auto-Drafting `OFF`)
- **Why Unresolved:**
  - The monthly AI spending cap has not been chosen by the owner.
  - Per Section 5 & Section 10, SPCR refuses live Groq calls until:
    1. `GROQ_API_KEY` is configured server-side in Render Environment settings (never pasted in chat),
    2. The officer reviews current model pricing (`openai/gpt-oss-20b`: $0.075/1M input, $0.30/1M output) and acknowledges the Groq Data-Flow Disclosure (including Groq's up-to-30-day reliability/abuse log policy unless opted out in Groq Data Controls), and
    3. The officer enters and confirms an explicit monthly budget cap in the SPCR Dashboard.
  - `Automatically format high-confidence placement candidates with Groq` defaults to **OFF** and requires a separate affirmative opt-in toggle.

## 4. Paid Render Infrastructure Approval (~$20 USD/month baseline)
- **Current State:** `NEEDED — OWNER ACTION` (Not provisioned)
- **Why Unresolved:**
  - Continuous background monitoring without spin-down or 30-day database expiration requires paid Render tiers:
    - Render Web Service (`Starter`): **$7/month**
    - Render Background Worker (`Starter`): **$7/month**
    - Render PostgreSQL (`Basic-256mb`, 1 GB): **$6/month**
    - Total estimated Render baseline (Hobby workspace): **~$20 USD/month** (+ usage overages if expanded).
  - No cloud resources have been created or billed. `render.yaml` is ready for owner-approved deployment.

## 5. Browser Extension Distribution Path
- **Current State:** `CONFIGURED FOR DEVELOPER MODE ZIP` (Store publication unapproved)
- **Details:**
  - Versioned unpacked build and `release/SPCR-Chrome-Edge-Extension-v1.0.0.zip` + SHA-256 checksum + `INSTALL_EXTENSION.md` are generated and verified.
  - In stable Chrome/Edge, installing from a ZIP requires extracting the folder and loading it via `chrome://extensions` or `edge://extensions` (**Developer mode -> Load unpacked**).
  - One-click store installation requires separate owner approval, developer account registration ($5 Chrome Web Store; free Edge Partner Center), exact Render production URL binding, and external store review.

## 6. Explicit v1 Product Scope Boundary ("Student Progression")
- **Decision Recorded (Section 1):**
  - Although **SPCR** stands for **Student Progression & Company Relation**, v1 scope is strictly bounded to placement-email discovery, authenticity/relevance screening, opportunity/JD matching, Groq announcement drafting, section/group routing, and guided manual WhatsApp dispatch.
  - Student academic databases, progression tracking, and placement-outcome modules are **intentionally excluded from v1** unless explicitly specified by the owner for a future release.

## 7. Local Screening Metrics Disclaimer
- **Decision Recorded (Section 6.5):**
  - Benchmark precision/recall/F1 metrics reported for the local self-hosted ONNX screening pipeline are measured on a **synthetic and adversarial evaluation fixture set**, not live college mailbox traffic. Real-world distribution drift is mitigated by routing uncertain/low-margin messages to `Needs review` rather than discarding them silently.

