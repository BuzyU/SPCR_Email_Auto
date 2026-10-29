import crypto from 'node:crypto';

export interface AppConfig {
  nodeEnv: 'development' | 'test' | 'production';
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
  groqApiKey: string;
  groqModel: string;
  groqLiveEnabled: boolean;
  classifierCacheDir: string;
  classifierOfflineOnly: boolean;
  maxAttachmentBytes: number;
  maxTotalAttachmentStorageBytes: number;
  maxPdfPages: number;
  maxExtractedChars: number;
  attachmentParseTimeoutMs: number;
}

const EPHEMERAL_DEV_SESSION_SECRET = crypto.randomBytes(32).toString('hex');
// Deterministic local-dev key ONLY when NODE_ENV !== 'production' and TOKEN_ENCRYPTION_KEY is unset,
// so local `dev` and `dev:worker` processes can share local PGlite encrypted blobs during demo runs.
const LOCAL_DEMO_ENCRYPTION_KEY_HEX = crypto
  .createHash('sha256')
  .update('spcr-local-demo-non-production-encryption-key-v1')
  .digest('hex');
const EPHEMERAL_WORKER_SECRET = crypto.randomBytes(32).toString('hex');

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const rawEnv = (env.NODE_ENV || 'development').trim();
  const nodeEnv: AppConfig['nodeEnv'] =
    rawEnv === 'production' ? 'production' : rawEnv === 'test' ? 'test' : 'development';

  const ownerEmail = (env.SPCR_OWNER_EMAIL || (nodeEnv === 'production' ? '' : 'tpo@college.example.edu'))
    .trim()
    .toLowerCase();

  // Hard security rule: local demo login is NEVER permitted in production, even if env var is set true.
  const demoAuthEnabled = nodeEnv !== 'production' && env.SPCR_DEMO_AUTH_ENABLED !== 'false';

  const databaseUrl = (
    env.DATABASE_URL || (nodeEnv === 'production' ? '' : 'pglite://./.data/spcr-pg')
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
    if (!databaseUrl.startsWith('postgres://') && !databaseUrl.startsWith('postgresql://')) {
      throw new Error('DATABASE_URL must be a Render/managed PostgreSQL URL in production (ephemeral local storage disallowed).');
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

  return {
    nodeEnv,
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
    groqApiKey: (env.GROQ_API_KEY || '').trim(),
    groqModel: (env.GROQ_MODEL || 'openai/gpt-oss-20b').trim(),
    groqLiveEnabled: env.GROQ_LIVE_ENABLED === 'true',
    classifierCacheDir: (env.CLASSIFIER_CACHE_DIR || './.models_cache').trim(),
    classifierOfflineOnly: env.CLASSIFIER_OFFLINE_ONLY === 'true',
    maxAttachmentBytes: Number.parseInt(env.MAX_ATTACHMENT_BYTES || '5242880', 10) || 5_242_880,
    maxTotalAttachmentStorageBytes:
      Number.parseInt(env.MAX_TOTAL_ATTACHMENT_STORAGE_BYTES || '262144000', 10) || 262_144_000,
    maxPdfPages: Number.parseInt(env.MAX_PDF_PAGES || '25', 10) || 25,
    maxExtractedChars: Number.parseInt(env.MAX_EXTRACTED_CHARS || '60000', 10) || 60_000,
    attachmentParseTimeoutMs: Number.parseInt(env.ATTACHMENT_PARSE_TIMEOUT_MS || '5000', 10) || 5_000,
  };
}

