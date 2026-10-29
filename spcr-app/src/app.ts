import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import express, { Request, Response, NextFunction } from 'express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { z } from 'zod';
import { AppConfig } from './config/env.js';
import { Database } from './db/database.js';
import { constantTimeEqual, randomId } from './utils/crypto.js';
import { logger } from './utils/logger.js';
import { AuthService, AuthenticatedPrincipal, ForbiddenOwnerError, GoogleOidcTokenVerifier } from './services/authService.js';
import { getSettings, updateSettings } from './services/settingsService.js';
import { RoutingAndDispatchService } from './services/routingAndDispatchService.js';
import { LocalOnnxRecruitmentClassifier, PINNED_CLASSIFIER_SPEC } from './services/localClassifier.js';
import { AttachmentExtractor, SharedAttachmentStorageService } from './services/attachmentService.js';
import { ScreeningAndMatchingService } from './services/screeningAndMatchingService.js';
import { GmailApiClient, GmailQuotaSafetyStopError, GmailSyncService } from './services/gmailSyncService.js';
import { GroqAdapterError, GroqDraftingService, GroqTransport } from './services/groqDraftingService.js';
import { RetentionAndPrivacyService } from './services/retentionAndPrivacyService.js';
import { EmailIntelligenceService } from './services/emailIntelligenceService.js';
import { RetrainingService } from './services/retrainingService.js';
import { EMAIL_INTELLIGENCE_CATEGORIES, EmailIntelligenceCategoryZod, ModelArtifactIntegrityError } from './ml/schema.js';
import { listAuditEvents, recordAuditEvent } from './services/auditService.js';
import { seedSyntheticDemoWorkspace } from './fixtures/demoSeedFixtures.js';

declare global {
  namespace Express {
    interface Request {
      principal?: AuthenticatedPrincipal;
    }
  }
}

export interface SpcrServiceContainer {
  config: AppConfig;
  db: Database;
  authService: AuthService;
  routingService: RoutingAndDispatchService;
  classifier: LocalOnnxRecruitmentClassifier;
  emailIntelligence: EmailIntelligenceService;
  retrainingService: RetrainingService;
  attachmentStorage: SharedAttachmentStorageService;
  screener: ScreeningAndMatchingService;
  gmailSync: GmailSyncService;
  groqDrafting: GroqDraftingService;
  retentionService: RetentionAndPrivacyService;
}

export function createServiceContainer(params: {
  config: AppConfig;
  db: Database;
  oidcVerifier?: GoogleOidcTokenVerifier;
  gmailApiClient?: GmailApiClient;
  groqTransport?: GroqTransport;
  attachmentExtractor?: AttachmentExtractor;
  emailIntelligence?: EmailIntelligenceService;
}): SpcrServiceContainer {
  const { config, db } = params;
  const authService = new AuthService(db, config, params.oidcVerifier);
  const routingService = new RoutingAndDispatchService(db);
  const classifier = new LocalOnnxRecruitmentClassifier({
    cacheDir: config.classifierCacheDir,
    offlineOnly: config.classifierOfflineOnly,
  });
  const emailIntelligence =
    params.emailIntelligence ||
    new EmailIntelligenceService({
      artifactPath: config.emailModelArtifactPath,
      cacheDir: config.classifierCacheDir,
      offlineOnly: config.classifierOfflineOnly,
    });
  const retrainingService = new RetrainingService(db, emailIntelligence, {
    cacheDir: config.classifierCacheDir,
    defaultArtifactPath: config.emailModelArtifactPath,
  });
  const attachmentStorage = new SharedAttachmentStorageService(db, config, params.attachmentExtractor);
  const screener = new ScreeningAndMatchingService(
    db,
    config,
    classifier,
    attachmentStorage,
    routingService,
    emailIntelligence
  );
  const gmailSync = new GmailSyncService(
    db,
    config,
    authService,
    screener,
    params.gmailApiClient,
    emailIntelligence
  );
  const groqDrafting = new GroqDraftingService(db, config, routingService, params.groqTransport);
  const retentionService = new RetentionAndPrivacyService(db, config, gmailSync);

  return {
    config,
    db,
    authService,
    routingService,
    classifier,
    emailIntelligence,
    retrainingService,
    attachmentStorage,
    screener,
    gmailSync,
    groqDrafting,
    retentionService,
  };
}

class SlidingWindowRateLimiter {
  private hits = new Map<string, number[]>();

  constructor(
    private readonly maxRequests: number,
    private readonly windowMs: number
  ) {}

  allow(key: string): boolean {
    const now = Date.now();
    const cutoff = now - this.windowMs;
    const prev = (this.hits.get(key) || []).filter((t) => t > cutoff);
    if (prev.length >= this.maxRequests) {
      this.hits.set(key, prev);
      return false;
    }
    prev.push(now);
    this.hits.set(key, prev);
    return true;
  }
}

