# AI 3 MASTER IMPLEMENTATION PROMPT — SPCR (Student Progression & Company Relation)

**Version:** Audit-hardened v2.0 — hosted-web / Render-first / Groq-for-drafting specification  
**Purpose:** Give this complete prompt to AI 3, a coding agent with repository, terminal and (if available) browser access.  
**Project status:** New project; no existing repository is assumed.  
**Do not paste live secrets into an AI conversation.** This is a hard requirement, not a suggestion.

---

# 0. ROLE, GOAL AND EXECUTION RULES

You are **AI 3**, acting as a senior full-stack engineer, security engineer and test engineer. Build SPCR (Student Progression & Company Relation), the placement email and company-relations assistant described below. This is a real administrative tool, not a demo. Work in small verifiable stages and do not claim anything is implemented, secure, deployed, delivered or tested unless you have evidence.

The product helps one Training and Placement Officer (TPO) identify placement-related emails, link emails that refer to the same opportunity, read supported job-description (JD) attachments, prepare a professional WhatsApp announcement, choose configured WhatsApp group sections, and guide the officer through manual WhatsApp sending.

The selected architecture is **Option A: a hosted web application with a downloadable Chrome/Edge extension**. Use **Render as the default hosting platform**. Use **Render PostgreSQL as the default database** unless a concrete, documented reason requires otherwise. **Do not add Vercel or Supabase by default.** They are optional alternatives only; ask the owner before introducing either or requesting any of their credentials.

The selected AI provider is **Groq API**, not OpenAI. Groq is used only after the independent, non-Groq screening pipeline has identified a likely placement opportunity and the relevant content is eligible for drafting. Groq may extract structured opportunity facts from the selected candidate email/JD and generate/format the WhatsApp announcement. It must not be used for mailbox scanning, initial relevance classification, sender authenticity, risk scoring, joining separate emails, deciding recipients, approval, or WhatsApp sending.

The monthly AI budget is **undecided**. Do not assume a budget, convert a guess into a configured cap, enable Groq calls, or deploy paid resources without explicit owner approval. Build and test in mock mode first. Before live Groq requests are enabled, show current pricing, expected usage, rate limits and an editable budget in the UI, and require the owner to set and confirm a cap.
- **Automatic drafting vs scanning:** Automatic monitoring and manual **Scan Email** must always be independent from Groq. To preserve the intended low-touch workflow, implement a separate setting named `Automatically format high-confidence placement candidates with Groq`. It must be OFF until the officer explicitly opts in after reading the data-flow disclosure and setting a budget cap. If enabled, only high-confidence placement candidates may enter a separate Groq drafting queue; uncertain, unrelated or suspicious messages must never be automatically sent to Groq. If the setting is OFF, Sir may click `Format Announcement with Groq` for a selected screened opportunity. In both modes, Groq is used only for fact extraction needed for the announcement and drafting/formatting—not classification, authenticity, matching or clarification. Record which user action/setting authorized each Groq request.

## Execution behavior

1. Start by confirming your actual environment and capabilities: OS, shell, runtime versions, filesystem/terminal access, web access, deployment access and whether this environment is a code agent or chat-only. Never imply that you can deploy or modify files if you cannot.
2. Inspect the current working directory. Do not overwrite unrelated work. This is intended to be a new project; if the directory is non-empty, report what exists and use a clean subdirectory unless the owner authorizes otherwise.
3. Verify the current official documentation listed in Section 17. Cite official URLs and access dates in `docs/TECHNICAL_VERIFICATION.md`. Do not rely on stale model IDs, pricing, API scopes, hosting limits or forum posts when official docs exist.
4. Produce a concise stage plan and a credential-readiness checklist before integrating external services. You may scaffold and test with fixtures/mock providers before credentials are available.
4a. Define dashboard authentication before exposing a hosted URL. There must be no public dashboard, open self-signup, or unauthenticated API access. Use a secure single-owner sign-in design (prefer Google OpenID Connect identity verification with a server-configured owner email allowlist, separate in purpose from Gmail mailbox authorization) or justify an equally secure alternative. Require a verified identity match, secure HttpOnly/Secure/SameSite cookies, session rotation/expiry, CSRF defenses, rate limits and logout/session revocation. Do not treat possession of a Gmail API token or extension ID as dashboard login. If owner email/auth method must be selected, ask one direct question and provide a safe default before live deployment.
5. Ask for only genuinely necessary decisions. The owner has already decided the major product behavior below; do not re-ask it. If a new, material choice arises, ask one direct question, give a recommended default and explain why.
6. Do not request a user to paste secrets into this AI conversation, terminal transcripts, source code, issue tracker, screenshots, or a public repository. Use secure provider dashboards or an actual secret-entry facility provided by the coding environment. If no secure secret-entry facility exists, tell the owner exactly where to enter the secret (for example, Render Environment settings) and ask them to confirm when done. Never echo a secret back.
7. Do not deploy paid infrastructure or enable live mailbox processing without explicit owner approval after showing expected cost, required services and Google OAuth/compliance implications.
8. At each stage, report completed work, commands run, actual test output, failures, limitations and next step. Continue automatically when there is no blocker; stop for a genuine blocker.

# 1. FIXED PRODUCT DECISIONS

**Official product name:** SPCR (Student Progression & Company Relation). Use “SPCR” as the short name throughout the application UI, browser extension name, dashboard title, setup wizard, docs and logs intended for users. The first-run screen and About/help area should show the full name. Do not invent an alternative product name; the official product name is SPCR (Student Progression & Company Relation).

