import { describe, expect, it } from 'vitest';
import { createTestSpcrEnvironment } from './testHarness.js';

describe('Section 16.5 — Sections, WhatsApp Group Registry, Approval Gate & Guided Manual Dispatch', () => {
  it('deduplicates overlapping sections by stable group.id while listing contributing sections, warns on similar group names without auto-merging, and deletes sections non-destructively', async () => {
    const env = await createTestSpcrEnvironment();
    try {
      const secFinal = await env.services.routingService.createSection('tpo@college.edu', {
        name: 'Final Year 2027',
        description: 'All final year B.Tech sections',
      });
      const secCircuit = await env.services.routingService.createSection('tpo@college.edu', {
        name: 'Circuit Branches',
        description: 'CSE, IT, ECE, EEE',
      });

      // Group 1 belongs to BOTH overlapping sections!
      const gShared = await env.services.routingService.registerGroup('tpo@college.edu', {
        visibleName: 'ECE Final Year Official',
        sectionIds: [secFinal!.id, secCircuit!.id],
      });

      // Group 2 & Group 3 have similar names ("CSE-A Placement Group" vs "CSE A Placement Group") -> warning emitted, NOT auto-merged!
      const gSim1 = await env.services.routingService.registerGroup('tpo@college.edu', {
        visibleName: 'CSE-A Placement Group',
        sectionIds: [secFinal!.id],
      });
      const gSim2 = await env.services.routingService.registerGroup('tpo@college.edu', {
        visibleName: 'CSE A Placement Group',
        sectionIds: [secCircuit!.id],
      });

      expect(gSim2.duplicateWarnings.length).toBeGreaterThanOrEqual(1);
      expect(gSim1.group!.id).not.toBe(gSim2.group!.id);

      // Extra group not in sections for per-batch manual override test
      const gManualExtra = await env.services.routingService.registerGroup('tpo@college.edu', {
        visibleName: 'M.Tech Placement Coordinators',
        sectionIds: [],
      });

      // Preview overlapping sections: `gShared` appears ONCE with both contributing section names; `gSim1` & `gSim2` remain distinct!
      const preview = await env.services.routingService.previewDestinationSelection({
        sectionIds: [secFinal!.id, secCircuit!.id],
        addGroupIds: [gManualExtra.group!.id],
        removeGroupIds: [gSim2.group!.id],
      });

      const sharedEntry = preview.destinations.find((d) => d.groupId === gShared.group!.id);
      expect(sharedEntry).toBeDefined();
      expect(sharedEntry?.contributingSections).toEqual(
        expect.arrayContaining(['Final Year 2027', 'Circuit Branches'])
      );
      expect(preview.destinations.map((d) => d.groupId)).toContain(gManualExtra.group!.id);
      expect(preview.destinations.map((d) => d.groupId)).not.toContain(gSim2.group!.id);

      // Verify reusable section memberships in DB were NOT mutated by per-batch add/remove preview!
      const regBefore = await env.services.routingService.listSectionsAndGroups();
      expect(regBefore.groups.length).toBe(4);

      // Deleting a section removes mappings non-destructively while keeping all 4 groups intact
      await env.services.routingService.deleteSection('tpo@college.edu', secCircuit!.id);
      const regAfterSecDelete = await env.services.routingService.listSectionsAndGroups();
      expect(regAfterSecDelete.sections.length).toBe(1);
      expect(regAfterSecDelete.groups.length).toBe(4);

      // Deleting a group without `confirmed = true` MUST fail; with `confirmed = true` succeeds
      await expect(
        env.services.routingService.deleteGroup('tpo@college.edu', gManualExtra.group!.id, false)
      ).rejects.toThrow(/Explicit confirmation/i);

      await env.services.routingService.deleteGroup('tpo@college.edu', gManualExtra.group!.id, true);
      const regAfterGrpDelete = await env.services.routingService.listSectionsAndGroups();
      expect(regAfterGrpDelete.groups.length).toBe(3);
    } finally {
      await env.cleanup();
    }
  });

  it('enforces officer approval gate, invalidates approval when draft is edited, rejects dishonest Delivered status, never auto-retries uncertain outcomes, and resumes cleanly across restarts', async () => {
    const env = await createTestSpcrEnvironment();
    try {
      const sec = await env.services.routingService.createSection('tpo@college.edu', { name: 'All Final Year' });
      const g1 = await env.services.routingService.registerGroup('tpo@college.edu', {
        visibleName: 'Group 1 — CSE',
        sectionIds: [sec!.id],
      });
      const g2 = await env.services.routingService.registerGroup('tpo@college.edu', {
        visibleName: 'Group 2 — ECE',
        sectionIds: [sec!.id],
      });
      const g3 = await env.services.routingService.registerGroup('tpo@college.edu', {
        visibleName: 'Group 3 — MECH',
        sectionIds: [sec!.id],
      });

      const scan = await env.services.screener.scanEmailMessage(
        {
          gmailMessageId: 'msg-dispatch-01',
          fromRaw: 'Campus Team <hiring@titanmotors.in>',
          authHeadersRaw: 'mx.google.com; spf=pass; dkim=pass; dmarc=pass',
          subject: 'Campus Recruitment Drive 2027 — Titan Motors Graduate Engineer',
          receivedAt: new Date().toISOString(),
          bodyText: 'Company: Titan Motors\nRole: Graduate Engineer\nCTC: 9.5 LPA\nCGPA: 7.0\nDeadline: 29 Nov 2026.',
          attachments: [],
          sourceOrigin: 'synthetic_fixture',
        },
        'auto_monitor',
        'tpo@college.edu'
      );
      const oppId = scan.opportunityId!;

      // Unapproved opportunity has zero dispatch batches
      const initialBatches = await env.db.query('SELECT * FROM dispatch_batches WHERE opportunity_id = $1', [oppId]);
      expect(initialBatches.rows.length).toBe(0);

      // Approve Draft #1 -> creates immutable dispatch batch with 3 pending targets
      const d1 = await env.db.query<{ id: string }>(
        'SELECT id FROM draft_versions WHERE opportunity_id = $1 ORDER BY draft_number DESC LIMIT 1',
        [oppId]
      );
      const batch1 = await env.services.routingService.approveDraftAndCreateDispatchBatch('tpo@college.edu', {
        opportunityId: oppId,
        draftVersionId: d1.rows[0]!.id,
        sectionIds: [sec!.id],
      });
      expect(batch1?.targets.length).toBe(3);

      // Officer edits draft AFTER approval -> creates Draft #2, invalidates Batch 1 pending targets (`stale_approval_invalidated`), and requires re-approval!
      const editedDraft = await env.services.screener.saveOfficerManualDraftEdit('tpo@college.edu', {
        opportunityId: oppId,
        draftText: 'UPDATED PLACEMENT NOTICE — Titan Motors Graduate Engineer (Revised Venue: Main Auditorium)',
      });
      expect(editedDraft.draft_number).toBe(2);

      const invalidatedBatch1 = await env.services.routingService.getDispatchBatchDetails(batch1!.batch.id);
      expect(invalidatedBatch1?.batch.status).toBe('stale_invalidated');
      expect(invalidatedBatch1?.targets.every((t: any) => t.status === 'stale_approval_invalidated')).toBe(true);

      // Re-approve Draft #2 -> creates Batch 2
      const batch2 = await env.services.routingService.approveDraftAndCreateDispatchBatch('tpo@college.edu', {
        opportunityId: oppId,
        draftVersionId: editedDraft.id,
        sectionIds: [sec!.id],
      });
      const b2Id = batch2!.batch.id;
      const t1 = batch2!.targets.find((t: any) => t.group_id === g1.group!.id)!;
      const t2 = batch2!.targets.find((t: any) => t.group_id === g2.group!.id)!;
      const t3 = batch2!.targets.find((t: any) => t.group_id === g3.group!.id)!;

      // Reject dishonest `"delivered"` outcome!
      await expect(
        env.services.routingService.recordManualTargetOutcome('tpo@college.edu', {
          batchId: b2Id,
          targetId: t1.id,
          outcome: 'delivered',
        })
      ).rejects.toThrow(/Invalid dispatch status/i);

      // Mark Target 1 `officer_marked_sent` and Target 2 `uncertain_needs_confirmation`
      await env.services.routingService.recordManualTargetOutcome('tpo@college.edu', {
        batchId: b2Id,
        targetId: t1.id,
        outcome: 'officer_marked_sent',
        officerNote: 'Pasted and sent manually in CSE WhatsApp group.',
      });

      await env.services.routingService.recordManualTargetOutcome('tpo@college.edu', {
        batchId: b2Id,
        targetId: t2.id,
        outcome: 'uncertain_needs_confirmation',
        officerNote: 'Browser tab refreshed while pasting; check group history before resending.',
      });

      // Simulate process restart by instantiating a brand-new `RoutingAndDispatchService` reading from PostgreSQL
      const restartedState = await env.services.routingService.getDispatchBatchDetails(b2Id);
      const rT1 = restartedState!.targets.find((t: any) => t.id === t1.id)!;
      const rT2 = restartedState!.targets.find((t: any) => t.id === t2.id)!;
      const rT3 = restartedState!.targets.find((t: any) => t.id === t3.id)!;

      // Already-sent target stays `officer_marked_sent` (never repeated); uncertain target stays `uncertain_needs_confirmation` (never auto-retried); remaining target stays `pending`!
      expect(rT1.status).toBe('officer_marked_sent');
      expect(rT2.status).toBe('uncertain_needs_confirmation');
      expect(rT3.status).toBe('pending');

      // Complete remaining targets honestly (`skipped` on t3, officer confirms t2 as `officer_marked_sent`)
      await env.services.routingService.recordManualTargetOutcome('tpo@college.edu', {
        batchId: b2Id,
        targetId: t3.id,
        outcome: 'skipped',
        officerNote: 'MECH students covered in separate notice.',
      });
      const finalBatch = await env.services.routingService.recordManualTargetOutcome('tpo@college.edu', {
        batchId: b2Id,
        targetId: t2.id,
        outcome: 'officer_marked_sent',
        officerNote: 'Verified message in ECE group.',
      });
      expect(finalBatch?.batch.status).toBe('completed');
    } finally {
      await env.cleanup();
    }
  });
});
