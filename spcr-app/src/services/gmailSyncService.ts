import { Database, QueryExecutor } from '../db/database.js';
import { AppConfig } from '../config/env.js';
import {
  decryptSecretString,
  encryptSecretString,
  hmacSha256Hex,
  randomId,
  randomTokenHex,
} from '../utils/crypto.js';
import { AuthService } from './authService.js';
import { IncomingAttachmentPayload, IncomingEmailMessage, ScreeningAndMatchingService } from './screeningAndMatchingService.js';
import { recordAuditEvent } from './auditService.js';

export const REQUIRED_GMAIL_READONLY_SCOPE = 'https://www.googleapis.com/auth/gmail.readonly';

export interface GmailRawApiMessage {
  id: string;
  threadId?: string;
  snippet?: string;
  internalDate?: string;
  payload?: {
    mimeType?: string;
    headers?: Array<{ name: string; value: string }>;
    body?: { data?: string; attachmentId?: string; size?: number };
    parts?: GmailMessagePart[];
  };
}

export interface GmailMessagePart {
  partId?: string;
  mimeType?: string;
  filename?: string;
  headers?: Array<{ name: string; value: string }>;
  body?: { data?: string; attachmentId?: string; size?: number };
  parts?: GmailMessagePart[];
}

export interface GmailApiClient {
  exchangeAuthCode(code: string, redirectUri: string): Promise<{
    accessToken: string;
    refreshToken?: string;
    expiresInSeconds: number;
    scope: string;
  }>;
  refreshAccessToken(refreshToken: string): Promise<{
    accessToken: string;
    expiresInSeconds: number;
  }>;
  revokeToken(token: string): Promise<void>;
  getProfile(accessToken: string): Promise<{ emailAddress: string; historyId: string }>;
  listHistory(
    accessToken: string,
    params: { startHistoryId: string; pageToken?: string }
  ): Promise<{ messageIds: string[]; nextPageToken?: string; latestHistoryId?: string }>;
  listMessages(
    accessToken: string,
    params: { maxResults: number; pageToken?: string }
  ): Promise<{ messageIds: string[]; nextPageToken?: string }>;
  getMessage(accessToken: string, messageId: string): Promise<GmailRawApiMessage>;
  getAttachmentBytes(accessToken: string, messageId: string, attachmentId: string): Promise<Buffer>;
}

export class GmailHttpApiError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
    public readonly errorCode?: string
  ) {
    super(message);
    this.name = 'GmailHttpApiError';
  }
}

function decodeBase64Url(input: string): Buffer {
  const b64 = input.replace(/-/g, '+').replace(/_/g, '/');
  return Buffer.from(b64, 'base64');
}