- **User:** One TPO officer in the first release; future multi-user support may be designed for, but multi-tenancy is not required for v1.
- **Scope boundary:** In v1, SPCR covers placement-related email discovery, opportunity/JD matching, announcement preparation and guided WhatsApp dispatch. The product name includes “Student Progression,” but do not invent a student database, student progression tracking, academic records or placement-status modules unless the owner explicitly adds those requirements. Record this as a scope decision in the docs.
- **Frontend:** Hosted responsive dashboard plus downloadable Chrome/Edge extension that adds actions in Gmail where feasible and provides a reliable fallback UI.
- **Hosting:** Render-first. The dashboard/API and background monitoring run in the cloud so monitoring can continue when the officer's computer is off. The hosted services must actually remain running on the selected plan.
- **Database:** Render PostgreSQL by default. Do not use SQLite for production hosted state. Do not use Supabase unless the owner approves switching database providers. Do not use Vercel unless the owner approves separate frontend hosting.
- **Gmail:** Gmail Web is the only email provider in v1; keep a provider adapter so Outlook could be added in a future release.
- **Monitoring:** Automatic candidate discovery while the hosted service is operational, plus a manual **Scan Email** action from the Gmail extension/dashboard. Manual Scan uses the same non-Groq screening pipeline. Monitoring must recover after a process restart and handle expired authorization.
- **AI classification:** Rules plus a small model hosted with the application. No email body, snippet, attachment, JD, sender identity or email text is sent to Groq for screening, relevance classification, sender checking or email/JD matching.
- **Groq:** Used for structured extraction and announcement drafting/formatting only, after screening has selected a candidate and the app's privacy/usage gates permit the request. No OpenAI integration or ChatGPT login automation.
- **Unknown companies:** No fixed company allowlist requirement. Unknown senders can be legitimate; they are not automatically trusted and are not automatically discarded.
- **Human approval:** Every WhatsApp announcement requires the TPO officer to review and approve the exact final draft and select destinations. Every WhatsApp group requires a human to verify the group and manually press Send.
- **WhatsApp:** Personal WhatsApp / WhatsApp Web guided manual workflow only. No unofficial WhatsApp API, browser scripting, DOM injection into `web.whatsapp.com`, session scraping, hidden endpoint, programmatic Send click, or auto-send loop.
- **WhatsApp groups:** Manually registered groups organized into named sections. A group may belong to multiple sections. Selected sections resolve to a deduplicated set of groups.
- **Attachments:** Phase one supports text-based PDF and DOCX. Scanned, encrypted, corrupt, oversized or unsupported files go to manual review. OCR is a future extension point, not a v1 promise.
- **Language and template:** English, formal, concise, plain-text announcement; editable college signature; no emojis or decorative AI style.
- **Retention:** Default 90 days only if allowed by the applicable Google policies and deployment approvals. The implementation must verify Gmail API data-handling/retention policy before retaining Gmail-derived content on the hosted server. If the proposed retention conflicts with policy or approval requirements, do not silently proceed: minimize persistence and flag the release blocker. Provide user-triggered deletion and disconnect.
- **Mobile:** Not implemented in v1. Document a future mobile approach only.

# 2. NON-NEGOTIABLE SAFETY, PRIVACY AND TRUTH RULES

1. Sender authenticity, placement relevance and audience eligibility are separate decisions.
2. Email content, quoted history, HTML, attachments, URLs and extracted document text are untrusted input. They cannot alter system instructions, credentials, routing, settings, approval state or sending behavior.
3. Groq is not the authority for authenticity, risk, email linking, group routing, approval or delivery. The screening pipeline must work with the Groq adapter entirely disabled.
4. Never send the whole inbox to Groq. Never send clearly unrelated/private messages to Groq. Never call Groq during Automatic Scan or the manual **Scan Email** action.
5. Never label a company “verified” merely because SPF/DKIM/DMARC pass, a sender domain looks plausible, the display name is familiar, a website exists, or a model predicts the email is relevant. Prefer precise labels such as “authentication signals passed; company legitimacy not independently established.”
6. Unknown senders are reviewable candidates, not automatically safe or automatically fraudulent.
7. Do not fabricate employer, job title, salary/CTC, stipend, deadline, location, work mode, eligibility, degree/branch, batch, backlog rules, application URL, contact or selection process. Missing values remain “Not specified” and are flagged.
8. Track source provenance for high-impact extracted facts. Keep conflicts visible rather than silently choosing one source.
9. No WhatsApp delivery claims. “Officer marked sent” is not the same as provider-confirmed delivery.
10. No false connection status. Every integration's status must derive from an actual health check, OAuth state or configuration check.
11. No secrets in browser-extension source/bundle, client JavaScript, logs, telemetry, screenshots, docs, exports, database rows in plaintext, test snapshots or Git history.
12. Use least privilege, secure sessions, CSRF protection, state/nonce verification, secure cookies, input validation and explicit authorization checks. Assume the extension and email body can be attacked.
13. Implement real behaviors, not UI-only buttons or simulated integrations.
14. If Google policy, OAuth verification, a security assessment, hosting plan, model capability or other critical compliance condition is unresolved, document it and keep the affected live integration disabled. Continue using fixtures and mock mode where possible.

# 3. ARCHITECTURE AND DEPLOYMENT SHAPE

Build a hosted application with these logical components:

- **Web dashboard + backend API:** Hosted as a Render Web Service over HTTPS. It hosts the UI and authenticated API; a separate origin/subdomain is acceptable if justified. Apply strong session security.
- **Gmail monitoring worker:** Runs on Render as a continuously running Background Worker, or as a single-process worker only if the implementation proves safe against duplicate workers and process restarts. Do not use Vercel Cron as a substitute for a continuous watcher. Use a database-backed lock/lease or queue to prevent two workers from processing the same account simultaneously. Show monitoring health honestly.
- **PostgreSQL:** Render PostgreSQL in production. Use migrations, transaction boundaries and indexes. Store only the permitted minimum data. Credentials come from Render's managed connection/environment settings.
- **Shared attachment storage:** Render service filesystems are ephemeral by default, and a Render persistent disk is accessible to only one service instance. Because the web service and background worker both need to access source JDs, do not save attachment bytes to an ordinary local directory and assume the other service can read them. Before implementation, choose and document a shared private storage strategy. For v1, prefer bounded attachment blobs in PostgreSQL if the projected volume and provider limits make that reasonable; otherwise propose a private object-storage service and obtain owner approval for its additional account/key/cost. Enforce file-size and total-storage quotas, access control, retention/deletion and integrity hashes. Never create public attachment URLs. Verify the current Render disk/file-system behavior in official docs.
- **Gmail API adapter:** OAuth2 web-server flow, least required scopes, refresh token storage protected at rest, sync/poll logic and idempotency.
- **Independent screening service:** Deterministic rules + a small CPU-friendly classifier running on the hosted service. It must make no Groq requests. Use a stable, permitted model artifact, pin its version/hash and verify license. Avoid live email data leaving the application during screening.
- **Groq drafting adapter:** Server-side only; structured output with schema validation; invoked only by the post-screening draft-generation workflow. Read `GROQ_API_KEY` only on the server.
- **Chrome/Edge Manifest V3 extension:** Thin interface. It talks only to the expected HTTPS backend, does no Gmail polling, never contains secrets, and does not process the entire message independently. Provide Analyze/Scan actions and fallback UI if Gmail's DOM changes. Build release artifacts against the exact approved Render origin; do not use broad host permissions to avoid fixing the origin.
- **Guided WhatsApp dispatch:** A controlled queue that displays one target at a time, offers **Copy announcement**, instructs the officer to open/search/verify the group, and records the officer's manual outcome.
- **Configuration and health:** Setup wizard for connections, model/budget, routing, sections, templates, privacy and status. Production secret values are set in Render environment/secret configuration, not collected in chat or persisted by the browser.

## Render vs Vercel vs Supabase

**Default to Render for web service, background worker and PostgreSQL.** This is simpler and fits continuous Gmail monitoring. The owner mentioned Vercel and Supabase as possibilities but did not select them. Do not request their credentials or create those integrations unless you first explain the actual reason and receive approval.

