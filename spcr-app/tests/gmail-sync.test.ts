import { describe, expect, it } from 'vitest';
import { createTestSpcrEnvironment } from './testHarness.js';
import {
  GmailApiClient,
  GmailHttpApiError,
  GmailRawApiMessage,
  REQUIRED_GMAIL_READONLY_SCOPE,
} from '../src/services/gmailSyncService.js';

function encodeBase64Url(text: string): string {
  return Buffer.from(text, 'utf8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function makeRawGmailMessage(params: {
  id: string;
  threadId?: string;
  from: string;
  subject: string;
  body: string;
  authResults?: string;
}): GmailRawApiMessage {
  const headers = [
    { name: 'From', value: params.from },
    { name: 'Subject', value: params.subject },
  ];
  if (params.authResults) {
    headers.push({ name: 'Authentication-Results', value: params.authResults });
  }
  return {
    id: params.id,
    threadId: params.threadId || `th-${params.id}`,
    internalDate: String(Date.now()),
    payload: {
      mimeType: 'text/plain',
      headers,
      body: { data: encodeBase64Url(params.body) },
    },
  };
}

describe('Section 16.2 — Gmail Sync, Encrypted Tokens, History 404 Recovery, Backoff & Worker Leases', () => {
  it('blocks live Gmail OAuth and polling when GMAIL_POLICY_GATE_APPROVED=false', async () => {
    const env = await createTestSpcrEnvironment({
      configOverrides: { gmailPolicyGateApproved: false },
    });
    try {
      expect(() => env.services.gmailSync.createGmailAuthorizationStart()).toThrow(/GMAIL_POLICY_GATE_BLOCKED/i);
      const health = await env.services.gmailSync.getMonitoringHealth();
      expect(health.policyGateApproved).toBe(false);
    } finally {
      await env.cleanup();
    }
  });

  it('encrypts OAuth tokens at rest, paginates messages, handles idempotent duplicates, recovers from HTTP 404 expired historyId, and retries 429', async () => {
    let historyShouldThrow404 = false;
    let transient429Remaining = 1;

    const messagesStore = new Map<string, GmailRawApiMessage>([
      [
        'gm-101',
        makeRawGmailMessage({
          id: 'gm-101',
          from: 'Campus Hiring <careers@quantacore.in>',
          subject: 'Campus Recruitment 2027 — Software Engineer (15 LPA)',
          body: 'Dear TPO, QuantaCore invites B.Tech CSE/IT 2027 batch for Software Engineer. CGPA >= 7.5. Deadline: 28 Nov 2026.',
          authResults: 'mx.google.com; spf=pass; dkim=pass; dmarc=pass',
        }),
      ],
      [
        'gm-102',
        makeRawGmailMessage({
          id: 'gm-102',
          from: 'HR Desk <talent@meridianlabs.co.in>',
          subject: 'Internship + Full-Time Drive 2027 — Data Engineer',
          body: 'Dear Placement Cell, Meridian Labs is recruiting B.Tech CSE/AI/DS 2027 students. Stipend 40k/mo, CTC 11 LPA.',
          // Intentionally omit Authentication-Results header to test 'unavailable' handling!
        }),
      ],
    ]);

    const fakeGmailClient: GmailApiClient = {
      async exchangeAuthCode() {
        return {
          accessToken: 'ya29.SUPER_SECRET_LIVE_ACCESS_TOKEN_VALUE',
          refreshToken: '1//0gSUPER_SECRET_LIVE_REFRESH_TOKEN_VALUE',
          expiresInSeconds: 3600,
          scope: REQUIRED_GMAIL_READONLY_SCOPE,
        };
      },
      async refreshAccessToken() {
        return {
          accessToken: 'ya29.REFRESHED_ACCESS_TOKEN_VALUE',
          expiresInSeconds: 3600,
        };
      },
      async revokeToken() {},
      async getProfile() {
        return { emailAddress: 'tpo-mailbox@college.edu', historyId: '5001' };
      },
      async listHistory(_token, params) {
        if (historyShouldThrow404) {
          throw new GmailHttpApiError('Requested entity was not found (expired historyId).', 404, 'notFound');
        }
        if (params.startHistoryId === '5001') {
          return { messageIds: ['gm-101', 'gm-101'], latestHistoryId: '5002' }; // duplicate ID included!
        }
        return { messageIds: [], latestHistoryId: params.startHistoryId };
      },
      async listMessages(_token, params) {
        if (transient429Remaining > 0) {
          transient429Remaining -= 1;
          throw new GmailHttpApiError('Rate Limit Exceeded', 429, 'rateLimitExceeded');
        }
        if (!params.pageToken) {
          return { messageIds: ['gm-101'], nextPageToken: 'page-2' };
        }
        return { messageIds: ['gm-102'] };
      },
      async getMessage(_token, messageId) {
        const found = messagesStore.get(messageId);
        if (!found) throw new GmailHttpApiError('Message not found', 404);
        return found;
      },
      async getAttachmentBytes() {
        return Buffer.alloc(0);
      },
    };

    const env = await createTestSpcrEnvironment({
      configOverrides: { gmailPolicyGateApproved: true },
      gmailApiClient: fakeGmailClient,
    });

    try {
      const start = env.services.gmailSync.createGmailAuthorizationStart();
      expect(start.authUrl).toContain(encodeURIComponent(REQUIRED_GMAIL_READONLY_SCOPE));
      expect(start.authUrl).not.toContain('gmail.modify');
      expect(start.authUrl).not.toContain('gmail.metadata');

      const stateParam = new URL(start.authUrl).searchParams.get('state')!;
      await env.services.gmailSync.completeGmailOAuthCallback({
        actorEmail: 'tpo@college.edu',
        code: 'mock-oauth-code',
        cookieState: start.stateCookieValue,
        queryState: stateParam,
      });

      // Verify tokens are AES-256-GCM encrypted in PostgreSQL (zero plaintext!)
      const rawConn = await env.db.query<{ encrypted_access_token: string; encrypted_refresh_token: string }>(
        'SELECT encrypted_access_token, encrypted_refresh_token FROM gmail_connections'
      );
      expect(rawConn.rows[0]?.encrypted_access_token).not.toContain('SUPER_SECRET');
      expect(rawConn.rows[0]?.encrypted_refresh_token).not.toContain('SUPER_SECRET');

      // Poll 1: incremental history returns ['gm-101', 'gm-101'] -> idempotent, stores only 1 source_message row
      const poll1 = await env.services.gmailSync.pollNewMessages('tpo@college.edu');
      expect(poll1.polledCount).toBeGreaterThanOrEqual(1);
      const countAfterPoll1 = await env.db.query<{ cnt: number }>('SELECT COUNT(*)::int AS cnt FROM source_messages');
      expect(countAfterPoll1.rows[0]?.cnt).toBe(1);

      // Poll 2: trigger HTTP 404 expired historyId -> recovers via getProfile + paginated listMessages (including 429 retry!)
      historyShouldThrow404 = true;
      const poll2 = await env.services.gmailSync.pollNewMessages('tpo@college.edu');
      expect(poll2.historyRecoveredFrom404).toBe(true);
      const countAfterPoll2 = await env.db.query<{ cnt: number }>('SELECT COUNT(*)::int AS cnt FROM source_messages');
      expect(countAfterPoll2.rows[0]?.cnt).toBe(2); // gm-101 idempotent, gm-102 added from page-2!

      // Verify gm-102 (missing Authentication-Results header) recorded transport_auth_status = 'unavailable'
      const gm102Outcome = await env.db.query<{ transport_auth_status: string }>(
        `SELECT so.transport_auth_status
         FROM screening_outcomes so
         JOIN source_messages sm ON sm.id = so.source_message_id
         WHERE sm.gmail_message_id = 'gm-102'`
      );
      expect(gm102Outcome.rows[0]?.transport_auth_status).toBe('unavailable');
    } finally {
      await env.cleanup();
    }
  });

  it('surfaces revoked/expired Gmail OAuth token cleanly and enforces PostgreSQL worker_leases single-worker lock + restart takeover', async () => {
    const revokingClient: GmailApiClient = {
      async exchangeAuthCode() {
        return {
          accessToken: 'ya29.SHORT_LIVED',
          refreshToken: '1//REVOKED_REFRESH',
          expiresInSeconds: -10, // Immediately expired so next poll triggers refreshAccessToken
          scope: REQUIRED_GMAIL_READONLY_SCOPE,
        };
      },
      async refreshAccessToken() {
        throw new GmailHttpApiError('Token has been expired or revoked (invalid_grant).', 401, 'invalid_grant');
      },
      async revokeToken() {},
      async getProfile() {
        return { emailAddress: 'tpo-mailbox@college.edu', historyId: '9000' };
      },
      async listHistory() {
        return { messageIds: [] };
      },
      async listMessages() {
        return { messageIds: [] };
      },
      async getMessage() {
        throw new GmailHttpApiError('Not found', 404);
      },
      async getAttachmentBytes() {
        return Buffer.alloc(0);
      },
    };

    const env = await createTestSpcrEnvironment({
      configOverrides: { gmailPolicyGateApproved: true },
      gmailApiClient: revokingClient,
    });

    try {
      // 1. Verify worker_leases coordination between two worker instances
      const acquiredA = await env.services.gmailSync.acquireOrRenewWorkerLease('worker-instance-A', 60);
      expect(acquiredA).toBe(true);

      const acquiredBWhileActive = await env.services.gmailSync.acquireOrRenewWorkerLease('worker-instance-B', 60);
      expect(acquiredBWhileActive).toBe(false); // Blocked because worker-instance-A holds active lease!

      const renewedA = await env.services.gmailSync.acquireOrRenewWorkerLease('worker-instance-A', 60);
      expect(renewedA).toBe(true);

      // Simulate worker-instance-A crash / lease expiration -> worker-instance-B takes over cleanly
      await env.db.query("UPDATE worker_leases SET expires_at = NOW() - INTERVAL '5 seconds'");
      const takeoverB = await env.services.gmailSync.acquireOrRenewWorkerLease('worker-instance-B', 60);
      expect(takeoverB).toBe(true);

      // 2. Verify revoked OAuth token transitions connection status to `expired_or_revoked`
      const start = env.services.gmailSync.createGmailAuthorizationStart();
      const stateParam = new URL(start.authUrl).searchParams.get('state')!;
      await env.services.gmailSync.completeGmailOAuthCallback({
        actorEmail: 'tpo@college.edu',
        code: 'code-1',
        cookieState: start.stateCookieValue,
        queryState: stateParam,
      });

      await expect(env.services.gmailSync.pollNewMessages('tpo@college.edu')).rejects.toThrow(/revoked|expired/i);

      const health = await env.services.gmailSync.getMonitoringHealth();
      expect(health.connection?.status).toBe('expired_or_revoked');
      expect(health.connection?.last_error).toMatch(/revoked|expired/i);
    } finally {
      await env.cleanup();
    }
  });
});
