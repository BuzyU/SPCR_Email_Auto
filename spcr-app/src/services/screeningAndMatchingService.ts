import { Database, QueryExecutor } from '../db/database.js';
import { AppConfig } from '../config/env.js';
import { randomId, sha256Hex } from '../utils/crypto.js';
import { assessSenderAuthenticity, extractUrlsFromText } from './authenticityService.js';
import { LocalOnnxRecruitmentClassifier, ScreeningClass } from './localClassifier.js';
import { EmailIntelligenceService } from './emailIntelligenceService.js';
import {
  extractValidatedStructuredEmailInfo,
  StructuredEmailExtraction,
} from './structuredEmailExtractor.js';
import {
  CATEGORY_METADATA,
  EMAIL_INTELLIGENCE_CATEGORIES,
  EmailIntelligenceCategory,
  UncertaintyOutcome,
} from '../ml/schema.js';
import { SharedAttachmentStorageService } from './attachmentService.js';
import {
  extractFactsFromSingleSource,
  inferCompanyAndRoleFromHeadersAndText,
  mergeProvenancedFacts,
  ProvenancedFactCandidate,
  renderPlainTextAnnouncementFromFacts,
} from './factExtractor.js';
import { getSettings } from './settingsService.js';
import { RoutingAndDispatchService } from './routingAndDispatchService.js';
import { recordAuditEvent } from './auditService.js';

export interface IncomingAttachmentPayload {
  filename: string;
  declaredMime?: string | null;
  buffer: Buffer;
  simulateHangMs?: number;
  timeoutOverrideMs?: number;
}

export interface IncomingEmailMessage {
  gmailMessageId: string;
  gmailThreadId?: string | null;
  rfcMessageId?: string | null;
  inReplyTo?: string | null;
  referencesHeader?: string | null;
  listUnsubscribeHeader?: string | null;
  fromRaw: string;
  replyToRaw?: string | null;
  authHeadersRaw?: string | null;
  subject: string;
  receivedAt: string;
  snippet?: string | null;
  bodyText?: string | null;
  isHtmlOnly?: boolean;
  attachments?: IncomingAttachmentPayload[];
  sourceOrigin: 'gmail_api' | 'synthetic_fixture';
}

export interface ScreeningScanResult {
  alreadyProcessed: boolean;
  sourceMessageId: string;
  gmailMessageId: string;
  classification: ScreeningClass;
  primaryCategory: EmailIntelligenceCategory;
  multiLabels: EmailIntelligenceCategory[];
  uncertaintyOutcome: UncertaintyOutcome;
  uncertaintyReasons: string[];
  modelVersion: string;
  recruitmentStage: string | null;
  structuredExtraction: StructuredEmailExtraction | null;
  confidence: number;
  margin: number;
  authenticityLabel: string;
  transportAuthStatus: string;
  riskFlags: string[];
  groqCallsMade: 0;
  statusBanner: 'Scanned — no Groq request made';
  opportunityId: string | null;
  linkState: 'confirmed' | 'proposed' | null;
  eligibleForAutoGroqQueue: boolean;
}

function roleTokens(role: string): Set<string> {
  const stop = new Set(['not', 'specified', 'role', 'position', 'and', 'the', 'for', 'intern', 'internship', 'fte', 'trainee', 'junior', 'senior']);
  return new Set(
    role
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length >= 2 && !stop.has(w))
  );
}

function rolesConflictExplicitly(roleA: string, roleB: string): { sameRole: boolean; conflict: boolean; overlap: number } {
  const aUnspecified = !roleA || roleA.toLowerCase() === 'not specified';
  const bUnspecified = !roleB || roleB.toLowerCase() === 'not specified';
  if (aUnspecified || bUnspecified) {
    return { sameRole: false, conflict: false, overlap: 0 };
  }
  const tokA = roleTokens(roleA);
  const tokB = roleTokens(roleB);
  if (tokA.size === 0 || tokB.size === 0) {
    const eq = roleA.trim().toLowerCase() === roleB.trim().toLowerCase();
    return { sameRole: eq, conflict: !eq, overlap: eq ? 1 : 0 };
  }
  let shared = 0;
  for (const t of tokA) {
    if (tokB.has(t)) shared++;
  }
  const union = tokA.size + tokB.size - shared;
  const overlap = union === 0 ? 0 : shared / union;
  if (overlap >= 0.45) {
    return { sameRole: true, conflict: false, overlap };
  }
  if (overlap === 0) {
    return { sameRole: false, conflict: true, overlap: 0 };
  }
  return { sameRole: false, conflict: false, overlap };
}

/**
 * Independent Email Screening, 14-Category Multi-Label Intelligence & Opportunity/JD Matching Service.
 * ARCHITECTURAL GUARANTEE: Has ZERO reference to GroqAdapter or GROQ_API_KEY.
 * Every auto-scan and manual-scan execution runs 100% locally on CPU and makes strictly 0 Groq requests.
 */
export class ScreeningAndMatchingService {
  private readonly emailIntelligence: EmailIntelligenceService;

  constructor(
    private readonly db: Database,
    private readonly config: AppConfig,
    private readonly classifier: LocalOnnxRecruitmentClassifier,
    private readonly attachmentStorage: SharedAttachmentStorageService,
    private readonly routingService: RoutingAndDispatchService,
    emailIntelligence?: EmailIntelligenceService
  ) {
    this.emailIntelligence =
      emailIntelligence ||
      new EmailIntelligenceService({
        artifactPath: config.emailModelArtifactPath,
        cacheDir: config.classifierCacheDir,
        offlineOnly: config.classifierOfflineOnly,
      });
  }

  private async loadPriorThreadCategories(msg: IncomingEmailMessage): Promise<EmailIntelligenceCategory[]> {
    if (!msg.gmailThreadId && !msg.inReplyTo && !msg.referencesHeader) {
      return [];
    }
    const clauses: string[] = [];
    const params: unknown[] = [];
    if (msg.gmailThreadId) {
      params.push(msg.gmailThreadId);
      clauses.push(`sm.gmail_thread_id = $${params.length}`);
    }
    const replyRefs = `${msg.inReplyTo || ''} ${msg.referencesHeader || ''}`.trim();
    if (replyRefs) {
      params.push(`%${replyRefs.slice(0, 120)}%`);
      clauses.push(`(sm.rfc_message_id IS NOT NULL AND $${params.length} LIKE '%' || sm.rfc_message_id || '%')`);
    }
    if (clauses.length === 0) return [];

    const res = await this.db.query<{ primary_category: string | null }>(
      `SELECT so.primary_category
       FROM source_messages sm
       JOIN screening_outcomes so ON so.source_message_id = sm.id
       WHERE (${clauses.join(' OR ')})
       ORDER BY sm.received_at ASC
       LIMIT 20`,
      params
    );

    return res.rows
      .map((r) => r.primary_category)
      .filter((c): c is EmailIntelligenceCategory =>
        Boolean(c && (EMAIL_INTELLIGENCE_CATEGORIES as readonly string[]).includes(c))
      );
  }

