import crypto from 'node:crypto';
import path from 'node:path';

export type SpcrOperatingMode = 'LOCAL_ZERO_COST' | 'FREE_CLOUD_OPTIONAL';
export type OptionalGroqMode = 'DISABLED' | 'OPTIONAL_GROQ';

export interface AppConfig {
  nodeEnv: 'development' | 'test' | 'production';
  operatingMode: SpcrOperatingMode;
  optionalGroqMode: OptionalGroqMode;
  groqFreeTierOnly: boolean;
  port: number;
  appBaseUrl: string;
  ownerEmail: string;
  demoAuthEnabled: boolean;
  databaseUrl: string;
  sessionSecret: string;
  tokenEncryptionKeyHex: string;
  workerSharedSecret: string;
  googleClientId: string;
  googleClientSecret: string;
  googleOidcRedirectUri: string;
  googleGmailRedirectUri: string;
  gmailPolicyGateApproved: boolean;
  gmailDailyQuotaSafetyLimitUnits: number;
  gmailPerSyncMaxQuotaUnits: number;
  localSyncIntervalSeconds: number;
  groqApiKey: string;
  groqModel: string;
  groqLiveEnabled: boolean;
  classifierCacheDir: string;
  classifierOfflineOnly: boolean;
  emailModelArtifactPath: string;
  maxAttachmentBytes: number;
  maxTotalAttachmentStorageBytes: number;
  maxPdfPages: number;
  maxExtractedChars: number;
  attachmentParseTimeoutMs: number;
}

const EPHEMERAL_DEV_SESSION_SECRET = crypto.randomBytes(32).toString('hex');
// Deterministic local-dev key ONLY when NODE_ENV !== 'production' and TOKEN_ENCRYPTION_KEY is unset,
// so local `dev` and `dev:worker` processes can share local PGlite encrypted blobs during zero-cost local runs.
const LOCAL_DEMO_ENCRYPTION_KEY_HEX = crypto
  .createHash('sha256')
  .update('spcr-local-demo-non-production-encryption-key-v1')
  .digest('hex');
