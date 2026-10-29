import path from 'node:path';
import { loadConfig } from '../src/config/env.js';
import { createDatabase, runMigrations } from '../src/db/database.js';
import { EmailIntelligenceService } from '../src/services/emailIntelligenceService.js';
import { RetrainingService } from '../src/services/retrainingService.js';

async function main() {
  const mode = process.argv[2] === '--rollback' ? 'rollback' : 'retrain';
  const targetVersion = process.argv[3];
  const config = loadConfig();
  const db = await createDatabase(config.databaseUrl);
  await runMigrations(db, path.resolve(process.cwd(), 'migrations'));

  const emailIntelligence = new EmailIntelligenceService({
    artifactPath: config.emailModelArtifactPath,
    cacheDir: config.classifierCacheDir,
    offlineOnly: config.classifierOfflineOnly,
  });
  const retraining = new RetrainingService(db, emailIntelligence, {
    cacheDir: config.classifierCacheDir,
    defaultArtifactPath: config.emailModelArtifactPath,
  });

  try {
    if (mode === 'rollback') {
      const out = await retraining.rollbackModelVersion({
        targetVersion,
        actorEmail: config.ownerEmail,
      });
      console.log(
        `[ml:rollback] Rolled back active model from ${out.previousActiveVersion} -> ${out.rolledBackToVersion} (${out.artifactPath})`
      );
    } else {
      const out = await retraining.retrainFromApprovedFeedback({
        actorEmail: config.ownerEmail,
        compareHybridMiniLm: true,
        autoActivate: true,
      });
      console.log(
        `[ml:retrain] Built ${out.newModelVersion} with ${out.approvedFeedbackIncluded} approved feedback items. Held-out Macro-F1=${out.heldOutMacroF1.toFixed(
          4
        )}, passedRegressionGate=${out.passedRegressionGate}, activated=${out.activated}`
      );
    }
  } finally {
    await db.close();
  }
}

main().catch((err) => {
  console.error('[ml:retrain/rollback] Error:', err);
  process.exitCode = 1;
});