  async scanEmailMessage(
    msg: IncomingEmailMessage,
    trigger: 'auto_monitor' | 'manual_scan',
    actorEmail = 'system'
  ): Promise<ScreeningScanResult> {
    const rawContentForHash = JSON.stringify({
      id: msg.gmailMessageId,
      from: msg.fromRaw,
      subject: msg.subject,
      body: msg.bodyText || msg.snippet || '',
      attNames: (msg.attachments || []).map((a) => `${a.filename}:${a.buffer.length}`),
    });
    const messageSha256 = sha256Hex(rawContentForHash);

    // 1. Idempotency check by stable Gmail message ID
    const existingRes = await this.db.query<{
      id: string;
      message_sha256: string;
    }>('SELECT id, message_sha256 FROM source_messages WHERE gmail_message_id = $1', [msg.gmailMessageId]);

    if (existingRes.rows[0] && existingRes.rows[0].message_sha256 === messageSha256) {
      const existingMsgId = existingRes.rows[0].id;
      const outRes = await this.db.query<any>(
        'SELECT * FROM screening_outcomes WHERE source_message_id = $1',
        [existingMsgId]
      );
      const linkRes = await this.db.query<{ opportunity_id: string; link_state: 'confirmed' | 'proposed' }>(
        `SELECT opportunity_id, link_state FROM opportunity_message_links
         WHERE source_message_id = $1 AND link_state IN ('confirmed', 'proposed')
         ORDER BY created_at DESC LIMIT 1`,
        [existingMsgId]
      );
      const out = outRes.rows[0];
      const pCat = (out.primary_category || 'uncertain') as EmailIntelligenceCategory;
      return {
        alreadyProcessed: true,
        sourceMessageId: existingMsgId,
        gmailMessageId: msg.gmailMessageId,
        classification: out.classification,
        primaryCategory: pCat,
        multiLabels: out.multi_labels_json || [pCat],
        uncertaintyOutcome: (out.uncertainty_outcome || 'REVIEW_REQUIRED') as UncertaintyOutcome,
        uncertaintyReasons: out.uncertainty_reasons_json || [],
        modelVersion: out.model_version || 'unknown',
        recruitmentStage: CATEGORY_METADATA[pCat]?.recruitmentStage || null,
        structuredExtraction: out.structured_extraction_json || null,
        confidence: Number(out.confidence),
        margin: Number(out.margin),
        authenticityLabel: out.authenticity_label,
        transportAuthStatus: out.transport_auth_status,
        riskFlags: out.risk_flags_json || [],
        groqCallsMade: 0,
        statusBanner: 'Scanned — no Groq request made',
        opportunityId: linkRes.rows[0]?.opportunity_id || null,
        linkState: linkRes.rows[0]?.link_state || null,
        eligibleForAutoGroqQueue: false,
      };
    }

    const settings = await getSettings(this.db, this.config);
    const rawBodyOrSnippet = msg.bodyText ?? msg.snippet ?? '';
    const inspectBody = rawBodyOrSnippet.trim();
    const extractedUrls = extractUrlsFromText(`${msg.subject}\n${inspectBody}`);

    // 2. Independent Sender Authenticity & Risk Evaluation (zero external URL fetches)
    const authAssessment = await assessSenderAuthenticity(this.db, {
      fromRaw: msg.fromRaw,
      replyToRaw: msg.replyToRaw,
      authHeadersRaw: msg.authHeadersRaw,
      subject: msg.subject,
      bodyOrSnippet: inspectBody,
      urls: extractedUrls,
    });

    // 3. Local Supervised 14-Category Multi-Label Classifier + Thread Context (ZERO Groq calls!)
    // Throws `ModelArtifactIntegrityError` cleanly if model artifact is missing, malformed, or tampered.
    const attachmentFilenames = (msg.attachments || []).map((a) => a.filename);
    const priorThreadCategories = await this.loadPriorThreadCategories(msg);

    let mlPred = await this.emailIntelligence.classifyEmail(
      {
        fromRaw: msg.fromRaw,
        replyToRaw: msg.replyToRaw || null,
        authHeadersRaw: msg.authHeadersRaw || null,
        listUnsubscribeHeader: msg.listUnsubscribeHeader || null,
        inReplyTo: msg.inReplyTo || null,
        subject: msg.subject,
        rawBody: rawBodyOrSnippet,
        isHtmlOnly: msg.isHtmlOnly,
        attachmentFilenames,
        priorThreadCategories,
        isSuspiciousSender: authAssessment.isSuspicious,
        riskFlags: authAssessment.riskFlags,
      },
      settings.classifierThresholds
    );

    const isRetainedRecruitmentOrReview =
      mlPred.primaryCategory !== 'unrelated_email' && mlPred.primaryCategory !== 'job_alert_newsletter';

    // 4. Persist inside transaction (non-relevant / newsletter messages discard body_text & attachment blobs!)
    return this.db.withTransaction(async (tx) => {
      const sourceMessageId = randomId('msg');
      const retainBody =
        isRetainedRecruitmentOrReview &&
        (msg.sourceOrigin === 'synthetic_fixture' || this.config.gmailPolicyGateApproved);

      const plainBodyForStorage = mlPred.representation.combinedPlainText || inspectBody;

      await tx.query(
        `INSERT INTO source_messages (
          id, gmail_message_id, gmail_thread_id, rfc_message_id, in_reply_to, references_header,
          from_raw, from_email, from_domain, from_display_name, reply_to_email,
          subject, received_at, snippet, body_text, body_retained, auth_headers_raw,
          extracted_urls_json, message_sha256, version, source_origin
        ) VALUES (
          $1, $2, $3, $4, $5, $6,
          $7, $8, $9, $10, $11,
          $12, $13, $14, $15, $16, $17,
          $18::jsonb, $19, 1, $20
        )`,
        [
          sourceMessageId,
          msg.gmailMessageId,
          msg.gmailThreadId || null,
          msg.rfcMessageId || null,
          msg.inReplyTo || null,
          msg.referencesHeader || null,
          msg.fromRaw,
          authAssessment.fromEmail || 'unknown@unknown',
          authAssessment.fromDomain || 'unknown',
          authAssessment.fromDisplayName || null,
          authAssessment.replyToEmail,
          msg.subject,
          msg.receivedAt,
          isRetainedRecruitmentOrReview ? (msg.snippet || plainBodyForStorage.slice(0, 240)) : null,
          retainBody ? plainBodyForStorage : null,
          retainBody,
          isRetainedRecruitmentOrReview ? msg.authHeadersRaw || null : null,
          JSON.stringify(isRetainedRecruitmentOrReview ? extractedUrls : []),
          messageSha256,
          msg.sourceOrigin,
        ]
      );

      const storedAttachments: any[] = [];
      if (isRetainedRecruitmentOrReview) {
        for (const att of msg.attachments || []) {
          const attRecord = await this.attachmentStorage.ingestAndStoreAttachment(tx, {
            sourceMessageId,
            opportunityId: null,
            filename: att.filename,
            declaredMime: att.declaredMime,
            buffer: att.buffer,
            retainOriginalBlob: retainBody,
            simulateHangMs: att.simulateHangMs,
            timeoutOverrideMs: att.timeoutOverrideMs,
          });
          storedAttachments.push(attRecord);
        }
      }

      const combinedJdText = storedAttachments
        .map((a) => a.extracted_text || '')
        .filter(Boolean)
        .join('\n');

      // If an empty/minimal email (e.g. "PFA") was flagged `uncertain` and its attachment parsed cleanly,
      // re-evaluate classification incorporating the extracted attachment text (`Section 3`).
      if (mlPred.primaryCategory === 'uncertain' && combinedJdText.trim().length >= 40) {
        mlPred = await this.emailIntelligence.classifyEmail(
          {
            fromRaw: msg.fromRaw,
            replyToRaw: msg.replyToRaw || null,
            authHeadersRaw: msg.authHeadersRaw || null,
            listUnsubscribeHeader: msg.listUnsubscribeHeader || null,
            inReplyTo: msg.inReplyTo || null,
            subject: msg.subject,
            rawBody: `${rawBodyOrSnippet}\n\n${combinedJdText.slice(0, 3000)}`,
            isHtmlOnly: msg.isHtmlOnly,
            attachmentFilenames,
            priorThreadCategories,
            isSuspiciousSender: authAssessment.isSuspicious,
            riskFlags: authAssessment.riskFlags,
          },
          settings.classifierThresholds
        );
      }

      // Section 4: Validated Structured Extraction with Verbatim Supporting Evidence
      const structuredExtraction = extractValidatedStructuredEmailInfo({
        sourceMessageId,
        gmailMessageId: msg.gmailMessageId,
        gmailThreadId: msg.gmailThreadId || null,
        subject: msg.subject,
        bodyText: plainBodyForStorage,
        attachmentTexts: storedAttachments.map((a) => ({
          filename: a.filename,
          parseStatus: a.parse_status,
          extractedText: a.extracted_text || null,
        })),
        prediction: mlPred,
        authenticity: authAssessment,
      });

      const outcomeId = randomId('scr');
      await tx.query(
        `INSERT INTO screening_outcomes (
          id, source_message_id, classification, primary_category, multi_labels_json,
          uncertainty_outcome, uncertainty_reasons_json, classifier_kind, model_version,
          structured_extraction_json, confidence, margin,
          model_scores_json, rule_signals_json, authenticity_label, transport_auth_status,
          authenticity_signals_json, risk_flags_json, groq_calls_made, scan_trigger
        ) VALUES (
          $1, $2, $3, $4, $5::jsonb,
          $6, $7::jsonb, $8, $9,
          $10::jsonb, $11, $12,
          $13::jsonb, $14::jsonb, $15, $16,
          $17::jsonb, $18::jsonb, 0, $19
        )`,
        [
          outcomeId,
          sourceMessageId,
          mlPred.legacyScreeningClass,
          mlPred.primaryCategory,
          JSON.stringify(mlPred.multiLabels),
          mlPred.uncertaintyOutcome,
          JSON.stringify(mlPred.uncertaintyReasons),
          mlPred.classifierKind,
          mlPred.modelVersion,
          JSON.stringify(structuredExtraction),
          mlPred.topConfidence,
          mlPred.margin,
          JSON.stringify(mlPred.categoryScores),
          JSON.stringify({
            structuralSignals: mlPred.representation.structuralSignals,
            missingAndQualityIndicators: mlPred.representation.missingAndQualityIndicators,
            explanation: mlPred.explanation,
          }),
          authAssessment.label,
          authAssessment.transportAuthStatus,
          JSON.stringify(authAssessment.signals),
          JSON.stringify(authAssessment.riskFlags),
          trigger,
        ]
      );

      let opportunityId: string | null = null;
      let linkState: 'confirmed' | 'proposed' | null = null;
      const categoryMeta = CATEGORY_METADATA[mlPred.primaryCategory];
      const recruitmentStage = categoryMeta.recruitmentStage;

      if (isRetainedRecruitmentOrReview) {
        const inferred = inferCompanyAndRoleFromHeadersAndText({
          fromDisplayName: authAssessment.fromDisplayName,
          fromDomain: authAssessment.fromDomain,
          subject: msg.subject,
          text: `${plainBodyForStorage}\n${combinedJdText}`,
        });

        const matchOutcome = await this.findOrCreateOpportunityAndLink(tx, {
          sourceMessageId,
          gmailThreadId: msg.gmailThreadId || null,
          inReplyTo: msg.inReplyTo || null,
          referencesHeader: msg.referencesHeader || null,
          fromDomain: authAssessment.fromDomain,
          receivedAt: msg.receivedAt,
          subject: msg.subject,
          inferredCompany: inferred.companyName,
          inferredRole: inferred.roleTitle,
          classification: mlPred.legacyScreeningClass,
          primaryCategory: mlPred.primaryCategory,
          recruitmentStage,
          allowCreateNewOpportunity: categoryMeta.createsOrUpdatesOpportunity,
          confidenceTier: mlPred.confidenceTier,
          isSuspicious: authAssessment.isSuspicious,
          riskFlags: authAssessment.riskFlags,
          storedAttachments,
          actorEmail,
        });

        opportunityId = matchOutcome.opportunityId;
        linkState = matchOutcome.linkState;

        if (linkState === 'confirmed' && opportunityId) {
          for (const att of storedAttachments) {
            await tx.query('UPDATE attachments SET opportunity_id = $1 WHERE id = $2', [opportunityId, att.id]);
          }
          if (recruitmentStage) {
            await tx.query(
              `UPDATE opportunities
               SET recruitment_stage = $1, latest_stage_updated_at = NOW(), updated_at = NOW()
               WHERE id = $2`,
              [recruitmentStage, opportunityId]
            );
          }
          await this.recomputeOpportunityFactsAndVersion(
            tx,
            opportunityId,
            matchOutcome.isNewOpportunity
              ? 'Initial opportunity creation from screened message'
              : `Linked ${mlPred.primaryCategory} message "${msg.subject.slice(0, 80)}"`,
            !matchOutcome.isNewOpportunity,
            actorEmail
          );
        }
      }

      await recordAuditEvent(tx, {
        actorEmail,
        eventType: 'email_screened_zero_groq',
        entityType: 'source_message',
        entityId: sourceMessageId,
        metadata: {
          trigger,
          classification: mlPred.legacyScreeningClass,
          primaryCategory: mlPred.primaryCategory,
          multiLabels: mlPred.multiLabels,
          uncertaintyOutcome: mlPred.uncertaintyOutcome,
          modelVersion: mlPred.modelVersion,
          confidence: mlPred.topConfidence,
          authenticityLabel: authAssessment.label,
          groqCallsMade: 0,
          opportunityId,
          linkState,
        },
      });

      // Section 5: High relevance score alone NEVER authorizes external LLM transfer.
      // Requires OPTIONAL_GROQ mode + explicit officer settings + HIGH_CONFIDENCE + passed transport auth + zero risk flags!
      const eligibleForAutoGroqQueue = Boolean(
        this.config.optionalGroqMode === 'OPTIONAL_GROQ' &&
          settings.autoDraftHighConfidence &&
          settings.groqDisclosureAcceptedAt &&
          settings.budgetConfirmedAt &&
          settings.monthlyBudgetInr &&
          settings.monthlyBudgetInr > 0 &&
          (mlPred.primaryCategory === 'relevant_opportunity' || mlPred.primaryCategory === 'recruiter_outreach') &&
          mlPred.uncertaintyOutcome === 'HIGH_CONFIDENCE' &&
          authAssessment.transportAuthStatus === 'passed' &&
          !authAssessment.isSuspicious &&
          authAssessment.riskFlags.length === 0 &&
          opportunityId &&
          linkState === 'confirmed'
      );

      return {
        alreadyProcessed: false,
        sourceMessageId,
        gmailMessageId: msg.gmailMessageId,
        classification: mlPred.legacyScreeningClass,
        primaryCategory: mlPred.primaryCategory,
        multiLabels: mlPred.multiLabels,
        uncertaintyOutcome: mlPred.uncertaintyOutcome,
        uncertaintyReasons: mlPred.uncertaintyReasons,
        modelVersion: mlPred.modelVersion,
        recruitmentStage,
        structuredExtraction,
        confidence: mlPred.topConfidence,
        margin: mlPred.margin,
        authenticityLabel: authAssessment.label,
        transportAuthStatus: authAssessment.transportAuthStatus,
        riskFlags: authAssessment.riskFlags,
        groqCallsMade: 0,
        statusBanner: 'Scanned — no Groq request made',
        opportunityId,
        linkState,
        eligibleForAutoGroqQueue,
      };
    });
  }

