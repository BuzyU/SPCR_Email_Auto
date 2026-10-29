import { loadConfig } from './config/env.js';
import { createDatabase, runMigrations } from './db/database.js';
import { createServiceContainer, createSpcrApp } from './app.js';
import { logger } from './utils/logger.js';

async function main() {
  const config = loadConfig();
  const db = await createDatabase(config.databaseUrl);
  await runMigrations(db);

  const services = createServiceContainer({ config, db });
  const app = createSpcrApp(services);

  const server = app.listen(config.port, () => {
    logger.info('spcr_web_server_started', {
      port: config.port,
      nodeEnv: config.nodeEnv,
      appBaseUrl: config.appBaseUrl,
      dbDriver: db.driverType,
      demoAuthEnabled: config.demoAuthEnabled,
      gmailPolicyGateApproved: config.gmailPolicyGateApproved,
      groqLiveEnabled: config.groqLiveEnabled && Boolean(config.groqApiKey),
    });
  });

  const shutdown = async () => {
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