function stripHtmlTagsToPlainText(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export class HttpGmailApiClient implements GmailApiClient {
  constructor(private readonly config: AppConfig) {}

  async exchangeAuthCode(code: string, redirectUri: string) {
    const resp = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: this.config.googleClientId,
        client_secret: this.config.googleClientSecret,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
      }),
      signal: AbortSignal.timeout(12_000),
    });
    const body = (await resp.json().catch(() => ({}))) as any;
    if (!resp.ok) {
      throw new GmailHttpApiError(
        `OAuth code exchange failed (HTTP ${resp.status})`,
        resp.status,
        body?.error
      );
    }
    return {
      accessToken: body.access_token as string,
      refreshToken: body.refresh_token as string | undefined,
      expiresInSeconds: Number(body.expires_in || 3600),
      scope: String(body.scope || ''),
    };
  }

  async refreshAccessToken(refreshToken: string) {
    const resp = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        refresh_token: refreshToken,
        client_id: this.config.googleClientId,
        client_secret: this.config.googleClientSecret,
        grant_type: 'refresh_token',
      }),
      signal: AbortSignal.timeout(12_000),
    });
    const body = (await resp.json().catch(() => ({}))) as any;
    if (!resp.ok) {
      throw new GmailHttpApiError(
        `Token refresh failed (HTTP ${resp.status}: ${body?.error || 'unknown'})`,
        resp.status,
        body?.error
      );
    }
    return {
      accessToken: body.access_token as string,
      expiresInSeconds: Number(body.expires_in || 3600),
    };
  }

  async revokeToken(token: string): Promise<void> {
    await fetch('https://oauth2.googleapis.com/revoke', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ token }),
      signal: AbortSignal.timeout(8_000),
    }).catch(() => undefined);
  }

  private async gmailGetJson(accessToken: string, url: string): Promise<any> {
    const resp = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(15_000),
    });
    const body = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      throw new GmailHttpApiError(
        `Gmail API HTTP ${resp.status}`,
        resp.status,
        body?.error?.status || body?.error
      );
    }
    return body;
  }

  async getProfile(accessToken: string) {
    const data = await this.gmailGetJson(accessToken, 'https://gmail.googleapis.com/gmail/v1/users/me/profile');
    return {
      emailAddress: String(data.emailAddress),
      historyId: String(data.historyId),
    };
  }

  async listHistory(accessToken: string, params: { startHistoryId: string; pageToken?: string }) {
    const url = new URL('https://gmail.googleapis.com/gmail/v1/users/me/history');
    url.searchParams.set('startHistoryId', params.startHistoryId);
    url.searchParams.set('historyTypes', 'messageAdded');
    if (params.pageToken) url.searchParams.set('pageToken', params.pageToken);

    const data = await this.gmailGetJson(accessToken, url.toString());
    const ids = new Set<string>();
    for (const h of data.history || []) {
      for (const added of h.messagesAdded || []) {
        if (added?.message?.id) ids.add(String(added.message.id));
      }
      for (const m of h.messages || []) {
        if (m?.id) ids.add(String(m.id));
      }
    }
    return {
      messageIds: Array.from(ids),
      nextPageToken: data.nextPageToken ? String(data.nextPageToken) : undefined,
      latestHistoryId: data.historyId ? String(data.historyId) : undefined,
    };
  }

  async listMessages(accessToken: string, params: { maxResults: number; pageToken?: string }) {
    const url = new URL('https://gmail.googleapis.com/gmail/v1/users/me/messages');
    url.searchParams.set('maxResults', String(params.maxResults));
    if (params.pageToken) url.searchParams.set('pageToken', params.pageToken);
    const data = await this.gmailGetJson(accessToken, url.toString());
    return {
      messageIds: (data.messages || []).map((m: any) => String(m.id)),
      nextPageToken: data.nextPageToken ? String(data.nextPageToken) : undefined,
    };
  }

  async getMessage(accessToken: string, messageId: string): Promise<GmailRawApiMessage> {
    return this.gmailGetJson(
      accessToken,
      `https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(messageId)}?format=full`
    );
  }

  async getAttachmentBytes(accessToken: string, messageId: string, attachmentId: string): Promise<Buffer> {
    const data = await this.gmailGetJson(
      accessToken,
      `https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(attachmentId)}`
    );
    return decodeBase64Url(String(data.data || ''));
  }
}

/**
 * Abstraction for Gmail change detection (supports polling now; allows Pub/Sub push adapter in future).
 */
export interface ChangeSource {
  readonly sourceName: string;
  pollNewMessages(actorEmail?: string): Promise<{
    polledCount: number;
    historyRecoveredFrom404: boolean;
    results: Array<{ gmailMessageId: string; classification: string; opportunityId: string | null }>;
  }>;
}

export class GmailSyncService implements ChangeSource {
  public readonly sourceName = 'gmail_history_polling';
  private readonly apiClient: GmailApiClient;

  constructor(
    private readonly db: Database,
    private readonly config: AppConfig,
    private readonly authService: AuthService,
    private readonly screener: ScreeningAndMatchingService,
    apiClient?: GmailApiClient
  ) {
    this.apiClient = apiClient || new HttpGmailApiClient(config);
  }

