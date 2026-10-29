-- Migration 003: Granular dispatch batch completion statuses
-- Adds discriminated completion statuses so a batch where all targets were
-- skipped or failed is NOT incorrectly reported as "dispatched".
-- The old 'completed' value is preserved for rows written before this migration.
--
-- New status values (in addition to existing 'ready', 'in_progress',
-- 'stale_invalidated', 'cancelled', 'completed'):
--   completed_all_sent    – every active target was officer_marked_sent
--   completed_partial     – at least one sent; others skipped/failed/uncertain
--   completed_all_skipped – all targets skipped (nothing actually sent)
--   completed_all_failed  – all targets failed (nothing actually sent)
--   completed_uncertain   – all targets uncertain_needs_confirmation

-- Drop the old restrictive CHECK constraint and replace it with one that also
-- accepts the new granular completion statuses.
ALTER TABLE dispatch_batches
  DROP CONSTRAINT IF EXISTS dispatch_batches_status_check;

ALTER TABLE dispatch_batches
  ADD CONSTRAINT dispatch_batches_status_check CHECK (
    status IN (
      'ready',
      'in_progress',
      'completed',
      'completed_all_sent',
      'completed_partial',
      'completed_all_skipped',
      'completed_all_failed',
      'completed_uncertain',
      'cancelled',
      'stale_invalidated'
    )
  );

-- Index on batch status for dashboard queries
CREATE INDEX IF NOT EXISTS idx_dispatch_batches_status ON dispatch_batches (status);
CREATE INDEX IF NOT EXISTS idx_dispatch_batches_opportunity_status ON dispatch_batches (opportunity_id, status);

-- Convenience view that surfaces the delivery quality of each completed batch.
-- Read-only; does not replace the underlying table.
CREATE OR REPLACE VIEW dispatch_batch_delivery_summary AS
SELECT
  db.id AS batch_id,
  db.opportunity_id,
  db.status AS batch_status,
  COUNT(dt.id) FILTER (WHERE dt.status = 'pending')                        AS pending_count,
  COUNT(dt.id) FILTER (WHERE dt.status = 'officer_marked_sent')            AS sent_count,
  COUNT(dt.id) FILTER (WHERE dt.status = 'skipped')                        AS skipped_count,
  COUNT(dt.id) FILTER (WHERE dt.status = 'failed')                         AS failed_count,
  COUNT(dt.id) FILTER (WHERE dt.status = 'uncertain_needs_confirmation')   AS uncertain_count,
  COUNT(dt.id) FILTER (WHERE dt.status = 'stale_approval_invalidated')     AS stale_count,
  COUNT(dt.id)                                                              AS total_count,
  db.created_at,
  db.updated_at
FROM dispatch_batches db
LEFT JOIN dispatch_targets dt ON dt.batch_id = db.id
GROUP BY db.id;
