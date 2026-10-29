import { Database, QueryExecutor } from '../db/database.js';
import { randomId, sha256Hex } from '../utils/crypto.js';
import { recordAuditEvent } from './auditService.js';

export type ManualDispatchStatus =
  | 'pending'
  | 'officer_marked_sent'
  | 'skipped'
  | 'failed'
  | 'uncertain_needs_confirmation'
  | 'stale_approval_invalidated';

const ALLOWED_OFFICER_OUTCOMES: ReadonlySet<string> = new Set([
  'officer_marked_sent',
  'skipped',
  'failed',
  'uncertain_needs_confirmation',
]);

function normalizeGroupNameForSimilarity(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function tokenJaccardSimilarity(a: string, b: string): number {
  const normA = normalizeGroupNameForSimilarity(a);
  const normB = normalizeGroupNameForSimilarity(b);
  if (!normA || !normB) return 0;
  if (normA === normB) return 1;
  const setA = new Set(normA.split(/\s+/));
  const setB = new Set(normB.split(/\s+/));
  let intersection = 0;
  for (const tok of setA) {
    if (setB.has(tok)) intersection++;
  }
  const union = setA.size + setB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

export interface DuplicateGroupWarning {
  groupAId: string;
  groupAName: string;
  groupBId: string;
  groupBName: string;
  similarity: number;
  message: string;
}

export class RoutingAndDispatchService {
  constructor(private readonly db: Database) {}

  async createSection(
    actorEmail: string,
    input: { name: string; description?: string; sortOrder?: number; eligibilityTags?: string[] }
  ) {
    const id = randomId('sec');
    const name = input.name.trim();
    if (!name) throw new Error('Section name is required.');

    await this.db.query(
      `INSERT INTO sections (id, name, description, sort_order, is_active, eligibility_tags_json)
       VALUES ($1, $2, $3, $4, TRUE, $5::jsonb)`,
      [
        id,
        name,
        input.description?.trim() || null,
        input.sortOrder ?? 0,
        JSON.stringify(input.eligibilityTags || []),
      ]
    );
    await recordAuditEvent(this.db, {
      actorEmail,
      eventType: 'section_created',
      entityType: 'section',
      entityId: id,
      metadata: { name },
    });
    return this.getSectionById(id);
  }

  async updateSection(
    actorEmail: string,
    sectionId: string,
    patch: { name?: string; description?: string; sortOrder?: number; isActive?: boolean; eligibilityTags?: string[] }
  ) {
    const existing = await this.getSectionById(sectionId);
    if (!existing) throw new Error('Section not found.');

    const nextName = patch.name !== undefined ? patch.name.trim() : existing.name;
    if (!nextName) throw new Error('Section name cannot be empty.');

    await this.db.query(
      `UPDATE sections
       SET name = $1,
           description = $2,
           sort_order = $3,
           is_active = $4,
           eligibility_tags_json = $5::jsonb,
           updated_at = NOW()
       WHERE id = $6`,
      [
        nextName,
        patch.description !== undefined ? patch.description.trim() || null : existing.description,
        patch.sortOrder !== undefined ? patch.sortOrder : existing.sort_order,
        patch.isActive !== undefined ? patch.isActive : existing.is_active,
        JSON.stringify(patch.eligibilityTags !== undefined ? patch.eligibilityTags : existing.eligibility_tags_json),
        sectionId,
      ]
    );
    await recordAuditEvent(this.db, {
      actorEmail,
      eventType: 'section_updated',
      entityType: 'section',
      entityId: sectionId,
      metadata: { name: nextName, isActive: patch.isActive ?? existing.is_active },
    });
    return this.getSectionById(sectionId);
  }

  /**
   * Deleting a section removes section-group mappings via FK cascade,
   * while keeping all registered WhatsApp groups intact (Section 12 requirement).
   */
  async deleteSection(actorEmail: string, sectionId: string): Promise<void> {
    await this.db.query('DELETE FROM sections WHERE id = $1', [sectionId]);
    await recordAuditEvent(this.db, {
      actorEmail,
      eventType: 'section_deleted',
      entityType: 'section',
      entityId: sectionId,
    });
  }

  async getSectionById(sectionId: string, q: QueryExecutor = this.db) {
    const res = await q.query<{
      id: string;
      name: string;
      description: string | null;
      sort_order: number;
      is_active: boolean;
      eligibility_tags_json: string[];
      created_at: string;
      updated_at: string;
    }>('SELECT * FROM sections WHERE id = $1', [sectionId]);
    return res.rows[0] || null;
  }

  async registerGroup(
    actorEmail: string,
    input: {
      visibleName: string;
      aliasOrNotes?: string;
      unverifiedInviteLink?: string;
      isActive?: boolean;
      verifiedNow?: boolean;
      sectionIds?: string[];
    }
  ) {
    const visibleName = input.visibleName.trim();
    if (!visibleName) throw new Error('WhatsApp group visible name is required.');
    const id = randomId('grp');

    return this.db.withTransaction(async (tx) => {
      await tx.query(
        `INSERT INTO whatsapp_groups (id, visible_name, alias_or_notes, unverified_invite_link, is_active, last_verified_at)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          id,
          visibleName,
          input.aliasOrNotes?.trim() || null,
          input.unverifiedInviteLink?.trim() || null,
          input.isActive !== false,
          input.verifiedNow ? new Date().toISOString() : null,
        ]
      );

      if (input.sectionIds && input.sectionIds.length > 0) {
        const uniqueSectionIds = Array.from(new Set(input.sectionIds));
        for (const secId of uniqueSectionIds) {
          await tx.query(
            `INSERT INTO section_group_mappings (section_id, group_id)
             VALUES ($1, $2) ON CONFLICT DO NOTHING`,
            [secId, id]
          );
        }
      }

      await recordAuditEvent(tx, {
        actorEmail,
        eventType: 'whatsapp_group_registered',
        entityType: 'whatsapp_group',
        entityId: id,
        metadata: { visibleName, mappedSectionsCount: input.sectionIds?.length || 0 },
      });

      const warnings = await this.computeSimilarGroupWarnings(tx);
      const groupRes = await tx.query('SELECT * FROM whatsapp_groups WHERE id = $1', [id]);
      return { group: groupRes.rows[0], duplicateWarnings: warnings };
    });
  }

  async updateGroup(
    actorEmail: string,
    groupId: string,
    patch: {
      visibleName?: string;
      aliasOrNotes?: string;
      unverifiedInviteLink?: string;
      isActive?: boolean;
      markVerifiedNow?: boolean;
      sectionIds?: string[];
    }
  ) {
    return this.db.withTransaction(async (tx) => {
      const existingRes = await tx.query<any>('SELECT * FROM whatsapp_groups WHERE id = $1', [groupId]);
      const existing = existingRes.rows[0];
      if (!existing) throw new Error('WhatsApp group not found.');

      const visibleName = patch.visibleName !== undefined ? patch.visibleName.trim() : existing.visible_name;
      if (!visibleName) throw new Error('WhatsApp group visible name cannot be empty.');

      await tx.query(
        `UPDATE whatsapp_groups
         SET visible_name = $1,
             alias_or_notes = $2,
             unverified_invite_link = $3,
             is_active = $4,
             last_verified_at = $5,
             updated_at = NOW()
         WHERE id = $6`,
        [
          visibleName,
          patch.aliasOrNotes !== undefined ? patch.aliasOrNotes.trim() || null : existing.alias_or_notes,
          patch.unverifiedInviteLink !== undefined
            ? patch.unverifiedInviteLink.trim() || null
            : existing.unverified_invite_link,
          patch.isActive !== undefined ? patch.isActive : existing.is_active,
          patch.markVerifiedNow ? new Date().toISOString() : existing.last_verified_at,
          groupId,
        ]
      );

      if (patch.sectionIds !== undefined) {
        await tx.query('DELETE FROM section_group_mappings WHERE group_id = $1', [groupId]);
        for (const secId of Array.from(new Set(patch.sectionIds))) {
          await tx.query(
            'INSERT INTO section_group_mappings (section_id, group_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
            [secId, groupId]
          );
        }
      }

      await recordAuditEvent(tx, {
        actorEmail,
        eventType: 'whatsapp_group_updated',
        entityType: 'whatsapp_group',
        entityId: groupId,
        metadata: { visibleName },
      });

      const updated = await tx.query('SELECT * FROM whatsapp_groups WHERE id = $1', [groupId]);
      return { group: updated.rows[0], duplicateWarnings: await this.computeSimilarGroupWarnings(tx) };
    });
  }

  /**
   * Deleting a group requires explicit officer confirmation (`confirmed === true`)
   * and cleanly removes its section mappings.
   */
  async deleteGroup(actorEmail: string, groupId: string, confirmed: boolean): Promise<void> {
    if (!confirmed) {
      throw new Error('Explicit confirmation (`confirm: true`) is required before deleting a registered WhatsApp group.');
    }
    await this.db.withTransaction(async (tx) => {
      await tx.query('DELETE FROM section_group_mappings WHERE group_id = $1', [groupId]);
      await tx.query('DELETE FROM whatsapp_groups WHERE id = $1', [groupId]);
      await recordAuditEvent(tx, {
        actorEmail,
        eventType: 'whatsapp_group_deleted',
        entityType: 'whatsapp_group',
        entityId: groupId,
      });
    });
  }

  async listSectionsAndGroups(q: QueryExecutor = this.db) {
    const sectionsRes = await q.query<any>('SELECT * FROM sections ORDER BY sort_order ASC, name ASC');
    const groupsRes = await q.query<any>('SELECT * FROM whatsapp_groups ORDER BY visible_name ASC');
    const mappingsRes = await q.query<{ section_id: string; group_id: string }>(
      'SELECT section_id, group_id FROM section_group_mappings'
    );

    const groupIdsBySection = new Map<string, string[]>();
    const sectionIdsByGroup = new Map<string, string[]>();
    for (const m of mappingsRes.rows) {
      const gList = groupIdsBySection.get(m.section_id) || [];
      gList.push(m.group_id);
      groupIdsBySection.set(m.section_id, gList);

      const sList = sectionIdsByGroup.get(m.group_id) || [];
      sList.push(m.section_id);
      sectionIdsByGroup.set(m.group_id, sList);
    }

    const sections = sectionsRes.rows.map((s) => ({
      ...s,
      groupIds: groupIdsBySection.get(s.id) || [],
    }));
    const groups = groupsRes.rows.map((g) => ({
      ...g,
      sectionIds: sectionIdsByGroup.get(g.id) || [],
      inviteLinkLabel: g.unverified_invite_link ? 'Unverified convenience link only' : null,
    }));

    const duplicateWarnings = await this.computeSimilarGroupWarnings(q, groupsRes.rows);
    return { sections, groups, duplicateWarnings };
  }

  async computeSimilarGroupWarnings(
    q: QueryExecutor = this.db,
    preloadedGroups?: Array<{ id: string; visible_name: string }>
  ): Promise<DuplicateGroupWarning[]> {
    const rows =
      preloadedGroups ||
      (await q.query<{ id: string; visible_name: string }>('SELECT id, visible_name FROM whatsapp_groups')).rows;
    const warnings: DuplicateGroupWarning[] = [];

    for (let i = 0; i < rows.length; i++) {
      for (let j = i + 1; j < rows.length; j++) {
        const a = rows[i]!;
        const b = rows[j]!;
        const sim = tokenJaccardSimilarity(a.visible_name, b.visible_name);
        if (sim >= 0.65) {
          warnings.push({
            groupAId: a.id,
            groupAName: a.visible_name,
            groupBId: b.id,
            groupBName: b.visible_name,
            similarity: Number(sim.toFixed(2)),
            message: `Similar group names detected ("${a.visible_name}" and "${b.visible_name}"). SPCR never auto-merges groups; verify both entries manually.`,
          });
        }
      }
    }
    return warnings;
  }

  /**
   * Resolves selected sections + manual per-batch additions/removals into a deduplicated set of active groups
   * keyed strictly by stable internal `group.id` (never merging distinct IDs that happen to have similar names).
   */
  async previewDestinationSelection(params: {
    sectionIds: string[];
    addGroupIds?: string[];
    removeGroupIds?: string[];
  }, q: QueryExecutor = this.db) {
    const uniqueSectionIds = Array.from(new Set(params.sectionIds));
    const addSet = new Set(params.addGroupIds || []);
    const removeSet = new Set(params.removeGroupIds || []);

    const sectionsRes =
      uniqueSectionIds.length > 0
        ? await q.query<{ id: string; name: string; is_active: boolean }>(
            'SELECT id, name, is_active FROM sections WHERE id = ANY($1::text[]) AND is_active = TRUE',
            [uniqueSectionIds]
          )
        : { rows: [] };
    const activeSectionMap = new Map(sectionsRes.rows.map((s) => [s.id, s.name]));

    const mappingsRes =
      sectionsRes.rows.length > 0
        ? await q.query<{ section_id: string; group_id: string }>(
            'SELECT section_id, group_id FROM section_group_mappings WHERE section_id = ANY($1::text[])',
            [Array.from(activeSectionMap.keys())]
          )
        : { rows: [] };

    const contributingSectionsByGroup = new Map<string, string[]>();
    for (const m of mappingsRes.rows) {
      const secName = activeSectionMap.get(m.section_id);
      if (!secName) continue;
      const list = contributingSectionsByGroup.get(m.group_id) || [];
      if (!list.includes(secName)) list.push(secName);
      contributingSectionsByGroup.set(m.group_id, list);
    }

    for (const addedId of addSet) {
      const list = contributingSectionsByGroup.get(addedId) || [];
      if (!list.includes('Manual batch addition')) list.push('Manual batch addition');
      contributingSectionsByGroup.set(addedId, list);
    }

    for (const removedId of removeSet) {
      contributingSectionsByGroup.delete(removedId);
    }

    const candidateGroupIds = Array.from(contributingSectionsByGroup.keys());
    const groupsRes =
      candidateGroupIds.length > 0
        ? await q.query<{
            id: string;
            visible_name: string;
            alias_or_notes: string | null;
            unverified_invite_link: string | null;
            is_active: boolean;
            last_verified_at: string | null;
          }>(
            'SELECT id, visible_name, alias_or_notes, unverified_invite_link, is_active, last_verified_at FROM whatsapp_groups WHERE id = ANY($1::text[]) AND is_active = TRUE ORDER BY visible_name ASC',
            [candidateGroupIds]
          )
        : { rows: [] };

    const destinations = groupsRes.rows.map((g) => ({
      groupId: g.id,
      visibleName: g.visible_name,
      aliasOrNotes: g.alias_or_notes,
      unverifiedInviteLink: g.unverified_invite_link,
      lastVerifiedAt: g.last_verified_at,
      contributingSections: contributingSectionsByGroup.get(g.id) || [],
    }));

    const duplicateWarnings = await this.computeSimilarGroupWarnings(
      q,
      destinations.map((d) => ({ id: d.groupId, visible_name: d.visibleName }))
    );

    return {
      selectedSections: sectionsRes.rows.map((s) => ({ id: s.id, name: s.name })),
      uniqueGroupCount: destinations.length,
      destinations,
      duplicateWarnings,
    };
  }

  /**
   * Invalidates active approvals and marks pending dispatch targets stale when material source/draft/target changes occur.
   */
  async invalidateApprovalsForOpportunity(
    tx: QueryExecutor,
    opportunityId: string,
    reason: string,
    actorEmail?: string
  ): Promise<number> {
    const activeRes = await tx.query<{ id: string }>(
      `UPDATE approvals
       SET status = 'invalidated', invalidation_reason = $1, invalidated_at = NOW()
       WHERE opportunity_id = $2 AND status = 'active'
       RETURNING id`,
      [reason, opportunityId]
    );

    if (activeRes.rows.length > 0) {
      // Mark pending targets in active batches as stale while keeping completed targets in history!
      await tx.query(
        `UPDATE dispatch_targets
         SET status = 'stale_approval_invalidated',
             officer_note = COALESCE(officer_note || ' | ', '') || $1,
             updated_at = NOW()
         WHERE opportunity_id = $2 AND status = 'pending'`,
        [`Invalidated: ${reason}`, opportunityId]
      );

      await tx.query(
        `UPDATE dispatch_batches
         SET status = 'stale_invalidated', updated_at = NOW()
         WHERE opportunity_id = $1 AND status IN ('ready', 'in_progress')`,
        [opportunityId]
      );

      await tx.query(
        `UPDATE opportunities
         SET status = 'draft_in_review', updated_at = NOW()
         WHERE id = $1 AND status IN ('approved', 'dispatch_in_progress')`,
        [opportunityId]
      );

      await recordAuditEvent(tx, {
        actorEmail: actorEmail || 'system',
        eventType: 'approval_invalidated',
        entityType: 'opportunity',
        entityId: opportunityId,
        metadata: { reason, invalidatedCount: activeRes.rows.length },
      });
    }

    return activeRes.rows.length;
  }

  async approveDraftAndCreateDispatchBatch(
    actorEmail: string,
    input: {
      opportunityId: string;
      draftVersionId: string;
      sectionIds: string[];
      addGroupIds?: string[];
      removeGroupIds?: string[];
      jdAttachmentId?: string | null;
      jdSourceUrl?: string | null;
    }
  ) {
    return this.db.withTransaction(async (tx) => {
      const oppRes = await tx.query<{ id: string; current_version: number; status: string }>(
        'SELECT id, current_version, status FROM opportunities WHERE id = $1 FOR UPDATE',
        [input.opportunityId]
      );
      const opp = oppRes.rows[0];
      if (!opp) throw new Error('Opportunity not found.');

      const draftRes = await tx.query<{ id: string; opportunity_id: string; draft_text: string; draft_sha256: string }>(
        'SELECT id, opportunity_id, draft_text, draft_sha256 FROM draft_versions WHERE id = $1',
        [input.draftVersionId]
      );
      const draft = draftRes.rows[0];
      if (!draft || draft.opportunity_id !== opp.id) {
        throw new Error('Selected draft version does not belong to this opportunity.');
      }

      const preview = await this.previewDestinationSelection(
        {
          sectionIds: input.sectionIds,
          addGroupIds: input.addGroupIds,
          removeGroupIds: input.removeGroupIds,
        },
        tx
      );
      if (preview.destinations.length === 0) {
        throw new Error('At least one active WhatsApp destination group must be selected before approving dispatch.');
      }

      // Verify JD source URL provenance if supplied
      let verifiedJdUrl: string | null = null;
      if (input.jdSourceUrl && input.jdSourceUrl.trim()) {
        const candidateUrl = input.jdSourceUrl.trim();
        const urlCheck = await tx.query<{ extracted_urls_json: string[]; body_text: string | null }>(
          `SELECT sm.extracted_urls_json, sm.body_text
           FROM opportunity_message_links oml
           JOIN source_messages sm ON sm.id = oml.source_message_id
           WHERE oml.opportunity_id = $1 AND oml.link_state = 'confirmed'`,
          [opp.id]
        );
        const attTextCheck = await tx.query<{ extracted_text: string | null }>(
          'SELECT extracted_text FROM attachments WHERE opportunity_id = $1',
          [opp.id]
        );
        const foundInEmail = urlCheck.rows.some(
          (r) =>
            (Array.isArray(r.extracted_urls_json) && r.extracted_urls_json.includes(candidateUrl)) ||
            (r.body_text || '').includes(candidateUrl)
        );
        const foundInAtt = attTextCheck.rows.some((a) => (a.extracted_text || '').includes(candidateUrl));
        if (!foundInEmail && !foundInAtt) {
          throw new Error('JD URL must originate from a linked source email or parsed JD attachment.');
        }
        verifiedJdUrl = candidateUrl;
      }

      const attHashesRes = await tx.query<{ sha256_hash: string }>(
        'SELECT sha256_hash FROM attachments WHERE opportunity_id = $1 ORDER BY sha256_hash ASC',
        [opp.id]
      );
      const attachmentHashes = attHashesRes.rows.map((r) => r.sha256_hash);

      // Supersede prior active approvals on this opportunity
      await tx.query(
        `UPDATE approvals SET status = 'superseded', invalidated_at = NOW(), invalidation_reason = 'Superseded by newer approval'
         WHERE opportunity_id = $1 AND status = 'active'`,
        [opp.id]
      );

      const approvalId = randomId('apr');
      const computedDraftHash = sha256Hex(draft.draft_text);
      const targetGroupIds = preview.destinations.map((d) => d.groupId);
      const targetSectionIds = preview.selectedSections.map((s) => s.id);

      await tx.query(
        `INSERT INTO approvals (
          id, opportunity_id, draft_version_id, opportunity_version, draft_sha256,
          attachment_hashes_json, target_section_ids_json, target_group_ids_json, approved_by_email, status
        ) VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8::jsonb, $9, 'active')`,
        [
          approvalId,
          opp.id,
          draft.id,
          opp.current_version,
          computedDraftHash,
          JSON.stringify(attachmentHashes),
          JSON.stringify(targetSectionIds),
          JSON.stringify(targetGroupIds),
          actorEmail,
        ]
      );

      const batchId = randomId('bat');
      await tx.query(
        `INSERT INTO dispatch_batches (
          id, opportunity_id, approval_id, opportunity_version, approved_draft_text, approved_draft_sha256,
          selected_sections_snapshot_json, destinations_snapshot_json, jd_attachment_id, jd_source_url, status
        ) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9, $10, 'ready')`,
        [
          batchId,
          opp.id,
          approvalId,
          opp.current_version,
          draft.draft_text,
          computedDraftHash,
          JSON.stringify(preview.selectedSections),
          JSON.stringify(preview.destinations),
          input.jdAttachmentId || null,
          verifiedJdUrl,
        ]
      );

      // Check already completed targets for the same (opportunity_id, opportunity_version, group_id) so we never repeat them!
      const completedRes = await tx.query<{ group_id: string }>(
        `SELECT group_id FROM dispatch_targets
         WHERE opportunity_id = $1 AND opportunity_version = $2 AND status = 'officer_marked_sent'`,
        [opp.id, opp.current_version]
      );
      const alreadySentGroupIds = new Set(completedRes.rows.map((r) => r.group_id));

      let sortIdx = 0;
      for (const dest of preview.destinations) {
        if (alreadySentGroupIds.has(dest.groupId)) continue;
        const targetId = randomId('tgt');
        const idemKey = `${batchId}:${opp.id}:v${opp.current_version}:${dest.groupId}`;
        await tx.query(
          `INSERT INTO dispatch_targets (
            id, batch_id, opportunity_id, opportunity_version, group_id,
            group_visible_name_snapshot, group_notes_snapshot, contributing_sections_json,
            sort_index, status, idempotency_key
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, 'pending', $10)`,
          [
            targetId,
            batchId,
            opp.id,
            opp.current_version,
            dest.groupId,
            dest.visibleName,
            dest.aliasOrNotes || null,
            JSON.stringify(dest.contributingSections),
            sortIdx++,
            idemKey,
          ]
        );
      }

      await tx.query(`UPDATE opportunities SET status = 'approved', updated_at = NOW() WHERE id = $1`, [opp.id]);

      await recordAuditEvent(tx, {
        actorEmail,
        eventType: 'draft_approved_for_manual_dispatch',
        entityType: 'approval',
        entityId: approvalId,
        metadata: {
          opportunityId: opp.id,
          opportunityVersion: opp.current_version,
          draftSha256: computedDraftHash,
          batchId,
          uniqueDestinationCount: preview.uniqueGroupCount,
        },
      });

      return this.getDispatchBatchDetails(batchId, tx);
    });
  }

  async getDispatchBatchDetails(batchId: string, q: QueryExecutor = this.db) {
    const batchRes = await q.query<any>('SELECT * FROM dispatch_batches WHERE id = $1', [batchId]);
    const batch = batchRes.rows[0];
    if (!batch) return null;

    const targetsRes = await q.query<any>(
      'SELECT * FROM dispatch_targets WHERE batch_id = $1 ORDER BY sort_index ASC',
      [batchId]
    );

    const nextPendingTarget = targetsRes.rows.find((t) => t.status === 'pending') || null;
    const summary = {
      total: targetsRes.rows.length,
      pending: targetsRes.rows.filter((t) => t.status === 'pending').length,
      officerMarkedSent: targetsRes.rows.filter((t) => t.status === 'officer_marked_sent').length,
      skipped: targetsRes.rows.filter((t) => t.status === 'skipped').length,
      failed: targetsRes.rows.filter((t) => t.status === 'failed').length,
      uncertainNeedsConfirmation: targetsRes.rows.filter((t) => t.status === 'uncertain_needs_confirmation').length,
      staleInvalidated: targetsRes.rows.filter((t) => t.status === 'stale_approval_invalidated').length,
    };

    return {
      batch,
      targets: targetsRes.rows,
      nextPendingTarget,
      summary,
      manualVerificationNotice:
        'Manual human action required: search WhatsApp Web for the exact group title, verify group membership/name, paste the copied announcement manually, attach any JD manually if needed, press Send in WhatsApp yourself, and then record your outcome below. SPCR cannot verify WhatsApp delivery.',
    };
  }

  async recordManualTargetOutcome(
    actorEmail: string,
    params: {
      batchId: string;
      targetId: string;
      outcome: string;
      officerNote?: string;
    }
  ) {
    if (!ALLOWED_OFFICER_OUTCOMES.has(params.outcome)) {
      throw new Error(
        `Invalid dispatch status "${params.outcome}". Allowed human-verified statuses: officer_marked_sent, skipped, failed, uncertain_needs_confirmation. Provider-confirmed delivery claims are prohibited.`
      );
    }

    return this.db.withTransaction(async (tx) => {
      const batchRes = await tx.query<any>('SELECT * FROM dispatch_batches WHERE id = $1 FOR UPDATE', [params.batchId]);
      const batch = batchRes.rows[0];
      if (!batch) throw new Error('Dispatch batch not found.');
      if (batch.status === 'stale_invalidated' || batch.status === 'cancelled') {
        throw new Error(`Cannot record outcome on batch with status "${batch.status}". Re-approve the updated draft first.`);
      }

      // Verify approval is still active and opportunity version has not drifted
      const approvalRes = await tx.query<any>('SELECT * FROM approvals WHERE id = $1', [batch.approval_id]);
      const approval = approvalRes.rows[0];
      if (!approval || approval.status !== 'active') {
        throw new Error('Approval is no longer active. Review changes and re-approve before continuing dispatch.');
      }

      const targetRes = await tx.query<any>(
        'SELECT * FROM dispatch_targets WHERE id = $1 AND batch_id = $2 FOR UPDATE',
        [params.targetId, params.batchId]
      );
      const target = targetRes.rows[0];
      if (!target) throw new Error('Dispatch target not found.');
      if (target.status === 'stale_approval_invalidated') {
        throw new Error('This target is stale because the opportunity changed after approval.');
      }

      // If target was `uncertain_needs_confirmation`, DO NOT auto-retry; officer can explicitly resolve after checking chat history
      await tx.query(
        `UPDATE dispatch_targets
         SET status = $1, officer_note = $2, updated_at = NOW()
         WHERE id = $3`,
        [params.outcome, params.officerNote?.trim() || null, target.id]
      );

      const remainingRes = await tx.query<{ cnt: string }>(
        `SELECT COUNT(*)::text AS cnt FROM dispatch_targets WHERE batch_id = $1 AND status = 'pending'`,
        [params.batchId]
      );
      const remainingPending = Number.parseInt(remainingRes.rows[0]?.cnt || '0', 10);

      const nextBatchStatus = remainingPending === 0 ? 'completed' : 'in_progress';
      await tx.query('UPDATE dispatch_batches SET status = $1, updated_at = NOW() WHERE id = $2', [
        nextBatchStatus,
        params.batchId,
      ]);

      const nextOppStatus = remainingPending === 0 ? 'dispatched' : 'dispatch_in_progress';
      await tx.query('UPDATE opportunities SET status = $1, updated_at = NOW() WHERE id = $2', [
        nextOppStatus,
        batch.opportunity_id,
      ]);

      await recordAuditEvent(tx, {
        actorEmail,
        eventType: 'manual_whatsapp_target_recorded',
        entityType: 'dispatch_target',
        entityId: target.id,
        metadata: {
          batchId: params.batchId,
          groupId: target.group_id,
          outcome: params.outcome,
          remainingPending,
        },
      });

      return this.getDispatchBatchDetails(params.batchId, tx);
    });
  }

  async cancelDispatchBatch(actorEmail: string, batchId: string) {
    return this.db.withTransaction(async (tx) => {
      await tx.query(
        `UPDATE dispatch_batches SET status = 'cancelled', updated_at = NOW()
         WHERE id = $1 AND status IN ('ready', 'in_progress')`,
        [batchId]
      );
      await recordAuditEvent(tx, {
        actorEmail,
        eventType: 'dispatch_batch_cancelled',
        entityType: 'dispatch_batch',
        entityId: batchId,
      });
      return this.getDispatchBatchDetails(batchId, tx);
    });
  }
}

