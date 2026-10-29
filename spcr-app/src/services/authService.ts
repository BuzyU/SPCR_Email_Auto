import { Database, QueryExecutor } from '../db/database.js';
import { AppConfig } from '../config/env.js';
import { constantTimeEqual, hmacSha256Hex, randomId, randomTokenHex, sha256Hex } from '../utils/crypto.js';
import { recordAuditEvent } from './auditService.js';

export interface AuthenticatedPrincipal {
  userId: string;
  email: string;
  displayName: string;
  sessionId?: string;
  extensionPairingId?: string;
  csrfToken: string;
  authSource: 'session_cookie' | 'extension_bearer';
  authMethod: 'google_oidc' | 'local_demo' | 'extension_paired';
}

export interface GoogleOidcTokenVerifier {
  exchangeCodeForIdentity(params: {
    code: string;
    redirectUri: string;
  }): Promise<{ sub: string; email: string; emailVerified: boolean; name?: string }>;
}

export class HttpGoogleOidcVerifier implements GoogleOidcTokenVerifier {
  constructor(private readonly config: AppConfig) {}

  async exchangeCodeForIdentity(params: {
    code: string;
    redirectUri: string;
  }): Promise<{ sub: string; email: string; emailVerified: boolean; name?: string }> {
    if (!this.config.googleClientId || !this.config.googleClientSecret) {
      throw new Error('Google OIDC client credentials are not configured.');
    }

    const tokenResp = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code: params.code,
        client_id: this.config.googleClientId,
        client_secret: this.config.googleClientSecret,
        redirect_uri: params.redirectUri,
        grant_type: 'authorization_code',
      }),
      signal: AbortSignal.timeout(10_000),
    });

    if (!tokenResp.ok) {
      throw new Error(`Google OIDC token exchange failed with HTTP ${tokenResp.status}`);
    }

    const tokenData = (await tokenResp.json()) as { access_token?: string; id_token?: string };
    if (!tokenData.access_token) {
      throw new Error('Google OIDC response missing access_token.');
    }

    // Verify identity via Google's official OpenID UserInfo endpoint over TLS
    const userInfoResp = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
      signal: AbortSignal.timeout(10_000),
    });

    if (!userInfoResp.ok) {
      throw new Error(`Google OIDC userinfo check failed with HTTP ${userInfoResp.status}`);
    }

    const profile = (await userInfoResp.json()) as {
      sub?: string;
      email?: string;
      email_verified?: boolean;
      name?: string;
    };

    if (!profile.sub || !profile.email) {
      throw new Error('Google OIDC userinfo missing sub or email.');
    }

    return {
      sub: profile.sub,
      email: profile.email.toLowerCase(),
      emailVerified: Boolean(profile.email_verified),
      name: profile.name,
    };
  }
}

const SESSION_DURATION_MS = 12 * 60 * 60 * 1000; // 12 hours

export class AuthService {
  private readonly oidcVerifier: GoogleOidcTokenVerifier;

  constructor(
    private readonly db: Database,
    private readonly config: AppConfig,
    oidcVerifier?: GoogleOidcTokenVerifier
  ) {
    this.oidcVerifier = oidcVerifier || new HttpGoogleOidcVerifier(config);
  }

  /**
   * Builds Google OpenID Connect login URL strictly for dashboard owner identity (`openid email profile`).
   * Does NOT request any Gmail mailbox scope — keeping dashboard auth separate from mailbox auth.
   */
  createGoogleOidcStart(): { authUrl: string; stateCookieValue: string; rawState: string } {
    if (!this.config.googleClientId || !this.config.googleClientSecret) {
      throw new Error('Google OAuth client is not configured yet.');
    }
    const nonce = randomTokenHex(24);
    const ts = Date.now().toString();
    const payload = `oidc.${ts}.${nonce}`;
    const sig = hmacSha256Hex(this.config.sessionSecret, payload);
    const signedState = `${payload}.${sig}`;

    const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    url.searchParams.set('client_id', this.config.googleClientId);
    url.searchParams.set('redirect_uri', this.config.googleOidcRedirectUri);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('scope', 'openid email profile');
    url.searchParams.set('access_type', 'online');
    url.searchParams.set('prompt', 'select_account');
    url.searchParams.set('state', signedState);

    return {
      authUrl: url.toString(),
      stateCookieValue: signedState,
      rawState: signedState,
    };
  }

