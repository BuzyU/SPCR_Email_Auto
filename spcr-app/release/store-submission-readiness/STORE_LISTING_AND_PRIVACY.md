# SPCR Chrome Web Store & Microsoft Edge Add-ons Submission Readiness

> **Publication Status:** **NOT PUBLISHED LIVE.** This folder contains submission-ready store listing metadata, permission justifications, and privacy disclosures. Publishing for one-click install requires the owner's developer account registration and store review.

## 1. Basic Listing Metadata

- **Extension Name:** SPCR — Placement Email Triage Companion
- **Short Name:** SPCR
- **Version:** 1.0.0
- **Category:** Productivity / Education (Institutional Single-Owner Companion)
- **Visibility Recommendation:** **Unlisted** (recommended for single-owner institutional TPO use so only the officer with the direct link or unpacked archive installs it).

## 2. Single-Purpose Statement

SPCR Companion enables an authenticated institutional Training & Placement Officer to trigger zero-LLM placement-email screening, optional post-screen announcement formatting, and review navigation between Gmail Web (`https://mail.google.com`) and their self-hosted SPCR backend (`http://localhost:3000`).

## 3. Narrow Permission Justifications

| Permission | Justification for Store Reviewers |
|---|---|
| `storage` | Stores only the single-owner pairing bearer token, CSRF token, and SPCR backend origin in `chrome.storage.local`. Zero API keys or third-party credentials are stored. |
| `activeTab` | Allows the toolbar popup fallback to check whether the officer's currently focused tab is `https://mail.google.com/*` and prefill the opened Gmail message ID on explicit click. |
| `https://mail.google.com/*` | Renders the minimalist SPCR action bar (`Scan Email`, `Format Announcement with Groq`, `Review/Edit in SPCR`, `Choose WhatsApp Groups`) inside the officer's opened Gmail thread and reads the active `data-legacy-message-id`. Does NOT perform background Gmail polling. |
| `http://localhost:3000/*` | Communicates exclusively with the officer's own hosted SPCR server over HTTPS using the paired token. Wildcard `*://*/*` permissions are strictly prohibited and absent. |

## 4. Data-Use & Privacy Disclosure

- **Does the extension collect analytics or telemetry?** No.
- **Does the extension inject ads or remote code?** No. All JavaScript is bundled statically inside the Manifest V3 package.
- **Does the extension automate WhatsApp Web?** No. Zero `web.whatsapp.com` permissions or scripts exist.
- **Data transmitted on `Scan Email`:** Sends only the opened `gmailMessageId` to the officer's SPCR server, where SPCR screens the message locally using deterministic checks + `Xenova/all-MiniLM-L6-v2` with **zero Groq requests**.

## 5. Developer Account Fees & Review Timelines

- **Chrome Web Store:** Requires a Google Chrome Web Store Developer account (**\$5.00 USD one-time registration fee** at `https://chrome.google.com/webstore/devconsole`) and Google store review before one-click install works.
- **Microsoft Edge Add-ons:** Requires a Microsoft Partner Center Developer account (**\$0 USD registration fee for individual/company Edge Add-ons** at `https://partner.microsoft.com/dashboard/microsoftedge`) and Microsoft store review.
- **Zero-Cost Immediate Option:** Extract `SPCR-Chrome-Edge-Extension-v1.0.0.zip` locally and load `release/unpacked/` via `chrome://extensions` or `edge://extensions` (`Developer mode` -> `Load unpacked`) per `INSTALL_EXTENSION.md`.

## 6. Screenshot Capture Checklist Before Store Upload

1. `1280x800` screenshot of Gmail thread showing the minimalist white SPCR bar (`Scanned — no Groq request made`).
2. `1280x800` screenshot of the SPCR Extension Toolbar Popup paired state.
3. `1280x800` screenshot of the SPCR Opportunity Review Workspace showing side-by-side source provenance and approval gate.