export function createSpcrApp(services: SpcrServiceContainer) {
  const {
    config,
    db,
    authService,
    routingService,
    classifier,
    emailIntelligence,
    retrainingService,
    attachmentStorage,
    screener,
    gmailSync,
    groqDrafting,
    retentionService,
  } = services;

  function respondWithSafeError(res: Response, err: any, defaultErrorCode: string, defaultStatus = 400) {
    if (err instanceof ModelArtifactIntegrityError) {
      return res.status(503).json({
        error: 'MODEL_ARTIFACT_INTEGRITY_ERROR',
        reasonCode: err.reasonCode,
        message: err.message,
      });
    }
    if (err instanceof GmailQuotaSafetyStopError) {
      return res.status(429).json({
        error: err.code,
        limitKind: err.limitKind,
        unitsUsed: err.unitsUsed,
        limitUnits: err.limitUnits,
        message: err.message,
      });
    }
    return res.status(defaultStatus).json({
      error: defaultErrorCode,
      message: err?.message || 'Operation failed.',
    });
  }

  const app = express();
  app.disable('x-powered-by');

  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", 'data:'],
          connectSrc: ["'self'"],
          objectSrc: ["'none'"],
          frameAncestors: ["'none'"],
        },
      },
      crossOriginResourcePolicy: { policy: 'same-origin' },
    })
  );

  // Strict Origin & CORS Control (rejects untrusted cross-origin requests)
  app.use('/api', (req: Request, res: Response, next: NextFunction) => {
    const origin = req.headers.origin;
    if (!origin) {
      return next();
    }
    const isSameAppOrigin = origin === config.appBaseUrl;
    const isBrowserExtensionOrigin =
      origin.startsWith('chrome-extension://') || origin.startsWith('moz-extension://');

    if (isSameAppOrigin) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Credentials', 'true');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-CSRF-Token, Authorization');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
      res.setHeader('Vary', 'Origin');
      if (req.method === 'OPTIONS') return res.status(204).end();
      return next();
    }

    // Extension origins may ONLY talk to `/api/extension/*`, `/api/scan/manual`, `/api/opportunities*`, `/api/auth/status`
    // and STILL require a valid paired extension bearer token (never trusted merely because of extension header!).
    const extensionAllowedPaths = [
      '/extension/pair',
      '/scan/manual',
      '/opportunities',
      '/auth/status',
    ];
    const pathMatchesExt = extensionAllowedPaths.some((p) => req.path === p || req.path.startsWith(`${p}/`));

    if (isBrowserExtensionOrigin && pathMatchesExt) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-CSRF-Token, Authorization');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.setHeader('Vary', 'Origin');
      if (req.method === 'OPTIONS') return res.status(204).end();
      return next();
    }

    return res.status(403).json({
      error: 'FORBIDDEN_ORIGIN',
      message: 'Cross-origin request from untrusted origin rejected.',
    });
  });

  app.use(cookieParser(config.sessionSecret));
  app.use(express.json({ limit: '8mb' }));

  const authRateLimiter = new SlidingWindowRateLimiter(30, 60_000);
  const apiRateLimiter = new SlidingWindowRateLimiter(240, 60_000);

  app.use('/api/auth', (req, res, next) => {
    const ip = req.ip || 'local';
    if (!authRateLimiter.allow(ip)) {
      return res.status(429).json({ error: 'RATE_LIMITED', message: 'Too many authentication attempts. Try again shortly.' });
    }
    next();
  });

  app.use('/api', (req, res, next) => {
    const ip = req.ip || 'local';
    if (!apiRateLimiter.allow(ip)) {
      return res.status(429).json({ error: 'RATE_LIMITED', message: 'API rate limit exceeded.' });
    }
    next();
  });

  const isLocalLoopbackBase =
    config.appBaseUrl.startsWith('http://localhost') || config.appBaseUrl.startsWith('http://127.0.0.1');
  const cookieOptions = {
    httpOnly: true,
    secure: (config.nodeEnv === 'production' && !isLocalLoopbackBase) || config.appBaseUrl.startsWith('https://'),
    sameSite: 'lax' as const,
    path: '/',
    maxAge: 12 * 60 * 60 * 1000,
  };

  async function resolvePrincipal(req: Request): Promise<AuthenticatedPrincipal | null> {
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const bearer = authHeader.slice(7).trim();
      return authService.authenticateExtensionToken(bearer);
    }
    const rawSession = req.signedCookies?.spcr_session;
    if (typeof rawSession === 'string' && rawSession) {
      return authService.authenticateSessionToken(rawSession);
    }
    return null;
  }

  async function requireOwnerAuth(req: Request, res: Response, next: NextFunction) {
    try {
      const principal = await resolvePrincipal(req);
      if (!principal) {
        return res.status(401).json({
          error: 'UNAUTHORIZED',
          message: 'Owner authentication required.',
        });
      }
      // Enforce CSRF on all state-changing methods!
      if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method.toUpperCase())) {
        const providedCsrf = String(req.headers['x-csrf-token'] || '');
        if (!providedCsrf || !constantTimeEqual(providedCsrf, principal.csrfToken)) {
          return res.status(403).json({
            error: 'CSRF_TOKEN_INVALID',
            message: 'Missing or invalid X-CSRF-Token header.',
          });
        }
      }
      req.principal = principal;
      next();
    } catch (err) {
      next(err);
    }
  }

  // ==================== PUBLIC HEALTH & AUTH BOOTSTRAP ====================

  app.get('/api/health/public', async (_req, res) => {
    try {
      await db.query('SELECT 1 AS ok');
      res.json({
        status: 'ok',
        product: 'SPCR',
        fullName: 'SPCR (Student Progression & Company Relation)',
        operatingMode: config.operatingMode,
        optionalGroqMode: config.optionalGroqMode,
        recurringSoftwareCostInr: 0,
        dbConnected: true,
        timestamp: new Date().toISOString(),
      });
    } catch {
      res.status(503).json({ status: 'degraded', dbConnected: false });
    }
  });

  app.get('/api/auth/status', async (req, res, next) => {
    try {
      const principal = await resolvePrincipal(req);
      res.json({
        authenticated: Boolean(principal),
        configuredOwnerEmail: config.ownerEmail,
        operatingMode: config.operatingMode,
        optionalGroqMode: config.optionalGroqMode,
        groqFreeTierOnly: config.groqFreeTierOnly,
        googleOidcConfigured: Boolean(config.googleClientId && config.googleClientSecret),
        demoAuthAvailable: config.demoAuthEnabled && config.nodeEnv !== 'production',
        principal: principal
          ? {
              email: principal.email,
              displayName: principal.displayName,
              authMethod: principal.authMethod,
              csrfToken: principal.csrfToken,
            }
          : null,
      });
    } catch (err) {
      next(err);
    }
  });

  app.get('/api/auth/google/login', (_req, res) => {
    try {
      const { authUrl, stateCookieValue } = authService.createGoogleOidcStart();
      res.cookie('spcr_oidc_state', stateCookieValue, { ...cookieOptions, maxAge: 15 * 60 * 1000 });
      res.redirect(authUrl);
    } catch (err: any) {
      res.status(400).json({ error: 'OIDC_NOT_CONFIGURED', message: err.message });
    }
  });

  app.get('/api/auth/google/callback', async (req, res) => {
    try {
      const code = String(req.query.code || '');
      const queryState = String(req.query.state || '');
      const cookieState = req.cookies?.spcr_oidc_state || req.signedCookies?.spcr_oidc_state;
      res.clearCookie('spcr_oidc_state', { path: '/' });

      const login = await authService.completeGoogleOidcLogin({
        code,
        cookieState,
        queryState,
        userAgent: req.headers['user-agent'],
        ipAddress: req.ip,
      });

      res.cookie('spcr_session', login.rawSessionToken, { ...cookieOptions, signed: true });
      res.redirect('/');
    } catch (err: any) {
      const status = err instanceof ForbiddenOwnerError ? 403 : 400;
      res.status(status).json({ error: 'OIDC_LOGIN_DENIED', message: err.message });
    }
  });

  app.post('/api/auth/demo-login', async (req, res) => {
    try {
      const requestedEmail = typeof req.body?.email === 'string' ? req.body.email : undefined;
      const login = await authService.loginLocalDemoOwner({
        email: requestedEmail,
        userAgent: req.headers['user-agent'],
        ipAddress: req.ip,
      });
      res.cookie('spcr_session', login.rawSessionToken, { ...cookieOptions, signed: true });
      res.json({
        authenticated: true,
        email: login.email,
        csrfToken: login.csrfToken,
        mode: 'local_demo',
      });
    } catch (err: any) {
      const status = err instanceof ForbiddenOwnerError ? 403 : 400;
      res.status(status).json({ error: 'DEMO_LOGIN_DENIED', message: err.message });
    }
  });

  app.post('/api/extension/pair', async (req, res) => {
    try {
      const schema = z.object({ pairingCode: z.string().min(6).max(64) });
      const parsed = schema.parse(req.body);
      const claimed = await authService.claimExtensionPairingCode({
        pairingCode: parsed.pairingCode,
        origin: req.headers.origin,
      });
      res.json(claimed);
    } catch (err: any) {
      res.status(400).json({ error: 'EXTENSION_PAIR_FAILED', message: err.message });
    }
  });

  // ==================== PROTECTED OWNER ENDPOINTS ====================

  app.post('/api/auth/logout', requireOwnerAuth, async (req, res, next) => {
    try {
      if (req.principal?.sessionId) {
        await authService.revokeSession(req.principal.sessionId, req.principal.email);
      }
      res.clearCookie('spcr_session', { path: '/' });
      res.json({ loggedOut: true });
    } catch (err) {
      next(err);
    }
  });

  app.post('/api/auth/revoke-all-sessions', requireOwnerAuth, async (req, res, next) => {
    try {
      await authService.revokeAllUserSessions(req.principal!.userId, req.principal!.email);
      res.clearCookie('spcr_session', { path: '/' });
      res.json({ allSessionsRevoked: true });
    } catch (err) {
      next(err);
    }
  });

  // Extension Pairing Management
  app.get('/api/extension/pairings', requireOwnerAuth, async (_req, res, next) => {
    try {
      res.json({ pairings: await authService.listExtensionPairings() });
    } catch (err) {
      next(err);
    }
  });

  app.post('/api/extension/pairings', requireOwnerAuth, async (req, res, next) => {
    try {
      const label = typeof req.body?.label === 'string' ? req.body.label : 'SPCR Browser Extension';
      const created = await authService.createExtensionPairingCode(req.principal!, label);
      res.json(created);
    } catch (err) {
      next(err);
    }
  });

  app.delete('/api/extension/pairings/:id', requireOwnerAuth, async (req, res, next) => {
    try {
      await authService.revokeExtensionPairing(req.params.id!, req.principal!.email);
      res.json({ revoked: true });
    } catch (err) {
      next(err);
    }
  });

  // Settings & Setup Wizard
  app.get('/api/settings', requireOwnerAuth, async (_req, res, next) => {
    try {
      const settings = await getSettings(db, config);
      res.json({ settings });
    } catch (err) {
      next(err);
    }
  });

  app.patch('/api/settings', requireOwnerAuth, async (req, res, next) => {
    try {
      const updated = await updateSettings(db, config, req.principal!.email, req.body || {});
      res.json({ settings: updated });
    } catch (err: any) {
      res.status(400).json({ error: 'SETTINGS_UPDATE_REJECTED', message: err.message });
    }
  });

  // Integration Checklist & Non-Disclosing Safe Connection Check (Screen 15)
  app.get('/api/integrations/checklist', requireOwnerAuth, async (_req, res, next) => {
    try {
      const settings = await getSettings(db, config);
      const monitoring = await gmailSync.getMonitoringHealth();
      const gmailQuota = await gmailSync.getQuotaStatus();
      const groqStatus = await groqDrafting.getBudgetAndProviderStatus();
      const storage = await attachmentStorage.getStorageStats();
      const arch = emailIntelligence.getArchitectureBreakdown();

      const items = [
        {
          id: 'operating_mode_zero_cost',
          name: `Zero-Cost Operating Mode (${config.operatingMode})`,
          state: 'CONFIGURED',
          consoleUrl: null,
          whereEntered: 'Environment (SPCR_OPERATING_MODE=LOCAL_ZERO_COST | FREE_CLOUD_OPTIONAL)',
          detail:
            config.operatingMode === 'LOCAL_ZERO_COST'
              ? 'Recurring third-party bill: INR 0. Runs locally on CPU + open-source PGlite/PostgreSQL. Sync runs while your local SPCR server is running (no payment method required).'
              : 'FREE_CLOUD_OPTIONAL: Uses explicit free-tier hosting (plan: free). Subject to ~15m idle sleep (non-continuous when asleep) and 30-day free PostgreSQL expiry.',
        },
        {
          id: 'owner_gate',
          name: 'SPCR Single-Owner Dashboard Gate (SPCR_OWNER_EMAIL)',
          state: config.ownerEmail ? 'CONFIGURED' : 'NEEDED — OWNER ACTION',
          consoleUrl: null,
          whereEntered: 'Environment (.env or Free-Tier Host -> SPCR_OWNER_EMAIL)',
          detail: `Restricts dashboard sign-in strictly to ${config.ownerEmail}. Separate from Gmail mailbox OAuth.`,
        },
        {
          id: 'google_oauth_client',
          name: 'Google Cloud OAuth 2.0 Web Client (Free Standard Tier)',
          state: config.googleClientId && config.googleClientSecret ? 'CONFIGURED' : 'NEEDED — OWNER ACTION',
          consoleUrl: 'https://console.cloud.google.com/apis/credentials',
          whereEntered: 'Environment (GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET)',
          callbackUris: {
            dashboardLoginOidc: config.googleOidcRedirectUri,
            gmailMailboxReadonly: config.googleGmailRedirectUri,
          },
          detail: 'Enable Gmail API (free tier) and register both exact redirect URIs above.',
        },
        {
          id: 'gmail_policy_gate',
          name: 'Gmail Restricted-Scope (gmail.readonly) Policy, Staged Sync & Quota Guard',
          state: !config.gmailPolicyGateApproved
            ? 'BLOCKED BY POLICY'
            : monitoring.connection?.status === 'connected'
              ? 'CONFIGURED'
              : monitoring.connection?.status === 'expired_or_revoked'
                ? 'INVALID'
                : 'NEEDED — OWNER ACTION',
          consoleUrl: 'https://developers.google.com/workspace/gmail/api/auth/scopes',
          whereEntered: 'Environment (GMAIL_POLICY_GATE_APPROVED=true after Workspace internal or CASA review)',
          detail: `${monitoring.policyGateExplanation} Quota today: ${gmailQuota.unitsUsedToday}/${gmailQuota.dailyLimitUnits} units (${gmailQuota.attachmentsSkippedByStagingToday} attachments skipped via staged pre-screen).`,
        },
        {
          id: 'local_classifier',
          name: `Local Supervised Email Intelligence Model (${arch.loadedModelVersion || 'spcr-email-intel-v1.0.0'})`,
          state: 'CONFIGURED',
          consoleUrl: 'https://huggingface.co/Xenova/all-MiniLM-L6-v2',
          whereEntered: 'Local ml/artifacts/recruitment_email_model_v1.json + .models_cache (SHA-256 verified)',
          detail: `Supervised 14-label multi-label classifier (${arch.loadedArchitectureType || 'hybrid_minilm_tfidf_logreg'}) + deterministic structured extraction. Runs 100% locally on CPU with INR 0 API cost.`,
        },
        {
          id: 'groq_drafting',
          name: `Optional Groq Announcement Polisher (${config.optionalGroqMode})`,
          state:
            !config.groqApiKey || !config.groqLiveEnabled
              ? 'OPTIONAL — DISABLED'
              : !settings.groqDisclosureAcceptedAt || !settings.budgetConfirmedAt
                ? 'NEEDED — OWNER ACTION'
                : 'CONFIGURED',
          consoleUrl: 'https://console.groq.com/keys',
          whereEntered: 'Optional ONLY: GROQ_LIVE_ENABLED=false by default; never needed for classification or extraction',
          detail: `Completely optional. Core classification, extraction, matching, review, and manual dispatch operate at 100% capability when DISABLED. Free-tier guard: ${
            config.groqFreeTierOnly ? 'ON (INR 0 hard stop)' : 'Custom cap'
          }.`,
        },
        {
          id: 'postgresql_and_storage',
          name: 'Local PGlite / PostgreSQL & Encrypted Attachment Storage',
          state: 'CONFIGURED',
          consoleUrl: null,
          whereEntered: 'DATABASE_URL (local pglite://./data/pglite by default; zero cost)',
          detail: `Driver: ${db.driverType}. Shared encrypted BYTEA blobs stored: ${storage.blobCount} (${storage.usedBytes} bytes).`,
        },
        {
          id: 'optional_providers',
          name: 'Paid Cloud Hosting / Paid LLM APIs / Unofficial WhatsApp APIs',
          state: 'NOT NEEDED',
          consoleUrl: null,
          whereEntered: 'Prohibited by Zero-Cost Architecture Addendum',
          detail: 'Zero paid APIs, zero paid schedulers, zero paid databases, and zero automated WhatsApp Web scripting.',
        },
      ];

      res.json({
        operatingMode: config.operatingMode,
        optionalGroqMode: config.optionalGroqMode,
        recurringSoftwareCostInr: 0,
        items,
        monitoring,
        gmailQuota,
        groqStatus,
        storage,
        emailIntelligence: arch,
      });
    } catch (err) {
      next(err);
    }
  });

  app.post('/api/integrations/safe-check', requireOwnerAuth, async (_req, res) => {
    try {
      await db.query('SELECT 1 AS ok');
      await classifier.ensureLoaded();
      const loadedArtifact = await emailIntelligence.ensureLoaded();
      const groqCheck =
        config.groqLiveEnabled && config.groqApiKey
          ? await groqDrafting.runSafeConnectionCheck()
          : {
              ok: false,
              modelAvailable: false,
              detail: 'OPTIONAL_GROQ is disabled by default (INR 0 local pipeline active).',
            };

      res.json({
        checkedAt: new Date().toISOString(),
        operatingMode: config.operatingMode,
        optionalGroqMode: config.optionalGroqMode,
        triggeredMailboxScan: false,
        triggeredGroqCompletionSpend: false,
        database: { ok: true, driver: db.driverType },
        localClassifier: { ok: true, modelId: PINNED_CLASSIFIER_SPEC.modelId, checksumVerified: true },
        emailIntelligenceModel: {
          ok: true,
          classifierKind: loadedArtifact.classifierKind,
          architectureType: loadedArtifact.architectureType,
          modelVersion: loadedArtifact.modelVersion,
          datasetVersion: loadedArtifact.datasetVersion,
          checksumVerified: true,
        },
        googleOAuthConfig: {
          credentialsPresent: Boolean(config.googleClientId && config.googleClientSecret),
          policyGateApproved: config.gmailPolicyGateApproved,
        },
        groq: groqCheck,
      });
    } catch (err: any) {
      respondWithSafeError(res, err, 'SAFE_CHECK_FAILED', 500);
    }
  });

  // Gmail OAuth, Quota & Staged Monitoring Endpoints
  app.get('/api/gmail/status', requireOwnerAuth, async (_req, res, next) => {
    try {
      res.json(await gmailSync.getMonitoringHealth());
    } catch (err) {
      next(err);
    }
  });

  app.get('/api/gmail/quota', requireOwnerAuth, async (_req, res, next) => {
    try {
      res.json(await gmailSync.getQuotaStatus());
    } catch (err) {
      next(err);
    }
  });

  app.post('/api/gmail/oauth/start', requireOwnerAuth, (_req, res) => {
    try {
      const { authUrl, stateCookieValue } = gmailSync.createGmailAuthorizationStart();
      res.cookie('spcr_gmail_state', stateCookieValue, { ...cookieOptions, maxAge: 15 * 60 * 1000 });
      res.json({ authUrl });
    } catch (err: any) {
      res.status(400).json({ error: 'GMAIL_OAUTH_BLOCKED', message: err.message });
    }
  });

  app.get('/api/gmail/oauth/callback', requireOwnerAuth, async (req, res) => {
    try {
      const code = String(req.query.code || '');
      const queryState = String(req.query.state || '');
      const cookieState = req.cookies?.spcr_gmail_state || req.signedCookies?.spcr_gmail_state;
      res.clearCookie('spcr_gmail_state', { path: '/' });

      await gmailSync.completeGmailOAuthCallback({
        actorEmail: req.principal!.email,
        code,
        cookieState,
        queryState,
      });
      res.redirect('/?tab=connections');
    } catch (err: any) {
      res.status(400).json({ error: 'GMAIL_OAUTH_CALLBACK_FAILED', message: err.message });
    }
  });

  app.post('/api/gmail/disconnect', requireOwnerAuth, async (req, res, next) => {
    try {
      await gmailSync.disconnectMailbox(req.principal!.email);
      res.json({ disconnected: true });
    } catch (err) {
      next(err);
    }
  });

  app.post('/api/gmail/poll-now', requireOwnerAuth, async (req, res) => {
    try {
      const out = await gmailSync.pollNewMessages(req.principal!.email);
      res.json({ ...out, groqCallsMade: 0 });
    } catch (err: any) {
      respondWithSafeError(res, err, 'GMAIL_POLL_FAILED', 400);
    }
  });

  // Manual Scan Endpoint (Zero Groq Calls — used by Extension & Dashboard!)
  app.post('/api/scan/manual', requireOwnerAuth, async (req, res) => {
    try {
      const schema = z.object({
        gmailMessageId: z.string().min(1).max(200),
        syntheticPayload: z
          .object({
            gmailThreadId: z.string().optional(),
            inReplyTo: z.string().optional(),
            referencesHeader: z.string().optional(),
            listUnsubscribeHeader: z.string().optional(),
            isHtmlOnly: z.boolean().optional(),
            fromRaw: z.string().min(3),
            replyToRaw: z.string().optional(),
            authHeadersRaw: z.string().optional(),
            subject: z.string().default(''),
            bodyText: z.string().default(''),
            attachments: z
              .array(
                z.object({
                  filename: z.string(),
                  declaredMime: z.string().optional(),
                  base64Data: z.string(),
                })
              )
              .optional(),
          })
          .optional(),
      });
      const body = schema.parse(req.body);

      if (body.syntheticPayload) {
        const result = await screener.scanEmailMessage(
          {
            gmailMessageId: body.gmailMessageId,
            gmailThreadId: body.syntheticPayload.gmailThreadId || null,
            inReplyTo: body.syntheticPayload.inReplyTo || null,
            referencesHeader: body.syntheticPayload.referencesHeader || null,
            listUnsubscribeHeader: body.syntheticPayload.listUnsubscribeHeader || null,
            isHtmlOnly: Boolean(body.syntheticPayload.isHtmlOnly),
            fromRaw: body.syntheticPayload.fromRaw,
            replyToRaw: body.syntheticPayload.replyToRaw || null,
            authHeadersRaw: body.syntheticPayload.authHeadersRaw || null,
            subject: body.syntheticPayload.subject,
            receivedAt: new Date().toISOString(),
            bodyText: body.syntheticPayload.bodyText,
            attachments: (body.syntheticPayload.attachments || []).map((a) => ({
              filename: a.filename,
              declaredMime: a.declaredMime || null,
              buffer: Buffer.from(a.base64Data, 'base64'),
            })),
            sourceOrigin: 'synthetic_fixture',
          },
          'manual_scan',
          req.principal!.email
        );

        // Manual Scan NEVER invokes Groq automatically even if autoDraftHighConfidence is ON.
        return res.json(result);
      }

      const result = await gmailSync.manualScanGmailMessageById(body.gmailMessageId, req.principal!.email);
      return res.json(result);
    } catch (err: any) {
      respondWithSafeError(res, err, 'MANUAL_SCAN_FAILED', 400);
    }
  });

  // Synthetic Demo Seed Endpoint (Zero Credentials, Zero Groq Calls)
  app.post('/api/demo/seed', requireOwnerAuth, async (req, res) => {
    try {
      const seeded = await seedSyntheticDemoWorkspace({
        db,
        actorEmail: req.principal!.email,
        routingService,
        screener,
      });
      res.json(seeded);
    } catch (err: any) {
      respondWithSafeError(res, err, 'DEMO_SEED_FAILED', 500);
    }
  });

  // Screened Messages & Officer Feedback / Controlled Corrections
  app.get('/api/messages/screened', requireOwnerAuth, async (_req, res, next) => {
    try {
      const rows = await db.query<any>(
        `SELECT sm.id, sm.gmail_message_id, sm.gmail_thread_id, sm.from_raw, sm.from_email, sm.from_domain, sm.subject,
                sm.received_at, sm.body_retained, sm.source_origin,
                so.classification, so.primary_category, so.multi_labels_json,
                so.uncertainty_outcome, so.uncertainty_reasons_json,
                so.classifier_kind, so.model_version, so.structured_extraction_json,
                so.confidence, so.margin, so.authenticity_label,
                so.transport_auth_status, so.risk_flags_json, so.groq_calls_made,
                so.scan_trigger, so.officer_feedback
         FROM source_messages sm
         JOIN screening_outcomes so ON so.source_message_id = sm.id
         ORDER BY sm.received_at DESC
         LIMIT 100`
      );
      res.json({ messages: rows.rows });
    } catch (err) {
      next(err);
    }
  });

  app.post('/api/messages/:id/feedback', requireOwnerAuth, async (req, res) => {
    try {
      const schema = z.object({
        feedback: z.enum(['relevant_placement', 'related_jd', 'not_relevant', 'suspicious']),
      });
      const parsed = schema.parse(req.body);
      await screener.recordScreeningFeedback(req.principal!.email, {
        sourceMessageId: req.params.id!,
        feedback: parsed.feedback,
      });
      res.json({ ok: true });
    } catch (err: any) {
      res.status(400).json({ error: 'INVALID_FEEDBACK', message: err.message });
    }
  });

  // Section 7: Controlled User Correction & Retraining / Rollback Endpoints
  app.post('/api/messages/:id/correction', requireOwnerAuth, async (req, res) => {
    try {
      const schema = z.object({
        verdict: z.enum(['correct', 'incorrect', 'uncertain']),
        correctedPrimaryCategory: EmailIntelligenceCategoryZod.optional(),
        correctedMultiLabels: z.array(EmailIntelligenceCategoryZod).optional(),
        officerNote: z.string().max(500).optional(),
      });
      const parsed = schema.parse(req.body);
      const feedback = await retrainingService.submitUserCorrection({
        sourceMessageId: req.params.id!,
        verdict: parsed.verdict,
        correctedPrimaryCategory: parsed.correctedPrimaryCategory,
        correctedMultiLabels: parsed.correctedMultiLabels,
        officerNote: parsed.officerNote,
        actorEmail: req.principal!.email,
      });
      res.json({ feedback });
    } catch (err: any) {
      respondWithSafeError(res, err, 'CORRECTION_REJECTED', 400);
    }
  });

  app.get('/api/ml/status', requireOwnerAuth, async (_req, res) => {
    try {
      await emailIntelligence.ensureLoaded();
      await retrainingService.ensureInitializedRegistry();
      const arch = emailIntelligence.getArchitectureBreakdown();
      const registry = await retrainingService.listFeedbackAndRegistryStatus();
      const evalPath = path.resolve(process.cwd(), 'ml', 'artifacts', 'evaluation_report_v1.json');
      let evaluationSummary: any = null;
      if (fs.existsSync(evalPath)) {
        try {
          const rawEval = JSON.parse(fs.readFileSync(evalPath, 'utf8'));
          evaluationSummary = {
            modelVersion: rawEval.modelVersion,
            datasetVersion: rawEval.datasetVersion,
            architectureType: rawEval.architectureType,
            thresholdsAllPassed:
              rawEval.thresholdCheckResults?.allThresholdsPassed ?? rawEval.thresholdChecks?.allPassed ?? null,
            heldOutMacroF1: rawEval.heldOutTestEvaluation?.macroF1 ?? null,
            heldOutAccuracy: rawEval.heldOutTestEvaluation?.accuracy ?? null,
            relevantOpportunityRecall: rawEval.heldOutTestEvaluation?.relevantOpportunityRecall ?? null,
            silentOpportunityDiscardRate: rawEval.heldOutTestEvaluation?.silentOpportunityDiscardRate ?? null,
            calibrationDisclosure: rawEval.calibrationDisclosure ?? null,
            realWorldInboxEvaluation:
              rawEval.realInboxConsentedEvaluation ?? rawEval.realWorldInboxEvaluation ?? null,
          };
        } catch {
          evaluationSummary = null;
        }
      }
      res.json({
        operatingMode: config.operatingMode,
        optionalGroqMode: config.optionalGroqMode,
        categories: EMAIL_INTELLIGENCE_CATEGORIES,
        architecture: arch,
        evaluationSummary,
        ...registry,
      });
    } catch (err: any) {
      respondWithSafeError(res, err, 'ML_STATUS_FAILED', 503);
    }
  });

  app.get('/api/ml/feedback', requireOwnerAuth, async (_req, res, next) => {
    try {
      res.json(await retrainingService.listFeedbackAndRegistryStatus());
    } catch (err) {
      next(err);
    }
  });

  app.post('/api/ml/feedback/:id/review', requireOwnerAuth, async (req, res) => {
    try {
      const schema = z.object({
        decision: z.enum(['approved_for_training', 'rejected']),
      });
      const parsed = schema.parse(req.body);
      const updated = await retrainingService.reviewFeedbackExample({
        feedbackId: req.params.id!,
        decision: parsed.decision,
        reviewerEmail: req.principal!.email,
      });
      res.json({ feedback: updated });
    } catch (err: any) {
      respondWithSafeError(res, err, 'FEEDBACK_REVIEW_FAILED', 400);
    }
  });

  app.post('/api/ml/retrain', requireOwnerAuth, async (req, res) => {
    try {
      const compareHybridMiniLm =
        typeof req.body?.compareHybridMiniLm === 'boolean' ? req.body.compareHybridMiniLm : true;
      const autoActivate = typeof req.body?.autoActivate === 'boolean' ? req.body.autoActivate : true;
      const out = await retrainingService.retrainFromApprovedFeedback({
        actorEmail: req.principal!.email,
        compareHybridMiniLm,
        autoActivate,
      });
      res.json(out);
    } catch (err: any) {
      respondWithSafeError(res, err, 'ML_RETRAIN_FAILED', 400);
    }
  });

  app.post('/api/ml/rollback', requireOwnerAuth, async (req, res) => {
    try {
      const targetVersion = typeof req.body?.targetVersion === 'string' ? req.body.targetVersion : undefined;
      const out = await retrainingService.rollbackModelVersion({
        targetVersion,
        actorEmail: req.principal!.email,
      });
      res.json(out);
    } catch (err: any) {
      respondWithSafeError(res, err, 'ML_ROLLBACK_FAILED', 400);
    }
  });

  // Opportunities Inbox & Detail Endpoints
  app.get('/api/opportunities', requireOwnerAuth, async (_req, res, next) => {
    try {
      const opps = await db.query<any>(
        `SELECT o.*,
          (SELECT COUNT(*)::int FROM opportunity_message_links oml WHERE oml.opportunity_id = o.id AND oml.link_state = 'confirmed') AS linked_messages_count,
          (SELECT COUNT(*)::int FROM opportunity_message_links oml WHERE oml.opportunity_id = o.id AND oml.link_state = 'proposed') AS proposed_links_count,
          (SELECT COUNT(*)::int FROM attachments a WHERE a.opportunity_id = o.id) AS attachments_count
         FROM opportunities o
         ORDER BY o.updated_at DESC`
      );
      res.json({ opportunities: opps.rows });
    } catch (err) {
      next(err);
    }
  });

  app.get('/api/opportunities/:id', requireOwnerAuth, async (req, res, next) => {
    try {
      const oppId = req.params.id!;
      const oppRes = await db.query<any>('SELECT * FROM opportunities WHERE id = $1', [oppId]);
      const opp = oppRes.rows[0];
      if (!opp) return res.status(404).json({ error: 'NOT_FOUND', message: 'Opportunity not found.' });

      const linksRes = await db.query<any>(
        `SELECT oml.id AS link_id, oml.link_state, oml.match_score, oml.evidence_json,
                sm.id AS message_id, sm.gmail_message_id, sm.gmail_thread_id, sm.from_raw, sm.reply_to_email, sm.subject,
                sm.received_at, sm.body_text, sm.snippet, sm.extracted_urls_json,
                so.classification, so.primary_category, so.multi_labels_json,
                so.uncertainty_outcome, so.uncertainty_reasons_json,
                so.classifier_kind, so.model_version, so.structured_extraction_json,
                so.confidence, so.margin, so.authenticity_label,
                so.transport_auth_status, so.authenticity_signals_json, so.risk_flags_json, so.officer_feedback
         FROM opportunity_message_links oml
         JOIN source_messages sm ON sm.id = oml.source_message_id
         LEFT JOIN screening_outcomes so ON so.source_message_id = sm.id
         WHERE oml.opportunity_id = $1
         ORDER BY sm.received_at ASC`,
        [oppId]
      );

      const attachmentsRes = await db.query<any>(
        `SELECT id, source_message_id, filename, declared_mime, verified_type, byte_size,
                sha256_hash, parse_status, parse_reason, extracted_text, page_count, blob_stored, created_at
         FROM attachments WHERE opportunity_id = $1 ORDER BY created_at ASC`,
        [oppId]
      );

      const factsRes = await db.query<any>(
        `SELECT * FROM extracted_facts WHERE opportunity_id = $1 AND opportunity_version = $2 ORDER BY field_name ASC`,
        [oppId, opp.current_version]
      );

      const draftsRes = await db.query<any>(
        `SELECT * FROM draft_versions WHERE opportunity_id = $1 ORDER BY opportunity_version DESC, draft_number DESC`,
        [oppId]
      );

      const approvalsRes = await db.query<any>(
        `SELECT * FROM approvals WHERE opportunity_id = $1 ORDER BY approved_at DESC`,
        [oppId]
      );

      const versionsRes = await db.query<any>(
        `SELECT * FROM opportunity_versions WHERE opportunity_id = $1 ORDER BY version DESC`,
        [oppId]
      );

      const batchesRes = await db.query<any>(
        `SELECT id, status, opportunity_version, created_at, updated_at FROM dispatch_batches WHERE opportunity_id = $1 ORDER BY created_at DESC`,
        [oppId]
      );

      res.json({
        opportunity: opp,
        messageLinks: linksRes.rows,
        attachments: attachmentsRes.rows,
        facts: factsRes.rows,
        drafts: draftsRes.rows,
        approvals: approvalsRes.rows,
        versions: versionsRes.rows,
        dispatchBatches: batchesRes.rows,
      });
    } catch (err) {
      next(err);
    }
  });

  app.post('/api/opportunities/links/:linkId/resolve', requireOwnerAuth, async (req, res) => {
    try {
      const schema = z.object({ decision: z.enum(['confirm', 'keep_separate']) });
      const parsed = schema.parse(req.body);
      const out = await screener.resolveProposedLink(req.principal!.email, {
        linkId: req.params.linkId!,
        decision: parsed.decision,
      });
      res.json(out);
    } catch (err: any) {
      res.status(400).json({ error: 'LINK_RESOLVE_FAILED', message: err.message });
    }
  });

  app.post('/api/opportunities/:id/drafts', requireOwnerAuth, async (req, res) => {
    try {
      const schema = z.object({ draftText: z.string().min(5).max(20_000) });
      const parsed = schema.parse(req.body);
      const draft = await screener.saveOfficerManualDraftEdit(req.principal!.email, {
        opportunityId: req.params.id!,
        draftText: parsed.draftText,
      });
      res.json({ draft });
    } catch (err: any) {
      res.status(400).json({ error: 'DRAFT_SAVE_FAILED', message: err.message });
    }
  });

  // Post-Screen Groq Formatting Endpoint (`Format Announcement with Groq`)
  app.post('/api/opportunities/:id/format-groq', requireOwnerAuth, async (req, res) => {
    try {
      const confirmSuspicious = Boolean(req.body?.confirmSuspiciousDataTransfer);
      const out = await groqDrafting.formatOpportunityWithGroq({
        actorEmail: req.principal!.email,
        opportunityId: req.params.id!,
        triggerMode: 'manual_click',
        confirmSuspiciousDataTransfer: confirmSuspicious,
      });
      res.json(out);
    } catch (err: any) {
      if (err instanceof GroqAdapterError) {
        return res.status(err.statusCode).json({ error: err.code, message: err.message });
      }
      res.status(400).json({ error: 'GROQ_FORMAT_FAILED', message: err.message });
    }
  });

  app.get('/api/groq/status', requireOwnerAuth, async (_req, res, next) => {
    try {
      res.json(await groqDrafting.getBudgetAndProviderStatus());
    } catch (err) {
      next(err);
    }
  });

  // Shared Encrypted Attachment Download (Owner-authenticated ONLY; zero public URLs!)
  app.get('/api/attachments/:id/download', requireOwnerAuth, async (req, res) => {
    try {
      const file = await attachmentStorage.readDecryptedAttachmentBlob(req.params.id!);
      const contentType =
        file.verifiedType === 'pdf'
          ? 'application/pdf'
          : file.verifiedType === 'docx'
            ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
            : 'application/octet-stream';
      const safeName = file.filename.replace(/[^A-Za-z0-9._-]/g, '_');
      res.setHeader('Content-Type', contentType);
      res.setHeader('Content-Disposition', `attachment; filename="${safeName}"`);
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.send(file.buffer);
    } catch (err: any) {
      res.status(404).json({ error: 'ATTACHMENT_UNAVAILABLE', message: err.message });
    }
  });

  // Sections & WhatsApp Groups Registry + Approval & Guided Manual Dispatch
  app.get('/api/routing/registry', requireOwnerAuth, async (_req, res, next) => {
    try {
      res.json(await routingService.listSectionsAndGroups());
    } catch (err) {
      next(err);
    }
  });

  app.post('/api/routing/sections', requireOwnerAuth, async (req, res) => {
    try {
      const sec = await routingService.createSection(req.principal!.email, req.body || {});
      res.json({ section: sec });
    } catch (err: any) {
      res.status(400).json({ error: 'SECTION_CREATE_FAILED', message: err.message });
    }
  });

  app.patch('/api/routing/sections/:id', requireOwnerAuth, async (req, res) => {
    try {
      const sec = await routingService.updateSection(req.principal!.email, req.params.id!, req.body || {});
      res.json({ section: sec });
    } catch (err: any) {
      res.status(400).json({ error: 'SECTION_UPDATE_FAILED', message: err.message });
    }
  });

  app.delete('/api/routing/sections/:id', requireOwnerAuth, async (req, res) => {
    try {
      await routingService.deleteSection(req.principal!.email, req.params.id!);
      res.json({ deleted: true });
    } catch (err: any) {
      res.status(400).json({ error: 'SECTION_DELETE_FAILED', message: err.message });
    }
  });

  app.post('/api/routing/groups', requireOwnerAuth, async (req, res) => {
    try {
      const created = await routingService.registerGroup(req.principal!.email, req.body || {});
      res.json(created);
    } catch (err: any) {
      res.status(400).json({ error: 'GROUP_CREATE_FAILED', message: err.message });
    }
  });

  app.patch('/api/routing/groups/:id', requireOwnerAuth, async (req, res) => {
    try {
      const updated = await routingService.updateGroup(req.principal!.email, req.params.id!, req.body || {});
      res.json(updated);
    } catch (err: any) {
      res.status(400).json({ error: 'GROUP_UPDATE_FAILED', message: err.message });
    }
  });

  app.delete('/api/routing/groups/:id', requireOwnerAuth, async (req, res) => {
    try {
      const confirmed = req.query.confirm === 'true' || req.body?.confirm === true;
      await routingService.deleteGroup(req.principal!.email, req.params.id!, confirmed);
      res.json({ deleted: true });
    } catch (err: any) {
      res.status(400).json({ error: 'GROUP_DELETE_FAILED', message: err.message });
    }
  });

  app.post('/api/routing/preview', requireOwnerAuth, async (req, res) => {
    try {
      const preview = await routingService.previewDestinationSelection({
        sectionIds: Array.isArray(req.body?.sectionIds) ? req.body.sectionIds : [],
        addGroupIds: Array.isArray(req.body?.addGroupIds) ? req.body.addGroupIds : [],
        removeGroupIds: Array.isArray(req.body?.removeGroupIds) ? req.body.removeGroupIds : [],
      });
      res.json(preview);
    } catch (err: any) {
      res.status(400).json({ error: 'PREVIEW_FAILED', message: err.message });
    }
  });

  app.post('/api/opportunities/:id/approve', requireOwnerAuth, async (req, res) => {
    try {
      const batchDetails = await routingService.approveDraftAndCreateDispatchBatch(req.principal!.email, {
        opportunityId: req.params.id!,
        draftVersionId: String(req.body?.draftVersionId || ''),
        sectionIds: Array.isArray(req.body?.sectionIds) ? req.body.sectionIds : [],
        addGroupIds: Array.isArray(req.body?.addGroupIds) ? req.body.addGroupIds : [],
        removeGroupIds: Array.isArray(req.body?.removeGroupIds) ? req.body.removeGroupIds : [],
        jdAttachmentId: req.body?.jdAttachmentId || null,
        jdSourceUrl: req.body?.jdSourceUrl || null,
      });
      res.json(batchDetails);
    } catch (err: any) {
      res.status(400).json({ error: 'APPROVAL_FAILED', message: err.message });
    }
  });

  app.get('/api/dispatch/batches/:batchId', requireOwnerAuth, async (req, res, next) => {
    try {
      const details = await routingService.getDispatchBatchDetails(req.params.batchId!);
      if (!details) return res.status(404).json({ error: 'NOT_FOUND', message: 'Dispatch batch not found.' });
      res.json(details);
    } catch (err) {
      next(err);
    }
  });

  app.post('/api/dispatch/batches/:batchId/targets/:targetId/outcome', requireOwnerAuth, async (req, res) => {
    try {
      const updated = await routingService.recordManualTargetOutcome(req.principal!.email, {
        batchId: req.params.batchId!,
        targetId: req.params.targetId!,
        outcome: String(req.body?.outcome || ''),
        officerNote: req.body?.officerNote,
      });
      res.json(updated);
    } catch (err: any) {
      res.status(400).json({ error: 'DISPATCH_OUTCOME_REJECTED', message: err.message });
    }
  });

  app.post('/api/dispatch/batches/:batchId/cancel', requireOwnerAuth, async (req, res) => {
    try {
      const out = await routingService.cancelDispatchBatch(req.principal!.email, req.params.batchId!);
      res.json(out);
    } catch (err: any) {
      res.status(400).json({ error: 'BATCH_CANCEL_FAILED', message: err.message });
    }
  });

  // Sender Notes CRUD
  app.get('/api/sender-notes', requireOwnerAuth, async (_req, res, next) => {
    try {
      const rows = await db.query('SELECT * FROM sender_notes ORDER BY domain_or_email ASC');
      res.json({ notes: rows.rows });
    } catch (err) {
      next(err);
    }
  });

  app.post('/api/sender-notes', requireOwnerAuth, async (req, res) => {
    try {
      const schema = z.object({
        domainOrEmail: z.string().min(3).max(160),
        category: z.enum(['known_company', 'recruitment_agency', 'caution', 'general_note']),
        note: z.string().min(2).max(500),
      });
      const parsed = schema.parse(req.body);
      const id = randomId('sn');
      await db.query(
        `INSERT INTO sender_notes (id, domain_or_email, category, note)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (domain_or_email) DO UPDATE
         SET category = EXCLUDED.category, note = EXCLUDED.note, updated_at = NOW()`,
        [id, parsed.domainOrEmail.trim().toLowerCase(), parsed.category, parsed.note.trim()]
      );
      await recordAuditEvent(db, {
        actorEmail: req.principal!.email,
        eventType: 'sender_note_saved',
        entityType: 'sender_note',
        entityId: parsed.domainOrEmail.trim().toLowerCase(),
      });
      res.json({ ok: true });
    } catch (err: any) {
      res.status(400).json({ error: 'SENDER_NOTE_INVALID', message: err.message });
    }
  });

  app.delete('/api/sender-notes/:id', requireOwnerAuth, async (req, res, next) => {
    try {
      await db.query('DELETE FROM sender_notes WHERE id = $1', [req.params.id!]);
      res.json({ deleted: true });
    } catch (err) {
      next(err);
    }
  });

  // Privacy Center, Retention & Audit Logs
  app.delete('/api/privacy/opportunities/:id', requireOwnerAuth, async (req, res, next) => {
    try {
      const out = await retentionService.deleteOpportunityAndDerivedContent(req.principal!.email, req.params.id!);
      res.json(out);
    } catch (err) {
      next(err);
    }
  });

  app.post('/api/privacy/purge-all-gmail-data', requireOwnerAuth, async (req, res, next) => {
    try {
      const disconnectToo = Boolean(req.body?.disconnectMailbox);
      const out = await retentionService.deleteAllStoredGmailDerivedData(req.principal!.email, disconnectToo);
      res.json(out);
    } catch (err) {
      next(err);
    }
  });

  app.post('/api/privacy/run-retention-now', requireOwnerAuth, async (req, res, next) => {
    try {
      const out = await retentionService.runRetentionCleanup(req.principal!.email);
      res.json(out);
    } catch (err) {
      next(err);
    }
  });

  app.get('/api/privacy/export-metadata', requireOwnerAuth, async (_req, res, next) => {
    try {
      res.json(await retentionService.exportNonSecretMetadataSummary());
    } catch (err) {
      next(err);
    }
  });

  app.get('/api/audit-events', requireOwnerAuth, async (_req, res, next) => {
    try {
      res.json({ events: await listAuditEvents(db, 150) });
    } catch (err) {
      next(err);
    }
  });

  // Serve built static frontend dashboard (`dist/public`)
  const thisDir = path.dirname(fileURLToPath(import.meta.url));
  const candidatePublicDirs = [
    path.resolve(thisDir, '../dist/public'),
    path.resolve(thisDir, './public'),
  ];
  const staticDir = candidatePublicDirs.find((d) => fs.existsSync(path.join(d, 'index.html')));

  if (staticDir) {
    app.use(express.static(staticDir));
    app.get('*', (req, res, next) => {
      if (req.path.startsWith('/api/')) return next();
      res.sendFile(path.join(staticDir, 'index.html'));
    });
  }

  // Global safe error handler (never echoes secrets or stack traces in responses)
  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof ModelArtifactIntegrityError) {
      return res.status(503).json({
        error: 'MODEL_ARTIFACT_INTEGRITY_ERROR',
        reasonCode: err.reasonCode,
        message: err.message,
      });
    }
    if (err instanceof GmailQuotaSafetyStopError) {
      return res.status(429).json({
        error: err.code,
        limitKind: err.limitKind,
        unitsUsed: err.unitsUsed,
        limitUnits: err.limitUnits,
        message: err.message,
      });
    }
    logger.error('unhandled_api_error', { message: err?.message || 'Unknown error' });
    res.status(500).json({
      error: 'INTERNAL_SERVER_ERROR',
      message: 'An unexpected server error occurred.',
    });
  });

  return app;
}
