import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { createTestSpcrEnvironment, getSharedTestEmbeddingProvider } from './testHarness.js';
import {
  EMAIL_INTELLIGENCE_CATEGORIES,
  EmailIntelligenceCategory,
  ModelArtifactIntegrityError,
} from '../src/ml/schema.js';
import { StructuredEmailExtractionSchema } from '../src/services/structuredEmailExtractor.js';
import { verifyZeroGroupLeakage } from '../src/ml/evaluationMetrics.js';
import { loadOrInitializeSplitCorpus } from '../src/ml/trainerPipeline.js';
import { loadAndVerifyTrainedArtifact } from '../src/ml/tfidfAndLinearModel.js';
import { EmailIntelligenceService } from '../src/services/emailIntelligenceService.js';
import { GroqTransport } from '../src/services/groqDraftingService.js';

function createPoisonedGroqTransport(): GroqTransport {
  return {
    isLiveProvider: false,
    async completeStructured() {
      throw new Error('FORBIDDEN_EXTERNAL_LLM_CALL_IN_LOCAL_PIPELINE');
    },
    async checkConnectionSafe() {
      throw new Error('FORBIDDEN_EXTERNAL_LLM_CALL_IN_LOCAL_PIPELINE');
    },
  };
}

describe('Mandatory Addendum Sections 2-7 & 10 — Local Supervised Recruitment Email Intelligence Model', () => {
  it('Demo 1 & 3: verifies group-disjoint train/val/test split (0 thread/org leakage), 5 architectural components, SHA-256 artifact, and held-out acceptance report', async () => {
    const rootDir = process.cwd();
    const corpus = loadOrInitializeSplitCorpus(rootDir);
    expect(corpus.train.length).toBeGreaterThanOrEqual(140);
    expect(corpus.val.length).toBeGreaterThanOrEqual(45);
    expect(corpus.test.length).toBeGreaterThanOrEqual(50);

    // Prove strictly zero group leakage by threadId AND senderOrgGroup across train/val/test
    const leakage = verifyZeroGroupLeakage(corpus);
    expect(leakage.sharedThreadIds).toBe(0);
    expect(leakage.sharedSenderOrgs).toBe(0);

    // Verify trained artifact checksum and schema
    const artifactPath = path.resolve(rootDir, 'ml/artifacts/recruitment_email_model_v1.json');
    const { artifact, fileSha256 } = loadAndVerifyTrainedArtifact(artifactPath);
    expect(artifact.classifierKind).toBe('supervised_trained_classifier');
    expect(artifact.labels).toEqual(EMAIL_INTELLIGENCE_CATEGORIES);
    expect(artifact.calibrationDisclosure.isCalibratedProbability).toBe(false);
    expect(fileSha256).toMatch(/^[a-f0-9]{64}$/);

    // Verify pre-declared acceptance thresholds & held-out evaluation report
    const evalReportPath = path.resolve(rootDir, 'ml/artifacts/evaluation_report_v1.json');
    expect(fs.existsSync(evalReportPath)).toBe(true);
    const evalReport = JSON.parse(fs.readFileSync(evalReportPath, 'utf8'));
    expect(evalReport.thresholdCheckResults.allThresholdsPassed).toBe(true);
    expect(evalReport.heldOutTestEvaluation.macroF1).toBeGreaterThanOrEqual(0.8);
    expect(evalReport.heldOutTestEvaluation.relevantOpportunityRecall).toBeGreaterThanOrEqual(0.85);
    expect(evalReport.heldOutTestEvaluation.silentOpportunityDiscardRate).toBeLessThanOrEqual(0.02);
    expect(evalReport.calibrationDisclosure.isCalibratedProbability).toBe(false);
    expect(evalReport.realInboxConsentedEvaluation.status).toBe('UNVERIFIED_NO_REAL_MAILBOX_DATA');

    // Verify /api/ml/status exposes all 5 distinct architectural components
    const env = await createTestSpcrEnvironment({ groqTransport: createPoisonedGroqTransport() });
    try {
      const agent = request.agent(env.app);
      const login = await agent.post('/api/auth/demo-login').send({ email: 'tpo@college.edu' });
      const statusRes = await agent.get('/api/ml/status').set('X-CSRF-Token', login.body.csrfToken);
      expect(statusRes.status).toBe(200);
      expect(statusRes.body.architecture.activeProductionClassifierKind).toBe('supervised_trained_classifier');
      const kinds = Object.keys(statusRes.body.architecture.components);
      expect(kinds).toEqual([
        'pretrained_embedding_backbone',
        'deterministic_screening_rules',
        'exemplar_similarity_classifier',
        'supervised_trained_classifier',
        'optional_drafting_llm',
      ]);
    } finally {
      await env.cleanup();
    }
  });

  it('Demo 2: classifies all 14 categories, supports multi-label emails, resists keyword traps in both directions, and advances Gmail thread stages without creating duplicate opportunities', async () => {
    const env = await createTestSpcrEnvironment({
      configOverrides: { groqApiKey: '', groqLiveEnabled: false },
      groqTransport: createPoisonedGroqTransport(),
    });

    try {
      const service = env.services.emailIntelligence;
      await service.ensureLoaded();

      // Verify all 14 required categories on representative unseen inputs
      const probes: Array<{
        expected: EmailIntelligenceCategory;
        fromRaw: string;
        subject: string;
        rawBody: string;
        inReplyTo?: string;
        attachmentFilenames?: string[];
        priorThreadCategories?: EmailIntelligenceCategory[];
        listUnsubscribeHeader?: string;
        isSuspiciousSender?: boolean;
        riskFlags?: string[];
      }> = [
        {
          expected: 'relevant_opportunity',
          fromRaw: 'Campus Team <campus@zephyrcompute.in>',
          subject: 'Campus Recruitment Drive 2027 — Backend Systems Engineer (CTC 14 LPA)',
          rawBody:
            'Dear TPO, Zephyr Compute invites B.Tech CSE/IT 2027 graduating batch for Backend Systems Engineer (Full-Time). Eligibility: CGPA >= 7.5. Apply by 25 Nov 2026 at https://careers.zephyrcompute.in/2027.',
        },
        {
          expected: 'recruiter_outreach',
          fromRaw: 'Neha Kulkarni <neha.kulkarni@latticeworks.io>',
          subject: 'Connecting with your Placement Cell for 2027 Engineering Hiring',
          rawBody:
            'Hello Placement Officer, I lead university talent acquisition at LatticeWorks. Came across your institute and would love to discuss partnering for our upcoming 2027 summer internship and FTE hiring.',
        },
        {
          expected: 'jd_or_details_followup',
          fromRaw: 'Campus Team <campus@zephyrcompute.in>',
          inReplyTo: '<init-drive@zephyrcompute.in>',
          attachmentFilenames: ['Updated_Job_Description_2027.pdf'],
          priorThreadCategories: ['relevant_opportunity'],
          subject: 'Re: Attached Updated Job Description PDF and Revised CTC Breakdown',
          rawBody:
            'Dear Placement Officer, Following up on our previous email thread, please find attached the updated Job Description PDF along with the revised stipend, branch eligibility, and CTC breakup.',
        },
        {
          expected: 'application_acknowledgement',
          fromRaw: 'Workday No-Reply <noreply@myworkday.com>',
          subject: 'Thank you for applying — Application Received (Req ID: WD-8821)',
          rawBody:
            'Thank you for submitting your application for Software Engineer Intern. We have received your application and our talent team will review your profile.',
        },
        {
          expected: 'screening_or_eligibility',
          fromRaw: 'Campus Relations <university@kronosfin.in>',
          subject: 'Action Required: Share Eligible Student Shortlist Excel & CGPA Verification',
          rawBody:
            'Dear TPO, Please share the Excel sheet of eligible B.Tech CSE/ECE students meeting minimum 7.5 CGPA and zero active backlogs by Friday 5 PM for initial screening.',
        },
        {
          expected: 'online_assessment',
          fromRaw: 'HackerRank Assessments <noreply@hackerrankforwork.com>',
          subject: 'Online Coding Assessment Invitation — Backend Engineer 2027',
          rawBody:
            'You are invited to complete the 90-minute proctored online coding test on HackerRank. Test link: https://www.hackerrank.com/test/zephyr-2027. Complete before 18 Nov 2026 11:59 PM IST.',
        },
        {
          expected: 'interview_invitation',
          fromRaw: 'Recruiting Coordinator <scheduling@zephyrcompute.in>',
          subject: 'Technical Interview Invitation — Slot Confirmation on 22 Nov 2026 at 11:00 AM IST',
          rawBody:
            'Congratulations on clearing the coding test! Your Round 1 Technical Interview is scheduled on 22 Nov 2026 at 11:00 AM IST via Google Meet: https://meet.google.com/abc-defg-hij. Please confirm your availability.',
        },
        {
          expected: 'interview_followup',
          fromRaw: 'Recruiting Coordinator <scheduling@zephyrcompute.in>',
          inReplyTo: '<round1-invite@zephyrcompute.in>',
          priorThreadCategories: ['relevant_opportunity', 'interview_invitation'],
          subject: 'Re: Round 1 Interview Result — Shortlisted for Next Round (HR Discussion)',
          rawBody:
            'Hi, Thank you for completing Round 1 yesterday. Feedback from the panel was positive — you have cleared Round 1 and are advancing to the next round. We will share next-round logistics shortly.',
        },
        {
          expected: 'offer',
          fromRaw: 'HR Operations <offers@zephyrcompute.in>',
          attachmentFilenames: ['Offer_Letter_Zephyr_2027.pdf'],
          priorThreadCategories: ['interview_invitation'],
          subject: 'Congratulations! Final Job Offer & Letter of Intent — Software Engineer (Zephyr Compute)',
          rawBody:
            'Congratulations! We are thrilled to offer you a Full-Time Job Offer for Software Engineer at Zephyr Compute (14.5 LPA). Please review, sign, and accept the attached offer letter within 7 days.',
        },
        {
          expected: 'rejection',
          fromRaw: 'Talent Acquisition <careers@zephyrcompute.in>',
          subject: 'Update on your application for Software Engineer 2027',
          rawBody:
            'Thank you for taking the time to interview with us. After careful consideration, we regret to inform you that we will not be moving forward with your candidacy at this time.',
        },
        {
          expected: 'job_alert_newsletter',
          fromRaw: 'LinkedIn Job Alerts <jobalerts-noreply@linkedin.com>',
          subject: '30+ new Software Developer jobs in Bengaluru matching your job alert',
          rawBody:
            'Your daily job alert digest: 34 new developer jobs posted today. View all jobs or manage alert preferences and unsubscribe anytime.',
          listUnsubscribeHeader: '<mailto:unsubscribe@linkedin.com>',
        },
        {
          expected: 'unrelated_email',
          fromRaw: 'Hostel Warden <warden@college.edu>',
          subject: 'Hostel Mess Menu Revision & Water Tank Maintenance Notice',
          rawBody:
            'All hostel residents are informed that overhead water tank cleaning will take place on Sunday from 10 AM to 2 PM. Updated mess menu is posted on the notice board.',
        },
        {
          expected: 'spam_or_scam',
          fromRaw: 'Global HR <hr.instantoffer2027@gmail.com>',
          subject: 'URGENT Direct Offer Letter 18 LPA — Pay INR 2500 Security Deposit Today',
          rawBody:
            'Guaranteed placement without interview! Pay refundable registration fee / training security deposit of Rs. 2500 via UPI immediately to receive confirmed offer letter.',
          isSuspiciousSender: true,
          riskFlags: ['fee_or_deposit_scam_indicator', 'free_webmail_claiming_corporate_sender'],
        },
        {
          expected: 'uncertain',
          fromRaw: 'arjun.patel@externalmail.org',
          subject: 'Quick query',
          rawBody: 'Please check and revert when free.',
        },
      ];

      for (const p of probes) {
        const pred = await service.classifyEmail({
          fromRaw: p.fromRaw,
          inReplyTo: p.inReplyTo || null,
          attachmentFilenames: p.attachmentFilenames || [],
          priorThreadCategories: p.priorThreadCategories || [],
          subject: p.subject,
          rawBody: p.rawBody,
          listUnsubscribeHeader: p.listUnsubscribeHeader || null,
          isSuspiciousSender: p.isSuspiciousSender,
          riskFlags: p.riskFlags,
        });
        expect(pred.primaryCategory, `Failed probe for ${p.expected}`).toBe(p.expected);
      }

      // Keyword-Trap Resistance Direction A: Contains "job", "career", "developer", "interview", "resume" -> still UNRELATED!
      const trapUnrelated = await service.classifyEmail({
        fromRaw: 'Film & Literary Club <litclub@college.edu>',
        subject: 'Book Review: Steve Jobs biography & Documentary Interview Screening',
        rawBody:
          'Join the campus film club this Friday! We are screening an archival interview about Steve Jobs early career as a game developer before we resume our weekly debate club schedule.',
      });
      expect(trapUnrelated.primaryCategory).toBe('unrelated_email');

      // Keyword-Trap Resistance Direction B: Genuine opportunity WITHOUT "job", "career", "developer", "interview", "resume"!
      const indirectOpp = await service.classifyEmail({
        fromRaw: 'University Relations <campus-relations@auroradata.in>',
        subject: '2027 Graduating Batch Intake — Systems Associate (B.Tech CSE/ECE, 12 LPA)',
        rawBody:
          'Dear Training and Placement Cell, Aurora Data Systems invites nominations from your 2027 B.Tech CSE and ECE graduating cohort for Full-Time Systems Associate roles in Pune. Minimum CGPA: 7.5. Compensation: INR 12 LPA. Nomination link: https://auroradata.in/campus-2027 (Deadline: 29 Nov 2026).',
      });
      expect(['relevant_opportunity', 'recruiter_outreach', 'screening_or_eligibility']).toContain(
        indirectOpp.primaryCategory
      );

      // Multi-label check: Recruiter outreach that also includes concrete campus opportunity details
      const multiPred = await service.classifyEmail({
        fromRaw: 'Ananya Rao <ananya@nimbusscale.io>',
        subject: 'Recruiter Outreach & Campus Hiring Drive 2027 — Cloud Engineer (16 LPA)',
        rawBody:
          'Hi Placement Officer, I am Ananya from University Recruiting at NimbusScale. Reaching out directly to invite your 2027 B.Tech CSE batch for our Cloud Engineer full-time drive (CTC 16 LPA, CGPA >= 8.0, apply by 24 Nov 2026 at https://nimbusscale.io/apply).',
      });
      expect(multiPred.multiLabels.length).toBeGreaterThanOrEqual(1);
      expect(
        multiPred.multiLabels.includes('relevant_opportunity') ||
          multiPred.multiLabels.includes('recruiter_outreach')
      ).toBe(true);

      // Multi-turn Gmail Thread Stage Progression WITHOUT creating duplicate opportunities!
      const agent = request.agent(env.app);
      const login = await agent.post('/api/auth/demo-login').send({ email: 'tpo@college.edu' });
      const csrf = login.body.csrfToken;
      const threadId = 'th-aurora-lifecycle-2027';

      // Turn 1: Initial Opportunity
      const t1 = await agent
        .post('/api/scan/manual')
        .set('X-CSRF-Token', csrf)
        .send({
          gmailMessageId: 'msg-th-1',
          syntheticPayload: {
            gmailThreadId: threadId,
            fromRaw: 'Campus Hiring <campus@auroracloud.in>',
            authHeadersRaw: 'mx.google.com; spf=pass; dkim=pass',
            subject: 'Campus Recruitment 2027 — Platform Engineer (CTC 15 LPA)',
            bodyText:
              'Dear TPO, Aurora Cloud invites B.Tech CSE 2027 students for Platform Engineer (Full-Time) in Bengaluru (Hybrid). CTC: INR 15 LPA. Apply by 20 Nov 2026 at https://careers.auroracloud.in/platform-2027.',
          },
        });
      expect(t1.status).toBe(200);
      expect(t1.body.opportunityId).toBeTruthy();
      const oppId = t1.body.opportunityId;

      // Turn 2: Online Assessment in same Gmail thread
      const t2 = await agent
        .post('/api/scan/manual')
        .set('X-CSRF-Token', csrf)
        .send({
          gmailMessageId: 'msg-th-2',
          syntheticPayload: {
            gmailThreadId: threadId,
            inReplyTo: '<msg-th-1@auroracloud.in>',
            fromRaw: 'Assessments <assessments@auroracloud.in>',
            subject: 'Re: Campus Recruitment 2027 — Online Coding Assessment Link',
            bodyText:
              'Shortlisted students for Platform Engineer at Aurora Cloud must complete the 90-minute HackerRank coding test by 22 Nov 2026: https://www.hackerrank.com/test/aurora-platform-2027.',
          },
        });
      expect(t2.status).toBe(200);
      expect(t2.body.primaryCategory).toBe('online_assessment');
      expect(t2.body.opportunityId).toBe(oppId);

      // Turn 3: Interview Invitation in same Gmail thread
      const t3 = await agent
        .post('/api/scan/manual')
        .set('X-CSRF-Token', csrf)
        .send({
          gmailMessageId: 'msg-th-3',
          syntheticPayload: {
            gmailThreadId: threadId,
            inReplyTo: '<msg-th-2@auroracloud.in>',
            fromRaw: 'Campus Hiring <campus@auroracloud.in>',
            subject: 'Re: Technical Interview Schedule — Aurora Cloud Platform Engineer',
            bodyText:
              'Congratulations! Technical Round 1 interviews for Platform Engineer are scheduled on 25 Nov 2026 at 10:30 AM IST via Google Meet: https://meet.google.com/aur-ora-meet. Please confirm attendance.',
          },
        });
      expect(t3.status).toBe(200);
      expect(t3.body.primaryCategory).toBe('interview_invitation');
      expect(t3.body.opportunityId).toBe(oppId);

      // Turn 4: Offer in same Gmail thread
      const t4 = await agent
        .post('/api/scan/manual')
        .set('X-CSRF-Token', csrf)
        .send({
          gmailMessageId: 'msg-th-4',
          syntheticPayload: {
            gmailThreadId: threadId,
            inReplyTo: '<msg-th-3@auroracloud.in>',
            fromRaw: 'Campus Hiring <campus@auroracloud.in>',
            subject: 'Re: Offer of Employment — Platform Engineer at Aurora Cloud',
            bodyText:
              'We are pleased to extend the final Offer of Employment for Platform Engineer at Aurora Cloud (CTC INR 15 LPA). Please sign and return the offer acceptance by 30 Nov 2026.',
          },
        });
      expect(t4.status).toBe(200);
      expect(t4.body.primaryCategory).toBe('offer');
      expect(t4.body.opportunityId).toBe(oppId);

      // Verify ONLY 1 opportunity exists in DB and its stage advanced to 'offer_extended' with 4 linked messages!
      const oppsRes = await agent.get('/api/opportunities');
      expect(oppsRes.body.opportunities).toHaveLength(1);
      expect(oppsRes.body.opportunities[0].id).toBe(oppId);
      expect(oppsRes.body.opportunities[0].recruitment_stage).toBe('offer_extended');
      expect(oppsRes.body.opportunities[0].linked_messages_count).toBe(4);
    } finally {
      await env.cleanup();
    }
  });

  it('Demo 4 & 6: performs validated local structured extraction (null for missing fields, verbatim evidence, separate authenticity) and handles empty/ambiguous/suspicious emails safely', async () => {
    const env = await createTestSpcrEnvironment({
      configOverrides: { groqApiKey: '', groqLiveEnabled: false },
      groqTransport: createPoisonedGroqTransport(),
    });

    try {
      const agent = request.agent(env.app);
      const login = await agent.post('/api/auth/demo-login').send({ email: 'tpo@college.edu' });
      const csrf = login.body.csrfToken;

      // 1. Rich relevant email WITHOUT salary/stipend -> salaryOrStipend MUST remain null (never invented!)
      const richRes = await agent
        .post('/api/scan/manual')
        .set('X-CSRF-Token', csrf)
        .send({
          gmailMessageId: 'msg-extract-1',
          syntheticPayload: {
            gmailThreadId: 'th-extract-1',
            fromRaw: '"Rohan Mehta" <rohan.mehta@stratoslabs.io>',
            authHeadersRaw: 'mx.google.com; spf=pass; dkim=pass; dmarc=pass',
            subject: 'Internship Drive 2027 — Backend Intern at Stratos Labs',
            bodyText:
              'Hello Placement Cell,\nCompany: Stratos Labs\nRole: Backend Engineering Intern\nLocation: Bengaluru (Hybrid)\nApplication Link: https://jobs.stratoslabs.io/apply/backend-intern\nLast Date to Apply: 19 Nov 2026\nPlease ask eligible students to apply before the deadline.',
          },
        });

      expect(richRes.status).toBe(200);
      expect(richRes.body.groqCallsMade).toBe(0);
      const ext = StructuredEmailExtractionSchema.parse(richRes.body.structuredExtraction);
      expect(ext.companyOrOrganization).toContain('Stratos Labs');
      expect(ext.jobTitleOrRole).toContain('Backend');
      expect(ext.workMode).toBe('hybrid');
      expect(ext.employmentType).toBe('internship');
      // Salary was NOT stated -> must strictly remain null!
      expect(ext.salaryOrStipend).toBeNull();
      expect(ext.applicationLinks).toContain('https://jobs.stratoslabs.io/apply/backend-intern');
      expect(ext.deadline).toContain('19 Nov 2026');
      expect(ext.sourceIds.sourceMessageId).toBeTruthy();
      expect(ext.sourceIds.gmailThreadId).toBe('th-extract-1');
      // Verbatim supporting evidence must exist for extracted fields
      expect(ext.evidence.companyOrOrganization?.verbatimExcerpt).toContain('Stratos Labs');
      expect(ext.evidence.applicationLinks?.verbatimExcerpt).toContain(
        'https://jobs.stratoslabs.io/apply/backend-intern'
      );
      // Source authenticity is strictly separate from relevance; claimed identity is never marked verified!
      expect(ext.authenticityAndRisk.claimedIdentityVerified).toBe(false);
      expect(ext.classificationConfidence.isCalibratedProbability).toBe(false);

      // 2. Empty / ultra-short ambiguous email -> REVIEW_REQUIRED, retained for human review, NEVER silently discarded!
      const emptyRes = await agent
        .post('/api/scan/manual')
        .set('X-CSRF-Token', csrf)
        .send({
          gmailMessageId: 'msg-empty-1',
          syntheticPayload: {
            fromRaw: 'unknown.contact@partner-mail.org',
            subject: '',
            bodyText: '',
          },
        });
      expect(emptyRes.status).toBe(200);
      expect(emptyRes.body.primaryCategory).toBe('uncertain');
      expect(emptyRes.body.uncertaintyOutcome).toBe('REVIEW_REQUIRED');
      expect(emptyRes.body.opportunityId).toBeTruthy(); // Retained in review inbox, NOT discarded!
      expect(emptyRes.body.eligibleForAutoGroqQueue).toBe(false);

      // 3. Suspicious spoofed / fee-scam email -> LOW_CONFIDENCE_OR_SUSPICIOUS, blocked from automation!
      const scamRes = await agent
        .post('/api/scan/manual')
        .set('X-CSRF-Token', csrf)
        .send({
          gmailMessageId: 'msg-scam-1',
          syntheticPayload: {
            fromRaw: '"Microsoft Campus HR" <microsoft.campus.offer@gmail.com>',
            subject: 'Direct Campus Selection — Pay INR 1999 Registration Deposit',
            bodyText:
              'Dear Student, Pay refundable security deposit of Rs 1999 immediately to collect your confirmed joining letter.',
          },
        });
      expect(scamRes.status).toBe(200);
      expect(scamRes.body.uncertaintyOutcome).toBe('LOW_CONFIDENCE_OR_SUSPICIOUS');
      expect(scamRes.body.eligibleForAutoGroqQueue).toBe(false);
    } finally {
      await env.cleanup();
    }
  });

  it('Demo 5: fails safely with ModelArtifactIntegrityError (HTTP 503) when model artifact is missing, malformed, schema-invalid, or checksum-tampered', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'spcr-artifact-safety-'));
    const realArtifactPath = path.resolve(process.cwd(), 'ml/artifacts/recruitment_email_model_v1.json');
    const rawValidJson = fs.readFileSync(realArtifactPath, 'utf8');

    try {
      // Case A: Missing artifact file
      const missingPath = path.join(tmpDir, 'nonexistent_model.json');
      const missingSvc = new EmailIntelligenceService({
        artifactPath: missingPath,
        cacheDir: path.resolve(process.cwd(), '.models_cache'),
        offlineOnly: true,
        embeddingProvider: getSharedTestEmbeddingProvider(),
      });
      await expect(missingSvc.ensureLoaded()).rejects.toThrow(ModelArtifactIntegrityError);

      // Verify API returns HTTP 503 MODEL_ARTIFACT_INTEGRITY_ERROR (zero silent misclassification)
      const brokenEnv = await createTestSpcrEnvironment({
        emailIntelligence: missingSvc,
      });
      try {
        const agent = request.agent(brokenEnv.app);
        const login = await agent.post('/api/auth/demo-login').send({ email: 'tpo@college.edu' });
        const scanRes = await agent
          .post('/api/scan/manual')
          .set('X-CSRF-Token', login.body.csrfToken)
          .send({
            gmailMessageId: 'msg-broken-model',
            syntheticPayload: {
              fromRaw: 'hr@company.in',
              subject: 'Campus Hiring 2027',
              bodyText: 'B.Tech CSE hiring drive.',
            },
          });
        expect(scanRes.status).toBe(503);
        expect(scanRes.body.error).toBe('MODEL_ARTIFACT_INTEGRITY_ERROR');
        expect(scanRes.body.reasonCode).toBe('ARTIFACT_MISSING');
      } finally {
        await brokenEnv.cleanup();
      }

      // Case B: Malformed JSON
      const malformedPath = path.join(tmpDir, 'malformed.json');
      fs.writeFileSync(malformedPath, '{ "artifactFormatVersion": "spcr-email-ml-v1", BROKEN_JSON ', 'utf8');
      expect(() => loadAndVerifyTrainedArtifact(malformedPath)).toThrow(ModelArtifactIntegrityError);

      // Case C: Schema-invalid JSON
      const schemaBadPath = path.join(tmpDir, 'schema_bad.json');
      fs.writeFileSync(schemaBadPath, JSON.stringify({ artifactFormatVersion: 'wrong-version' }), 'utf8');
      expect(() => loadAndVerifyTrainedArtifact(schemaBadPath)).toThrow(ModelArtifactIntegrityError);

      // Case D: Checksum-tampered weights (altering 1 bias weight by +0.001 without recomputing signature)
      const tamperedObj = JSON.parse(rawValidJson);
      tamperedObj.biasByLabel.relevant_opportunity += 0.001;
      const tamperedPath = path.join(tmpDir, 'tampered_weights.json');
      fs.writeFileSync(tamperedPath, JSON.stringify(tamperedObj), 'utf8');
      expect(() => loadAndVerifyTrainedArtifact(tamperedPath)).toThrow(/Model artifact checksum mismatch/);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('Demo 7: enforces controlled PII-redacted user corrections, blocks unapproved feedback from training, retrains with held-out regression gate, and rolls back cleanly', async () => {
    const env = await createTestSpcrEnvironment({
      configOverrides: { groqApiKey: '', groqLiveEnabled: false },
      groqTransport: createPoisonedGroqTransport(),
    });

    const createdArtifactsToClean: string[] = [];

    try {
      const agent = request.agent(env.app);
      const login = await agent.post('/api/auth/demo-login').send({ email: 'tpo@college.edu' });
      const csrf = login.body.csrfToken;

      // 1. Scan a candidate email (retains body_text) containing personal phone & email PII
      const scanRes = await agent
        .post('/api/scan/manual')
        .set('X-CSRF-Token', csrf)
        .send({
          gmailMessageId: 'msg-corr-1',
          syntheticPayload: {
            fromRaw: 'Campus Recruitment <campus@partnerfirm.in>',
            subject: 'Campus Hiring Drive 2027 Eligibility — Contact +91 9876543210',
            bodyText:
              'Dear TPO, PartnerFirm invites B.Tech CSE 2027 students (CTC 12 LPA). Please send the eligible CSE shortlist to rahul.personal@partnerfirm.in or call +91 9876543210 before Friday 5 PM.',
          },
        });
      expect(scanRes.status).toBe(200);
      const sourceMessageId = scanRes.body.sourceMessageId;

      // 2. Submit user correction -> stored as 'staged_unverified' with PII redacted!
      const corrRes = await agent
        .post(`/api/messages/${sourceMessageId}/correction`)
        .set('X-CSRF-Token', csrf)
        .send({
          verdict: 'incorrect',
          correctedPrimaryCategory: 'screening_or_eligibility',
          correctedMultiLabels: ['screening_or_eligibility', 'jd_or_details_followup'],
          officerNote: 'Requests eligible student shortlist.',
        });
      expect(corrRes.status).toBe(200);
      const fb = corrRes.body.feedback;
      expect(fb.review_status).toBe('staged_unverified');
      expect(fb.privacy_redacted).toBe(true);
      expect(fb.redacted_subject).toContain('[REDACTED_PHONE]');
      expect(fb.redacted_body).toContain('[REDACTED_USER]@partnerfirm.in');
      expect(fb.redacted_body).not.toContain('rahul.personal');
      expect(fb.redacted_body).not.toContain('9876543210');

      // 3. Retraining BEFORE approval must NOT include unverified staged feedback (`approvedFeedbackIncluded === 0`)
      const preApproveRetrain = await agent
        .post('/api/ml/retrain')
        .set('X-CSRF-Token', csrf)
        .send({ compareHybridMiniLm: false, autoActivate: false });
      expect(preApproveRetrain.status).toBe(200);
      expect(preApproveRetrain.body.approvedFeedbackIncluded).toBe(0);
      expect(preApproveRetrain.body.activated).toBe(false);
      if (preApproveRetrain.body.artifactPath) createdArtifactsToClean.push(preApproveRetrain.body.artifactPath);

      // 4. Approve correction explicitly
      const reviewRes = await agent
        .post(`/api/ml/feedback/${fb.id}/review`)
        .set('X-CSRF-Token', csrf)
        .send({ decision: 'approved_for_training' });
      expect(reviewRes.status).toBe(200);
      expect(reviewRes.body.feedback.review_status).toBe('approved_for_training');

      // 5. Retrain with approved feedback -> passes held-out regression gate and activates new version!
      const retrainRes = await agent
        .post('/api/ml/retrain')
        .set('X-CSRF-Token', csrf)
        .send({ compareHybridMiniLm: false, autoActivate: true });
      expect(retrainRes.status).toBe(200);
      expect(retrainRes.body.approvedFeedbackIncluded).toBe(1);
      expect(retrainRes.body.passedRegressionGate).toBe(true);
      expect(retrainRes.body.activated).toBe(true);
      expect(retrainRes.body.previousVersion).toBe('spcr-email-intel-v1.0.0');
      if (retrainRes.body.artifactPath) createdArtifactsToClean.push(retrainRes.body.artifactPath);

      const statusAfterRetrain = await agent.get('/api/ml/status');
      expect(statusAfterRetrain.body.architecture.loadedModelVersion).toBe(retrainRes.body.newModelVersion);

      // 6. Reversible Rollback -> restores spcr-email-intel-v1.0.0 cleanly!
      const rollbackRes = await agent
        .post('/api/ml/rollback')
        .set('X-CSRF-Token', csrf)
        .send({ targetVersion: 'spcr-email-intel-v1.0.0' });
      expect(rollbackRes.status).toBe(200);
      expect(rollbackRes.body.rolledBackToVersion).toBe('spcr-email-intel-v1.0.0');

      const statusAfterRollback = await agent.get('/api/ml/status');
      expect(statusAfterRollback.body.architecture.loadedModelVersion).toBe('spcr-email-intel-v1.0.0');
    } finally {
      for (const p of createdArtifactsToClean) {
        if (fs.existsSync(p)) fs.rmSync(p, { force: true });
      }
      await env.cleanup();
    }
  }, 30_000);
});
