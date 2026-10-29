import path from 'node:path';
import { AppConfig } from '../src/config/env.js';
import { createDatabase, Database, runMigrations } from '../src/db/database.js';
import { createSpcrApp, SpcrServiceContainer } from '../src/app.js';
import { AuthService, GoogleOidcTokenVerifier } from '../src/services/authService.js';
import { RoutingAndDispatchService } from '../src/services/routingAndDispatchService.js';
import { LocalOnnxRecruitmentClassifier } from '../src/services/localClassifier.js';
import { EmailIntelligenceService, LocalMiniLmEmbeddingProvider } from '../src/services/emailIntelligenceService.js';
import { RetrainingService } from '../src/services/retrainingService.js';
import { AttachmentExtractor, SharedAttachmentStorageService } from '../src/services/attachmentService.js';
import { ScreeningAndMatchingService } from '../src/services/screeningAndMatchingService.js';
import { GmailApiClient, GmailSyncService } from '../src/services/gmailSyncService.js';
import { GroqDraftingService, GroqTransport } from '../src/services/groqDraftingService.js';
import { RetentionAndPrivacyService } from '../src/services/retentionAndPrivacyService.js';

// Reuse verified local ONNX instances across test cases in the same Vitest worker
let sharedClassifier: LocalOnnxRecruitmentClassifier | null = null;
let sharedEmbeddingProvider: LocalMiniLmEmbeddingProvider | null = null;

export function getSharedTestClassifier(): LocalOnnxRecruitmentClassifier {
  if (!sharedClassifier) {
    sharedClassifier = new LocalOnnxRecruitmentClassifier({
      cacheDir: path.resolve(process.cwd(), '.models_cache'),
      offlineOnly: true,
    });
  }
  return sharedClassifier;
}

export function getSharedTestEmbeddingProvider(): LocalMiniLmEmbeddingProvider {
  if (!sharedEmbeddingProvider) {
    sharedEmbeddingProvider = new LocalMiniLmEmbeddingProvider({
      cacheDir: path.resolve(process.cwd(), '.models_cache'),
      offlineOnly: true,
    });
  }
  return sharedEmbeddingProvider;
}

export function buildTestConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  const groqLiveEnabled = overrides.groqLiveEnabled ?? false;
  const groqApiKey = overrides.groqApiKey ?? '';
  return {
    nodeEnv: 'test',
    operatingMode: 'LOCAL_ZERO_COST',
    optionalGroqMode: groqLiveEnabled && Boolean(groqApiKey) ? 'OPTIONAL_GROQ' : 'DISABLED',
    groqFreeTierOnly: true,
    port: 0,
    appBaseUrl: 'http://localhost:3000',
    databaseUrl: 'pglite://memory',
    ownerEmail: 'tpo@college.edu',
    demoAuthEnabled: true,
    sessionSecret: 'test-session-secret-0123456789abcdef0123456789abcdef',
    tokenEncryptionKeyHex: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
    workerSharedSecret: 'test-worker-shared-secret-0123456789abcdef',
    googleClientId: 'test-google-client-id.apps.googleusercontent.com',
    googleClientSecret: 'test-google-client-secret',
    googleOidcRedirectUri: 'http://localhost:3000/api/auth/google/callback',
    googleGmailRedirectUri: 'http://localhost:3000/api/gmail/oauth/callback',
    gmailPolicyGateApproved: false,
    gmailDailyQuotaSafetyLimitUnits: 25_000,
    gmailPerSyncMaxQuotaUnits: 2_500,
    localSyncIntervalSeconds: 0,
    groqApiKey,
    groqModel: 'openai/gpt-oss-20b',
    groqLiveEnabled,
    classifierCacheDir: path.resolve(process.cwd(), '.models_cache'),
    classifierOfflineOnly: true,
    emailModelArtifactPath: path.resolve(process.cwd(), 'ml/artifacts/recruitment_email_model_v1.json'),
    maxAttachmentBytes: 10 * 1024 * 1024,
    maxTotalAttachmentStorageBytes: 250 * 1024 * 1024,
    maxPdfPages: 40,
    maxExtractedChars: 50_000,
    attachmentParseTimeoutMs: 8000,
    ...overrides,
  };
}

export async function createTestSpcrEnvironment(options: {
  configOverrides?: Partial<AppConfig>;
  oidcVerifier?: GoogleOidcTokenVerifier;
  gmailApiClient?: GmailApiClient;
  groqTransport?: GroqTransport;
  attachmentExtractor?: AttachmentExtractor;
  emailIntelligence?: EmailIntelligenceService;
} = {}) {
  const config = buildTestConfig(options.configOverrides);
  const db: Database = await createDatabase('pglite://memory');
  await runMigrations(db);

  const classifier = getSharedTestClassifier();
  const emailIntelligence =
    options.emailIntelligence ||
    new EmailIntelligenceService({
      artifactPath: config.emailModelArtifactPath,
      cacheDir: config.classifierCacheDir,
      offlineOnly: config.classifierOfflineOnly,
      embeddingProvider: getSharedTestEmbeddingProvider(),
    });
  const retrainingService = new RetrainingService(db, emailIntelligence, {
    cacheDir: config.classifierCacheDir,
    defaultArtifactPath: config.emailModelArtifactPath,
  });
  const authService = new AuthService(db, config, options.oidcVerifier);
  const routingService = new RoutingAndDispatchService(db);
  const attachmentStorage = new SharedAttachmentStorageService(db, config, options.attachmentExtractor);
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
    options.gmailApiClient,
    emailIntelligence
  );
  const groqDrafting = new GroqDraftingService(db, config, routingService, options.groqTransport);
  const retentionService = new RetentionAndPrivacyService(db, config, gmailSync);

  const services: SpcrServiceContainer = {
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

  const app = createSpcrApp(services);

  return {
    config,
    db,
    services,
    app,
    async cleanup() {
      await db.close();
    },
  };
}