  /**
   * Matches an incoming candidate/JD/stage-update message against existing opportunities.
   * RULES (Section 8 + Mandatory Addendum Section 3):
   * - Same company alone NEVER merges records!
   * - Two different jobs from one company stay separate!
   * - Stage updates (assessment, interview, follow-up, offer, rejection, acknowledgement) in an existing Gmail thread
   *   update the parent opportunity's stage rather than creating duplicate unrelated opportunities!
   */
  private async findOrCreateOpportunityAndLink(
    tx: QueryExecutor,
    params: {
      sourceMessageId: string;
      gmailThreadId: string | null;
      inReplyTo: string | null;
      referencesHeader: string | null;
      fromDomain: string;
      receivedAt: string;
      subject: string;
      inferredCompany: string;
      inferredRole: string;
      classification: ScreeningClass;
      primaryCategory: EmailIntelligenceCategory;
      recruitmentStage: string | null;
      allowCreateNewOpportunity: boolean;
      confidenceTier: 'high' | 'standard' | 'uncertain' | 'suspicious';
      isSuspicious: boolean;
      riskFlags: string[];
      storedAttachments: any[];
      actorEmail: string;
    }
  ): Promise<{ opportunityId: string | null; linkState: 'confirmed' | 'proposed' | null; isNewOpportunity: boolean }> {
    const candidatesRes = await tx.query<{
      id: string;
      company_name: string;
      role_title: string;
      created_at: string;
    }>(
      `SELECT id, company_name, role_title, created_at
       FROM opportunities
       WHERE status != 'archived'
       ORDER BY updated_at DESC
       LIMIT 50`
    );

    const isStageContinuationCategory =
      params.primaryCategory === 'jd_or_details_followup' ||
      params.primaryCategory === 'application_acknowledgement' ||
      params.primaryCategory === 'screening_or_eligibility' ||
      params.primaryCategory === 'online_assessment' ||
      params.primaryCategory === 'interview_invitation' ||
      params.primaryCategory === 'interview_followup' ||
      params.primaryCategory === 'offer' ||
      params.primaryCategory === 'rejection';

    let bestMatch: {
      oppId: string;
      score: number;
      evidence: string[];
      autoConfirm: boolean;
    } | null = null;

    for (const opp of candidatesRes.rows) {
      const linkedMsgsRes = await tx.query<{
        gmail_thread_id: string | null;
        rfc_message_id: string | null;
        from_domain: string;
        received_at: string;
      }>(
        `SELECT sm.gmail_thread_id, sm.rfc_message_id, sm.from_domain, sm.received_at
         FROM opportunity_message_links oml
         JOIN source_messages sm ON sm.id = oml.source_message_id
         WHERE oml.opportunity_id = $1 AND oml.link_state = 'confirmed'`,
        [opp.id]
      );

      const roleCheck = rolesConflictExplicitly(params.inferredRole, opp.role_title);
      // Hard rule: if two emails explicitly name DIFFERENT roles, NEVER merge them even if same company/sender!
      if (roleCheck.conflict) {
        continue;
      }

      let score = 0;
      const evidence: string[] = [];

      const sameThread =
        Boolean(params.gmailThreadId) &&
        linkedMsgsRes.rows.some((m) => m.gmail_thread_id && m.gmail_thread_id === params.gmailThreadId);
      if (sameThread) {
        score += 0.55;
        evidence.push(`Same Gmail thread (${params.gmailThreadId})`);
        if (isStageContinuationCategory) {
          score += 0.25;
          evidence.push(`Thread lifecycle stage continuation (${params.primaryCategory})`);
        }
      }

      const matchesReplyHeader = linkedMsgsRes.rows.some(
        (m) =>
          m.rfc_message_id &&
          ((params.inReplyTo && params.inReplyTo.includes(m.rfc_message_id)) ||
            (params.referencesHeader && params.referencesHeader.includes(m.rfc_message_id)))
      );
      if (matchesReplyHeader) {
        score += 0.45;
        evidence.push('In-Reply-To / References header matches existing opportunity email');
      }

      const sameDomain =
        params.fromDomain &&
        params.fromDomain !== 'unknown' &&
        linkedMsgsRes.rows.some((m) => m.from_domain.toLowerCase() === params.fromDomain.toLowerCase());
      if (sameDomain) {
        score += 0.2;
        evidence.push(`Matching sender domain (${params.fromDomain})`);
      }

      const sameCompany =
        params.inferredCompany !== 'Not specified' &&
        opp.company_name !== 'Not specified' &&
        params.inferredCompany.toLowerCase() === opp.company_name.toLowerCase();
      if (sameCompany) {
        score += 0.15;
        evidence.push(`Matching company name (${opp.company_name})`);
      }

      if (roleCheck.sameRole) {
        score += 0.45;
        evidence.push(`Matching role title ("${params.inferredRole}" ~ "${opp.role_title}")`);
      } else if (
        (params.classification === 'related_jd_followup' ||
          isStageContinuationCategory ||
          opp.role_title === 'Not specified' ||
          params.inferredRole === 'Not specified') &&
        (sameDomain || sameCompany)
      ) {
        // Details -> JD, JD -> Details, or stage update across two separate threads within 14 days!
        const withinWindow = linkedMsgsRes.rows.some(
          (m) => Math.abs(new Date(params.receivedAt).getTime() - new Date(m.received_at).getTime()) <= 14 * 86_400_000
        );
        if (withinWindow) {
          score += 0.42;
          evidence.push('Complementary details/JD/stage follow-up within 14-day window');
        }
      }

      // Guardrail: same company + same domain alone is max 0.35 -> below 0.55 threshold, so NEVER merges on company alone!
      const clampedScore = Math.min(1, Number(score.toFixed(4)));
      if (clampedScore >= 0.55 && (!bestMatch || clampedScore > bestMatch.score)) {
        const autoConfirm = clampedScore >= 0.72 && !params.isSuspicious;
        bestMatch = {
          oppId: opp.id,
          score: clampedScore,
          evidence,
          autoConfirm,
        };
      }
    }

    if (bestMatch) {
      const linkState: 'confirmed' | 'proposed' = bestMatch.autoConfirm ? 'confirmed' : 'proposed';
      await tx.query(
        `INSERT INTO opportunity_message_links (
          id, opportunity_id, source_message_id, link_state, match_score, evidence_json, confirmed_at
        ) VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7)`,
        [
          randomId('oml'),
          bestMatch.oppId,
          params.sourceMessageId,
          linkState,
          bestMatch.score,
          JSON.stringify(bestMatch.evidence),
          linkState === 'confirmed' ? new Date().toISOString() : null,
        ]
      );
      return {
        opportunityId: bestMatch.oppId,
        linkState,
        isNewOpportunity: false,
      };
    }

    if (!params.allowCreateNewOpportunity) {
      return {
        opportunityId: null,
        linkState: null,
        isNewOpportunity: false,
      };
    }

    // Create a brand new Opportunity record
    const newOppId = randomId('opp');
    const reviewFlags: string[] = [...params.riskFlags];
    const unparsedAtts = params.storedAttachments.filter((a) => a.parse_status !== 'parsed');
    for (const ua of unparsedAtts) {
      reviewFlags.push(`attachment_manual_review:${ua.filename}:${ua.parse_status}`);
    }

    const initialStatus =
      params.isSuspicious ||
      params.classification === 'suspicious_needs_review' ||
      params.classification === 'uncertain_needs_review' ||
      unparsedAtts.length > 0
        ? 'needs_review'
        : 'ready_for_draft';

    const initHash = sha256Hex(`${params.inferredCompany}|${params.inferredRole}|${params.sourceMessageId}`);

    await tx.query(
      `INSERT INTO opportunities (
        id, company_name, role_title, opportunity_type, status, screening_confidence_tier,
        current_version, material_hash, review_flags_json, recruitment_stage, latest_stage_updated_at
      ) VALUES ($1, $2, $3, 'Not specified', $4, $5, 1, $6, $7::jsonb, $8, NOW())`,
      [
        newOppId,
        params.inferredCompany,
        params.inferredRole,
        initialStatus,
        params.confidenceTier,
        initHash,
        JSON.stringify(reviewFlags),
        params.recruitmentStage || 'opportunity_identified',
      ]
    );

    await tx.query(
      `INSERT INTO opportunity_message_links (
        id, opportunity_id, source_message_id, link_state, match_score, evidence_json, confirmed_at
      ) VALUES ($1, $2, $3, 'confirmed', 1.0, $4::jsonb, NOW())`,
      [randomId('oml'), newOppId, params.sourceMessageId, JSON.stringify(['Primary source message creating opportunity'])]
    );

    return {
      opportunityId: newOppId,
      linkState: 'confirmed',
      isNewOpportunity: true,
    };
  }