  createGmailAuthorizationStart(): { authUrl: string; stateCookieValue: string } {
    if (!this.config.gmailPolicyGateApproved) {
      throw new Error(
        'GMAIL_POLICY_GATE_BLOCKED: Live Gmail mailbox connection is disabled until Google restricted-scope (gmail.readonly) verification / CASA policy requirements are confirmed for this hosted deployment.'
      );
    }
    if (!this.config.googleClientId || !this.config.googleClientSecret) {
      throw new Error('Google OAuth client credentials (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET) are not configured.');
    }

    const nonce = randomTokenHex(24);
    const ts = Date.now().toString();
    const payload = `gmail.${ts}.${nonce}`;
    const sig = hmacSha256Hex(this.config.sessionSecret, payload);
    const signedState = `${payload}.${sig}`;

    const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    url.searchParams.set('client_id', this.config.googleClientId);
    url.searchParams.set('redirect_uri', this.config.googleGmailRedirectUri);
    url.searchParams.set('response_type', 'code');
    // Request strictly gmail.readonly — NEVER modify/send/mail.google.com
    url.searchParams.set('scope', REQUIRED_GMAIL_READONLY_SCOPE);
    url.searchParams.set('access_type', 'offline');
    url.searchParams.set('prompt', 'consent');
    url.searchParams.set('state', signedState);

    return { authUrl: url.toString(), stateCookieValue: signedState };
  }

  async completeGmailOAuthCallback(params: {
    actorEmail: string;
    code: string;
    cookieState?: string;
    queryState?: string;
  }) {
    if (!this.config.gmailPolicyGateApproved) {
      throw new Error('GMAIL_POLICY_GATE_BLOCKED: Live Gmail mailbox connection is blocked by policy gate.');
    }
    this.authService.verifySignedOAuthState('gmail', params.cookieState, params.queryState);

    const tokenSet = await this.apiClient.exchangeAuthCode(params.code, this.config.googleGmailRedirectUri);
    const profile = await this.apiClient.getProfile(tokenSet.accessToken);

    const encAccess = encryptSecretString(tokenSet.accessToken, this.config.tokenEncryptionKeyHex);
    const encRefresh = tokenSet.refreshToken
      ? encryptSecretString(tokenSet.refreshToken, this.config.tokenEncryptionKeyHex)
      : null;
    const expiryIso = new Date(Date.now() + tokenSet.expiresInSeconds * 1000).toISOString();

    await this.db.withTransaction(async (tx) => {
      await tx.query(
        `INSERT INTO gmail_connections (
          id, mailbox_email, encrypted_access_token, encrypted_refresh_token,
          token_expiry_at, granted_scopes, status, last_history_id, last_error, connected_at, disconnected_at
        ) VALUES ($1, $2, $3, $4, $5, $6, 'connected', $7, NULL, NOW(), NULL)
        ON CONFLICT (mailbox_email) DO UPDATE
        SET encrypted_access_token = EXCLUDED.encrypted_access_token,
            encrypted_refresh_token = COALESCE(EXCLUDED.encrypted_refresh_token, gmail_connections.encrypted_refresh_token),
            token_expiry_at = EXCLUDED.token_expiry_at,
            granted_scopes = EXCLUDED.granted_scopes,
            status = 'connected',
            last_history_id = COALESCE(gmail_connections.last_history_id, EXCLUDED.last_history_id),
            last_error = NULL,
            disconnected_at = NULL`,
        [
          randomId('gmc'),
          profile.emailAddress.toLowerCase(),
          encAccess,
          encRefresh,
          expiryIso,
          tokenSet.scope || REQUIRED_GMAIL_READONLY_SCOPE,
          profile.historyId,
        ]
      );

      await recordAuditEvent(tx, {
        actorEmail: params.actorEmail,
        eventType: 'gmail_mailbox_connected',
        entityType: 'gmail_connection',
        entityId: profile.emailAddress.toLowerCase(),
        metadata: { grantedScopes: tokenSet.scope || REQUIRED_GMAIL_READONLY_SCOPE },
      });
    });

    return { mailboxEmail: profile.emailAddress.toLowerCase(), initialHistoryId: profile.historyId };
  }

