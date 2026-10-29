import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { buildTestConfig, createTestSpcrEnvironment, getSharedTestClassifier, getSharedTestEmbeddingProvider } from './testHarness.js';
import { createDatabase, runMigrations } from '../src/db/database.js';
import { createServiceContainer, createSpcrApp } from '../src/app.js';
import { EmailIntelligenceService } from '../src/services/emailIntelligenceService.js';
import {
  GmailApiClient,
  GmailRawApiMessage,
  REQUIRED_GMAIL_READONLY_SCOPE,
} from '../src/services/gmailSyncService.js';
import { GroqTransport } from '../src/services/groqDraftingService.js';
import { updateSettings } from '../src/services/settingsService.js';
import { buildValidTextPdfBuffer } from '../src/utils/documentFixtures.js';

function encodeBase64Url(bufOrText: Buffer | string): string {
  const buf = typeof bufOrText === 'string' ? Buffer.from(bufOrText, 'utf8') : bufOrText;
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function makeMultipartGmailMessageWithPdf(params: {
  id: string;
  threadId?: string;
  from: string;
  subject: string;
  bodyText: string;
  attachmentId: string;
  pdfFilename: string;
  listUnsubscribe?: string;
  authResults?: string;
}): GmailRawApiMessage {
  const headers = [
    { name: 'From', value: params.from },
    { name: 'Subject', value: params.subject },
  ];
  if (params.listUnsubscribe) {
    headers.push({ name: 'List-Unsubscribe', value: params.listUnsubscribe });
  }
  if (params.authResults) {
    headers.push({ name: 'Authentication-Results', value: params.authResults });
  }
  return {
    id: params.id,
    threadId: params.threadId || `th-${params.id}`,
    internalDate: String(Date.now()),
    snippet: params.bodyText.slice(0, 140),
    payload: {
      mimeType: 'multipart/mixed',
      headers,
      parts: [
        {
          mimeType: 'text/plain',
          body: { data: encodeBase64Url(params.bodyText) },
        },
        {
          filename: params.pdfFilename,
          mimeType: 'application/pdf',
          body: {
            attachmentId: params.attachmentId,
            size: 4096,
          },
        },
      ],
    },
  };
}

describe('Mandatory Addendum Sections 1, 8, 9 & 10 — Zero-Cost Architecture, Staged Gmail Sync & Quota Guards', () => {
  it('Demo 8a: executes 3-stage Gmail sync — downloads 0 attachments on newsletters, unrelated, and scam emails while fetching & parsing PDFs on relevant and uncertain emails', async () => {
    const validJdPdf = buildValidTextPdfBuffer([
      [
        'Company: Borealis Systems Pvt Ltd',
        'Role: Backend Software Engineer (2027 Batch)',
        'Compensation: CTC 16 LPA | Eligibility: B.Tech CSE/IT CGPA >= 7.5',
        'Apply Link: https://careers.borealissystems.in/2027',
      ],
    ]);

    const messages = new Map<string, GmailRawApiMessage>([
      // 1. Bulk job alert newsletter with PDF -> skipped at Stage 1 metadata!
      [
        'gm-stage-newsletter',
        makeMultipartGmailMessageWithPdf({
          id: 'gm-stage-newsletter',
          from: 'Naukri Alerts <alerts@naukri.com>',
          subject: '25 new developer jobs matching your job alert digest',
          bodyText: 'Daily job alert newsletter. Click here to unsubscribe from job alerts.',
          attachmentId: 'att-newsletter-pdf',
          pdfFilename: 'Sponsor_Brochure.pdf',
          listUnsubscribe: '<mailto:unsubscribe@naukri.com>',
        }),
      ],
      // 2. Unrelated administrative email with PDF -> skipped at Stage 2 body pre-screen!
      [
        'gm-stage-unrelated',
        makeMultipartGmailMessageWithPdf({
          id: 'gm-stage-unrelated',
          from: 'Central Library <library@college.edu>',
          subject: 'Library Overdue Book Return Reminder & Holiday Timings',
          bodyText:
            'All hostel and day-scholar readers are requested to return borrowed reference books before vacation. Revised library reading-room timings are attached.',
          attachmentId: 'att-unrelated-pdf',
          pdfFilename: 'Library_Holiday_Timings.pdf',
        }),
      ],
      // 3. Fee-scam email with PDF -> flagged spam_or_scam at Stage 2; attachment skipped!
      [
        'gm-stage-scam',
        makeMultipartGmailMessageWithPdf({
          id: 'gm-stage-scam',
          from: 'HR Direct Offer <instant.joining.hr@gmail.com>',
          subject: 'Confirmed Offer 20 LPA — Pay INR 3000 Registration Deposit Now',
          bodyText:
            'Guaranteed job without interview! Pay Rs 3000 refundable training fee deposit via UPI to unlock attached offer.',
          attachmentId: 'att-scam-pdf',
          pdfFilename: 'Fake_Offer_Deposit_Form.pdf',
        }),
      ],
      // 4. Genuine campus hiring email with JD PDF -> downloads & parses JD PDF at Stage 3!
      [
        'gm-stage-relevant',
        makeMultipartGmailMessageWithPdf({
          id: 'gm-stage-relevant',
          from: 'Campus Hiring <campus@borealissystems.in>',
          subject: 'Campus Recruitment Drive 2027 — Borealis Systems (Backend Engineer)',
          bodyText:
            'Dear TPO, Borealis Systems invites your 2027 B.Tech CSE/IT batch for Backend Software Engineer. Please find the detailed JD PDF attached.',
          attachmentId: 'att-relevant-jd',
          pdfFilename: 'Borealis_Backend_JD_2027.pdf',
          authResults: 'mx.google.com; spf=pass; dkim=pass',
        }),
      ],
      // 5. Ultra-short ambiguous email ("PFA") with PDF -> REVIEW_REQUIRED triggers Stage 3 PDF download & upgrades classification!
      [
        'gm-stage-uncertain-pfa',
        makeMultipartGmailMessageWithPdf({
          id: 'gm-stage-uncertain-pfa',
          from: 'hr-desk@borealis-campus.in',
          subject: 'PFA document for 2027 batch',
          bodyText: 'Hi Sir, PFA.',
          attachmentId: 'att-uncertain-jd',
          pdfFilename: 'Campus_Drive_Details.pdf',
        }),
      ],
    ]);

    const callLog = {
      metadataIds: [] as string[],
      fullMessageIds: [] as string[],
      downloadedAttachmentIds: [] as string[],
    };

    const stagedGmailClient: GmailApiClient = {
      async exchangeAuthCode() {
        return {
          accessToken: 'ya29.test_staged_token',
          refreshToken: '1//test_staged_refresh',
          expiresInSeconds: 3600,
          scope: REQUIRED_GMAIL_READONLY_SCOPE,
        };
      },
      async refreshAccessToken() {
        return { accessToken: 'ya29.test_staged_refreshed', expiresInSeconds: 3600 };
      },
      async revokeToken() {},
      async getProfile() {
        return { emailAddress: 'tpo@college.edu', historyId: '5000' };
      },
      async listMessages() {
        return {
          messageIds: Array.from(messages.keys()),
        };
      },
      async listHistory() {
        return { messageIds: Array.from(messages.keys()), latestHistoryId: '5001' };
      },
      async getMessageMetadata(_token, messageId) {
        callLog.metadataIds.push(messageId);
        const msg = messages.get(messageId)!;
        return {
          id: msg.id,
          threadId: msg.threadId,
          snippet: msg.snippet,
          payload: { headers: msg.payload?.headers || [] },
        };
      },
      async getMessage(_token, messageId) {
        callLog.fullMessageIds.push(messageId);
        return messages.get(messageId)!;
      },
      async getAttachmentBytes(_token, _messageId, attachmentId) {
        callLog.downloadedAttachmentIds.push(attachmentId);
        return validJdPdf;
      },
    };

    const env = await createTestSpcrEnvironment({
      configOverrides: { gmailPolicyGateApproved: true },
      gmailApiClient: stagedGmailClient,
    });

    try {
      const start = env.services.gmailSync.createGmailAuthorizationStart();
      await env.services.gmailSync.completeGmailOAuthCallback({
        actorEmail: 'tpo@college.edu',
        code: 'oauth-code-1',
        cookieState: start.stateCookieValue,
        queryState: start.stateCookieValue,
      });

      const pollOut = await env.services.gmailSync.pollNewMessages('tpo@college.edu');
      expect(pollOut.polledCount).toBe(5);

      // Stage 1: Newsletter was skipped at metadata stage -> never even fetched full message body or attachment!
      expect(callLog.metadataIds).toContain('gm-stage-newsletter');
      expect(callLog.fullMessageIds).not.toContain('gm-stage-newsletter');

      // Stage 3: Strictly ZERO attachment downloads for newsletter, unrelated, and scam emails!
      expect(callLog.downloadedAttachmentIds).not.toContain('att-newsletter-pdf');
      expect(callLog.downloadedAttachmentIds).not.toContain('att-unrelated-pdf');
      expect(callLog.downloadedAttachmentIds).not.toContain('att-scam-pdf');

      // Genuine relevant email AND uncertain PFA email DID download and parse their PDFs!
      expect(callLog.downloadedAttachmentIds).toEqual(['att-relevant-jd', 'att-uncertain-jd']);

      const quotaStatus = await env.services.gmailSync.getQuotaStatus();
      expect(quotaStatus.attachmentCallsToday).toBe(2);
      expect(quotaStatus.attachmentsSkippedByStagingToday).toBe(2);
      expect(quotaStatus.unitsUsedToday).toBeGreaterThan(0);
    } finally {
      await env.cleanup();
    }
  });

  it('Demo 8b & 8c: halts cleanly before exceeding Gmail quota safety cap (HTTP 429) and enforces Groq INR 0 free-tier guard', async () => {
    let apiCallsExecuted = 0;
    const tightQuotaClient: GmailApiClient = {
      async exchangeAuthCode() {
        return {
          accessToken: 'ya29.tight',
          refreshToken: '1//tight',
          expiresInSeconds: 3600,
          scope: REQUIRED_GMAIL_READONLY_SCOPE,
        };
      },
      async refreshAccessToken() {
        return { accessToken: 'ya29.tight', expiresInSeconds: 3600 };
      },
      async revokeToken() {},
      async getProfile() {
        apiCallsExecuted++;
        return { emailAddress: 'tpo@college.edu', historyId: '900' };
      },
      async listMessages() {
        apiCallsExecuted++;
        return {
          messageIds: ['q-1', 'q-2', 'q-3'],
        };
      },
      async listHistory() {
        apiCallsExecuted++;
        return { messageIds: ['q-1', 'q-2', 'q-3'], latestHistoryId: '900' };
      },
      async getMessageMetadata(_t, id) {
        apiCallsExecuted++;
        return {
          id,
          threadId: `th-${id}`,
          snippet: 'Campus hiring drive',
          payload: { headers: [{ name: 'From', value: 'hr@corp.in' }, { name: 'Subject', value: 'Campus Drive' }] },
        };
      },
      async getMessage(_t, id) {
        apiCallsExecuted++;
        return {
          id,
          threadId: `th-${id}`,
          payload: {
            mimeType: 'text/plain',
            headers: [{ name: 'From', value: 'hr@corp.in' }, { name: 'Subject', value: 'Campus Drive' }],
            body: { data: encodeBase64Url('Campus hiring 2027') },
          },
        };
      },
      async getAttachmentBytes() {
        apiCallsExecuted++;
        return Buffer.alloc(0);
      },
    };

    const mockGroqTransport: GroqTransport = {
      isLiveProvider: true,
      async completeStructured() {
        const parsed = {
          companyName: 'TestCorp',
          roleTitle: 'Software Engineer',
          opportunityType: 'Full-Time',
          compensation: '12 LPA',
          locationAndMode: 'Bengaluru',
          eligibleBranchesAndBatch: 'B.Tech CSE 2027',
          cgpaOrCriteria: '7.5',
          deadline: '30 Nov 2026',
          registrationOrActionLinks: [] as string[],
          selectionProcess: 'Not specified',
          plainTextAnnouncementSummary: 'Placement Notice: TestCorp Software Engineer.',
        };
        return {
          parsed,
          rawJsonContent: JSON.stringify(parsed),
          modelUsed: 'openai/gpt-oss-20b',
          promptTokens: 600,
          completionTokens: 200,
        };
      },
      async checkConnectionSafe() {
        return { ok: true, modelAvailable: true, detail: 'OK' };
      },
    };

    const env = await createTestSpcrEnvironment({
      configOverrides: {
        gmailPolicyGateApproved: true,
        gmailPerSyncMaxQuotaUnits: 8, // listMessages(5) + getMessageMetadata(2) = 7; next full message (5) = 12 > 8 -> STOP!
        groqLiveEnabled: true,
        groqApiKey: 'test-free-tier-key',
        groqFreeTierOnly: true,
      },
      gmailApiClient: tightQuotaClient,
      groqTransport: mockGroqTransport,
    });

    try {
      const start = env.services.gmailSync.createGmailAuthorizationStart();
      await env.services.gmailSync.completeGmailOAuthCallback({
        actorEmail: 'tpo@college.edu',
        code: 'code-tight',
        cookieState: start.stateCookieValue,
        queryState: start.stateCookieValue,
      });

      const agent = request.agent(env.app);
      const login = await agent.post('/api/auth/demo-login').send({ email: 'tpo@college.edu' });
      const csrf = login.body.csrfToken;

      const pollRes = await agent.post('/api/gmail/poll-now').set('X-CSRF-Token', csrf).send({});
      expect(pollRes.status).toBe(429);
      expect(pollRes.body.error).toBe('GMAIL_QUOTA_SAFETY_STOP');
      expect(pollRes.body.limitKind).toBe('per_sync_cap');

      const quotaAfter = await env.services.gmailSync.getQuotaStatus();
      expect(quotaAfter.hardStopTriggered).toBe(true);
      expect(quotaAfter.unitsUsedToday).toBeLessThanOrEqual(9); // getProfile(1) during OAuth + 7 during poll

      // Verify Groq Free-Tier Guard halts BEFORE exceeding 900 RPD free-tier ceiling (INR 0 cost!)
      await updateSettings(env.db, env.config, 'tpo@college.edu', {
        acceptGroqDisclosure: true,
        monthlyBudgetInr: 100,
        confirmBudget: true,
      });
      const scanRes = await agent
        .post('/api/scan/manual')
        .set('X-CSRF-Token', csrf)
        .send({
          gmailMessageId: 'msg-groq-guard',
          syntheticPayload: {
            fromRaw: 'Campus Team <hr@testcorp.in>',
            authHeadersRaw: 'mx.google.com; spf=pass; dkim=pass',
            subject: 'Campus Recruitment 2027 — Software Engineer (12 LPA)',
            bodyText: 'TestCorp invites B.Tech CSE 2027 batch for Software Engineer (CTC 12 LPA).',
          },
        });
      const oppId = scanRes.body.opportunityId;

      const todayKey = new Date().toISOString().slice(0, 10);
      await env.db.query(
        `INSERT INTO groq_free_tier_usage (day_key, requests_count, tokens_used) VALUES ($1, 900, 150000)`,
        [todayKey]
      );

      const fmtBlocked = await agent
        .post(`/api/opportunities/${oppId}/format-groq`)
        .set('X-CSRF-Token', csrf)
        .send({});
      expect(fmtBlocked.status).toBe(429);
      expect(fmtBlocked.body.error).toBe('GROQ_BUDGET_CAP_REACHED');
      expect(fmtBlocked.body.message).toMatch(/Zero-cost safety guard: OPTIONAL_GROQ daily free-tier ceiling reached/);
    } finally {
      await env.cleanup();
    }
  });

  it('Demo 9: runs full LOCAL_ZERO_COST production workflow on persistent local PGlite with INR 0 bill, no payment method, and GROQ_LIVE_ENABLED=false', async () => {
    const pgliteDir = fs.mkdtempSync(path.join(os.tmpdir(), 'spcr-local-zero-cost-db-'));
    const config = buildTestConfig({
      nodeEnv: 'production',
      operatingMode: 'LOCAL_ZERO_COST',
      optionalGroqMode: 'DISABLED',
      demoAuthEnabled: false,
      groqLiveEnabled: false,
      groqApiKey: '',
      databaseUrl: `pglite://${pgliteDir}`,
    });

    const db = await createDatabase(config.databaseUrl);
    await runMigrations(db);

    const emailIntelligence = new EmailIntelligenceService({
      artifactPath: config.emailModelArtifactPath,
      cacheDir: config.classifierCacheDir,
      offlineOnly: true,
      embeddingProvider: getSharedTestEmbeddingProvider(),
    });

    const services = createServiceContainer({
      config,
      db,
      emailIntelligence,
      oidcVerifier: {
        async exchangeCodeForIdentity() {
          return {
            sub: 'google-oidc-sub-owner-1',
            email: 'tpo@college.edu',
            emailVerified: true,
            name: 'Placement Officer',
          };
        },
      },
    });
    // Reuse shared ONNX classifier so test stays fast
    (services as any).classifier = getSharedTestClassifier();
    await services.retrainingService.ensureInitializedRegistry();
    const app = createSpcrApp(services);

    try {
      // 1. Public health reports LOCAL_ZERO_COST & recurringSoftwareCostInr === 0
      const health = await request(app).get('/api/health/public');
      expect(health.status).toBe(200);
      expect(health.body.operatingMode).toBe('LOCAL_ZERO_COST');
      expect(health.body.optionalGroqMode).toBe('DISABLED');
      expect(health.body.recurringSoftwareCostInr).toBe(0);

      // 2. Demo login is strictly blocked in production; authenticate via real OIDC flow
      const demoBlocked = await request(app).post('/api/auth/demo-login').send({ email: 'tpo@college.edu' });
      expect(demoBlocked.status).toBe(403);

      const agent = request.agent(app);
      const oidcStart = services.authService.createGoogleOidcStart();
      const loginCb = await agent
        .get(`/api/auth/google/callback?code=valid-oidc-code&state=${encodeURIComponent(oidcStart.stateCookieValue)}`)
        .set('Cookie', [`spcr_oidc_state=${oidcStart.stateCookieValue}`]);
      expect(loginCb.status).toBe(302);

      const authStatus = await agent.get('/api/auth/status');
      expect(authStatus.body.authenticated).toBe(true);
      expect(authStatus.body.operatingMode).toBe('LOCAL_ZERO_COST');
      const csrf = authStatus.body.principal.csrfToken;

      // 3. Safe connection check succeeds with OPTIONAL_GROQ disabled
      const safeCheck = await agent.post('/api/integrations/safe-check').set('X-CSRF-Token', csrf).send({});
      expect(safeCheck.status).toBe(200);
      expect(safeCheck.body.database.driver).toBe('pglite');
      expect(safeCheck.body.emailIntelligenceModel.ok).toBe(true);
      expect(safeCheck.body.triggeredGroqCompletionSpend).toBe(false);

      // 4. Local classification + structured extraction + opportunity creation + manual approval + guided WhatsApp queue
      const scanRes = await agent
        .post('/api/scan/manual')
        .set('X-CSRF-Token', csrf)
        .send({
          gmailMessageId: 'prod-local-1',
          syntheticPayload: {
            fromRaw: 'University Hiring <campus@veritascloud.in>',
            authHeadersRaw: 'mx.google.com; spf=pass; dkim=pass',
            subject: 'Campus Recruitment 2027 — Cloud Systems Engineer (14 LPA)',
            bodyText:
              'Dear TPO, Veritas Cloud invites B.Tech CSE 2027 students for Cloud Systems Engineer in Pune (Hybrid). CTC: INR 14 LPA. Apply by 27 Nov 2026 at https://veritascloud.in/careers/2027.',
          },
        });
      expect(scanRes.status).toBe(200);
      expect(scanRes.body.primaryCategory).toBe('relevant_opportunity');
      expect(scanRes.body.groqCallsMade).toBe(0);
      const oppId = scanRes.body.opportunityId;

      // Register section & WhatsApp group, approve deterministic local draft, and record manual send
      const secRes = await agent
        .post('/api/routing/sections')
        .set('X-CSRF-Token', csrf)
        .send({ name: 'CSE 2027', eligibilityTags: ['CSE'] });
      await agent
        .post('/api/routing/groups')
        .set('X-CSRF-Token', csrf)
        .send({
          visibleName: 'B.Tech CSE 2027 Official Notices',
          sectionIds: [secRes.body.section.id],
        });

      const oppDetail = await agent.get(`/api/opportunities/${oppId}`);
      const draftId = oppDetail.body.drafts[0].id;

      const approveRes = await agent
        .post(`/api/opportunities/${oppId}/approve`)
        .set('X-CSRF-Token', csrf)
        .send({
          draftVersionId: draftId,
          sectionIds: [secRes.body.section.id],
        });
      expect(approveRes.status).toBe(200);
      const batchId = approveRes.body.batch.id;
      const targetId = approveRes.body.targets[0].id;

      const outcomeRes = await agent
        .post(`/api/dispatch/batches/${batchId}/targets/${targetId}/outcome`)
        .set('X-CSRF-Token', csrf)
        .send({ outcome: 'officer_marked_sent', officerNote: 'Verified group header and sent manually.' });
      expect(outcomeRes.status).toBe(200);
      expect(outcomeRes.body.batch.status).toBe('completed');
    } finally {
      await db.close();
      fs.rmSync(pgliteDir, { recursive: true, force: true });
    }
  });
});