  /**
   * Re-evaluates all confirmed source messages and parsed attachments for an opportunity,
   * updates provenanced facts + visible conflicts, suggests eligible sections (non-binding),
   * increments `current_version` if material facts/attachments changed, and invalidates stale approvals!
   */
  async recomputeOpportunityFactsAndVersion(
    tx: QueryExecutor,
    opportunityId: string,
    changeSummary: string,
    checkMaterialDrift: boolean,
    actorEmail = 'system'
  ): Promise<void> {
    const oppRes = await tx.query<any>('SELECT * FROM opportunities WHERE id = $1 FOR UPDATE', [opportunityId]);
    const opp = oppRes.rows[0];
    if (!opp) return;

    const msgsRes = await tx.query<{
      id: string;
      subject: string;
      body_text: string | null;
      snippet: string | null;
      from_display_name: string | null;
      from_domain: string;
      received_at: string;
    }>(
      `SELECT sm.id, sm.subject, sm.body_text, sm.snippet, sm.from_display_name, sm.from_domain, sm.received_at
       FROM opportunity_message_links oml
       JOIN source_messages sm ON sm.id = oml.source_message_id
       WHERE oml.opportunity_id = $1 AND oml.link_state = 'confirmed'
       ORDER BY sm.received_at ASC`,
      [opportunityId]
    );

    const attsRes = await tx.query<{
      id: string;
      filename: string;
      sha256_hash: string;
      parse_status: string;
      parse_reason: string;
      extracted_text: string | null;
      created_at: string;
    }>('SELECT id, filename, sha256_hash, parse_status, parse_reason, extracted_text, created_at FROM attachments WHERE opportunity_id = $1 ORDER BY created_at ASC', [
      opportunityId,
    ]);

    const candidates: ProvenancedFactCandidate[] = [];
    let resolvedCompany = opp.company_name as string;
    let resolvedRole = opp.role_title as string;

    for (const m of msgsRes.rows) {
      const text = m.body_text || m.snippet || '';
      const inferred = inferCompanyAndRoleFromHeadersAndText({
        fromDisplayName: m.from_display_name || '',
        fromDomain: m.from_domain,
        subject: m.subject,
        text,
      });
      if (resolvedCompany === 'Not specified' && inferred.companyName !== 'Not specified') {
        resolvedCompany = inferred.companyName;
      }
      if (resolvedRole === 'Not specified' && inferred.roleTitle !== 'Not specified') {
        resolvedRole = inferred.roleTitle;
      }
      candidates.push(
        ...extractFactsFromSingleSource({
          text,
          subject: m.subject,
          fromDisplayName: m.from_display_name || '',
          fromDomain: m.from_domain,
          sourceKind: 'email',
          sourceRefId: m.id,
          sourceLabel: `Email: ${m.subject.slice(0, 60)}`,
        })
      );
    }

    for (const a of attsRes.rows) {
      if (a.parse_status === 'parsed' && a.extracted_text) {
        const inferred = inferCompanyAndRoleFromHeadersAndText({
          fromDisplayName: '',
          fromDomain: '',
          subject: a.filename,
          text: a.extracted_text,
        });
        if (resolvedCompany === 'Not specified' && inferred.companyName !== 'Not specified') {
          resolvedCompany = inferred.companyName;
        }
        if (resolvedRole === 'Not specified' && inferred.roleTitle !== 'Not specified') {
          resolvedRole = inferred.roleTitle;
        }
        candidates.push(
          ...extractFactsFromSingleSource({
            text: a.extracted_text,
            sourceKind: 'attachment',
            sourceRefId: a.id,
            sourceLabel: `Attachment: ${a.filename}`,
          })
        );
      }
    }

    // Inject header-inferred company/role as fallback if explicit body label wasn't matched
    if (resolvedCompany !== 'Not specified' && !candidates.some((c) => c.field === 'employer')) {
      const firstMsg = msgsRes.rows[0];
      if (firstMsg) {
        candidates.unshift({
          field: 'employer',
          value: resolvedCompany,
          sourceKind: 'email',
          sourceRefId: firstMsg.id,
          sourceLabel: `Email Header/Subject: ${firstMsg.subject.slice(0, 50)}`,
          sourceExcerpt: firstMsg.subject,
        });
      }
    }
    if (resolvedRole !== 'Not specified' && !candidates.some((c) => c.field === 'role_title')) {
      const firstMsg = msgsRes.rows[0];
      if (firstMsg) {
        candidates.unshift({
          field: 'role_title',
          value: resolvedRole,
          sourceKind: 'email',
          sourceRefId: firstMsg.id,
          sourceLabel: `Email Subject: ${firstMsg.subject.slice(0, 50)}`,
          sourceExcerpt: firstMsg.subject,
        });
      }
    }

    const merged = mergeProvenancedFacts(candidates);
    const factsMap: Record<string, string> = {};
    for (const f of merged.facts) {
      factsMap[f.field] = f.value;
    }

    if (factsMap.employer && factsMap.employer !== 'Not specified') {
      resolvedCompany = factsMap.employer;
    }
    if (factsMap.role_title && factsMap.role_title !== 'Not specified') {
      resolvedRole = factsMap.role_title;
    }

    const materialSignature = JSON.stringify({
      company: resolvedCompany,
      role: resolvedRole,
      eligibility: factsMap.CGPA_or_percentage,
      degree: factsMap.degree_branch,
      batch: factsMap.batch,
      backlogs: factsMap.backlog_rules,
      deadline: factsMap.deadline,
      url: factsMap.application_url,
      msgIds: msgsRes.rows.map((m) => m.id),
      attHashes: attsRes.rows.map((a) => `${a.sha256_hash}:${a.parse_status}`),
    });
    const nextMaterialHash = sha256Hex(materialSignature);

    let nextVersion = opp.current_version as number;
    if (checkMaterialDrift && nextMaterialHash !== opp.material_hash) {
      nextVersion = nextVersion + 1;
      await this.routingService.invalidateApprovalsForOpportunity(
        tx,
        opportunityId,
        `Material source update (${changeSummary}) incremented opportunity to v${nextVersion}`,
        actorEmail
      );
    }

    // Non-binding section suggestions based on explicit eligibility tags
    const sectionsRes = await tx.query<{ id: string; name: string; eligibility_tags_json: string[] }>(
      'SELECT id, name, eligibility_tags_json FROM sections WHERE is_active = TRUE'
    );
    const eligHaystack = `${factsMap.degree_branch} ${factsMap.batch} ${factsMap.opportunity_type}`.toLowerCase();
    const suggestedSectionIds = sectionsRes.rows
      .filter((sec) => {
        const tags = Array.isArray(sec.eligibility_tags_json) ? sec.eligibility_tags_json : [];
        if (tags.length === 0) {
          const nameWords = sec.name.toLowerCase().split(/\W+/).filter((w) => w.length >= 2);
          return nameWords.length > 0 && nameWords.some((w) => eligHaystack.includes(w));
        }
        return tags.some((t) => eligHaystack.includes(t.toLowerCase()));
      })
      .map((s) => s.id);

    const reviewFlags = new Set<string>(Array.isArray(opp.review_flags_json) ? opp.review_flags_json : []);
    if (merged.hasConflicts) {
      reviewFlags.add('conflicting_facts_across_sources');
    }
    for (const a of attsRes.rows) {
      if (a.parse_status !== 'parsed') {
        reviewFlags.add(`attachment_manual_review:${a.filename}:${a.parse_status}`);
      }
    }

    await tx.query('DELETE FROM extracted_facts WHERE opportunity_id = $1 AND opportunity_version = $2', [
      opportunityId,
      nextVersion,
    ]);
    for (const f of merged.facts) {
      await tx.query(
        `INSERT INTO extracted_facts (
          id, opportunity_id, opportunity_version, field_name, field_value,
          source_kind, source_ref_id, source_label, source_excerpt, conflicts_json, extraction_method
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, 'deterministic_local')`,
        [
          randomId('fct'),
          opportunityId,
          nextVersion,
          f.field,
          f.value,
          f.sourceKind,
          f.sourceRefId,
          f.sourceLabel,
          f.sourceExcerpt,
          JSON.stringify(f.conflicts),
        ]
      );
    }

    await tx.query(
      `UPDATE opportunities
       SET company_name = $1,
           role_title = $2,
           opportunity_type = $3,
           current_version = $4,
           material_hash = $5,
           eligibility_summary_json = $6::jsonb,
           suggested_section_ids_json = $7::jsonb,
           review_flags_json = $8::jsonb,
           updated_at = NOW()
       WHERE id = $9`,
      [
        resolvedCompany,
        resolvedRole,
        factsMap.opportunity_type || 'Not specified',
        nextVersion,
        nextMaterialHash,
        JSON.stringify({
          degreeBranch: factsMap.degree_branch,
          batch: factsMap.batch,
          cgpa: factsMap.CGPA_or_percentage,
          backlogs: factsMap.backlog_rules,
          deadline: factsMap.deadline,
          salaryOrStipend: factsMap.salary_or_stipend,
        }),
        JSON.stringify(suggestedSectionIds),
        JSON.stringify(Array.from(reviewFlags)),
        opportunityId,
      ]
    );

    await tx.query(
      `INSERT INTO opportunity_versions (id, opportunity_id, version, material_hash, change_summary, snapshot_json)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb)
       ON CONFLICT (opportunity_id, version) DO UPDATE
       SET material_hash = EXCLUDED.material_hash,
           change_summary = EXCLUDED.change_summary,
           snapshot_json = EXCLUDED.snapshot_json`,
      [
        randomId('opv'),
        opportunityId,
        nextVersion,
        nextMaterialHash,
        changeSummary,
        JSON.stringify({
          companyName: resolvedCompany,
          roleTitle: resolvedRole,
          factsMap,
          hasConflicts: merged.hasConflicts,
          missingFields: merged.missingFields,
        }),
      ]
    );

    // Ensure a baseline deterministic plain-text draft exists for manual editing even when Groq is completely disabled!
    const existingDraftRes = await tx.query<{ cnt: string }>(
      'SELECT COUNT(*)::text AS cnt FROM draft_versions WHERE opportunity_id = $1 AND opportunity_version = $2',
      [opportunityId, nextVersion]
    );
    if (Number.parseInt(existingDraftRes.rows[0]?.cnt || '0', 10) === 0) {
      const settings = await getSettings(tx, this.config);
      const parsedAttNames = attsRes.rows.filter((a) => a.parse_status === 'parsed').map((a) => a.filename);
      const unparsedAttNames = attsRes.rows.filter((a) => a.parse_status !== 'parsed').map((a) => `${a.filename} (${a.parse_status})`);
      const jdStatusText =
        parsedAttNames.length > 0
          ? `Attached (${parsedAttNames.join(', ')})`
          : unparsedAttNames.length > 0
            ? `Manual review needed (${unparsedAttNames.join(', ')})`
            : 'Not specified';

      const draftText = renderPlainTextAnnouncementFromFacts({
        template: settings.announcementTemplate,
        factsMap,
        jdStatusText,
        collegeSignature: settings.collegeSignature,
        omitMissingFields: settings.omitMissingFields,
      });

      const conflictSummary = merged.facts
        .filter((f) => f.conflicts.length > 0)
        .map((f) => ({ field: f.field, current: f.value, conflicts: f.conflicts }));

      const maxDraftRes = await tx.query<{ next_num: number }>(
        'SELECT (COALESCE(MAX(draft_number), 0) + 1)::int AS next_num FROM draft_versions WHERE opportunity_id = $1',
        [opportunityId]
      );
      const nextDraftNum = maxDraftRes.rows[0]?.next_num || 1;

      await tx.query(
        `INSERT INTO draft_versions (
          id, opportunity_id, opportunity_version, draft_number, draft_text, draft_sha256,
          generated_by, authorization_source, model_id, missing_fields_json, conflicts_json, review_flags_json
        ) VALUES ($1, $2, $3, $4, $5, $6, 'deterministic_template', 'local_zero_groq_baseline', NULL, $7::jsonb, $8::jsonb, $9::jsonb)`,
        [
          randomId('drf'),
          opportunityId,
          nextVersion,
          nextDraftNum,
          draftText,
          sha256Hex(draftText),
          JSON.stringify(merged.missingFields),
          JSON.stringify(conflictSummary),
          JSON.stringify(Array.from(reviewFlags)),
        ]
      );
    }
  }

