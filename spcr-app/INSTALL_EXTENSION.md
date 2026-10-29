# SPCR Companion Extension — Installation, Pairing, Update & Removal Guide

**Product:** SPCR (Student Progression & Company Relation)  
**Target Browsers:** Google Chrome (`v116+`) and Microsoft Edge (`v116+`) — Manifest V3  
**Release Archive:** `release/SPCR-Chrome-Edge-Extension-v1.0.0.zip`  
**Checksum File:** `release/SPCR-Chrome-Edge-Extension-v1.0.0.zip.sha256`  
**Unpacked Folder:** `release/unpacked/`

---

## Important Delivery Model Distinction

- **Direct Local Install (Included & Ready Now — Zero Store Fee):** You can install SPCR Companion immediately in Google Chrome or Microsoft Edge using the packaged `release/SPCR-Chrome-Edge-Extension-v1.0.0.zip` (extracted) or `release/unpacked/` folder via `Load unpacked`.
- **Store One-Click Install (Optional — Requires Store Review):** Publishing to the Chrome Web Store (\$5 USD one-time developer registration fee + Google review) or Microsoft Edge Add-ons (\$0 registration fee + Microsoft review) is **not performed automatically** and requires owner developer credentials. Submission-ready store metadata and permission justifications are included in `release/store-submission-readiness/STORE_LISTING_AND_PRIVACY.md`.

---

## 1. Verify Archive Integrity (Optional Recommended Check)

In PowerShell from `spcr-app`:

```powershell
Get-FileHash .\release\SPCR-Chrome-Edge-Extension-v1.0.0.zip -Algorithm SHA256
Get-Content .\release\SPCR-Chrome-Edge-Extension-v1.0.0.zip.sha256
```

Confirm the two SHA-256 hashes match identically.

---

## 2. Configure Your SPCR Hosted Backend URL Before Installing

By default, the release extension manifest restricts `host_permissions` strictly to:

1. `https://mail.google.com/*`
2. Your exact SPCR backend origin (default placeholder: `https://spcr-web.onrender.com/*`)

When your Render URL (or local test server URL) is finalized, rebuild the extension with that exact origin so Chrome/Edge enforces narrow host permissions:

```powershell
# Example A: Your production Render HTTPS URL
$env:EXTENSION_BACKEND_ORIGIN="https://your-spcr-service.onrender.com"
npm run build:extension

# Example B: Local workstation testing against http://localhost:3000
$env:EXTENSION_BACKEND_ORIGIN="http://localhost:3000"
npm run build:extension
```

---

## 3. Install in Google Chrome

1. If installing from the ZIP archive, extract `SPCR-Chrome-Edge-Extension-v1.0.0.zip` into a permanent local folder on your workstation (do not delete the folder while the extension is installed), **or** point directly to `spcr-app\release\unpacked`.
2. Open Chrome and navigate to `chrome://extensions`.
3. Enable **Developer mode** using the toggle in the top-right corner.
4. Click **Load unpacked** in the top-left toolbar.
5. Select the folder containing `manifest.json` (e.g., `d:\Projects\SPCR\spcr-app\release\unpacked`).
6. Click the **Extensions** puzzle icon in the Chrome toolbar and **Pin** `SPCR — Placement Email Triage Companion`.

---

## 4. Install in Microsoft Edge

1. Extract `SPCR-Chrome-Edge-Extension-v1.0.0.zip` to a permanent local folder, **or** use `spcr-app\release\unpacked`.
2. Open Microsoft Edge and navigate to `edge://extensions`.
3. Enable **Developer mode** in the left sidebar (or bottom-left toggle).
4. Click **Load unpacked**.
5. Select the folder containing `manifest.json` (`d:\Projects\SPCR\spcr-app\release\unpacked`).
6. Click the Extensions icon in the Edge toolbar and **Show in toolbar** next to `SPCR — Placement Email Triage Companion`.

---

## 5. Pair the Extension with Your Single-Owner SPCR Account

No API keys, client secrets, or database tokens are embedded inside the extension. Instead, pair it with a short-lived one-time code:

1. Sign into your **SPCR Web Dashboard** as the allowlisted TPO owner.
2. Open **Settings, Privacy & Audit** -> **Browser Extension Pairing**.
3. Click **Generate One-Time Pairing Code** (valid for 10 minutes; single-use).
4. Click the **SPCR Companion** icon in your Chrome/Edge toolbar.
5. Verify the **SPCR Hosted Backend Origin** matches your SPCR URL, paste the 12-character pairing code, and click **Pair Extension**.
6. Status changes to **Paired**.

---

## 6. Using SPCR Inside Gmail & Fallback Mode

1. Open an email thread in `https://mail.google.com`.
2. The minimalist white **SPCR** bar appears at the top of the message pane:
   - **Scan Email:** Runs SPCR's local deterministic + ONNX screening on your server (**zero Groq API calls**) and displays `"Scanned — no Groq request made"`, classification, confidence, and authenticity label.
   - **Format Announcement with Groq:** Enabled once a placement opportunity candidate is created; submits to Groq only if your SPCR Groq consent, budget cap, and API key gates are satisfied.
   - **Review/Edit in SPCR:** Opens the exact opportunity inside your SPCR Review Workspace.
   - **Choose WhatsApp Groups:** Opens destination section/group selection for officer approval.
3. **If Gmail Changes Its DOM Layout:** Click the **SPCR Companion** icon in your browser toolbar — the popup provides a complete manual scan, Groq format, and dashboard launch fallback.

---

## 7. Updating or Removing the Extension

- **To Update:** Run `npm run build:extension`, open `chrome://extensions` or `edge://extensions`, and click the **Reload** button on the SPCR card (or extract the new ZIP over your folder and click **Reload**).
- **To Revoke Pairing Remotely:** In the SPCR Dashboard -> **Settings, Privacy & Audit**, click **Revoke** next to the extension pairing, or click **Unpair** inside the extension popup.
- **To Uninstall Completely:** Open `chrome://extensions` or `edge://extensions` and click **Remove** on the SPCR card. Removing the extension deletes its `chrome.storage.local` pairing token automatically.

