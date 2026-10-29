import { Database } from '../db/database.js';
import { AppConfig } from '../config/env.js';
import { getSettings } from './settingsService.js';
import { GmailSyncService } from './gmailSyncService.js';
import { recordAuditEvent } from './auditService.js';

export class RetentionAndPrivacyService {
  constructor(
    private readonly db: Database,
    private readonly config: AppConfig,
    private readonly gmailSync: GmailSyncService
  ) {}

  /**
   * Deletes an individual opportunity along with its linked message bodies, attachment blobs,
   * extracted facts, drafts, approvals, and dispatch records.
   */
  async deleteOpportunityAndDerivedContent(actorEmail: string, opportunityId: string) {
    return this.db.withTransaction(async (tx) => {
      const linkedMsgRes = await tx.query<{ source_message_id: string }>(
        'SELECT source_message_id FROM opportunity_message_links WHERE opportunity_id = $1',
        [opportunityId]
      );
      const msgIds = linkedMsgRes.rows.map((r) => r.source_message_id);

      // Delete attachments (cascades to `attachment_blobs` encrypted BYTEA!)
      const delAttRes = await tx.query<{ id: string }>(
        'DELETE FROM attachments WHERE opportunity_id = $1 RETURNING id',
        [opportunityId]
      );

      // Delete opportunity (cascades to versions, links, facts, drafts, approvals, dispatch batches & targets)
      const delOppRes = await tx.query<{ id: string }>('DELETE FROM opportunities WHERE id = $1 RETURNING id', [
        opportunityId,
      ]);

      // Scrub stored email body/snippet/headers on orphaned source_messages while keeping minimal message ID
      // or remove entirely if not linked to any other opportunity
      for (const msgId of msgIds) {
        const otherLinks = await tx.query<{ cnt: string }>(
          'SELECT COUNT(*)::text AS cnt FROM opportunity_message_links WHERE source_message_id = $1',
          [msgId]
        );
        if (Number.parseInt(otherLinks.rows[0]?.cnt || '0', 10) === 0) {
          await tx.query('DELETE FROM attachments WHERE source_message_id = $1', [msgId]);
          await tx.query('DELETE FROM source_messages WHERE id = $1', [msgId]);
        }
      }

      await recordAuditEvent(tx, {
        actorEmail,
        eventType: 'opportunity_deleted',
        entityType: 'opportunity',
        entityId: opportunityId,
        metadata: {
          deletedOpportunityCount: delOppRes.rowCount,
          deletedAttachmentsCount: delAttRes.rowCount,
        },
      });

      return {
        deletedOpportunity: delOppRes.rowCount > 0,
        deletedAttachmentsCount: delAttRes.rowCount,
      };
    });
  }

  /**
   * Deletes ALL stored Gmail-derived data (messages, screening outcomes, opportunities,
   * encrypted attachment blobs, extracted facts, drafts, approvals, dispatch history).
   */
  async deleteAllStoredGmailDerivedData(actorEmail: string, disconnectMailboxToo = false) {
    if (disconnectMailboxToo) {
      await this.gmailSync.disconnectMailbox(actorEmail);
    }

    return this.db.withTransaction(async (tx) => {
      const blobsDel = await tx.query('DELETE FROM attachment_blobs');
      const attDel = await tx.query('DELETE FROM attachments');
      const oppDel = await tx.query('DELETE FROM opportunities');
      const msgDel = await tx.query('DELETE FROM source_messages');

      await recordAuditEvent(tx, {
        actorEmail,
        eventType: 'all_gmail_derived_data_purged',
        entityType: 'privacy_center',
        metadata: {
          purgedMessages: msgDel.rowCount,
          purgedOpportunities: oppDel.rowCount,
          purgedAttachments: attDel.rowCount,
          purgedEncryptedBlobs: blobsDel.rowCount,
          disconnectedMailbox: disconnectMailboxToo,
        },
      });

      return {
        purgedMessages: msgDel.rowCount,
        purgedOpportunities: oppDel.rowCount,
        purgedAttachments: attDel.rowCount,
        purgedEncryptedBlobs: blobsDel.rowCount,
      };
    });
  }

  /**
   * Scheduled/manual retention cleanup enforcing the configured retention window (default 90 days)
   * across source message bodies, encrypted attachment blobs, extracted text, and expired opportunities.
   */
  async runRetentionCleanup(actorEmail = 'retention_worker', overrideRetentionDays?: number) {
    const settings = await getSettings(this.db, this.config);
    const days = overrideRetentionDays ?? settings.retentionDays;
    const cutoffIso = new Date(Date.now() - days * 86_400_000).toISOString();

    return this.db.withTransaction(async (tx) => {
      // Delete attachment blobs and attachment records older than cutoff
      const expiredBlobs = await tx.query(
        `DELETE FROM attachment_blobs
         WHERE attachment_id IN (SELECT id FROM attachments WHERE created_at < $1)`,
        [cutoffIso]
      );
      const expiredAtts = await tx.query('DELETE FROM attachments WHERE created_at < $1', [cutoffIso]);

      // Delete old opportunities not updated since cutoff (cascades drafts, facts, versions)
      const expiredOpps = await tx.query('DELETE FROM opportunities WHERE updated_at < $1', [cutoffIso]);

      // Delete or scrub source messages older than cutoff
      const expiredMsgs = await tx.query('DELETE FROM source_messages WHERE created_at < $1', [cutoffIso]);

      // Clean expired sessions
      await tx.query('DELETE FROM sessions WHERE expires_at < NOW()');

      await recordAuditEvent(tx, {
        actorEmail,
        eventType: 'retention_cleanup_executed',
        entityType: 'retention',
        metadata: {
          retentionDays: days,
          cutoffIso,
          retentionPolicyValidated: settings.retentionPolicyValidated,
          expiredBlobsRemoved: expiredBlobs.rowCount,
          expiredAttachmentsRemoved: expiredAtts.rowCount,
          expiredOpportunitiesRemoved: expiredOpps.rowCount,
          expiredMessagesRemoved: expiredMsgs.rowCount,
        },
      });

      return {
        retentionDays: days,
        cutoffIso,
        expiredBlobsRemoved: expiredBlobs.rowCount,
        expiredAttachmentsRemoved: expiredAtts.rowCount,
        expiredOpportunitiesRemoved: expiredOpps.rowCount,
        expiredMessagesRemoved: expiredMsgs.rowCount,
      };
    });
  }

  async exportNonSecretMetadataSummary() {
    const settings = await getSettings(this.db, this.config);
    const opps = await this.db.query(
      'SELECT id, company_name, role_title, opportunity_type, status, current_version, created_at, updated_at FROM opportunities ORDER BY created_at DESC'
    );
    const sections = await this.db.query('SELECT id, name, description, is_active FROM sections ORDER BY sort_order ASC');
    const groups = await this.db.query(
      'SELECT id, visible_name, alias_or_notes, is_active, last_verified_at FROM whatsapp_groups ORDER BY visible_name ASC'
    );
    const ledger = await this.db.query(
      'SELECT id, month_key, model_id, authorization_source, status, prompt_tokens, completion_tokens, actual_cost_usd, actual_cost_inr, created_at FROM groq_usage_ledger ORDER BY created_at DESC LIMIT 200'
    );

    return {
      exportedAt: new Date().toISOString(),
      product: 'SPCR (Student Progression & Company Relation)',
      secretsIncluded: false,
      settings,
      opportunities: opps.rows,
      sections: sections.rows,
      whatsappGroups: groups.rows,
      groqLedger: ledger.rows,
    };
  }
}

