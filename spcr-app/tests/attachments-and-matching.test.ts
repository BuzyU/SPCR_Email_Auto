import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { createTestSpcrEnvironment } from './testHarness.js';
import {
  buildValidDocxBuffer,
  buildValidTextPdfBuffer,
  buildZipArchiveFromEntries,
} from '../src/utils/documentFixtures.js';
import { SafeAttachmentExtractor, SharedAttachmentStorageService } from '../src/services/attachmentService.js';
import { sha256Hex } from '../src/utils/crypto.js';

describe('Section 16.3 — Attachment Security/Parsing, Shared Private Storage & 6-Case Email/JD Matching', () => {
  it('safely extracts valid PDF/DOCX and handles encrypted, scanned, corrupt, oversized, macro, ZIP-bomb, and parser timeout without crashing', async () => {
    const env = await createTestSpcrEnvironment({
      configOverrides: {
        maxAttachmentBytes: 2 * 1024 * 1024, // 2 MB test cap
      },
    });

    try {
      const extractor = new SafeAttachmentExtractor(env.config);
      expect(extractor.ocrAdapter.enabledInV1).toBe(false);

      // 1. Valid text PDF
      const validPdf = buildValidTextPdfBuffer([
        [
          'Company: Vertex Cloud Systems',
          'Role: Site Reliability Engineer',
          'CTC: 16 LPA | CGPA: 8.0 | Deadline: 20 Nov 2026',
        ],
      ]);
      const pdfRes = await extractor.extract(validPdf, {
        filename: 'Vertex_SRE_JD.pdf',
        declaredMime: 'application/pdf',
      });
      expect(pdfRes.parseStatus).toBe('parsed');
      expect(pdfRes.verifiedType).toBe('pdf');
      expect(pdfRes.extractedText).toContain('Site Reliability Engineer');

      // 2. Valid text DOCX
      const validDocx = buildValidDocxBuffer([
        'Company: Helios Semiconductors',
        'Role: VLSI Design Engineer',
        'Eligibility: B.Tech ECE/EEE 2027 Batch, Minimum CGPA 7.5',
      ]);
      const docxRes = await extractor.extract(validDocx, {
        filename: 'Helios_VLSI_JD.docx',
        declaredMime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      });
      expect(docxRes.parseStatus).toBe('parsed');
      expect(docxRes.verifiedType).toBe('docx');
      expect(docxRes.extractedText).toContain('VLSI Design Engineer');

      // 3. Password-protected / encrypted PDF
      const encryptedPdf = buildValidTextPdfBuffer([['Secret text']], { includeEncryptDict: true });
      const encRes = await extractor.extract(encryptedPdf, { filename: 'Encrypted_JD.pdf' });
      expect(encRes.parseStatus).toBe('not_parsed_encrypted');
      expect(encRes.extractedText).toBeNull();

      // 4. Scanned / image-only PDF (0 extractable text)
      const scannedPdf = buildValidTextPdfBuffer([[]]);
      const scanPdfRes = await extractor.extract(scannedPdf, { filename: 'Scanned_Brochure.pdf' });
      expect(scanPdfRes.parseStatus).toBe('not_parsed_scanned_or_image_only');
      expect(scanPdfRes.extractedText).toBeNull();

      // 5. Corrupt / magic-byte mismatch `.pdf`
      const corruptPdf = Buffer.from('NOT_A_REAL_PDF_HEADER_RANDOM_GARBAGE_BYTES_12345', 'utf8');
      const corruptRes = await extractor.extract(corruptPdf, {
        filename: 'Corrupt.pdf',
        declaredMime: 'application/pdf',
      });
      expect(corruptRes.parseStatus).toBe('not_parsed_corrupt');

      // 6. Oversized file (> 2 MB test cap)
      const oversized = Buffer.alloc(2 * 1024 * 1024 + 512, 0x41);
      const overRes = await extractor.extract(oversized, { filename: 'Huge_Presentation.pdf' });
      expect(overRes.parseStatus).toBe('not_parsed_oversized');

      // 7. Macro-enabled `.docm` AND disguised `.docx` with embedded `word/vbaProject.bin`
      const docmBuf = buildValidDocxBuffer(['Macro payload'], { includeMacroVba: true });
      const docmRes = await extractor.extract(docmBuf, { filename: 'JD_With_Macros.docm' });
      expect(docmRes.parseStatus).toBe('not_parsed_macro_rejected');

      const disguisedMacroRes = await extractor.extract(docmBuf, { filename: 'Disguised_Clean.docx' });
      expect(disguisedMacroRes.parseStatus).toBe('not_parsed_macro_rejected');

      // 8. Forged-header high-compression-ratio DOCX ZIP bomb (10 MB repetitive XML with forged 100-byte header!)
      const bombPayload = Buffer.from('<w:document>' + 'A'.repeat(10 * 1024 * 1024) + '</w:document>', 'utf8');
      const zipBomb = buildZipArchiveFromEntries([
        {
          name: '[Content_Types].xml',
          data: Buffer.from('<Types></Types>', 'utf8'),
        },
        {
          name: 'word/document.xml',
          data: bombPayload,
          compress: true,
          forgedUncompressedSize: 120, // Forged tiny size in ZIP header to try bypassing naive checks!
        },
      ]);
      const bombRes = await extractor.extract(zipBomb, { filename: 'Forged_Bomb.docx' });
      expect(bombRes.parseStatus).toBe('not_parsed_zip_bomb_rejected');
      expect(bombRes.extractedText).toBeNull();

      // 9. Isolated worker-thread CPU hang timeout (`worker.terminate()`)
      const timeoutRes = await extractor.extract(
        validDocx,
        { filename: 'Runaway_Parser.docx', simulateHangMs: 2500 },
        180
      );
      expect(timeoutRes.parseStatus).toBe('not_parsed_timeout');
    } finally {
      await env.cleanup();
    }
  });

  it('stores encrypted attachment blobs in shared PostgreSQL BYTEA so worker writes are readable by web service and blocked when unauthenticated', async () => {
    const env = await createTestSpcrEnvironment();
    try {
      const pdfBytes = buildValidTextPdfBuffer([
        ['Shared Storage Proof — Company: Orbit Dynamics | Role: Cloud Architect | CTC: 18 LPA'],
      ]);
      const expectedSha = sha256Hex(pdfBytes);

      // Simulate Background Worker scanning email with PDF attachment
      const scanOut = await env.services.screener.scanEmailMessage(
        {
          gmailMessageId: 'msg-shared-blob-01',
          fromRaw: 'HR <campus@orbitdynamics.in>',
          authHeadersRaw: 'mx.google.com; spf=pass; dkim=pass; dmarc=pass',
          subject: 'Campus Recruitment Drive 2027 — Orbit Dynamics Cloud Architect',
          receivedAt: new Date().toISOString(),
          bodyText: 'Dear TPO, please find attached the Cloud Architect JD for 2027 batch.',
          attachments: [
            {
              filename: 'Orbit_Cloud_Architect_JD.pdf',
              declaredMime: 'application/pdf',
              buffer: pdfBytes,
            },
          ],
          sourceOrigin: 'synthetic_fixture',
        },
        'auto_monitor',
        'worker@spcr.internal'
      );
      expect(scanOut.opportunityId).toBeTruthy();

      const attRow = await env.db.query<{ id: string }>(
        'SELECT id FROM attachments WHERE opportunity_id = $1',
        [scanOut.opportunityId]
      );
      const attachmentId = attRow.rows[0]!.id;

      // Verify raw PostgreSQL `attachment_blobs.encrypted_bytes` does NOT contain plaintext PDF header `%PDF-1.4`
      const rawBlobRes = await env.db.query<{ encrypted_bytes: Uint8Array }>(
        'SELECT encrypted_bytes FROM attachment_blobs WHERE attachment_id = $1',
        [attachmentId]
      );
      const rawEncryptedBuf = Buffer.from(rawBlobRes.rows[0]!.encrypted_bytes);
      expect(rawEncryptedBuf.toString('latin1')).not.toContain('%PDF-1.4');
      expect(rawEncryptedBuf.toString('latin1')).not.toContain('Orbit Dynamics');

      // Instantiate a completely separate Web Service `SharedAttachmentStorageService` sharing only PostgreSQL + key
      const separateWebStorage = new SharedAttachmentStorageService(env.db, env.config);
      const decrypted = await separateWebStorage.readDecryptedAttachmentBlob(attachmentId);
      expect(sha256Hex(decrypted.buffer)).toBe(expectedSha);

      // Verify HTTP download blocks unauthenticated requests (401) and serves exact bytes to authenticated owner (200)
      const unauthGet = await request(env.app).get(`/api/attachments/${attachmentId}/download`);
      expect(unauthGet.status).toBe(401);

      const agent = request.agent(env.app);
      await agent.post('/api/auth/demo-login').send({ email: 'tpo@college.edu' });
      const authedGet = await agent
        .get(`/api/attachments/${attachmentId}/download`)
        .buffer(true)
        .parse((res, cb) => {
          const chunks: Buffer[] = [];
          res.on('data', (c) => chunks.push(Buffer.from(c)));
          res.on('end', () => cb(null, Buffer.concat(chunks)));
        });
      expect(authedGet.status).toBe(200);
      expect(sha256Hex(authedGet.body as Buffer)).toBe(expectedSha);
    } finally {
      await env.cleanup();
    }
  });

  it('handles all 6 Email/JD matching cases: 1-email+PDF, details->JD, JD->details, 2 roles from same company kept separate, conflicts preserved, and post-approval JD drift invalidation', async () => {
    const env = await createTestSpcrEnvironment();
    try {
      const sec = await env.services.routingService.createSection('tpo@college.edu', {
        name: 'CSE Final Year',
        description: '2026-27 CSE',
      });
      const grp = await env.services.routingService.registerGroup('tpo@college.edu', {
        visibleName: 'CSE 2027 Placement Official',
        sectionIds: [sec!.id],
      });

      // CASE 1: Single email containing details + JD PDF -> 1 unified opportunity
      const c1 = await env.services.screener.scanEmailMessage(
        {
          gmailMessageId: 'm-case1',
          fromRaw: 'Campus Team <hiring@alphaforge.io>',
          authHeadersRaw: 'mx.google.com; spf=pass; dkim=pass; dmarc=pass',
          subject: 'Campus Drive 2027 — AlphaForge Platform Engineer',
          receivedAt: '2026-10-20T09:00:00Z',
          bodyText: 'Dear TPO, AlphaForge invites CSE/IT 2027 batch. Registration deadline: 15 Nov 2026. Apply: https://careers.alphaforge.io/2027',
          attachments: [
            {
              filename: 'AlphaForge_JD.pdf',
              declaredMime: 'application/pdf',
              buffer: buildValidTextPdfBuffer([
                ['Company: AlphaForge', 'Role: Platform Engineer', 'CTC: 14 LPA', 'Minimum CGPA: 7.5'],
              ]),
            },
          ],
          sourceOrigin: 'synthetic_fixture',
        },
        'auto_monitor',
        'tpo@college.edu'
      );
      expect(c1.opportunityId).toBeTruthy();

      // CASE 2 & CASE 5: Email 1 has drive details (CGPA 7.5), Email 2 follows in thread with JD PDF containing conflicting CGPA 8.0!
      const c2a = await env.services.screener.scanEmailMessage(
        {
          gmailMessageId: 'm-case2-email1',
          gmailThreadId: 'thread-beta-corp',
          fromRaw: 'HR <campus@betacorp.in>',
          authHeadersRaw: 'mx.google.com; spf=pass; dkim=pass; dmarc=pass',
          subject: 'BetaCorp Campus Hiring 2027 — Full Stack Developer',
          receivedAt: '2026-10-21T10:00:00Z',
          bodyText:
            'Dear TPO, BetaCorp is hiring Full Stack Developer for 2027 batch. CTC: 12 LPA. Eligibility: CGPA 7.5 and above. Deadline: 18 Nov 2026.',
          attachments: [],
          sourceOrigin: 'synthetic_fixture',
        },
        'auto_monitor',
        'tpo@college.edu'
      );

      const c2b = await env.services.screener.scanEmailMessage(
        {
          gmailMessageId: 'm-case2-email2',
          gmailThreadId: 'thread-beta-corp',
          inReplyTo: 'm-case2-email1',
          fromRaw: 'HR <campus@betacorp.in>',
          authHeadersRaw: 'mx.google.com; spf=pass; dkim=pass; dmarc=pass',
          subject: 'Re: BetaCorp Campus Hiring 2027 — Full Stack Developer (Attached JD)',
          receivedAt: '2026-10-21T11:00:00Z',
          bodyText: 'Please find attached the detailed Job Description PDF for Full Stack Developer.',
          attachments: [
            {
              filename: 'BetaCorp_FSD_JD.pdf',
              declaredMime: 'application/pdf',
              buffer: buildValidTextPdfBuffer([
                ['Company: BetaCorp', 'Role: Full Stack Developer', 'Eligibility: Minimum CGPA 8.5 required'],
              ]),
            },
          ],
          sourceOrigin: 'synthetic_fixture',
        },
        'auto_monitor',
        'tpo@college.edu'
      );
      expect(c2b.opportunityId).toBe(c2a.opportunityId); // Thread-matched cleanly!

      // Check Case 5 conflict preservation on BetaCorp (`CGPA 7.5` vs `CGPA 8.5`)
      const betaDrafts = await env.db.query<{ conflicts_json: any[] }>(
        'SELECT conflicts_json FROM draft_versions WHERE opportunity_id = $1 ORDER BY draft_number DESC LIMIT 1',
        [c2a.opportunityId]
      );
      expect((betaDrafts.rows[0]?.conflicts_json || []).length).toBeGreaterThanOrEqual(1);

      // CASE 3: JD attachment arrives first, followed by eligibility/deadline email in same thread
      const c3a = await env.services.screener.scanEmailMessage(
        {
          gmailMessageId: 'm-case3-jd-first',
          gmailThreadId: 'thread-gamma-analytics',
          fromRaw: 'Talent <university@gammaanalytics.com>',
          authHeadersRaw: 'mx.google.com; spf=pass; dkim=pass; dmarc=pass',
          subject: 'Gamma Analytics 2027 Campus Drive — Business Intelligence Analyst JD',
          receivedAt: '2026-10-22T08:00:00Z',
          bodyText: 'Dear Placement Cell, sharing the JD for Gamma Analytics Business Intelligence Analyst.',
          attachments: [
            {
              filename: 'Gamma_BI_JD.docx',
              buffer: buildValidDocxBuffer([
                'Company: Gamma Analytics',
                'Role: Business Intelligence Analyst',
                'CTC: 10.5 LPA',
              ]),
            },
          ],
          sourceOrigin: 'synthetic_fixture',
        },
        'auto_monitor',
        'tpo@college.edu'
      );

      const c3b = await env.services.screener.scanEmailMessage(
        {
          gmailMessageId: 'm-case3-details-second',
          gmailThreadId: 'thread-gamma-analytics',
          fromRaw: 'Talent <university@gammaanalytics.com>',
          authHeadersRaw: 'mx.google.com; spf=pass; dkim=pass; dmarc=pass',
          subject: 'Re: Gamma Analytics 2027 Campus Drive — Business Intelligence Analyst JD',
          receivedAt: '2026-10-22T09:30:00Z',
          bodyText: 'Registration link and deadline for Gamma Analytics BI Analyst: CGPA 7.0, Deadline 22 Nov 2026, https://gammaanalytics.com/campus',
          attachments: [],
          sourceOrigin: 'synthetic_fixture',
        },
        'auto_monitor',
        'tpo@college.edu'
      );
      expect(c3b.opportunityId).toBe(c3a.opportunityId);

      // CASE 4: Same company (`Zenith Systems`) sends TWO DIFFERENT ROLES in separate threads -> MUST STAY SEPARATE!
      const roleA = await env.services.screener.scanEmailMessage(
        {
          gmailMessageId: 'm-zenith-sde',
          gmailThreadId: 'thread-zenith-1',
          fromRaw: 'Campus Hiring <campus@zenithsystems.com>',
          authHeadersRaw: 'mx.google.com; spf=pass; dkim=pass; dmarc=pass',
          subject: 'Zenith Systems Campus Drive 2027 — Role: Software Development Engineer',
          receivedAt: '2026-10-23T10:00:00Z',
          bodyText: 'Company: Zenith Systems\nRole: Software Development Engineer\nCTC: 18 LPA\nBranches: B.Tech CSE/IT 2027.',
          attachments: [],
          sourceOrigin: 'synthetic_fixture',
        },
        'auto_monitor',
        'tpo@college.edu'
      );

      const roleB = await env.services.screener.scanEmailMessage(
        {
          gmailMessageId: 'm-zenith-analyst',
          gmailThreadId: 'thread-zenith-2',
          fromRaw: 'Campus Hiring <campus@zenithsystems.com>',
          authHeadersRaw: 'mx.google.com; spf=pass; dkim=pass; dmarc=pass',
          subject: 'Zenith Systems Campus Drive 2027 — Role: Product Data Analyst',
          receivedAt: '2026-10-23T10:15:00Z',
          bodyText: 'Company: Zenith Systems\nRole: Product Data Analyst\nCTC: 11 LPA\nBranches: B.Tech All Branches 2027.',
          attachments: [],
          sourceOrigin: 'synthetic_fixture',
        },
        'auto_monitor',
        'tpo@college.edu'
      );
      expect(roleA.opportunityId).toBeTruthy();
      expect(roleB.opportunityId).toBeTruthy();
      expect(roleA.opportunityId).not.toBe(roleB.opportunityId); // Distinct roles NOT merged!

      // CASE 6: Officer approves `c1` (v1), creating a pending WhatsApp dispatch target;
      // then an updated JD arrives in `c1`'s thread -> increments version to v2, invalidates v1 approval & marks pending target stale!
      const draftRow = await env.db.query<{ id: string }>(
        'SELECT id FROM draft_versions WHERE opportunity_id = $1 ORDER BY draft_number DESC LIMIT 1',
        [c1.opportunityId]
      );
      const batch = await env.services.routingService.approveDraftAndCreateDispatchBatch('tpo@college.edu', {
        opportunityId: c1.opportunityId!,
        draftVersionId: draftRow.rows[0]!.id,
        sectionIds: [sec!.id],
      });
      expect(batch?.targets.length).toBe(1);
      expect(batch?.targets[0]?.group_id).toBe(grp.group!.id);
      expect(batch?.targets[0]?.status).toBe('pending');

      // Updated JD arrives in same thread after approval!
      await env.services.screener.scanEmailMessage(
        {
          gmailMessageId: 'm-case6-updated-jd',
          inReplyTo: 'm-case1',
          fromRaw: 'Campus Team <hiring@alphaforge.io>',
          authHeadersRaw: 'mx.google.com; spf=pass; dkim=pass; dmarc=pass',
          subject: 'Re: Campus Drive 2027 — AlphaForge Platform Engineer (Revised CTC 16 LPA)',
          receivedAt: '2026-10-24T10:00:00Z',
          bodyText: 'Dear TPO, sharing revised JD with updated CTC 16 LPA for AlphaForge Platform Engineer.',
          attachments: [
            {
              filename: 'AlphaForge_Revised_JD_v2.pdf',
              buffer: buildValidTextPdfBuffer([
                ['Company: AlphaForge', 'Role: Platform Engineer', 'Revised CTC: 16 LPA'],
              ]),
            },
          ],
          sourceOrigin: 'synthetic_fixture',
        },
        'auto_monitor',
        'tpo@college.edu'
      );

      const updatedOpp = await env.db.query<{ current_version: number; status: string }>(
        'SELECT current_version, status FROM opportunities WHERE id = $1',
        [c1.opportunityId]
      );
      expect(updatedOpp.rows[0]?.current_version).toBe(2);
      expect(['needs_review', 'draft_in_review']).toContain(updatedOpp.rows[0]?.status);

      const approvalCheck = await env.db.query<{ status: string; invalidated_at: string | null }>(
        'SELECT status, invalidated_at FROM approvals WHERE opportunity_id = $1',
        [c1.opportunityId]
      );
      expect(approvalCheck.rows[0]?.status).toBe('invalidated');
      expect(approvalCheck.rows[0]?.invalidated_at).toBeTruthy();

      const staleBatch = await env.services.routingService.getDispatchBatchDetails(batch!.batch.id);
      expect(staleBatch?.batch.status).toBe('stale_invalidated');
      expect(staleBatch?.targets[0]?.status).toBe('stale_approval_invalidated');
    } finally {
      await env.cleanup();
    }
  });
});
