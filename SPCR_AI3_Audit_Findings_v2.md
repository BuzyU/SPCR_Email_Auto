# SPCR AI 3 Prompt Audit — Findings and v2 Changes

**Audit date:** 29 October 2026  
**Scope:** Review of the SPCR AI 3 implementation prompt, credential checklist, and the agreed requirements from the conversation.

## Verdict

The prior prompt was already substantially detailed and suitable for building a mock-mode prototype. It covered the main email pipeline, zero-Groq scanning, human approval, configurable WhatsApp sections, matching separate details/JD emails, attachment safety, costs, retention, tests, credentials and Google restricted-scope risks.

It still left material implementation decisions implicit. The audit-hardened v2 prompt adds those decisions and the required verification/tests. **Use v2, not an earlier copy, for AI 3.**

## Already covered correctly

- Render-first hosted architecture with Render PostgreSQL; Vercel and Supabase are not requested by default.
- Groq is the drafting/formatting provider; the independent screening pipeline must not call Groq.
- Automatic monitoring plus a manual Scan Email action.
- Unknown companies are not automatically trusted or discarded; sender authentication, relevance, and audience eligibility are separate.
- One-email details+JD, two-email details/JD in either order, multiple roles from one company, conflicts and versions.
- PDF/DOCX extraction with explicit manual fallback for unreadable/encrypted/scanned/oversized or unsupported files.
- Approval integrity, named WhatsApp sections, overlapping-section deduplication, manual group registry, guided human sending and honest status labels.
- API keys remain server-side; owner is guided through setup without pasting live secrets into the AI conversation.
- Minimalist white UI, no emojis/decorative AI style, English formal plain text, mobile roadmap only.
- Strong baseline testing, audit trail, retention/deletion gate, and official-documentation verification instructions.

## Material gaps found and closed in v2

### 1. Dashboard authentication was described generally, not specified concretely

A hosted service is internet-facing. “Secure sessions” alone does not define who may access the dashboard, setup options, source emails or group routing. v2 requires a single-owner allowlist and secure sign-in, no open registration, server-side authorization on every protected endpoint, and a clear separation between dashboard identity and Gmail mailbox authorization.

### 2. Extension delivery did not guarantee a user-installable release artifact

The prior prompt required unpacked installation documentation but did not require a versioned ZIP, checksum, exact install/update/removal instructions, or a clear decision about browser-store publication. v2 requires a tested extension archive and installation guide. It explains that a ZIP is not one-click installation in stable Chrome; a Chrome Web Store/Edge Add-ons release requires an owner-approved publishing path and external store review.

Official references:
- Chrome extension testing/Load unpacked: https://support.google.com/chrome/a/answer/2714278
- Chrome Web Store developer account and review: https://developer.chrome.com/docs/webstore/register/ and https://developer.chrome.com/docs/webstore/review-process
- Edge extension hosting and updates: https://learn.microsoft.com/microsoft-edge/extensions/publish/hosting-and-updating

### 3. Attachment storage across separate Render services needed an explicit design

Render's normal filesystem is ephemeral. Its persistent disk can be accessed by only one service instance, so a web service and a separate background worker must not assume they share a local attachment directory. v2 requires a shared private storage decision and verified access across both services. PostgreSQL blob storage may be suitable for a tightly bounded single-user v1; otherwise an additional private object-storage provider needs owner approval and a cost explanation.

Official reference: https://render.com/docs/disks

### 4. Automatic screening versus automatic Groq drafting was not fully explicit

v2 preserves the core rule: both automatic screening and manual Scan Email make zero Groq calls. A separate `Automatically format high-confidence placement candidates with Groq` setting is OFF by default and requires affirmative data-flow consent plus a configured budget cap. If the officer enables it, only high-confidence candidates enter a separate drafting queue. Uncertain/suspicious items are never automatically sent to Groq. If auto-drafting is off, the officer uses the explicit `Format Announcement with Groq` action.

This supports automation without confusing local clarification/classification with external AI formatting.

### 5. The lightweight screening model needed a quality/evaluation requirement

v2 prohibits choosing an arbitrary sentiment model and pretending it is placement-specific. AI 3 must document model/license suitability, test labeled synthetic/adversarial examples, report fixture metrics without calling them real-world accuracy, route uncertain results to review, and never silently discard messages solely based on model output. Feedback controls are included, but private mailbox content must not be used for automatic model training.

### 6. Spend-cap concurrency needed a test

A pre-call cost estimate can be bypassed by simultaneous jobs if both read the same remaining budget. v2 requires concurrency-safe budget reservation/transaction behavior and tests of parallel drafting jobs.

### 7. Product-name scope needed a boundary

SPCR expands to “Student Progression & Company Relation,” while the agreed v1 features are focused on placement-email triage, opportunity/JD handling and WhatsApp announcements. v2 explicitly says not to invent student-record/progression-tracking modules without owner requirements.

## Remaining launch gates (not prompt omissions)

These are genuine owner or external-provider decisions; the coding AI must not silently assume them:

1. **Google Gmail restricted-scope policy:** `gmail.readonly` is restricted. Google states that storing restricted data on servers or transmitting it can require restricted-scope verification/security assessment. The applicable requirement for this exact hosted data flow must be verified before live mailbox processing.
   - Official source: https://developers.google.com/workspace/gmail/api/auth/scopes
2. **OAuth mode/account type:** personal Gmail versus college Google Workspace, external versus internal app, and any verification/security-assessment status.
3. **Groq budget:** still undecided. The app must stay in mock/screen-only mode for Groq until the officer reviews costs, sets a cap and accepts the data-flow disclosure.
4. **Extension distribution:** use the ZIP + Developer Mode for initial testing, or separately approve Chrome Web Store/Edge Add-ons publication for a more familiar one-click install. v2 defaults to delivering a tested ZIP and instructions; it does not falsely claim store publication.
5. **WhatsApp use:** manual officer sending only. The app cannot claim provider-confirmed delivery and must not script WhatsApp Web.
6. **Student progression module:** out of v1 scope unless the owner explicitly describes what tracking is needed.

## Final recommendation

Give AI 3 the v2 prompt and v2 credential checklist. Let it build/test mock mode first. Do not connect live Gmail or run live Groq drafting until the policy, owner-authentication, cost, consent and deployment gates have been resolved.
