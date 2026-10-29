import { loadConfig } from './config/env.js';
import { createDatabase, runMigrations } from './db/database.js';
import { createServiceContainer, createSpcrApp } from './app.js';
import { executeWorkerCycleOnce } from './worker.js';
import { logger } from './utils/logger.js';

async function main() {
  const config = loadConfig();
  const db = await createDatabase(config.databaseUrl);
  await runMigrations(db);

  const services = createServiceContainer({ config, db });
  await services.retrainingService.ensureInitializedRegistry();
  const app = createSpcrApp(services);

  let localSyncTimer: NodeJS.Timeout | null = null;
  if (config.localSyncIntervalSeconds > 0) {
    const intervalMs = Math.max(15, config.localSyncIntervalSeconds) * 1000;
    localSyncTimer = setInterval(() => {
      executeWorkerCycleOnce(services, 'local-inproc-sync').catch((err) => {
        logger.warn('local_inproc_sync_cycle_error', {
          message: err instanceof Error ? err.message : String(err),
        });
      });
    }, intervalMs);
  }

  const server = app.listen(config.port, () => {
    logger.info('spcr_web_server_started', {
      port: config.port,
      nodeEnv: config.nodeEnv,
      operatingMode: config.operatingMode,
      optionalGroqMode: config.optionalGroqMode,
      recurringSoftwareCostInr: 0,
      appBaseUrl: config.appBaseUrl,
      dbDriver: db.driverType,
      demoAuthEnabled: config.demoAuthEnabled,
      gmailPolicyGateApproved: config.gmailPolicyGateApproved,
      localSyncIntervalSeconds: config.localSyncIntervalSeconds,
      groqLiveEnabled: config.groqLiveEnabled && Boolean(config.groqApiKey),
    });
  });

  const shutdown = async () => {
    if (localSyncTimer) clearInterval(localSyncTimer);
    server.close();
    await db.close();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  logger.error('spcr_web_server_fatal', { message: err instanceof Error ? err.message : String(err) });
  process.exit(1);
});