const EPHEMERAL_WORKER_SECRET = crypto.randomBytes(32).toString('hex');

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const rawEnv = (env.NODE_ENV || 'development').trim();
  const nodeEnv: AppConfig['nodeEnv'] =
    rawEnv === 'production' ? 'production' : rawEnv === 'test' ? 'test' : 'development';

  const rawOperatingMode = (env.SPCR_OPERATING_MODE || 'LOCAL_ZERO_COST').trim().toUpperCase();
  const operatingMode: SpcrOperatingMode =
    rawOperatingMode === 'FREE_CLOUD_OPTIONAL' ? 'FREE_CLOUD_OPTIONAL' : 'LOCAL_ZERO_COST';

  const groqLiveEnabled = env.GROQ_LIVE_ENABLED === 'true';
  const optionalGroqMode: OptionalGroqMode = groqLiveEnabled ? 'OPTIONAL_GROQ' : 'DISABLED';
  // Enforce free-tier quota guard by default so OPTIONAL_GROQ halts before triggering paid billing or rate overages
  const groqFreeTierOnly = env.GROQ_FREE_TIER_ONLY !== 'false';

  const ownerEmail = (env.SPCR_OWNER_EMAIL || (nodeEnv === 'production' ? '' : 'tpo@college.example.edu'))
    .trim()
    .toLowerCase();

  // Hard security rule: local demo login is NEVER permitted when NODE_ENV === 'production'.
  const demoAuthEnabled = nodeEnv !== 'production' && env.SPCR_DEMO_AUTH_ENABLED !== 'false';

  const databaseUrl = (
    env.DATABASE_URL ||
    (nodeEnv === 'production' && operatingMode === 'FREE_CLOUD_OPTIONAL' ? '' : 'pglite://./.data/spcr-pg')
  ).trim();

  const sessionSecret = (env.SESSION_SECRET || '').trim() || (nodeEnv === 'production' ? '' : EPHEMERAL_DEV_SESSION_SECRET);
  const tokenEncryptionKeyHex =
    (env.TOKEN_ENCRYPTION_KEY || '').trim() || (nodeEnv === 'production' ? '' : LOCAL_DEMO_ENCRYPTION_KEY_HEX);
  const workerSharedSecret =
    (env.WORKER_SHARED_SECRET || '').trim() || (nodeEnv === 'production' ? '' : EPHEMERAL_WORKER_SECRET);

  if (nodeEnv === 'production') {
    if (!ownerEmail || !ownerEmail.includes('@')) {
      throw new Error('SPCR_OWNER_EMAIL must be configured to a valid email address in production.');
    }
    if (operatingMode === 'FREE_CLOUD_OPTIONAL') {
      if (!databaseUrl.startsWith('postgres://') && !databaseUrl.startsWith('postgresql://')) {
        throw new Error(
          'DATABASE_URL must be an approved free-tier PostgreSQL URL when SPCR_OPERATING_MODE=FREE_CLOUD_OPTIONAL in production.'
        );
      }
    } else if (
      !databaseUrl.startsWith('pglite://') &&
      !databaseUrl.startsWith('postgres://') &&
      !databaseUrl.startsWith('postgresql://')
    ) {
      throw new Error('DATABASE_URL must be a local pglite:// path or local PostgreSQL URL in LOCAL_ZERO_COST mode.');
    }
    if (sessionSecret.length < 32) {
      throw new Error('SESSION_SECRET must be at least 32 characters in production.');
    }
    if (!/^[0-9a-fA-F]{64}$/.test(tokenEncryptionKeyHex)) {
      throw new Error('TOKEN_ENCRYPTION_KEY must be a 64-character hex string (32 bytes) in production.');
    }
  }

  const port = Number.parseInt(env.PORT || '3000', 10) || 3000;
  const appBaseUrl = (env.APP_BASE_URL || `http://localhost:${port}`).replace(/\/+$/, '');

  const defaultArtifactPath = path.resolve(process.cwd(), 'ml/artifacts/recruitment_email_model_v1.json');

  return {
    nodeEnv,
    operatingMode,
    optionalGroqMode,
    groqFreeTierOnly,
    port,
    appBaseUrl,
    ownerEmail,
    demoAuthEnabled,
    databaseUrl,
    sessionSecret,
    tokenEncryptionKeyHex,
    workerSharedSecret,
    googleClientId: (env.GOOGLE_CLIENT_ID || '').trim(),
    googleClientSecret: (env.GOOGLE_CLIENT_SECRET || '').trim(),
    googleOidcRedirectUri: (env.GOOGLE_OIDC_REDIRECT_URI || `${appBaseUrl}/api/auth/google/callback`).trim(),
    googleGmailRedirectUri: (env.GOOGLE_GMAIL_REDIRECT_URI || `${appBaseUrl}/api/gmail/oauth/callback`).trim(),
    gmailPolicyGateApproved: env.GMAIL_POLICY_GATE_APPROVED === 'true',
    gmailDailyQuotaSafetyLimitUnits:
      Number.parseInt(env.GMAIL_DAILY_QUOTA_SAFETY_LIMIT_UNITS || '10000', 10) || 10_000,
    gmailPerSyncMaxQuotaUnits:
      Number.parseInt(env.GMAIL_PER_SYNC_MAX_QUOTA_UNITS || '500', 10) || 500,
    localSyncIntervalSeconds: Math.max(0, Number.parseInt(env.LOCAL_SYNC_INTERVAL_SECONDS || '0', 10) || 0),
    groqApiKey: (env.GROQ_API_KEY || '').trim(),
    groqModel: (env.GROQ_MODEL || 'openai/gpt-oss-20b').trim(),
    groqLiveEnabled,
    classifierCacheDir: (env.CLASSIFIER_CACHE_DIR || './.models_cache').trim(),
    classifierOfflineOnly: env.CLASSIFIER_OFFLINE_ONLY === 'true',
    emailModelArtifactPath: (env.EMAIL_MODEL_ARTIFACT_PATH || defaultArtifactPath).trim(),
    maxAttachmentBytes: Number.parseInt(env.MAX_ATTACHMENT_BYTES || '5242880', 10) || 5_242_880,
    maxTotalAttachmentStorageBytes:
      Number.parseInt(env.MAX_TOTAL_ATTACHMENT_STORAGE_BYTES || '262144000', 10) || 262_144_000,
    maxPdfPages: Number.parseInt(env.MAX_PDF_PAGES || '25', 10) || 25,
    maxExtractedChars: Number.parseInt(env.MAX_EXTRACTED_CHARS || '60000', 10) || 60_000,
    attachmentParseTimeoutMs: Number.parseInt(env.ATTACHMENT_PARSE_TIMEOUT_MS || '5000', 10) || 5_000,
  };
}