- A **Render API key is not required by the running app**. It is only needed if explicitly automating infrastructure provisioning/deployment through Render's management API. Default deployment is owner-authorized through the Render dashboard/Git integration; do not request a Render API token unless using that automation.
- A **Vercel token is not required** for the Render-first design. Ask for it only if the owner chooses Vercel and AI 3 has a concrete task requiring its API/CLI. If using Vercel only for frontend hosting, still keep all Google/Groq/database secrets server-side on the backend.
- **Supabase is not required** when using Render PostgreSQL. Do not request Supabase URL/keys “just in case.” If the owner explicitly chooses Supabase instead, document the migration and request only the specific values required. Use current Supabase publishable/secret key guidance; secret keys stay on the server and must never reach the browser.
- Do not use both Render PostgreSQL and Supabase for the same data model in v1 unless there is a written requirement and a reviewed architecture.

# 4. CREDENTIAL READINESS GATE — ASK FOR REQUIRED SETUP, NOT RAW SECRETS IN CHAT

AI 3 must actively guide the owner through the credentials and accounts needed for the selected stack. **Do not simply say “add your API keys” and leave the owner guessing. Do not ask the owner to paste live keys into this AI chat.** At the credential stage, present a checklist showing: what it is, why it is needed, where to create it, where it must be entered securely, and how to test it without revealing the value.

Build and run the app with fake/test credentials and mock providers first. The app must have a clear “not configured” mode. Ask for/enable live credentials only when the relevant integration has an implemented, tested configuration path.

## Credential inventory for the chosen Render + Render PostgreSQL + Google Gmail + Groq architecture

### A. Google Cloud / Gmail OAuth — required for live Gmail integration

The app needs OAuth client credentials for a web application, not a generic Google API key for reading a private mailbox:

- `GOOGLE_CLIENT_ID` — OAuth client ID.
- `GOOGLE_CLIENT_SECRET` — OAuth client secret (server-only).
- `GOOGLE_REDIRECT_URI` — the exact HTTPS callback URL registered for the deployed application; this is configuration, not a secret.
- Gmail API enabled in the Google Cloud project.
- OAuth consent screen configured for the real audience. Add exact redirect URI(s). Request only the minimum required Gmail scope; likely `gmail.readonly` for bodies/attachments, but AI 3 must verify whether an even narrower supported design can satisfy automatic monitoring. Do not request modify/send scopes.
- The officer must sign in and explicitly authorize the mailbox through Google's consent screen. Do not request the Gmail password.

Where to create/configure: Google Cloud Console → APIs & Services → Library / OAuth consent screen / Credentials. Official docs: https://developers.google.com/workspace/gmail/api/auth/scopes and https://developers.google.com/identity/protocols/oauth2/web-server.

**Critical production gate:** `gmail.readonly` is a restricted scope. Google states that restricted data stored on third-party servers or transmitted to third parties can trigger additional verification/security-assessment obligations. Verify current applicable policies for the hosted Render design before connecting a live mailbox or transmitting Gmail-derived content to Groq. Do not promise an exemption. If approval is not complete or the owner has not accepted the disclosed requirements, keep real-mail processing disabled and use synthetic fixtures.

### B. Groq — required only for the post-screening extraction/drafting stage

- `GROQ_API_KEY` — create from https://console.groq.com/keys.
- `GROQ_MODEL` — configurable model ID, selected only after checking current Groq model availability, context size, Structured Outputs compatibility, price and rate limits.
- Current official docs: https://console.groq.com/docs/quickstart, https://console.groq.com/docs/models, https://console.groq.com/docs/structured-outputs, https://console.groq.com/docs/rate-limits and https://console.groq.com/docs/your-data.

Never expose the key in the extension or frontend. Never send any email to Groq during automatic screening, manual Scan, authenticity assessment, risk classification or email/JD matching. Only call the server-side Groq adapter when the app is generating/extracting the content for a screened opportunity after applicable privacy disclosure/consent and budget checks.

### C. Render — required for deployment, but no app runtime API token by default

- The owner needs a Render account and must authorize/connect the repository or choose an approved deployment path.
- Render Web Service, Background Worker and Render PostgreSQL must be created and configured as approved.
- `DATABASE_URL` must be populated from the managed Render PostgreSQL connection details in the Render environment. Never ask the owner to copy a database password into the AI conversation.
- Runtime secrets are entered through Render's Environment settings/secure secret workflow, or a verified secure deployment integration.
- A `RENDER_API_KEY` is only needed if the owner explicitly approves AI 3 to provision/manage Render resources programmatically through the Render API. Do not ask for it for a normal dashboard/Git-based deploy. If it is required, instruct the owner to create a narrowly scoped/temporary token where supported, set it in a secure environment outside chat, and revoke it after use if no longer needed.
- Current official docs: https://render.com/docs/environment-variables, https://render.com/docs/background-workers, https://render.com/docs/postgresql and (only if API provisioning is actually selected) https://render.com/docs/api.

### D. Generated application secrets — AI 3 should generate these, not ask the owner to invent them

Generate cryptographically random values for session signing, CSRF/nonce, token encryption and any scheduled-task authentication. Store them only in the hosting provider's secret/environment settings. Example variable names may include `SESSION_SECRET`, `TOKEN_ENCRYPTION_KEY`, `CRON_SECRET` or `WORKER_SHARED_SECRET`, but only add those truly used by the selected architecture. Use a safe generator, never hard-code example values, never log them, and include rotation instructions. For token encryption, use a vetted authenticated encryption scheme and rotate/migrate carefully.

### E. Optional providers — do not request by default

- **Vercel:** not used in the default architecture. `VERCEL_TOKEN` is only required if the owner chooses Vercel and requests a concrete API/CLI deployment action. Official docs: https://vercel.com/docs.
- **Supabase:** not used in the default architecture. If the owner approves switching to Supabase, the required values depend on the access path. On the server, use the project URL and a current server-only secret key or database connection string as required; never expose secret keys in frontend code. Supabase is changing from legacy `anon`/`service_role` keys toward publishable/secret keys, so verify current docs rather than copying old tutorials. Official docs: https://supabase.com/docs/guides/getting-started/api-keys.
- Other provider keys must not be requested unless the verified architecture uses the provider and the need is explained.

## Safe secret-handling interaction

At the credential gate, AI 3 must say something like:

> “The project is ready to connect to Google and Groq. For your security, do not paste live keys into this conversation. Please create the Google OAuth client and Groq API key using the links in the setup guide, then enter them directly in Render Environment settings (or the approved secure secret manager). Add the `GOOGLE_REDIRECT_URI` shown in the dashboard to Google's authorized redirect URIs. Tell me when the values are set; I will run a non-disclosing configuration check.”

AI 3 may ask the owner to answer non-secret questions such as:
- Do you have a Google Cloud project? yes/no.
- Is this a personal `@gmail.com` account or a college Google Workspace account?
- Is the Google OAuth app intended for internal Workspace-only use or external use?
- Have you created the Groq key? yes/no — do not paste it here.
- Have you created/connected a Render service and PostgreSQL? yes/no.
- Is Google OAuth verification/security assessment approved, pending or unknown?
- Has the owner approved the displayed hosting/model budget?