  async resolveProposedLink(
    actorEmail: string,
    params: { linkId: string; decision: 'confirm' | 'keep_separate' }
  ) {
    return this.db.withTransaction(async (tx) => {
      const linkRes = await tx.query<{
        id: string;
        opportunity_id: string;
        source_message_id: string;
        link_state: string;
      }>('SELECT id, opportunity_id, source_message_id, link_state FROM opportunity_message_links WHERE id = $1 FOR UPDATE', [
        params.linkId,
      ]);
      const link = linkRes.rows[0];
      if (!link) throw new Error('Proposed message link not found.');

      if (params.decision === 'confirm') {
        await tx.query(
          `UPDATE opportunity_message_links SET link_state = 'confirmed', confirmed_at = NOW() WHERE id = $1`,
          [link.id]
        );
        await tx.query('UPDATE attachments SET opportunity_id = $1 WHERE source_message_id = $2', [
          link.opportunity_id,
          link.source_message_id,
        ]);
        await this.recomputeOpportunityFactsAndVersion(
          tx,
          link.opportunity_id,
          'Officer confirmed proposed email/JD link',
          true,
          actorEmail
        );
        await recordAuditEvent(tx, {
          actorEmail,
          eventType: 'proposed_link_confirmed',
          entityType: 'opportunity',
          entityId: link.opportunity_id,
          metadata: { linkId: link.id, sourceMessageId: link.source_message_id },
        });
        return { opportunityId: link.opportunity_id, status: 'confirmed' };
      } else {
        await tx.query(`UPDATE opportunity_message_links SET link_state = 'rejected' WHERE id = $1`, [link.id]);
        const msgRes = await tx.query<any>('SELECT * FROM source_messages WHERE id = $1', [link.source_message_id]);
        const msg = msgRes.rows[0];
        const newOppId = randomId('opp');
        const inferred = inferCompanyAndRoleFromHeadersAndText({
          fromDisplayName: msg?.from_display_name || '',
          fromDomain: msg?.from_domain || '',
          subject: msg?.subject || '',
          text: msg?.body_text || msg?.snippet || '',
        });
        await tx.query(
          `INSERT INTO opportunities (id, company_name, role_title, opportunity_type, status, current_version, material_hash)
           VALUES ($1, $2, $3, 'Not specified', 'needs_review', 1, $4)`,
          [newOppId, inferred.companyName, inferred.roleTitle, sha256Hex(`${newOppId}:${link.source_message_id}`)]
        );
        await tx.query(
          `INSERT INTO opportunity_message_links (id, opportunity_id, source_message_id, link_state, match_score, evidence_json, confirmed_at)
           VALUES ($1, $2, $3, 'confirmed', 1.0, $4::jsonb, NOW())`,
          [randomId('oml'), newOppId, link.source_message_id, JSON.stringify(['Separated into standalone opportunity by officer'])]
        );
        await tx.query('UPDATE attachments SET opportunity_id = $1 WHERE source_message_id = $2', [
          newOppId,
          link.source_message_id,
        ]);
        await this.recomputeOpportunityFactsAndVersion(
          tx,
          newOppId,
          'Separated into standalone opportunity by officer',
          false,
          actorEmail
        );
        await recordAuditEvent(tx, {
          actorEmail,
          eventType: 'proposed_link_separated',
          entityType: 'opportunity',
          entityId: newOppId,
          metadata: { originalLinkId: link.id },
        });
        return { opportunityId: newOppId, status: 'separated' };
      }
    });
  }

