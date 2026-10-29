import { QueryExecutor } from '../db/database.js';
import { randomId } from '../utils/crypto.js';
import { sanitizeForLog } from '../utils/logger.js';

export interface AuditEventInput {
  actorEmail?: string | null;
  eventType: string;
  entityType: string;
  entityId?: string | null;
  metadata?: Record<string, unknown>;
}

export async function recordAuditEvent(db: QueryExecutor, input: AuditEventInput): Promise<string> {
  const id = randomId('aud');
  const safeMeta = (sanitizeForLog(input.metadata || {}) as Record<string, unknown>) || {};
  await db.query(
    `INSERT INTO audit_events (id, actor_email, event_type, entity_type, entity_id, metadata_json)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb)`,
    [
      id,
      input.actorEmail ?? null,
      input.eventType,
      input.entityType,
      input.entityId ?? null,
      JSON.stringify(safeMeta),
    ]
  );
  return id;
}

export async function listAuditEvents(db: QueryExecutor, limit = 100) {
  const res = await db.query<{
    id: string;
    actor_email: string | null;
    event_type: string;
    entity_type: string;
    entity_id: string | null;
    metadata_json: Record<string, unknown>;
    created_at: string;
  }>(
    `SELECT id, actor_email, event_type, entity_type, entity_id, metadata_json, created_at
     FROM audit_events
     ORDER BY created_at DESC
     LIMIT $1`,
    [Math.min(Math.max(limit, 1), 500)]
  );
  return res.rows;
}