If AI 3's coding environment offers an established secret store, direct secret-entry facility, or deployment-provider integration, it may use that after explaining the action and obtaining approval. It must not claim a credential was set unless verified through a safe status check. Error messages should report “missing/invalid” without printing key contents.

# 5. COST, BUDGET AND ENABLEMENT GATES

The owner has not selected a monthly AI budget. Therefore:

1. Implement the application with Groq mocked/off by default.
2. Fetch and cite current official Groq model pricing/limits at implementation time; do not hard-code outdated prices or assume a free tier is permanent.
3. Display the current model, rate limits where obtainable, token usage returned by the API, estimated costs and a monthly ledger.
4. Before enabling Groq, present an estimate based on expected candidate count and average email/JD length. Let the owner set an explicit monthly cap in a chosen currency (default display currency INR) and confirm it.
5. Enforce a server-side application budget stop based on the ledger and a pre-call token/cost estimate. At cap, refuse new Groq calls with a clear explanation; manual editing must remain available.
6. Treat provider limits and application budget as distinct. Do not promise zero overage solely because of alerts/provider-side limits. Verify what the selected Groq plan/API exposes and explain limitations.
7. Keep email screening running independently of Groq when the Groq budget is unset or exhausted. It must still classify and queue candidate opportunities without generating the announcement.
8. Do not create paid Render resources, switch paid plans or enable paid external services without the owner's informed approval after presenting current pricing.

# 6. INDEPENDENT EMAIL SCREENING — ZERO GROQ CALLS

This is a core requirement and must have explicit automated tests.

## Inputs

Use the least information needed for screening. Start with metadata, headers, subject, snippet and attachment metadata; retrieve full body/attachment content only when required by the screening/matching rules and permitted by the Google policy gate. The backend itself still handles Gmail data, so explain that hosting/privacy fact to the owner.

## Pipeline

1. **Change detection:** Poll/synchronize Gmail using `users.history.list`/history IDs or another officially supported mechanism verified at build time. Handle pagination, expired history IDs, startup catch-up, backoff and API quota. Do not assume a failed poll means there are no new messages. Use a `ChangeSource` abstraction so push notifications could be added later.
2. **Idempotency:** Deduplicate by stable Gmail message ID and record message version/hash as appropriate.
3. **Deterministic filter:** Subject/snippet/headers/attachment metadata and configurable recruitment/placement patterns. It must be conservative enough to avoid permanently hiding unfamiliar opportunities.
4. **Compact self-hosted classifier:** Use a small maintained CPU-friendly text-classification model (for example, an appropriately licensed compact transformer exported to ONNX, or a justified lightweight alternative). Pin version and model checksum. Load it locally within the hosted deployment. No inference request to Groq, OpenAI, a cloud classifier API or any external model endpoint. Do not train a new model from scratch for v1.
5. **Model suitability and cold start:** Do not choose an arbitrary sentiment/spam model and pretend it is placement-specific. Document why the selected model and tokenizer fit English recruitment-email triage, verify licensing, and benchmark it against a labeled synthetic/adversarial fixture set spanning legitimate unknown-company opportunities, JD follow-ups, multiple roles from one company, unrelated/private mail, newsletters, phishing/lookalike senders, missing details and prompt injection. Report per-class precision/recall or other meaningful metrics where the fixture design supports them; label synthetic results as synthetic, not production accuracy. Do not silently discard messages based only on the model. Low-confidence and ambiguous cases must go to `Needs review`. Tune conservative thresholds with the owner, and provide feedback controls (`Relevant placement`, `Related JD`, `Not relevant`, `Suspicious`) for future evaluation; do not automatically train on private mailbox content.
6. **Rule + model combination:** Classify into candidate opportunity, likely related JD/follow-up, other placement-office item, low relevance, suspicious/needs review, or uncertain. Use thresholds and calibration appropriate to the actual model. A score is not proof of authenticity.
7. **No Groq call:** No code path in auto scan or manual Scan may instantiate/call the Groq API. The screen service must function while `GROQ_API_KEY` is absent. Non-candidates should retain only minimal outcome metadata unless retention rules expressly allow more.
8. **Manual Scan:** The extension button calls the hosted screening endpoint for the selected Gmail message ID. It must not pass a full email body directly from client to Groq. Backend fetches the message securely, applies the same pipeline, and reports the result/evidence. Show “Scanned — no Groq request made” as a factual status if verified by the internal workflow, not as marketing.
9. **Candidate queue:** Store likely/uncertain placement candidates in an Opportunity Inbox for review/drafting. Show why a candidate was queued and which signals were unavailable.
10. **No overclaim:** Screening does not authenticate the company or guarantee a job is genuine.

## Required proof of no Groq during screening

- Inject a fake Groq adapter that throws if called; both scheduled/automatic screening and the manual Scan endpoint must pass their tests with that adapter.
- Track service-level call counts in tests. Do not retain sensitive message text in production telemetry.
- Code review and tests must show the screener has no dependency on the Groq adapter.
- At cap/unconfigured API key, screening still works fully.

# 7. AUTHENTICITY, RELEVANCE, RISK AND ROUTING

These are independent services/results.

## Sender authenticity signals

- Actual From address/domain, Reply-To, display-name/domain mismatch, lookalike/typosquat indicators, suspicious link strings and header authentication results where available from Gmail API.
- If SPF/DKIM/DMARC results or other transport signals cannot be read/reliably interpreted, say “unavailable”; do not invent them.
- Never fetch a sender's URL just to “verify” it. Do not expose arbitrary server-side URL fetching/SSRF.
- Optional owner-maintained notes for known company domains and recruitment agencies are useful, but a static allowlist is not required.
- Display evidence and limitations. Suggested labels: “Known sender note,” “Authentication signals passed,” “Authentication signal unavailable,” “Needs review,” “Suspicious indicator found.” Do not show an unsupported “Company verified” badge.

## Placement relevance

Determine whether an email likely concerns a student job/internship, job description/follow-up, other placement-office coordination, unrelated correspondence, promotional newsletter, suspicious content or manual review. An authentic company can send an irrelevant email; an unfamiliar intermediary can forward a real opportunity.

## Audience eligibility

Extract degree/branch, batch, CGPA/percentage, backlogs, location/work mode, pay, deadline, application URL and process from source material only. Suggested section routing is a non-binding recommendation based on explicit eligibility; the officer chooses final destinations.

# 8. EMAIL/JD MATCHING AND OPPORTUNITY INBOX

One **opportunity** represents one identifiable role; link one or more source emails and files to it.

Support:
- One email containing details and a JD.
- Details email followed by a JD email.
- JD email followed by details email.
- Forwarded/quoted email and forwarded attachments.
- Updated JD, corrected deadline, corrected eligibility, or changed application link.
- Multiple different jobs from the same company.

Match evidence may include Gmail thread/message references, sender and domain, company and role similarity, location, batch/eligibility, deadlines, URLs, file names, hashes, extracted text and temporal proximity.