  async disconnectMailbox(actorEmail: string): Promise<void> {
    const connRes = await this.db.query<any>(
      `SELECT * FROM gmail_connections WHERE status IN ('connected', 'expired_or_revoked') LIMIT 1`
    );
    const conn = connRes.rows[0];
    if (conn) {
      try {
        const token = conn.encrypted_refresh_token
          ? decryptSecretString(conn.encrypted_refresh_token, this.config.tokenEncryptionKeyHex)
          : decryptSecretString(conn.encrypted_access_token, this.config.tokenEncryptionKeyHex);
        await this.apiClient.revokeToken(token);
      } catch {
        // Proceed with local wipe even if network revocation errors
      }
      await this.db.query(
        `UPDATE gmail_connections
         SET encrypted_access_token = 'REVOKED',
             encrypted_refresh_token = NULL,
             status = 'disconnected',
             disconnected_at = NOW(),
             last_error = NULL
         WHERE id = $1`,
        [conn.id]
      );
      await recordAuditEvent(this.db, {
        actorEmail,
        eventType: 'gmail_mailbox_disconnected',
        entityType: 'gmail_connection',
        entityId: conn.mailbox_email,
      });
    }
  }

  private async getValidAccessToken(conn: any): Promise<string> {
    const expiryMs = conn.token_expiry_at ? new Date(conn.token_expiry_at).getTime() : 0;
    if (expiryMs > Date.now() + 60_000) {
      return decryptSecretString(conn.encrypted_access_token, this.config.tokenEncryptionKeyHex);
    }

    if (!conn.encrypted_refresh_token) {
      await this.markAuthExpired(conn.id, 'Access token expired and no refresh token is stored; re-authorize Gmail.');
      throw new Error('GMAIL_AUTH_EXPIRED');
    }

    const refreshToken = decryptSecretString(conn.encrypted_refresh_token, this.config.tokenEncryptionKeyHex);
    try {
      const refreshed = await this.apiClient.refreshAccessToken(refreshToken);
      const encAccess = encryptSecretString(refreshed.accessToken, this.config.tokenEncryptionKeyHex);
      const nextExpiry = new Date(Date.now() + refreshed.expiresInSeconds * 1000).toISOString();
      await this.db.query(
        `UPDATE gmail_connections SET encrypted_access_token = $1, token_expiry_at = $2, status = 'connected', last_error = NULL WHERE id = $3`,
        [encAccess, nextExpiry, conn.id]
      );
      return refreshed.accessToken;
    } catch (err: any) {
      if (err instanceof GmailHttpApiError && (err.statusCode === 400 || err.statusCode === 401 || err.errorCode === 'invalid_grant')) {
        await this.markAuthExpired(conn.id, `OAuth refresh token expired or revoked (${err.errorCode || err.statusCode}). Re-authorize Gmail.`);
        throw new Error('GMAIL_AUTH_EXPIRED');
      }
      throw err;
    }
  }

  private async markAuthExpired(connId: string, reason: string): Promise<void> {
    await this.db.query(
      `UPDATE gmail_connections SET status = 'expired_or_revoked', last_error = $1, last_poll_at = NOW() WHERE id = $2`,
      [reason, connId]
    );
    await recordAuditEvent(this.db, {
      actorEmail: 'system',
      eventType: 'gmail_auth_expired_or_revoked',
      entityType: 'gmail_connection',
      entityId: connId,
      metadata: { reason },
    });
  }

  private async callWithQuotaBackoff<T>(fn: () => Promise<T>, maxRetries = 2): Promise<T> {
    let attempt = 0;
    while (true) {
      try {
        return await fn();
      } catch (err: any) {
        const isTransientOrQuota =
          err instanceof GmailHttpApiError && (err.statusCode === 429 || err.statusCode === 500 || err.statusCode === 503);
        if (!isTransientOrQuota || attempt >= maxRetries) {
          throw err;
        }
        attempt++;
        const delayMs = 80 * Math.pow(2, attempt);
        await new Promise((r) => setTimeout(r, delayMs));
      }
    }
  }

