# SPCR (Student Progression & Company Relation) — Credential & Service Checklist

This checklist accompanies `SPCR_AI3_Implementation_Prompt_Groq_Render.md` (audit-hardened v2.0).

## Security rule

**Do not paste live API keys, OAuth client secrets, database passwords or deployment tokens into an AI chat.** Create credentials in the official provider console and enter them directly into Render's secure Environment settings or another explicitly approved secret manager. Tell the coding agent only when configuration is complete. Never send screenshots that reveal values.

## Required for the default Render-first deployment

| Item | Required value/setup | Where to get it | Where it goes | Needed? |
|---|---|---|---|---|
| Google Cloud project | Enable Gmail API; configure OAuth consent; create Web application OAuth client | https://console.cloud.google.com/ | Google client ID, client secret and exact callback URI in Render environment settings | Required for live Gmail integration, subject to Google policy/verification gate |
| Google OAuth client | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI` | Google Cloud Console → APIs & Services → Credentials | Render Environment settings; callback URI also registered in Google Cloud | Required for live Gmail OAuth |
| SPCR dashboard owner gate | Owner's verified Google identity / allowlisted email, e.g. `SPCR_OWNER_EMAIL` | Decide the single authorized officer account | Non-secret server configuration; dashboard must reject all other identities | Required before public dashboard access |
| Groq | `GROQ_API_KEY`; choose a current supported `GROQ_MODEL` after model/pricing verification | https://console.groq.com/keys | Render Environment settings only; never extension/frontend | Required only for extraction/drafting with Groq; not required for scanning |
| Render | Account, repo connection, Web Service and continuously running monitor/worker | https://render.com/ | Render dashboard | Required for hosting. A Render API key is NOT normally required |
| Render PostgreSQL | Managed database and `DATABASE_URL` | Render dashboard → PostgreSQL | Render service/worker environment settings | Default database choice; avoid adding Supabase unnecessarily |
| App secrets | Session secret, token-encryption key, worker/cron secret if used | Generate cryptographically with implementation tooling | Render Environment settings | Generate; do not ask Sir to invent values |

## Installation and extension distribution

- AI 3 must produce a versioned extension archive, a tested unpacked extension directory, a checksum and `INSTALL_EXTENSION.md`.
- **ZIP + Developer Mode** is the default initial handoff. In Chrome/Edge the ZIP is extracted and the extracted folder is loaded from the browser's extension page with Developer Mode enabled; downloading a ZIP is not the same as one-click browser-store installation.
- A normal store-install experience requires Chrome Web Store and/or Edge Add-ons publication, developer registration, policy disclosures and review. This is a separate owner-approved release action; do not assume it has happened just because an extension ZIP exists.
- The exact Render HTTPS URL must be configured into the extension release build and its host permissions limited to that origin.

## Not required by the selected default

- **Vercel token:** Not required. Only ask if the owner explicitly approves Vercel hosting or API-driven deployment.
- **Supabase keys:** Not required. The default is Render PostgreSQL. Ask for Supabase configuration only if the owner approves switching the database provider.
- **OpenAI API key:** Not used. Groq is the selected model provider.
- **WhatsApp API key:** Not used. WhatsApp delivery is guided/manual through the officer's existing account; no programmatic personal-group sending.
- **Gmail password:** Never request or store it. Use Google OAuth.

## Owner facts AI 3 may ask (not secret values)

- Is the mailbox a personal `@gmail.com` account or a college Google Workspace account?
- Is there already a Google Cloud project and OAuth consent screen?
- Has the Groq key been created? Answer yes/no only, never paste the key.
- Has the Render account/repository connection been set up?
- Has the owner approved estimated monthly hosting costs?
- Does the owner want only ZIP + Developer Mode installation initially, or would they like to pursue Chrome Web Store / Edge Add-ons publication after testing?
- Does the owner want automatic Groq drafting of high-confidence candidates, or manual drafting only? Automatic drafting must remain disabled until data disclosure is accepted and a budget cap is set.
- What monthly Groq spending cap should be configured? This remains unset until the owner decides.
- Is Google OAuth verification/security-assessment status approved, pending or unknown?

## Additional implementation gates

- Dashboard authentication must be configured as a separate security layer from Gmail mailbox authorization. No public unauthenticated dashboard, open registration or ownerless account.
- Source attachments must be stored in a private storage layer accessible to both the Render web service and worker. Do not rely on an ephemeral local filesystem or assume a disk attached to one Render service is shared by another.
- The automatic and manual Scan flows must make zero Groq requests. Groq formatting/drafting is a separate gated workflow.

## Do not enable live Gmail processing yet if

- Google policy/verification requirements for the hosted restricted-scope data flow are unresolved.
- The owner has not approved the required hosted resources and cost.
- OAuth callback configuration is incomplete.
- Token encryption and session security are not implemented/tested.

In these cases, continue building/testing with synthetic fixtures and mock integrations.
