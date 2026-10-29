import os from 'node:os';
import { loadConfig } from './config/env.js';
import { createDatabase, runMigrations } from './db/database.js';
import { createServiceContainer, SpcrServiceContainer } from './app.js';
import { getSettings } from './services/settingsService.js';
import { logger } from './utils/logger.js';

/**
 * Executes a single background worker cycle safely under PostgreSQL lease protection:
 * 1. Acquires/renews `worker_leases` lock so duplicate workers cannot double-poll.
 * 2. When `GMAIL_POLICY_GATE_APPROVED=true` and Gmail is connected, polls Gmail incrementally with ZERO Groq calls.
 * 3. Separately, ONLY if the officer explicitly enabled `autoDraftHighConfidence` (+ accepted disclosure + confirmed budget),
 *    processes high-confidence unformatted candidates through the post-screen Groq drafting queue.
 */
export async function executeWorkerCycleOnce(
  services: SpcrServiceContainer,
  holderId: string
): Promise<{
  leaseAcquired: boolean;
  polledMessages: number;
  autoDraftedCount: number;
  skippedReason?: string;
}> {
  const acquired = await services.gmailSync.acquireOrRenewWorkerLease(holderId, 60, {
    lastAttemptAt: new Date().toISOString(),
  });

  if (!acquired) {
    return {
      leaseAcquired: false,
      polledMessages: 0,
      autoDraftedCount: 0,
      skippedReason: 'Another worker instance currently holds an unexpired gmail_monitor lease.',
    };
  }

  let polledMessages = 0;
  let autoDraftedCount = 0;

  // Stage A: Independent Gmail Screening (ZERO Groq calls!)
  if (services.config.gmailPolicyGateApproved) {
    try {
      const pollRes = await services.gmailSync.pollNewMessages(`worker:${holderId}`);
      polledMessages = pollRes.polledCount;
    } catch (err: any) {
      logger.warn('worker_gmail_poll_error', { message: err?.message || String(err) });
    }
  }

  // Stage B: Separate Post-Screen Auto-Drafting Queue (DEFAULT OFF!)
  // Strictly isolated from Stage A; never touches uncertain or suspicious items, and never runs when OPTIONAL_GROQ is DISABLED!
  const settings = await getSettings(services.db, services.config);
  if (
    services.config.optionalGroqMode === 'OPTIONAL_GROQ' &&
    settings.autoDraftHighConfidence &&
    settings.groqDisclosureAcceptedAt &&
    settings.budgetConfirmedAt &&
    settings.monthlyBudgetInr &&
    settings.monthlyBudgetInr > 0
  ) {
    const eligibleRes = await services.db.query<{ id: string }>(
      `SELECT o.id
       FROM opportunities o
       WHERE o.status = 'ready_for_draft'
         AND o.screening_confidence_tier = 'high'
         AND NOT EXISTS (
           SELECT 1 FROM draft_versions dv
           WHERE dv.opportunity_id = o.id
             AND dv.opportunity_version = o.current_version
             AND dv.generated_by IN ('groq_live', 'groq_mock_demo')
         )
       ORDER BY o.created_at ASC
       LIMIT 3`
    );

    for (const row of eligibleRes.rows) {
      try {
        await services.groqDrafting.formatOpportunityWithGroq({
          actorEmail: `auto_draft_queue:${holderId}`,
          opportunityId: row.id,
          triggerMode: 'auto_high_confidence_queue',
        });
        autoDraftedCount++;
      } catch (err: any) {
        logger.warn('worker_auto_draft_item_stopped', {
          opportunityId: row.id,
          code: err?.code || 'ERR',
          message: err?.message || String(err),
        });
        break;
      }
    }
  }

  await services.gmailSync.acquireOrRenewWorkerLease(holderId, 60, {
    lastCompletedAt: new Date().toISOString(),
    polledMessages,
    autoDraftedCount,
  });

  return { leaseAcquired: true, polledMessages, autoDraftedCount };
}

async function main() {
  const config = loadConfig();
  const db = await createDatabase(config.databaseUrl);
  await runMigrations(db);
  const services = createServiceContainer({ config, db });

  const holderId = `${os.hostname()}-${process.pid}`;
  const pollIntervalMs = Number.parseInt(process.env.WORKER_POLL_INTERVAL_MS || '45000', 10) || 45_000;
  let running = true;

  // CRITICAL: Register signal handlers BEFORE the polling loop so SIGINT/SIGTERM
  // received during any active cycle still sets running=false and the loop exits
  // after the current cycle completes (graceful drain, no abrupt kill).
  process.on('SIGINT', () => {
    logger.info('spcr_worker_sigint_received', { holderId });
    running = false;
  });
  process.on('SIGTERM', () => {
    logger.info('spcr_worker_sigterm_received', { holderId });
    running = false;
  });

  logger.info('spcr_background_worker_started', {
    holderId,
    pollIntervalMs,
    gmailPolicyGateApproved: config.gmailPolicyGateApproved,
  });

  // Periodic retention check every 12 hours when policy is validated
  let lastRetentionRunMs = 0;

  while (running) {
    await executeWorkerCycleOnce(services, holderId);

    const settings = await getSettings(db, config);
    if (settings.retentionPolicyValidated && Date.now() - lastRetentionRunMs > 12 * 3600_000) {
      await services.retentionService.runRetentionCleanup(`worker:${holderId}`);
      lastRetentionRunMs = Date.now();
    }

    if (!running) break;
    await new Promise((r) => setTimeout(r, pollIntervalMs));
  }

  logger.info('spcr_background_worker_stopped', { holderId });
}

if (import.meta.url === `file:///${process.argv[1]?.replace(/\\/g, '/')}` || process.argv[1]?.endsWith('worker.ts') || process.argv[1]?.endsWith('worker.js')) {
  main().catch((err) => {
    logger.error('spcr_worker_fatal', { message: err instanceof Error ? err.message : String(err) });
    process.exit(1);
  });
}