  private async convertRawGmailMessage(accessToken: string, raw: GmailRawApiMessage): Promise<IncomingEmailMessage> {
    const headers = raw.payload?.headers || [];
    const getHeader = (name: string) =>
      headers.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value || null;

    let plainBody = '';
    let htmlBody = '';
    const attachmentParts: Array<{ filename: string; mimeType?: string; data?: string; attachmentId?: string }> = [];

    const walkPart = (part?: GmailMessagePart) => {
      if (!part) return;
      if (part.filename && part.filename.trim()) {
        attachmentParts.push({
          filename: part.filename.trim(),
          mimeType: part.mimeType,
          data: part.body?.data,
          attachmentId: part.body?.attachmentId,
        });
      } else if (part.mimeType === 'text/plain' && part.body?.data) {
        plainBody += decodeBase64Url(part.body.data).toString('utf8') + '\n';
      } else if (part.mimeType === 'text/html' && part.body?.data) {
        htmlBody += decodeBase64Url(part.body.data).toString('utf8') + '\n';
      }
      for (const child of part.parts || []) {
        walkPart(child);
      }
    };

    if (raw.payload?.body?.data && (!raw.payload.parts || raw.payload.parts.length === 0)) {
      const decoded = decodeBase64Url(raw.payload.body.data).toString('utf8');
      if (raw.payload.mimeType === 'text/html') htmlBody = decoded;
      else plainBody = decoded;
    } else {
      for (const p of raw.payload?.parts || []) {
        walkPart(p);
      }
    }

    const bodyText = plainBody.trim() || (htmlBody ? stripHtmlTagsToPlainText(htmlBody) : raw.snippet || '');
    const attachments: IncomingAttachmentPayload[] = [];
    for (const ap of attachmentParts) {
      let buf: Buffer | null = null;
      if (ap.data) {
        buf = decodeBase64Url(ap.data);
      } else if (ap.attachmentId) {
        buf = await this.callWithQuotaBackoff(() =>
          this.apiClient.getAttachmentBytes(accessToken, raw.id, ap.attachmentId!)
        );
      }
      if (buf) {
        attachments.push({
          filename: ap.filename,
          declaredMime: ap.mimeType || null,
          buffer: buf,
        });
      }
    }

    const receivedAt = raw.internalDate
      ? new Date(Number(raw.internalDate)).toISOString()
      : getHeader('Date')
        ? new Date(getHeader('Date')!).toISOString()
        : new Date().toISOString();

    return {
      gmailMessageId: raw.id,
      gmailThreadId: raw.threadId || null,
      rfcMessageId: getHeader('Message-ID'),
      inReplyTo: getHeader('In-Reply-To'),
      referencesHeader: getHeader('References'),
      fromRaw: getHeader('From') || 'unknown@unknown',
      replyToRaw: getHeader('Reply-To'),
      authHeadersRaw: getHeader('Authentication-Results') || getHeader('ARC-Authentication-Results'),
      subject: getHeader('Subject') || '(No Subject)',
      receivedAt,
      snippet: raw.snippet || null,
      bodyText,
      attachments,
      sourceOrigin: 'gmail_api',
    };
  }

  /**
   * Acquires or renews a DB-backed distributed worker lease so two workers never process the mailbox concurrently.
   */
  async acquireOrRenewWorkerLease(holderId: string, ttlSeconds = 60, statusMeta: Record<string, unknown> = {}): Promise<boolean> {
    const expiresAt = new Date(Date.now() + ttlSeconds * 1000).toISOString();
    const res = await this.db.query<{ holder_id: string }>(
      `INSERT INTO worker_leases (lease_key, holder_id, acquired_at, heartbeat_at, expires_at, last_status_json)
       VALUES ('gmail_monitor', $1, NOW(), NOW(), $2, $3::jsonb)
       ON CONFLICT (lease_key) DO UPDATE
       SET holder_id = EXCLUDED.holder_id,
           heartbeat_at = NOW(),
           expires_at = EXCLUDED.expires_at,
           last_status_json = EXCLUDED.last_status_json
       WHERE worker_leases.expires_at < NOW() OR worker_leases.holder_id = $1
       RETURNING holder_id`,
      [holderId, expiresAt, JSON.stringify(statusMeta)]
    );
    return res.rows.length > 0;
  }

