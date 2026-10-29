import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { unzipSync } from 'fflate';
import { createTestSpcrEnvironment } from './testHarness.js';
import { GoogleOidcTokenVerifier } from '../src/services/authService.js';
import { buildValidTextPdfBuffer } from '../src/utils/documentFixtures.js';

describe('Section 16.6 — Single-Owner Security, CSRF/CORS, Extension Pairing, Privacy Retention & Release Integrity', () => {
  it('blocks unauthenticated access, rejects non-owner Google OIDC accounts, hard-blocks demo login in production, and separates dashboard login from Gmail OAuth', async () => {
    let oidcMockEmail = 'intruder@college.edu';
    const mockOidcVerifier: GoogleOidcTokenVerifier = {
      async exchangeCodeForIdentity() {
        return {
          sub: `google-sub-${oidcMockEmail}`,
          email: oidcMockEmail,
          emailVerified: true,
          name: 'Test User',
        };
      },
    };

    const env = await createTestSpcrEnvironment({
      configOverrides: { ownerEmail: 'tpo@college.edu' },
      oidcVerifier: mockOidcVerifier,
    });

    try {
      // 1. Unauthenticated requests to protected endpoints return 401
      for (const endpoint of ['/api/opportunities', '/api/settings', '/api/routing/registry', '/api/gmail/status']) {
        const res = await request(env.app).get(endpoint);
        expect(res.status).toBe(401);
      }

      // 2. Non-owner Google OIDC sign-in (`intruder@college.edu`) MUST be rejected with 403!
      const oidcAgent = request.agent(env.app);
      const startRes = await oidcAgent.get('/api/auth/google/login');
      expect(startRes.status).toBe(302);
      const redirectUrl = new URL(startRes.headers.location!);
      const state = redirectUrl.searchParams.get('state')!;

      const rejectedCallback = await oidcAgent
        .get('/api/auth/google/callback')
        .query({ code: 'mock-code-1', state });
      expect(rejectedCallback.status).toBe(403);
      expect(rejectedCallback.body.error).toBe('OIDC_LOGIN_DENIED');

      // 3. Allowlisted owner (`tpo@college.edu`) succeeds via Google OIDC with HttpOnly SameSite=Lax cookie
      oidcMockEmail = 'tpo@college.edu';
      const startOwner = await oidcAgent.get('/api/auth/google/login');
      const ownerState = new URL(startOwner.headers.location!).searchParams.get('state')!;
      const okCallback = await oidcAgent
        .get('/api/auth/google/callback')
        .query({ code: 'mock-code-owner', state: ownerState });
      expect(okCallback.status).toBe(302);
      const setCookies = ([] as string[]).concat(okCallback.headers['set-cookie'] || []);
      expect(setCookies.some((c) => c.includes('spcr_session=') && c.includes('HttpOnly') && c.includes('SameSite=Lax'))).toBe(
        true
      );

      // 4. Dashboard login does NOT automatically grant Gmail mailbox access (`connection` is null)
      const gmailStatus = await oidcAgent.get('/api/gmail/status');
      expect(gmailStatus.status).toBe(200);
      expect(gmailStatus.body.connection).toBeNull();
    } finally {
      await env.cleanup();
    }

    // 5. Verify local demo login is hard-disabled when `nodeEnv === 'production'` even if demoAuthEnabled was passed
    const prodEnv = await createTestSpcrEnvironment({
      configOverrides: {
        nodeEnv: 'production',
        appBaseUrl: 'https://spcr.example.edu',
        demoAuthEnabled: true,
      },
    });
    try {
      const demoAttempt = await request(prodEnv.app)
        .post('/api/auth/demo-login')
        .send({ email: 'tpo@college.edu' });
      expect(demoAttempt.status).toBe(403);
    } finally {
      await prodEnv.cleanup();
    }
  });

  it('enforces CSRF protection, blocks untrusted CORS Origins, pairs/revokes Chrome/Edge extension one-time codes, and executes Privacy Center deletion + retention cleanup', async () => {
    const env = await createTestSpcrEnvironment();
    try {
      const agent = request.agent(env.app);
      const login = await agent.post('/api/auth/demo-login').send({ email: 'tpo@college.edu' });
      const csrf = login.body.csrfToken;

      // 1. Missing CSRF header on state-changing PATCH/POST -> 403 CSRF_TOKEN_INVALID
      const missingCsrf = await agent.patch('/api/settings').send({ collegeSignature: 'Tampered' });
      expect(missingCsrf.status).toBe(403);
      expect(missingCsrf.body.error).toBe('CSRF_TOKEN_INVALID');

      // 2. Untrusted cross-origin request -> 403 FORBIDDEN_ORIGIN
      const evilOrigin = await agent
        .get('/api/opportunities')
        .set('Origin', 'https://evil-attacker.example');
      expect(evilOrigin.status).toBe(403);
      expect(evilOrigin.body.error).toBe('FORBIDDEN_ORIGIN');

      // 3. One-time Browser Extension Pairing Flow -> Scan -> Replay Rejected -> Remote Revocation
      const createPair = await agent
        .post('/api/extension/pairings')
        .set('X-CSRF-Token', csrf)
        .send({ label: 'TPO Chrome Workstation' });
      expect(createPair.status).toBe(200);
      const { pairingId, pairingCode } = createPair.body;

      const claimRes = await request(env.app)
        .post('/api/extension/pair')
        .set('Origin', 'chrome-extension://abcdefghijklmnopabcdefghijklmnop')
        .send({ pairingCode });
      expect(claimRes.status).toBe(200);
      const { extensionToken, csrfToken: extCsrf } = claimRes.body;

      // Replay of already-used one-time pairing code MUST fail!
      const replayRes = await request(env.app)
        .post('/api/extension/pair')
        .set('Origin', 'chrome-extension://abcdefghijklmnopabcdefghijklmnop')
        .send({ pairingCode });
      expect(replayRes.status).toBe(400);

      // Authenticated extension calls `POST /api/scan/manual` with zero Groq calls
      const extScan = await request(env.app)
        .post('/api/scan/manual')
        .set('Origin', 'chrome-extension://abcdefghijklmnopabcdefghijklmnop')
        .set('Authorization', `Bearer ${extensionToken}`)
        .set('X-CSRF-Token', extCsrf)
        .send({
          gmailMessageId: 'ext-msg-001',
          syntheticPayload: {
            fromRaw: 'Hiring <campus@cypressdata.in>',
            authHeadersRaw: 'mx.google.com; spf=pass; dkim=pass; dmarc=pass',
            subject: 'Campus Recruitment Drive 2027 — Cypress Data Engineer',
            bodyText: 'Company: Cypress Data | Role: Data Engineer | CTC: 13 LPA | CGPA 7.5',
            attachments: [
              {
                filename: 'Cypress_JD.pdf',
                declaredMime: 'application/pdf',
                base64Data: buildValidTextPdfBuffer([['Company: Cypress Data', 'Role: Data Engineer']]).toString(
                  'base64'
                ),
              },
            ],
          },
        });
      expect(extScan.status).toBe(200);
      expect(extScan.body.groqCallsMade).toBe(0);
      const createdOppId = extScan.body.opportunityId;
      expect(createdOppId).toBeTruthy();

      // Revoke extension pairing from dashboard -> subsequent extension call immediately gets 401!
      const revokeRes = await agent
        .delete(`/api/extension/pairings/${pairingId}`)
        .set('X-CSRF-Token', csrf);
      expect(revokeRes.status).toBe(200);

      const afterRevoke = await request(env.app)
        .get('/api/opportunities')
        .set('Origin', 'chrome-extension://abcdefghijklmnopabcdefghijklmnop')
        .set('Authorization', `Bearer ${extensionToken}`);
      expect(afterRevoke.status).toBe(401);

      // 4. Non-secret metadata export contains zero tokens/keys
      const exportRes = await agent.get('/api/privacy/export-metadata');
      expect(exportRes.status).toBe(200);
      const serializedExport = JSON.stringify(exportRes.body);
      expect(serializedExport).not.toContain(extensionToken);
      expect(serializedExport).not.toContain(env.config.sessionSecret);

      // 5. Retention cleanup scrubs aged messages & encrypted attachment blobs past retention window
      // Seed an extra opportunity for per-opportunity deletion test after retention check
      await env.db.query("UPDATE source_messages SET created_at = NOW() - INTERVAL '120 days'");
      await env.db.query("UPDATE attachments SET created_at = NOW() - INTERVAL '120 days'");
      const retentionRes = await agent
        .post('/api/privacy/run-retention-now')
        .set('X-CSRF-Token', csrf)
        .send({});
      expect(retentionRes.status).toBe(200);
      expect(retentionRes.body.expiredMessagesRemoved).toBeGreaterThanOrEqual(1);
      expect(retentionRes.body.expiredBlobsRemoved).toBeGreaterThanOrEqual(1);

      // 6. Per-opportunity delete & full Gmail-derived data purge
      const delOpp = await agent
        .delete(`/api/privacy/opportunities/${createdOppId}`)
        .set('X-CSRF-Token', csrf);
      expect(delOpp.status).toBe(200);

      const purgeAll = await agent
        .post('/api/privacy/purge-all-gmail-data')
        .set('X-CSRF-Token', csrf)
        .send({ disconnectMailbox: false });
      expect(purgeAll.status).toBe(200);

      const remainingOpps = await env.db.query('SELECT id FROM opportunities');
      expect(remainingOpps.rows.length).toBe(0);
    } finally {
      await env.cleanup();
    }
  });

  it('verifies Chrome/Edge Manifest V3 unpacked folder, root-manifest ZIP archive, PNG icons, and SHA-256 checksum artifact', () => {
    const rootDir = process.cwd();
    const unpackedManifestPath = path.join(rootDir, 'release', 'unpacked', 'manifest.json');
    const zipPath = path.join(rootDir, 'release', 'SPCR-Chrome-Edge-Extension-v1.0.0.zip');
    const shaPath = `${zipPath}.sha256`;

    expect(fs.existsSync(unpackedManifestPath)).toBe(true);
    expect(fs.existsSync(zipPath)).toBe(true);
    expect(fs.existsSync(shaPath)).toBe(true);

    const zipBytes = fs.readFileSync(zipPath);
    const actualSha = crypto.createHash('sha256').update(zipBytes).digest('hex');
    const recordedShaLine = fs.readFileSync(shaPath, 'utf8').trim();
    expect(recordedShaLine.startsWith(actualSha)).toBe(true);

    const unzipped = unzipSync(new Uint8Array(zipBytes));
    expect(unzipped['manifest.json']).toBeDefined();
    expect(unzipped['background.js']).toBeDefined();
    expect(unzipped['content-gmail.js']).toBeDefined();
    expect(unzipped['popup.html']).toBeDefined();
    expect(unzipped['popup.js']).toBeDefined();
    expect(unzipped['icons/icon16.png']).toBeDefined();
    expect(unzipped['icons/icon48.png']).toBeDefined();
    expect(unzipped['icons/icon128.png']).toBeDefined();

    // Verify valid PNG magic header (`89 50 4E 47`) on generated icon128.png
    const icon128 = unzipped['icons/icon128.png']!;
    expect(icon128[0]).toBe(0x89);
    expect(icon128[1]).toBe(0x50);
    expect(icon128[2]).toBe(0x4e);
    expect(icon128[3]).toBe(0x47);

    const manifest = JSON.parse(Buffer.from(unzipped['manifest.json']!).toString('utf8'));
    expect(manifest.manifest_version).toBe(3);
    expect(manifest.permissions).toEqual(['storage', 'activeTab']);
    expect(manifest.host_permissions).toContain('https://mail.google.com/*');
    expect(manifest.host_permissions.some((h: string) => h.includes('*://*/*'))).toBe(false);
  });
});