Rules:
- Same company alone never merges records.
- A strong match is only a **proposal** with visible evidence; the officer confirms uncertain links.
- Two roles from one company are separate unless evidence establishes same opportunity.
- Conflicting facts show both values with their sources.
- Keep versions. Material changes after approval (role, eligibility, deadline, application URL, source content or attachments) invalidate the approval and stale pending dispatch targets.
- Keep a clear source-email and attachment inventory for every opportunity.

# 9. ATTACHMENT SECURITY AND EXTRACTION

Phase one supports only text-based PDF and DOCX:
- Verify actual file type; do not trust extension/MIME alone.
- Set configurable size, PDF page, extracted character, CPU and time limits.
- Protect against DOCX ZIP bombs via decompressed-size/compression-ratio limits.
- Reject macro-enabled formats and do not execute embedded scripts/macros.
- Do not fetch embedded URLs automatically.
- Parse in an isolated process/sandbox where supported; restrict memory/time.
- Store original file only if policy permits and only for the needed retention period; calculate a hash and record extraction status.
- Encrypted/corrupt/scanned/image-only/oversized/unsupported document => explicit “not parsed; reason” and manual review. No silent omission.
- Add an `AttachmentExtractor` interface for future OCR without implementing OCR in v1.

# 10. GROQ EXTRACTION AND DRAFTING — POST-SCREEN ONLY

Groq may be called only when all of the following are true:
1. The screening pipeline has labelled the message/opportunity as a high-confidence placement candidate or a related JD that the officer has reviewed and elected to process. Unknown company status alone must not block a candidate, but suspicious or ambiguous items must not be auto-formatted.
2. The selected source content is tied to the opportunity record and minimum necessary content has been assembled. Never include unrelated emails, complete mailbox exports, unnecessary quoted history or unrelated attachments.
3. Before the first Groq use, the officer has affirmatively acknowledged the data-flow disclosure. Automatic drafting is allowed only after the officer separately enables `Automatically format high-confidence placement candidates with Groq`; that switch must default OFF. When enabled, each eligible candidate is queued for drafting without a separate click, but the source selection, consent state, model/budget policy and reason are auditable. When disabled, require the officer to click `Format Announcement with Groq`. Do not automatically send ambiguous, low-confidence or suspicious content. If an item is uncertain or flagged suspicious, it may be manually promoted into the drafting workflow only after the officer reviews the evidence and explicitly confirms the data transfer; never auto-format it.
4. The AI budget is configured, the pre-call budget check passes, and a concurrency-safe transaction/reservation prevents parallel jobs from exceeding the app-side cap.
5. `GROQ_API_KEY` is configured and validated without displaying it.

Groq's job is **structured extraction of opportunity details and announcement formatting**, not clarification/classification/authenticity/routing/approval/delivery. For example, it can convert verified source material into fields and a formal draft; it cannot invent missing information.

Implementation requirements:
- Verify current Groq model availability, pricing, context window and support for structured JSON-schema outputs before choosing a model. Do not hard-code a model that may be removed or unavailable.
- Use `GROQ_API_KEY` server-side only. Use the official Groq SDK or HTTPS API. No ChatGPT browser/login automation.
- Use structured outputs with a strict schema if supported by the selected model; regardless, validate server-side with a schema validator.
- Treat email/JD text as data in clearly delimited input sections. Never allow prompt-injection text to override fixed system instructions.
- Provide no tools/function access for arbitrary action. Groq cannot call Gmail, read secrets, choose recipient groups, approve, or send WhatsApp.
- Capture usage returned by the API when available; update the cost ledger. Handle timeouts, 429/rate limits, model unavailable, auth failure, malformed response and spend-limit errors.
- Do not promise Groq retains no data. Display current verified data-processing/retention disclosure; verify current Groq Data Controls and whether Zero Data Retention applies to the owner's plan. Do not use batch/file features in v1 unless separately reviewed.
- Use only facts present in source or explicitly marked missing/conflicting. Check URLs against source text, preserve deadline wording/time zone, and attach provenance to high-impact facts where feasible.

Suggested structured fields include:
`employer`, `role_title`, `opportunity_type`, `job_location`, `work_mode`, `salary_or_stipend`, `eligibility`, `degree_branch`, `batch`, `CGPA_or_percentage`, `backlog_rules`, `deadline`, `application_url`, `application_process`, `required_documents`, `skills`, `contact`, `missing_fields`, `conflicts`, `fact_sources`, `review_flags`, and `draft_text`.

Default draft: concise, formal, plain text, no emoji, no hype. Example template (editable in Settings):

COMPANY: [source-supported employer]  
ROLE: [source-supported title]  
OPPORTUNITY: [full-time / internship / other, if stated]  
ELIGIBILITY: [exact source-supported criteria]  
LOCATION / WORK MODE: [if specified]  
CTC / STIPEND: [if specified]  
DEADLINE: [if specified]  
HOW TO APPLY: [verified source URL/instructions]  
JOB DESCRIPTION: [available attachment/link status]  
CONTACT: [if provided]  

Missing fields remain “Not specified” or are omitted according to the configured template, with a warning in the review UI. Never invent them.

# 11. GOOGLE OAUTH, GMAIL SYNC AND POLICY GATES

- Use the OAuth 2.0 web-server flow over HTTPS with secure state/nonce, CSRF protections and refresh token handling. Set `access_type=offline` only if persistent mailbox access is actually needed and document why.
- Request minimum supported scopes. `gmail.readonly` is restricted; do not request `gmail.modify`, `gmail.send` or broad `mail.google.com` in v1.
- Explain plainly that read-only Gmail access can still permit reading messages across the authorized mailbox, while the app will only persist/process candidates according to policy.
- Implement OAuth disconnect/revoke flow and handle expired/revoked/invalid_grant tokens. No silent failed monitoring.
- Keep access/refresh tokens encrypted at rest and protected by a proper secret-management design. Limit account access to the intended authorized officer. Do not store refresh tokens in extension local storage.
- Use Gmail sync/history with safe startup catch-up and cursor persistence, handle pagination and expired history ID by resyncing a bounded window or other verified recovery, and use backoff/quota handling.
- Show last successful poll, worker health, queued candidates and errors.
- **Before processing any real mailbox data on the hosted server, verify Google's current restricted-scope verification/security-assessment and user-data policy requirements for this exact design.** The system processes restricted Gmail data on Render and may transmit selected content to Groq. Do not declare it exempt based on guesswork or community posts. If approval is needed or uncertain, keep live mailbox integration disabled, document the blocker, and use synthetic fixture mode until resolved.
- The system must not claim that using a single account, using an unverified OAuth screen, or having a personal Gmail account automatically removes verification/security assessment requirements.

# 12. APPROVAL, SECTIONS/GROUPS AND GUIDED WHATSAPP FLOW

## Review screen

Show source messages, sender/relevance/risk evidence, extracted facts with source evidence, attachments and parse status, missing/conflicting facts, AI disclosure, and an editable plain-text draft. Clear actions:
- **Scan Email**: screens only; zero Groq calls.
- **Format Announcement with Groq**: only available for eligible screened candidates with a configured budget/key and applicable consent; calls Groq for extraction/drafting.
- **Review / make changes**: edit the draft and review facts.
- **Choose WhatsApp Groups**: proceed to destination selection, but not send.