  async pollNewMessages(actorEmail = 'worker'): Promise<{
    polledCount: number;
    historyRecoveredFrom404: boolean;
    results: Array<{ gmailMessageId: string; classification: string; opportunityId: string | null }>;
  }> {
    if (!this.config.gmailPolicyGateApproved) {
      throw new Error('GMAIL_POLICY_GATE_BLOCKED: Live Gmail polling is disabled until policy gate approval.');
    }

    const connRes = await this.db.query<any>(
      `SELECT * FROM gmail_connections WHERE status = 'connected' ORDER BY connected_at DESC LIMIT 1`
    );
    const conn = connRes.rows[0];
    if (!conn) {
      return { polledCount: 0, historyRecoveredFrom404: false, results: [] };
    }

    await this.db.query('UPDATE gmail_connections SET last_poll_at = NOW() WHERE id = $1', [conn.id]);

    let accessToken: string;
    try {
      accessToken = await this.getValidAccessToken(conn);
    } catch (err: any) {
      throw err;
    }

    let historyRecoveredFrom404 = false;
    let nextHistoryId: string | null = conn.last_history_id;
    const messageIdsToFetch: string[] = [];

    try {
      if (!conn.last_history_id) {
        // Startup catch-up when no cursor is persisted yet
        const profile = await this.callWithQuotaBackoff(() => this.apiClient.getProfile(accessToken));
        nextHistoryId = profile.historyId;
        let pageToken: string | undefined;
        do {
          const page = await this.callWithQuotaBackoff(() =>
            this.apiClient.listMessages(accessToken, { maxResults: 25, pageToken })
          );
          messageIdsToFetch.push(...page.messageIds);
          pageToken = page.nextPageToken;
        } while (pageToken && messageIdsToFetch.length < 50);
      } else {
        try {
          let pageToken: string | undefined;
          do {
            const hist = await this.callWithQuotaBackoff(() =>
              this.apiClient.listHistory(accessToken, {
                startHistoryId: conn.last_history_id,
                pageToken,
              })
            );
            messageIdsToFetch.push(...hist.messageIds);
            if (hist.latestHistoryId) nextHistoryId = hist.latestHistoryId;
            pageToken = hist.nextPageToken;
          } while (pageToken);
        } catch (histErr: any) {
          if (histErr instanceof GmailHttpApiError && histErr.statusCode === 404) {
            // Official Google recovery for expired historyId (404): fresh getProfile + bounded resync!
            historyRecoveredFrom404 = true;
            const profile = await this.callWithQuotaBackoff(() => this.apiClient.getProfile(accessToken));
            nextHistoryId = profile.historyId;
            let pageToken: string | undefined;
            do {
              const page = await this.callWithQuotaBackoff(() =>
                this.apiClient.listMessages(accessToken, { maxResults: 25, pageToken })
              );
              messageIdsToFetch.push(...page.messageIds);
              pageToken = page.nextPageToken;
            } while (pageToken && messageIdsToFetch.length < 50);
          } else {
            throw histErr;
          }
        }
      }

      const uniqueIds = Array.from(new Set(messageIdsToFetch));
      const results: Array<{ gmailMessageId: string; classification: string; opportunityId: string | null }> = [];

      for (const msgId of uniqueIds) {
        // Skip API download if message ID was already processed idempotently
        const already = await this.db.query<{ id: string }>(
          'SELECT id FROM source_messages WHERE gmail_message_id = $1',
          [msgId]
        );
        if (already.rows[0]) continue;

        const rawMsg = await this.callWithQuotaBackoff(() => this.apiClient.getMessage(accessToken, msgId));
        const normalized = await this.convertRawGmailMessage(accessToken, rawMsg);
        const scanOut = await this.screener.scanEmailMessage(normalized, 'auto_monitor', actorEmail);
        results.push({
          gmailMessageId: msgId,
          classification: scanOut.classification,
          opportunityId: scanOut.opportunityId,
        });
      }

      await this.db.query(
        `UPDATE gmail_connections
         SET last_history_id = $1, last_success_at = NOW(), last_error = NULL
         WHERE id = $2`,
        [nextHistoryId, conn.id]
      );

      return {
        polledCount: results.length,
        historyRecoveredFrom404,
        results,
      };
    } catch (err: any) {
      if (err instanceof GmailHttpApiError && err.statusCode === 401) {
        await this.markAuthExpired(conn.id, 'Gmail API returned 401 Unauthorized; token revoked or expired.');
      } else {
        await this.db.query('UPDATE gmail_connections SET last_error = $1 WHERE id = $2', [
          String(err?.message || 'Poll failed').slice(0, 300),
          conn.id,
        ]);
      }
      throw err;
    }
  }