  verifySignedOAuthState(expectedPrefix: 'oidc' | 'gmail', cookieState: string | undefined, queryState: string | undefined): void {
    if (!cookieState || !queryState || !constantTimeEqual(cookieState, queryState)) {
      throw new Error('OAuth state mismatch (potential CSRF).');
    }
    const parts = queryState.split('.');
    if (parts.length !== 4 || parts[0] !== expectedPrefix) {
      throw new Error('Malformed OAuth state token.');
    }
    const [prefix, tsStr, nonce, sig] = parts;
    const payload = `${prefix}.${tsStr}.${nonce}`;
    const expectedSig = hmacSha256Hex(this.config.sessionSecret, payload);
    if (!sig || !constantTimeEqual(sig, expectedSig)) {
      throw new Error('Invalid OAuth state signature.');
    }
    const ts = Number.parseInt(tsStr || '0', 10);
    if (!Number.isFinite(ts) || Math.abs(Date.now() - ts) > 15 * 60 * 1000) {
      throw new Error('Expired OAuth state token.');
    }
  }

  async completeGoogleOidcLogin(params: {
    code: string;
    cookieState?: string;
    queryState?: string;
    userAgent?: string;
    ipAddress?: string;
  }): Promise<{ rawSessionToken: string; csrfToken: string; email: string }> {
    this.verifySignedOAuthState('oidc', params.cookieState, params.queryState);

    const identity = await this.oidcVerifier.exchangeCodeForIdentity({
      code: params.code,
      redirectUri: this.config.googleOidcRedirectUri,
    });

    if (!identity.emailVerified) {
      await recordAuditEvent(this.db, {
        actorEmail: identity.email,
        eventType: 'auth_rejected_unverified_email',
        entityType: 'auth',
      });
      throw new ForbiddenOwnerError('Google account email is not verified.');
    }

    const normalizedEmail = identity.email.trim().toLowerCase();
    if (normalizedEmail !== this.config.ownerEmail.toLowerCase()) {
      await recordAuditEvent(this.db, {
        actorEmail: normalizedEmail,
        eventType: 'auth_rejected_non_owner',
        entityType: 'auth',
        metadata: { attemptedEmailDomain: normalizedEmail.split('@')[1] || 'unknown' },
      });
      throw new ForbiddenOwnerError(
        `Access denied: only the configured SPCR owner account (${this.config.ownerEmail}) may sign in.`
      );
    }

    return this.issueOwnerSession({
      email: normalizedEmail,
      displayName: identity.name || 'TPO Officer',
      oidcSub: identity.sub,
      authMethod: 'google_oidc',
      userAgent: params.userAgent,
      ipAddress: params.ipAddress,
    });
  }

  async loginLocalDemoOwner(params: {
    email?: string;
    userAgent?: string;
    ipAddress?: string;
  }): Promise<{ rawSessionToken: string; csrfToken: string; email: string }> {
    if (this.config.nodeEnv === 'production' || !this.config.demoAuthEnabled) {
      throw new ForbiddenOwnerError('Local demo login is disabled. Sign in with Google OpenID Connect.');
    }
    const requestedEmail = (params.email || this.config.ownerEmail).trim().toLowerCase();
    if (requestedEmail !== this.config.ownerEmail.toLowerCase()) {
      await recordAuditEvent(this.db, {
        actorEmail: requestedEmail,
        eventType: 'auth_rejected_non_owner_demo',
        entityType: 'auth',
      });
      throw new ForbiddenOwnerError(
        `Access denied: only the configured owner allowlist email (${this.config.ownerEmail}) is permitted.`
      );
    }

    return this.issueOwnerSession({
      email: requestedEmail,
      displayName: 'TPO Officer (Local Demo Mode)',
      oidcSub: null,
      authMethod: 'local_demo',
      userAgent: params.userAgent,
      ipAddress: params.ipAddress,
    });
  }