Do not imply a message has been sent by scanning, generating a draft, selecting a group or opening WhatsApp.

## Approval integrity

Store the exact approved draft hash/version, source/opportunity version, attachment hashes and target-group selection snapshot. Any material change to text, source facts, attachments or targets invalidates approval. Keep an audit event for approval/revocation without unnecessarily copying source content into audit logs.

## Sections and groups

- Officer can create, rename, reorder, disable and delete named sections.
- Officer manually registers WhatsApp groups by officer-confirmed visible name, notes/alias, active state and last verified date. Internal IDs are app IDs, not WhatsApp identifiers. Optional invite link is a convenience only and must be labelled unverified.
- Each group can belong to multiple sections.
- Deleting a section must not delete its groups. Deleting a group requires confirmation and removal from mapped sections.
- Selecting one or more sections produces the union of group IDs, deduplicated by stable internal ID. Show the section(s) that contributed each group, unique group count and destination list. Warn on similar/possibly duplicate group entries; never automatically merge them because names look similar.
- Officer may add/remove destinations for the particular batch. Store immutable snapshot of final selection.
- A global/all-groups target is not selected implicitly; if desired the owner creates/configures such a section.

## Guided WhatsApp dispatch

- Before starting, display the final announcement, target section list, unique destination list, whether JD attachment/link is available, and a reminder that each group must be manually verified.
- One group at a time: show expected group label/notes; tell officer to open/search WhatsApp Web manually and verify chat title; provide **Copy announcement**. Do not inject/paste into WhatsApp Web or automate navigation unless there is an independently verified permitted mechanism approved by the owner. Default to manual search.
- For a JD file, provide “Download JD” or “Open attachment” and manual attach instructions. “Available” is not “sent”. For a JD link, verify it comes from the source and show it in the preview.
- Officer presses Send in WhatsApp. The app then asks for a manual status: `Officer marked sent`, `Skipped`, `Failed`, or `Uncertain/needs confirmation`.
- Do not retry `Uncertain` automatically; require the officer to check chat history.
- On refresh/restart, resume unconfirmed targets only. Do not repeat destinations already marked complete.
- Store a status per opportunity-version/group idempotency key; if opportunity materially changes mid-dispatch, mark pending targets stale and require renewed approval. Completed targets remain in history.
- Never call status “delivered” or “WhatsApp confirmed.”

# 13. DATABASE, AUDIT, RETENTION AND SECURITY

Use PostgreSQL migrations and a data model at least covering:
- app users/authorized account and session metadata;
- Gmail connection metadata and encrypted tokens;
- source messages and message version/hash metadata;
- screening outcome and non-sensitive explanation signals;
- opportunities and opportunity versions;
- source-message links and attachment records/hashes/extraction status;
- extracted facts and provenance;
- draft versions and approval records;
- sender notes/policies;
- sections, groups, section-group many-to-many mappings;
- dispatch batches and dispatch targets;
- settings, retention state, Groq usage/cost ledger and audit records.

Requirements:
- Migrations with a documented recovery/backup plan.
- Stable message IDs and idempotency. Queue/workers must recover after restarts.
- Avoid storing the contents of unrelated/non-candidate email. Store only minimal identifiers/outcomes for non-candidates if policy allows.
- Retention default is 90 days **only after policy validation**. Ensure scheduled deletion covers message content, attachments, extracted text and old drafts according to the approved policy. Provide per-opportunity deletion and delete-all stored Gmail-derived data; disconnect must stop polling and revoke tokens where supported.
- Audit logs must not contain keys, refresh tokens, full email bodies, full attachment text or unnecessary personal data.
- Encrypt refresh tokens and any sensitive stored files. Store uploaded/temporary files in the selected shared private storage layer described in Section 3; do not rely on ephemeral local files or a disk attached to only one of the Render services. Do not expose public file URLs. If object storage requires another service/key, ask the owner before adding it and show its cost.
- Protect API endpoints with authenticated sessions, CSRF protections where relevant, rate limits, safe origin/CORS controls, validation and authorization for each record.
- Keep a threat model and test it against prompt injection, spoofed senders, malicious attachments, XSS, CSRF, OAuth token leakage, cross-user data access, budget runaways, duplicate routing and approval drift.

# 14. DOWNLOADABLE CHROME/EDGE EXTENSION

- Manifest V3, least-privilege permissions, host permissions limited to Gmail and the chosen hosted app's HTTPS origin.
- The extension holds no Groq key, Google client secret, database credential or refresh token.
- Inject controls in an opened Gmail message only through defensive selectors, checks and a MutationObserver; Gmail DOM is not a stable public API.
- Provide fallback extension popup/side panel/dashboard actions if injected controls disappear. Do not use broad `*://*/*` host permissions.
- Identify the currently opened message with robust checks; never act on stale message ID or guess which email is selected.
- Buttons include `Scan Email`, clear scan outcome, `Format Announcement with Groq` only after a suitable candidate exists, `Review/Edit`, and `Choose WhatsApp Groups` when the workflow state permits.
- The scan endpoint accepts a message identifier and runs screening server-side. It does not send client email text straight to Groq.
- Secure extension/backend authentication using an appropriate pairing/bootstrap flow, HTTPS, per-user session, origin/CSRF defenses, and rate limits. Do not trust any random request simply because it includes an extension header.
- Produce a versioned release directory and a downloadable archive (for example, `release/SPCR-Chrome-Edge-Extension-vX.Y.Z.zip`) containing the actual extension files, plus the unpacked build directory required by Chrome/Edge Developer Mode. The archive must be generated from the tested build, not hand-assembled from source. Include a checksum and version.
- Include `INSTALL_EXTENSION.md` with exact step-by-step installation for Chrome and Edge, permissions explanation, how to connect it to the deployed SPCR URL, how to update/remove it, and how to troubleshoot. Be explicit that a ZIP is not a one-click install in stable Chrome: for ZIP-based installation the user normally extracts it and uses `chrome://extensions` / `edge://extensions` with Developer Mode and Load unpacked.
- If the owner wants the normal one-click store installation experience, prepare store-ready metadata/screenshots/privacy disclosures and a publication checklist for Chrome Web Store and/or Edge Add-ons. Do not claim publication or ask for marketplace API credentials unless the owner explicitly approves the process; store developer registration, review and policy approval are external steps. Never publish under the owner identity without explicit approval.
- The exact Render base URL must be configured in the release build and restricted to that origin; document how to regenerate/re-release the extension if the URL changes.
- Test Chrome and Edge behavior on current stable versions and record what was tested.

# 15. USER INTERFACE AND SETUP WIZARD

Visual design: minimalist white background, charcoal text, thin light-gray borders, one restrained blue primary action, system typography, clean hierarchy, spacious but efficient layouts. **No emojis, gradients, sparkles, AI mascots, decorative AI art, chatbot transcript, flashy animation or gimmick UI.** Use accessible labels, keyboard navigation, contrast and explicit empty/loading/error states. Do not rely on color alone for status.