  /**
   * Manual Scan action triggered from Gmail Extension or Dashboard for a specific Gmail message ID.
   * Runs the exact same non-Groq screening pipeline!
   */
  async manualScanGmailMessageById(gmailMessageId: string, actorEmail: string) {
    // Check if synthetic message already exists locally first
    const localExisting = await this.db.query<{ id: string }>(
      'SELECT id FROM source_messages WHERE gmail_message_id = $1',
      [gmailMessageId]
    );
    if (localExisting.rows[0]) {
      const outRes = await this.db.query<any>(
        'SELECT * FROM screening_outcomes WHERE source_message_id = $1',
        [localExisting.rows[0].id]
      );
      const linkRes = await this.db.query<any>(
        `SELECT opportunity_id, link_state FROM opportunity_message_links WHERE source_message_id = $1 LIMIT 1`,
        [localExisting.rows[0].id]
      );
      const out = outRes.rows[0];
      return {
        alreadyProcessed: true,
        sourceMessageId: localExisting.rows[0].id,
        gmailMessageId,
        classification: out.classification,
        confidence: Number(out.confidence),
        margin: Number(out.margin),
        authenticityLabel: out.authenticity_label,
        transportAuthStatus: out.transport_auth_status,
        riskFlags: out.risk_flags_json || [],
        groqCallsMade: 0 as const,
        statusBanner: 'Scanned — no Groq request made' as const,
        opportunityId: linkRes.rows[0]?.opportunity_id || null,
        linkState: linkRes.rows[0]?.link_state || null,
      };
    }

    if (!this.config.gmailPolicyGateApproved) {
      throw new Error(
        'GMAIL_POLICY_GATE_BLOCKED: Live Gmail message fetch is disabled until Google restricted-scope policy gate is approved. Use synthetic fixture messages in Demo Mode.'
      );
    }

    const connRes = await this.db.query<any>(
      `SELECT * FROM gmail_connections WHERE status = 'connected' ORDER BY connected_at DESC LIMIT 1`
    );
    const conn = connRes.rows[0];
    if (!conn) {
      throw new Error('No active Gmail mailbox connection is configured.');
    }

    const accessToken = await this.getValidAccessToken(conn);
    const rawMsg = await this.callWithQuotaBackoff(() => this.apiClient.getMessage(accessToken, gmailMessageId));
    const normalized = await this.convertRawGmailMessage(accessToken, rawMsg);
    return this.screener.scanEmailMessage(normalized, 'manual_scan', actorEmail);
  }

  async getMonitoringHealth(q: QueryExecutor = this.db) {
    const connRes = await q.query<any>(
      'SELECT id, mailbox_email, granted_scopes, status, last_history_id, last_poll_at, last_success_at, last_error, connected_at, disconnected_at FROM gmail_connections ORDER BY connected_at DESC LIMIT 1'
    );
    const leaseRes = await q.query<any>(
      `SELECT lease_key, holder_id, acquired_at, heartbeat_at, expires_at, last_status_json
       FROM worker_leases WHERE lease_key = 'gmail_monitor'`
    );
    const queueCountRes = await q.query<{ cnt: string }>(
      `SELECT COUNT(*)::text AS cnt FROM opportunities WHERE status IN ('needs_review', 'ready_for_draft', 'draft_in_review')`
    );

    const lease = leaseRes.rows[0] || null;
    const workerActive = Boolean(lease && new Date(lease.expires_at).getTime() > Date.now());

    return {
      policyGateApproved: this.config.gmailPolicyGateApproved,
      policyGateExplanation: this.config.gmailPolicyGateApproved
        ? 'Approved by owner configuration'
        : 'Live Gmail access blocked until Google restricted-scope (gmail.readonly) verification / CASA compliance is confirmed.',
      connection: connRes.rows[0] || null,
      workerActive,
      workerLease: lease,
      queuedCandidatesCount: Number.parseInt(queueCountRes.rows[0]?.cnt || '0', 10),
    };
  }
}