  private async issueOwnerSession(params: {
    email: string;
    displayName: string;
    oidcSub: string | null;
    authMethod: 'google_oidc' | 'local_demo';
    userAgent?: string;
    ipAddress?: string;
  }): Promise<{ rawSessionToken: string; csrfToken: string; email: string }> {
    return this.db.withTransaction(async (tx) => {
      const existingUser = await tx.query<{ id: string }>('SELECT id FROM users WHERE email = $1', [params.email]);
      let userId: string;
      if (existingUser.rows[0]) {
        userId = existingUser.rows[0].id;
        await tx.query(
          'UPDATE users SET display_name = $1, oidc_sub = COALESCE($2, oidc_sub), last_login_at = NOW() WHERE id = $3',
          [params.displayName, params.oidcSub, userId]
        );
      } else {
        userId = randomId('usr');
        await tx.query(
          'INSERT INTO users (id, email, display_name, oidc_sub, is_owner, last_login_at) VALUES ($1, $2, $3, $4, TRUE, NOW())',
          [userId, params.email, params.displayName, params.oidcSub]
        );
      }

      const rawSessionToken = randomTokenHex(32);
      const tokenHash = sha256Hex(rawSessionToken);
      const csrfToken = randomTokenHex(24);
      const sessionId = randomId('ses');
      const expiresAt = new Date(Date.now() + SESSION_DURATION_MS).toISOString();

      await tx.query(
        `INSERT INTO sessions (id, user_id, token_sha256, csrf_token, auth_method, user_agent, ip_address, expires_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          sessionId,
          userId,
          tokenHash,
          csrfToken,
          params.authMethod,
          (params.userAgent || '').slice(0, 250),
          (params.ipAddress || '').slice(0, 80),
          expiresAt,
        ]
      );

      await recordAuditEvent(tx, {
        actorEmail: params.email,
        eventType: 'dashboard_login_succeeded',
        entityType: 'session',
        entityId: sessionId,
        metadata: { authMethod: params.authMethod },
      });

      return { rawSessionToken, csrfToken, email: params.email };
    });
  }

  async authenticateSessionToken(rawToken: string): Promise<AuthenticatedPrincipal | null> {
    if (!rawToken || rawToken.length < 32) return null;
    const tokenHash = sha256Hex(rawToken);
    const res = await this.db.query<{
      session_id: string;
      user_id: string;
      email: string;
      display_name: string | null;
      csrf_token: string;
      auth_method: 'google_oidc' | 'local_demo';
      expires_at: string;
      revoked_at: string | null;
    }>(
      `SELECT s.id AS session_id, s.user_id, u.email, u.display_name, s.csrf_token, s.auth_method, s.expires_at, s.revoked_at
       FROM sessions s
       JOIN users u ON u.id = s.user_id
       WHERE s.token_sha256 = $1`,
      [tokenHash]
    );

    const row = res.rows[0];
    if (!row || row.revoked_at) return null;
    if (new Date(row.expires_at).getTime() <= Date.now()) return null;
    // Re-enforce server-side single-owner allowlist on every single request!
    if (row.email.toLowerCase() !== this.config.ownerEmail.toLowerCase()) return null;

    return {
      userId: row.user_id,
      email: row.email,
      displayName: row.display_name || 'TPO Officer',
      sessionId: row.session_id,
      csrfToken: row.csrf_token,
      authSource: 'session_cookie',
      authMethod: row.auth_method,
    };
  }

  async authenticateExtensionToken(rawToken: string): Promise<AuthenticatedPrincipal | null> {
    if (!rawToken || rawToken.length < 32) return null;
    const tokenHash = sha256Hex(rawToken);
    const res = await this.db.query<{
      pairing_id: string;
      user_id: string;
      email: string;
      display_name: string | null;
      csrf_token: string;
      revoked_at: string | null;
    }>(
      `SELECT p.id AS pairing_id, p.user_id, u.email, u.display_name, p.csrf_token, p.revoked_at
       FROM extension_pairings p
       JOIN users u ON u.id = p.user_id
       WHERE p.extension_token_sha256 = $1`,
      [tokenHash]
    );
    const row = res.rows[0];
    if (!row || row.revoked_at) return null;
    if (row.email.toLowerCase() !== this.config.ownerEmail.toLowerCase()) return null;

    await this.db.query('UPDATE extension_pairings SET last_used_at = NOW() WHERE id = $1', [row.pairing_id]);

    return {
      userId: row.user_id,
      email: row.email,
      displayName: row.display_name || 'TPO Officer',
      extensionPairingId: row.pairing_id,
      csrfToken: row.csrf_token,
      authSource: 'extension_bearer',
      authMethod: 'extension_paired',
    };
  }

  async revokeSession(sessionId: string, actorEmail: string): Promise<void> {
    await this.db.query('UPDATE sessions SET revoked_at = NOW() WHERE id = $1', [sessionId]);
    await recordAuditEvent(this.db, {
      actorEmail,
      eventType: 'session_revoked',
      entityType: 'session',
      entityId: sessionId,
    });
  }

  async revokeAllUserSessions(userId: string, actorEmail: string): Promise<void> {
    await this.db.query('UPDATE sessions SET revoked_at = NOW() WHERE user_id = $1 AND revoked_at IS NULL', [userId]);
    await recordAuditEvent(this.db, {
      actorEmail,
      eventType: 'all_sessions_revoked',
      entityType: 'user',
      entityId: userId,
    });
  }

  async createExtensionPairingCode(principal: AuthenticatedPrincipal, label = 'Chrome/Edge Extension'): Promise<{
    pairingId: string;
    pairingCode: string;
    expiresAt: string;
  }> {
    const pairingId = randomId('extp');
    const pairingCode = randomTokenHex(6).toUpperCase(); // 12 hex chars, one-time use
    const codeHash = sha256Hex(pairingCode);
    const csrfToken = randomTokenHex(24);
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();

    await this.db.query(
      `INSERT INTO extension_pairings (id, user_id, pairing_code_sha256, pairing_expires_at, csrf_token, label)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [pairingId, principal.userId, codeHash, expiresAt, csrfToken, label.slice(0, 80)]
    );

    await recordAuditEvent(this.db, {
      actorEmail: principal.email,
      eventType: 'extension_pairing_code_created',
      entityType: 'extension_pairing',
      entityId: pairingId,
    });

    return { pairingId, pairingCode, expiresAt };
  }

  async claimExtensionPairingCode(params: {
    pairingCode: string;
    origin?: string;
  }): Promise<{ extensionToken: string; csrfToken: string; pairingId: string; ownerEmail: string }> {
    const normalizedCode = params.pairingCode.trim().toUpperCase();
    const codeHash = sha256Hex(normalizedCode);

    return this.db.withTransaction(async (tx) => {
      const res = await tx.query<{
        id: string;
        user_id: string;
        pairing_expires_at: string;
        claimed_at: string | null;
        revoked_at: string | null;
        csrf_token: string;
      }>(
        `SELECT id, user_id, pairing_expires_at, claimed_at, revoked_at, csrf_token
         FROM extension_pairings
         WHERE pairing_code_sha256 = $1
         FOR UPDATE`,
        [codeHash]
      );

      const row = res.rows[0];
      if (!row || row.revoked_at || row.claimed_at) {
        throw new Error('Invalid or already-used extension pairing code.');
      }
      if (new Date(row.pairing_expires_at).getTime() <= Date.now()) {
        throw new Error('Extension pairing code has expired. Generate a new code in the SPCR Dashboard.');
      }

      const userRes = await tx.query<{ email: string }>('SELECT email FROM users WHERE id = $1', [row.user_id]);
      const ownerEmail = userRes.rows[0]?.email || '';
      if (ownerEmail.toLowerCase() !== this.config.ownerEmail.toLowerCase()) {
        throw new ForbiddenOwnerError('Pairing owner mismatch.');
      }

      const rawExtensionToken = randomTokenHex(32);
      const extTokenHash = sha256Hex(rawExtensionToken);

      await tx.query(
        `UPDATE extension_pairings
         SET pairing_code_sha256 = NULL,
             extension_token_sha256 = $1,
             claimed_at = NOW(),
             last_used_at = NOW(),
             origin = $2
         WHERE id = $3`,
        [extTokenHash, (params.origin || '').slice(0, 120), row.id]
      );

      await recordAuditEvent(tx, {
        actorEmail: ownerEmail,
        eventType: 'extension_paired',
        entityType: 'extension_pairing',
        entityId: row.id,
        metadata: { origin: params.origin || 'none' },
      });

      return {
        extensionToken: rawExtensionToken,
        csrfToken: row.csrf_token,
        pairingId: row.id,
        ownerEmail,
      };
    });
  }

  async listExtensionPairings(db: QueryExecutor = this.db) {
    const res = await db.query<{
      id: string;
      label: string;
      origin: string | null;
      created_at: string;
      claimed_at: string | null;
      last_used_at: string | null;
      revoked_at: string | null;
    }>(
      `SELECT id, label, origin, created_at, claimed_at, last_used_at, revoked_at
       FROM extension_pairings
       ORDER BY created_at DESC`
    );
    return res.rows;
  }

  async revokeExtensionPairing(pairingId: string, actorEmail: string): Promise<void> {
    await this.db.query('UPDATE extension_pairings SET revoked_at = NOW() WHERE id = $1', [pairingId]);
    await recordAuditEvent(this.db, {
      actorEmail,
      eventType: 'extension_pairing_revoked',
      entityType: 'extension_pairing',
      entityId: pairingId,
    });
  }
}

export class ForbiddenOwnerError extends Error {
  public readonly statusCode = 403;
  constructor(message: string) {
    super(message);
    this.name = 'ForbiddenOwnerError';
  }
}