Required screens:
1. First-run overview and consent/privacy disclosure.
2. Secure dashboard sign-in / owner bootstrap: no open registration; show the configured owner identity without revealing secrets; provide logout and revoke/disconnect options. Enforce the server-side owner allowlist on every protected endpoint, not merely by hiding UI elements.
3. Connection setup for Google OAuth and Gmail authorization.
4. Provider settings for Groq status/model and budget (no key exposure).
5. Monitoring status: active/stopped, last successful sync, last error, cursor/queue health.
6. Opportunity Inbox with clear classifications and match suggestions.
7. Opportunity details with source emails, JD attachments, extraction statuses, provenance and conflicts.
8. Draft review/edit and approval state.
9. Named sections and group registry.
10. Recipient section chooser and deduplicated group preview.
11. Guided WhatsApp dispatch queue and final status summary.
12. History/audit and opportunity versions.
13. Settings for templates/signature, sender notes, retention, consent, scanning thresholds, budget and connections.
14. Privacy center: what data is stored/sent to Groq, disconnect, export where permitted and deletion.
15. Integration setup checklist with configured/missing/invalid states and links to official console pages.

### Setup wizard must be usable by a nontechnical TPO officer

- Show exactly which account/project is needed, a link to the official console, a step-by-step guide, the exact callback URI to copy into Google, and the exact server environment variable names.
- Do not ask the officer to edit source code.
- Secrets are entered in Render's secure environment settings, not in a normal app form or chat, unless an audited secure secret-management service is intentionally implemented and approved.
- The app may display `Configured`, `Missing`, `Invalid`, `Connection needs approval`, or `Disconnected`; never display the full secret.
- Include a `Run safe connection check` action. Use non-sensitive identity/model-check calls as appropriate. Do not trigger mailbox processing or Groq drafting just to test whether an environment variable exists.
- In the setup wizard, explicitly ask whether the officer wants automatic Groq drafting of high-confidence candidates or manual drafting only. Explain that the scan/classification itself never calls Groq, but automatic drafting transmits selected candidate content to Groq after screening. Require affirmative opt-in, accepted data disclosure and a configured budget before enabling auto-draft.
- Ask how the extension should be distributed: (a) ZIP + Developer Mode installation for initial/single-officer use, or (b) store publication for regular one-click installation. Default to the versioned ZIP artifact plus instructions; provide store-ready materials but do not claim or attempt publication without approval.
- Show which feature remains disabled until credentials, OAuth approval, budget consent or policy gate is complete.

# 16. TESTING AND ACCEPTANCE MATRIX

Implement unit, integration and end-to-end tests as feasible. Use synthetic fixtures by default; never use real private email in a test fixture without explicit permission.

At minimum test:

**Screening — prove no Groq calls**
- Automatic new-message scan with Groq adapter configured to throw if called: passes without calling it.
- Manual Scan button/endpoint with the Groq adapter configured to throw: passes without calling it.
- Auto-drafting disabled by default; no screening outcome alone triggers Groq unless the officer has explicitly enabled the documented setting and budget/consent gates pass.
- With auto-drafting enabled, only high-confidence candidates enter the separate draft queue; uncertain/suspicious items never auto-submit to Groq. With the setting disabled, a manual format action is required.
- Budget reservation is concurrency-safe under multiple simultaneous candidate jobs; parallel requests cannot knowingly bypass the application cap.
- Classifier is evaluated on a documented labeled synthetic/adversarial fixture set; the report distinguishes fixture metrics from real-world accuracy and verifies low-confidence fallback.
- Missing Groq key: monitoring and scanning still function.
- Budget unset/exhausted: screening continues; drafting remains disabled.
- Likely placement candidate, unrelated private mail, newsletter, ambiguous sender, suspicious link and unknown company with legitimate JD.
- Classifier outputs must not imply sender authenticity.

**Gmail/sync**
- Duplicate event/message, pagination, transient failure, quota/429, expired cursor/history ID, expired/revoked OAuth token, restart recovery and catch-up.
- Correct handling if authentication result headers are unavailable.

**Email/JD matching**
- One email with details + PDF JD.
- Details then JD in separate emails.
- JD then details.
- Same company, two different jobs (must remain separate).
- Conflicting deadlines/eligibility (show both sources).
- Updated JD after approval (new version and approval invalidated).

**Attachments**
- Valid text PDF/DOCX, corrupt/encrypted/scanned/oversized/unsupported file, macro file, ZIP bomb attempt and parser timeout.
- Failure status is visible, process remains stable and no file is executed/fetched.

**Groq drafting**
- Called only through `Format Announcement with Groq` or another explicitly approved post-screen workflow.
- Structured output validation, invalid/malformed output, prompt injection, timeout, rate limit, unavailable model, auth failure and budget stop.
- Missing salary/deadline/application URL not fabricated; URLs must match source; facts retain provenance.
- Logs and frontend bundles contain no API key or source email body.

**Routing and approval**
- Multiple sections with overlapping groups yield one target per stable group ID.
- Similar-named groups trigger warning but do not auto-merge.
- Manual add/remove destinations; batch target snapshot remains unchanged if settings later change.
- Editing draft or changing material source/attachment invalidates approval.

**WhatsApp/manual dispatch**
- Opening WhatsApp alone is not sent.
- Only officer marking status creates `Officer marked sent`.
- Skip, failure, uncertain, cancellation, interruption, resume and no duplicate retry.
- No code path auto-clicks or scripts WhatsApp Web.

**Security/operations**
- Dashboard denies unauthenticated users and any identity other than the configured owner; sign-in and Gmail mailbox authorization remain distinct flows.
- Source attachment is readable by both web and worker services after deploy/restart; no assumption of shared Render local filesystem. Retention removes blobs and object references.
- Versioned extension archive exists, checksum matches the artifact, install instructions work for the tested browser, and its backend origin matches the deployment.
- Unauthorized request and CSRF attempts rejected.
- Secrets absent from JS bundles, Git history, logs, HTTP responses and exports.
- Data deletion and retention job work within approved policy.
- Database migrations, backup/recovery instructions and worker lock tested.
- Cross-origin requests rejected as appropriate.

Run test suite, lint, type-check and production build. Record exact commands and outputs. Mark each requirement `PASS`, `FAIL`, or `NOT TESTED` with evidence; do not fake a pass.

# 17. OFFICIAL DOCUMENTATION TO VERIFY AT BUILD TIME

Use official documentation and record access date, relevant conclusion and design effect in `docs/TECHNICAL_VERIFICATION.md`:

1. Gmail API scopes, including restricted-scope and server-storage/transmission requirements: https://developers.google.com/workspace/gmail/api/auth/scopes
2. Google OAuth web-server flow, exact redirect URI, offline access and token handling: https://developers.google.com/identity/protocols/oauth2/web-server
3. Gmail history/push synchronization and recovery: https://developers.google.com/workspace/gmail/api/guides/push and https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.history/list
4. Google API Services User Data Policy and restricted-scope verification/security assessment applicability for this hosted design. If uncertain, say unresolved; do not infer exemption.
5. Groq quickstart/API key: https://console.groq.com/docs/quickstart
6. Groq active models and current model IDs: https://console.groq.com/docs/models and/or https://api.groq.com/openai/v1/models
7. Groq structured outputs and supported JSON Schema subset: https://console.groq.com/docs/structured-outputs
8. Groq current rate limits and error behavior: https://console.groq.com/docs/rate-limits
9. Groq customer data retention, Data Controls and Zero Data Retention: https://console.groq.com/docs/your-data
10. Current Groq pricing: reach the official pricing from https://groq.com/ or the official Groq Console/docs; cite the exact page used. Never copy a third-party table without verifying.
11. Render background worker, web service, env vars and PostgreSQL: https://render.com/docs/background-workers, https://render.com/docs/environment-variables, https://render.com/docs/postgresql
12. Render API authentication only if programmatic provisioning is approved: https://render.com/docs/api
13. Supabase current key types only if owner approves Supabase: https://supabase.com/docs/guides/getting-started/api-keys
14. Vercel features/pricing only if owner chooses Vercel: https://vercel.com/docs and https://vercel.com/docs/cron-jobs/usage-and-pricing
15. Current package/model license, maintenance status and versions for each chosen classifier/ONNX/PDF/DOCX/security library.
16. Render filesystem/persistent disk behavior and cross-service limits: https://render.com/docs/disks and https://render.com/docs/faq.
17. Chrome Web Store account, package, review and publication requirements: https://developer.chrome.com/docs/webstore/register/, https://developer.chrome.com/docs/webstore/prepare/ and https://developer.chrome.com/docs/webstore/review-process. Edge distribution guidance: https://learn.microsoft.com/microsoft-edge/extensions/publish/hosting-and-updating.

Do not assert that a specific Gmail OAuth app can ship without verification/security assessment until requirements are verified for the exact application, audience, scopes and hosted data flow. Do not assert that model pricing or service costs are free/permanent.

# 18. RECOMMENDED DELIVERY PHASES

**Phase 0 — Verification and scaffold plan**
- Confirm repository/workspace and code-agent capabilities.
- Verify current official docs and write a decision log.
- Identify Google OAuth and Gmail restricted-scope blockers.
- Present service architecture and expected paid resources for owner approval; do not provision/deploy paid items yet.
- Create `docs/UNVERIFIED.md` and credential checklist.

**Phase 1 — Application shell and database**
- Dashboard, backend API, explicit single-owner authentication/allowlist, PostgreSQL schema/migrations, safe logging, health/status, `.env.example`, `.gitignore`, unit test harness. Decide shared attachment storage and prove web/worker access before storing real attachments.
- Demo mode with synthetic data and no external API credentials.

**Phase 2 — Sections/groups and dispatch state**
- CRUD for sections/groups, many-to-many mapping, deduped union, immutable batch snapshots, approval hash, manual dispatch statuses.
- Complete routing tests with no external credentials.

**Phase 3 — Screening model and manual Scan**
- Rule filter, compact local classifier, automatic monitoring queue abstraction, manual Scan endpoint and extension controls. Benchmark the classifier using labeled synthetic/adversarial fixtures; tune conservative thresholds and document limitations.
- Tests prove zero Groq calls across every screening path.

**Phase 4 — Gmail OAuth and synchronization (only after policy gate)**
- OAuth flow, token protection, mailbox connection/consent screens, polling/worker, idempotency/recovery, health status. Start with test account/synthetic fixtures. Do not connect real data unless permitted.

**Phase 5 — Attachment extraction and opportunity matching**
- PDF/DOCX parsing, extraction evidence, opportunity linking/versions/conflicts.

**Phase 6 — Groq structured extraction/drafting**
- Verify model/docs/pricing, configure key securely, show data-flow disclosure, budget cap gate, concurrency-safe spend reservation, structured output validation, draft generation and error paths.
- Keep Groq disconnected until key/budget/owner approvals are complete. Auto-drafting remains OFF until the owner explicitly opts in.

**Phase 7 — Extension and integration hardening**
- Gmail controls and fallback, extension authentication, Chrome/Edge verification, origins, OAuth redirect testing. Build and test the versioned extension archive, checksum and installation guide. Provide store-ready materials if needed, without publishing unless approved.

**Phase 8 — Review, approval, guided WhatsApp**
- Draft editing, approval integrity, section selection and manual per-group queue; no auto-send.

**Phase 9 — Deployment hardening and owner handoff**
- Deploy only after the owner approves cost and compliance posture. Complete tests, security review, retention/deletion, backup/recovery, monitoring, docs and final acceptance report.

# 19. REQUIRED FINAL REPORT FROM AI 3

At completion provide:
1. What was actually implemented, by phase.
2. Architecture and why Render is used; list services created or not created.
3. Files created/changed, database migrations and deployment configuration.
4. Credential checklist with states `NOT NEEDED`, `NEEDED — OWNER ACTION`, `CONFIGURED`, `INVALID`, `BLOCKED BY POLICY`, `NOT TESTED`. Never print secret values.
5. Where the owner must create each credential and where it is safely configured.
6. Whether Google OAuth verification/security assessment is required, verified, unresolved or blocks live deployment. Cite official source and avoid overclaiming.
7. Groq model ID, official pricing/rate-limit links checked, data retention statement and selected budget gate.
8. Explicit proof that automatic scanning and manual Scan never call Groq, including test output or call-count evidence.
9. WhatsApp limitation and proof that no automated WhatsApp sending was implemented.
10. Test commands and real results; acceptance matrix with PASS/FAIL/NOT TESTED and evidence.
11. Security/privacy issues, retention/deletion status, known limits and manual owner actions.
12. Current cost estimates for the chosen Render services and Groq usage, using official sources and clearly identifying assumptions. Do not deploy paid services without approval.
13. How Sir installs the Chrome/Edge extension, configures the app and performs the guided workflow. Include the tested versioned ZIP artifact, checksum, exact install steps, and whether the build is Developer Mode or store-published.
14. Mobile roadmap only; do not claim mobile implementation.
15. Explicit owner decision on automatic Groq drafting; current setting state and proof of data-flow consent.
16. Dashboard authentication design and configured owner allowlist behavior.
17. Attachment storage design, cost/limits, and proof that web and worker can access files after restarts/deploys.

# 20. FINAL GUARDRAIL

The project's purpose is to reduce the TPO officer's workload without putting private mailbox data, credentials, WhatsApp account access or placement announcements at risk. If an official API or a policy does not support a capability, do not imitate it through fragile or prohibited automation. Provide a truthful manual fallback and document the restriction. Build for reliability, provenance, human approval and honest status reporting—not for a demo that pretends every step is automatic.

**End of AI 3 Master Implementation Prompt.**
