import { loadConfig } from '../config/env.js';
import { createDatabase, runMigrations } from './database.js';

async function main() {
  const config = loadConfig();
  const db = await createDatabase(config.databaseUrl);
  try {
    const applied = await runMigrations(db);
    console.log(`SPCR PostgreSQL migrations complete (${db.driverType}). Newly applied: ${applied.length}`);
  } finally {
    await db.close();
  }
}

main().catch((err) => {
  console.error('Migration failed:', err instanceof Error ? err.message : String(err));
  process.exit(1);
});