  async saveOfficerManualDraftEdit(
    actorEmail: string,
    params: { opportunityId: string; draftText: string }
  ) {
    const cleaned = params.draftText.trim();
    if (!cleaned) throw new Error('Draft text cannot be empty.');

    return this.db.withTransaction(async (tx) => {
      const oppRes = await tx.query<{ id: string; current_version: number }>(
        'SELECT id, current_version FROM opportunities WHERE id = $1 FOR UPDATE',
        [params.opportunityId]
      );
      const opp = oppRes.rows[0];
      if (!opp) throw new Error('Opportunity not found.');

      // Editing draft text invalidates any active approval!
      await this.routingService.invalidateApprovalsForOpportunity(
        tx,
        opp.id,
        'Officer edited announcement draft text',
        actorEmail
      );

      const numRes = await tx.query<{ max_num: number | null }>(
        'SELECT MAX(draft_number) AS max_num FROM draft_versions WHERE opportunity_id = $1',
        [opp.id]
      );
      const nextDraftNumber = (numRes.rows[0]?.max_num || 0) + 1;
      const draftId = randomId('drf');
      const draftHash = sha256Hex(cleaned);

      await tx.query(
        `INSERT INTO draft_versions (
          id, opportunity_id, opportunity_version, draft_number, draft_text, draft_sha256,
          generated_by, authorization_source
        ) VALUES ($1, $2, $3, $4, $5, $6, 'officer_manual_edit', 'officer_manual_editor')`,
        [draftId, opp.id, opp.current_version, nextDraftNumber, cleaned, draftHash]
      );

      await tx.query(
        `UPDATE opportunities SET status = 'draft_in_review', updated_at = NOW() WHERE id = $1`,
        [opp.id]
      );

      await recordAuditEvent(tx, {
        actorEmail,
        eventType: 'draft_manually_edited',
        entityType: 'draft_version',
        entityId: draftId,
        metadata: { opportunityId: opp.id, draftNumber: nextDraftNumber, draftSha256: draftHash },
      });

      const created = await tx.query<any>('SELECT * FROM draft_versions WHERE id = $1', [draftId]);
      return created.rows[0];
    });
  }

  async recordScreeningFeedback(
    actorEmail: string,
    params: {
      sourceMessageId: string;
      feedback: 'relevant_placement' | 'related_jd' | 'not_relevant' | 'suspicious';
    }
  ) {
    // Feedback is recorded strictly for future offline evaluation; private mailbox text is NEVER used for auto-training!
    await this.db.query(
      `UPDATE screening_outcomes
       SET officer_feedback = $1, feedback_recorded_at = NOW()
       WHERE source_message_id = $2`,
      [params.feedback, params.sourceMessageId]
    );
    await recordAuditEvent(this.db, {
      actorEmail,
      eventType: 'screening_feedback_recorded',
      entityType: 'source_message',
      entityId: params.sourceMessageId,
      metadata: { feedback: params.feedback, autoTrainingUsed: false },
    });
  }
}
