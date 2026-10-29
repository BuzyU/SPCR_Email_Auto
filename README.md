# SPCR_Email_Auto

SPCR (Student Progression & Company Relation) Email & WhatsApp Automation Assistant for Training & Placement Officers (TPO).

## Overview

SPCR automates the discovery, triage, and announcement drafting for campus recruitment and placement emails:
- **Triage & Screening:** Independent local screening (zero external AI API calls for privacy & cost control) using lightweight local embeddings and deterministic rule-based verification.
- **Fact Extraction & Drafting:** Post-screening structured opportunity extraction and WhatsApp announcement generation powered by Groq API under a strict owner-configured monthly budget cap.
- **Human-in-the-Loop Dispatch:** Manual review, destination group selection, and guided one-click dispatch to WhatsApp Web (no unofficial APIs or DOM automation).
- **Companion Extension:** Chrome & Edge Manifest V3 extension for one-click action directly inside Gmail Web.

## Repository Structure

```
SPCR/
├── spcr-app/                               # Full-stack Node.js / React application
│   ├── client/                             # React SPA owner dashboard
│   ├── extension/                          # Chrome/Edge Manifest V3 extension
│   ├── src/                                # Backend Express API & continuous worker
│   ├── tests/                              # Vitest end-to-end and unit test suites
│   ├── migrations/                         # PostgreSQL schema migrations
│   ├── render.yaml                         # Render Blueprint definition (rootDir: spcr-app)
│   └── package.json
├── render.yaml                             # Root Render Blueprint pointing to spcr-app
├── SPCR_AI3_Implementation_Prompt_Groq_Render_v2.md # Master specification
├── SPCR_AI3_Audit_Findings_v2.md           # Security, architecture & privacy audit findings
└── SPCR_Credential_Setup_Checklist_v2.md   # External credential configuration guide
```

## Quick Start (Local Run)

See [`spcr-app/README.md`](spcr-app/README.md) for full instructions:

```powershell
cd spcr-app
npm install
npm run preload:model
npm run migrate
npm run build
npm start
```

