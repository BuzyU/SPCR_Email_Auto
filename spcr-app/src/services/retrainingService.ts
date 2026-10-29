import fs from 'node:fs';
import path from 'node:path';
import { Database } from '../db/database.js';
import { randomId } from '../utils/crypto.js';
import { parseEmailHeaderAddress, assessSenderAuthenticity } from './authenticityService.js';
import { recordAuditEvent } from './auditService.js';
import { EmailIntelligenceService } from './emailIntelligenceService.js';
import { redactPersonalInfoForFeedback } from '../ml/preprocessing.js';
import {
  EMAIL_INTELLIGENCE_CATEGORIES,
  EmailIntelligenceCategory,
  EmailIntelligenceCategoryZod,
  LabeledEmailExample,
  PreDeclaredAcceptanceThresholdsSchema,
} from '../ml/schema.js';
import { loadAndVerifyTrainedArtifact } from '../ml/tfidfAndLinearModel.js';
import { evaluatePredictionsComprehensively, PredictionRecordForEval } from '../ml/evaluationMetrics.js';
import { loadOrInitializeSplitCorpus, trainAndCompareEmailIntelligenceModels } from '../ml/trainerPipeline.js';

export interface FeedbackExampleRow {
  id: string;
  source_message_id: string | null;
  gmail_thread_id: string | null;
  sender_org_group: string;
  verdict: 'correct' | 'incorrect' | 'uncertain';
  predicted_primary_category: string;
  corrected_primary_category: EmailIntelligenceCategory;
  corrected_multi_labels_json: EmailIntelligenceCategory[];
  redacted_subject: string;
  redacted_body: string;
  sender_domain: string;
  attachment_filenames_json: string[];
  prior_thread_categories_json: EmailIntelligenceCategory[];
  privacy_redacted: boolean;
  officer_note: string | null;
  review_status: 'staged_unverified' | 'approved_for_training' | 'rejected';
  created_by_email: string;
  reviewed_by_email: string | null;
  created_at: string;
  reviewed_at: string | null;
}

export interface ModelRegistryEntry {
  model_version: string;
  classifier_kind: string;
  architecture_summary: string;
  artifact_path: string;
  artifact_sha256: string;
  dataset_version: string;
  held_out_macro_f1: number;
  metrics_summary_json: Record<string, unknown>;
  is_active: boolean;
  previous_version: string | null;
  created_by_email: string;
  created_at: string;
  activated_at: string | null;
}

export class RetrainingService {
  constructor(
    private readonly db: Database,
    private readonly emailIntelligence: EmailIntelligenceService,
    private readonly options: {
      rootDir?: string;
      cacheDir: string;
      defaultArtifactPath: string;
    }
  ) {}

  private get rootDir(): string {
    return this.options.rootDir || process.cwd();
  }

  async ensureInitializedRegistry(): Promise<void> {
    const activeRes = await this.db.query<ModelRegistryEntry>(
      `SELECT * FROM ml_model_registry WHERE is_active = TRUE ORDER BY activated_at DESC NULLS LAST LIMIT 1`
    );
    if (activeRes.rows[0]) {
      const activeRow = activeRes.rows[0];
      if (fs.existsSync(activeRow.artifact_path)) {
        this.emailIntelligence.reloadFromArtifactPath(activeRow.artifact_path);
        return;
      }
    }

    const resolvedDefault = path.resolve(this.options.defaultArtifactPath);
    if (fs.existsSync(resolvedDefault)) {
      const { artifact, fileSha256 } = loadAndVerifyTrainedArtifact(resolvedDefault);
      let heldOutMacroF1 = 0;
      let metricsSummary: Record<string, unknown> = {};
      const evalReportPath = path.join(this.rootDir, 'ml', 'artifacts', 'evaluation_report_v1.json');
      if (fs.existsSync(evalReportPath)) {
        try {
          const parsedEval = JSON.parse(fs.readFileSync(evalReportPath, 'utf8'));
          heldOutMacroF1 = Number(parsedEval?.heldOutTestEvaluation?.macroF1 || 0);
          metricsSummary = {
            accuracy: parsedEval?.heldOutTestEvaluation?.accuracy,
            macroF1: heldOutMacroF1,
            relevantOpportunityRecall: parsedEval?.heldOutTestEvaluation?.relevantOpportunityRecall,
            silentOpportunityDiscardRate: parsedEval?.heldOutTestEvaluation?.silentOpportunityDiscardRate,
          };
        } catch {
          // ignore optional report read failure
        }
      }

      await this.db.query(
        `INSERT INTO ml_model_registry (
          model_version, classifier_kind, architecture_summary, artifact_path, artifact_sha256,
          dataset_version, held_out_macro_f1, metrics_summary_json, is_active, previous_version,
          created_by_email, activated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, TRUE, NULL, 'system', NOW())
        ON CONFLICT (model_version) DO UPDATE SET
          is_active = TRUE,
          activated_at = NOW()`,
        [
          artifact.modelVersion,
          artifact.classifierKind,
          artifact.architectureType,
          resolvedDefault,
          fileSha256,
          artifact.datasetVersion,
          heldOutMacroF1,
          JSON.stringify(metricsSummary),
        ]
      );
      this.emailIntelligence.reloadFromArtifactPath(resolvedDefault);
    }
  }

  async submitUserCorrection(params: {
    sourceMessageId: string;
    verdict: 'correct' | 'incorrect' | 'uncertain';
    correctedPrimaryCategory?: EmailIntelligenceCategory;
    correctedMultiLabels?: EmailIntelligenceCategory[];
    officerNote?: string;
    actorEmail: string;
  }): Promise<FeedbackExampleRow> {
    const msgRes = await this.db.query<{
      id: string;
      gmail_thread_id: string | null;
      from_raw: string;
      subject: string;
      snippet: string | null;
      body_text: string | null;
      primary_category: string | null;
      classification: string | null;
    }>(
      `SELECT sm.id, sm.gmail_thread_id, sm.from_raw, sm.subject, sm.snippet, sm.body_text,
              so.primary_category, so.classification
       FROM source_messages sm
       LEFT JOIN screening_outcomes so ON so.source_message_id = sm.id
       WHERE sm.id = $1`,
      [params.sourceMessageId]
    );

    const msg = msgRes.rows[0];
    if (!msg) {
      throw new Error(`Source message not found: ${params.sourceMessageId}`);
    }

    const predictedCat: EmailIntelligenceCategory =
      msg.primary_category && (EMAIL_INTELLIGENCE_CATEGORIES as readonly string[]).includes(msg.primary_category)
        ? (msg.primary_category as EmailIntelligenceCategory)
        : 'uncertain';

    let targetPrimary: EmailIntelligenceCategory;
    if (params.verdict === 'correct') {
      targetPrimary = params.correctedPrimaryCategory
        ? EmailIntelligenceCategoryZod.parse(params.correctedPrimaryCategory)
        : predictedCat;
    } else if (params.verdict === 'uncertain') {
      targetPrimary = 'uncertain';
    } else {
      if (!params.correctedPrimaryCategory) {
        throw new Error('correctedPrimaryCategory is required when marking a classification as incorrect.');
      }
      targetPrimary = EmailIntelligenceCategoryZod.parse(params.correctedPrimaryCategory);
    }

    const multiSet = new Set<EmailIntelligenceCategory>([targetPrimary]);
    for (const ml of params.correctedMultiLabels || []) {
      multiSet.add(EmailIntelligenceCategoryZod.parse(ml));
    }

    const attRes = await this.db.query<{ filename: string }>(
      `SELECT filename FROM attachments WHERE source_message_id = $1 ORDER BY created_at ASC`,
      [msg.id]
    );
    const attachmentFilenames = attRes.rows.map((r) => r.filename);

    let priorThreadCategories: EmailIntelligenceCategory[] = [];
    if (msg.gmail_thread_id) {
      const thRes = await this.db.query<{ primary_category: string | null }>(
        `SELECT so.primary_category
         FROM source_messages sm
         JOIN screening_outcomes so ON so.source_message_id = sm.id
         WHERE sm.gmail_thread_id = $1 AND sm.id <> $2
         ORDER BY sm.received_at ASC`,
        [msg.gmail_thread_id, msg.id]
      );
      priorThreadCategories = thRes.rows
        .map((r) => r.primary_category)
        .filter((c): c is EmailIntelligenceCategory =>
          Boolean(c && (EMAIL_INTELLIGENCE_CATEGORIES as readonly string[]).includes(c))
        );
    }

    const parsedSender = parseEmailHeaderAddress(msg.from_raw);
    const senderDomain = parsedSender.domain || 'unknown';
    const senderOrgGroup = `feedback_org_${senderDomain.replace(/[^a-z0-9]/gi, '_')}`;

    // Minimize retained PII before saving feedback example (`Section 7`)
    const redactedSubject = redactPersonalInfoForFeedback(msg.subject || '');
    const redactedBody = redactPersonalInfoForFeedback(msg.body_text || msg.snippet || '');

    const feedbackId = randomId('fbk');
    await this.db.query(
      `INSERT INTO training_feedback_examples (
        id, source_message_id, gmail_thread_id, sender_org_group, verdict,
        predicted_primary_category, corrected_primary_category, corrected_multi_labels_json,
        redacted_subject, redacted_body, sender_domain, attachment_filenames_json,
        prior_thread_categories_json, privacy_redacted, officer_note, review_status, created_by_email
      ) VALUES (
        $1, $2, $3, $4, $5,
        $6, $7, $8::jsonb,
        $9, $10, $11, $12::jsonb,
        $13::jsonb, TRUE, $14, 'staged_unverified', $15
      )`,
      [
        feedbackId,
        msg.id,
        msg.gmail_thread_id,
        senderOrgGroup,
        params.verdict,
        predictedCat,
        targetPrimary,
        JSON.stringify(Array.from(multiSet)),
        redactedSubject,
        redactedBody,
        senderDomain,
        JSON.stringify(attachmentFilenames),
        JSON.stringify(priorThreadCategories),
        params.officerNote?.trim() || null,
        params.actorEmail,
      ]
    );

    await recordAuditEvent(this.db, {
      actorEmail: params.actorEmail,
      eventType: 'ml_correction_submitted',
      entityType: 'source_message',
      entityId: msg.id,
      metadata: {
        feedbackId,
        verdict: params.verdict,
        predictedCat,
        targetPrimary,
        reviewStatus: 'staged_unverified',
      },
    });

    const inserted = await this.db.query<FeedbackExampleRow>(
      `SELECT * FROM training_feedback_examples WHERE id = $1`,
      [feedbackId]
    );
    return inserted.rows[0]!;
  }

  async reviewFeedbackExample(params: {
    feedbackId: string;
    decision: 'approved_for_training' | 'rejected';
    reviewerEmail: string;
  }): Promise<FeedbackExampleRow> {
    const res = await this.db.query<FeedbackExampleRow>(
      `UPDATE training_feedback_examples
       SET review_status = $1, reviewed_by_email = $2, reviewed_at = NOW()
       WHERE id = $3
       RETURNING *`,
      [params.decision, params.reviewerEmail, params.feedbackId]
    );
    if (!res.rows[0]) {
      throw new Error(`Feedback example not found: ${params.feedbackId}`);
    }

    await recordAuditEvent(this.db, {
      actorEmail: params.reviewerEmail,
      eventType: 'ml_feedback_reviewed',
      entityType: 'training_feedback',
      entityId: params.feedbackId,
      metadata: { decision: params.decision },
    });

    return res.rows[0];
  }

  async listFeedbackAndRegistryStatus() {
    const countsRes = await this.db.query<{ review_status: string; cnt: string }>(
      `SELECT review_status, COUNT(*)::text AS cnt FROM training_feedback_examples GROUP BY review_status`
    );
    const feedbackCounts = {
      staged_unverified: 0,
      approved_for_training: 0,
      rejected: 0,
    };
    for (const r of countsRes.rows) {
      if (r.review_status in feedbackCounts) {
        feedbackCounts[r.review_status as keyof typeof feedbackCounts] = Number(r.cnt);
      }
    }

    const recentFeedback = await this.db.query<FeedbackExampleRow>(
      `SELECT * FROM training_feedback_examples ORDER BY created_at DESC LIMIT 50`
    );
    const modelVersions = await this.db.query<ModelRegistryEntry>(
      `SELECT * FROM ml_model_registry ORDER BY created_at DESC LIMIT 20`
    );

    return {
      feedbackCounts,
      recentFeedback: recentFeedback.rows,
      modelVersions: modelVersions.rows.map((m) => ({
        ...m,
        held_out_macro_f1: Number(m.held_out_macro_f1),
      })),
    };
  }

  async retrainFromApprovedFeedback(params: {
    actorEmail: string;
    compareHybridMiniLm?: boolean;
    autoActivate?: boolean;
  }): Promise<{
    newModelVersion: string;
    artifactPath: string;
    approvedFeedbackIncluded: number;
    heldOutMacroF1: number;
    relevantOpportunityRecall: number;
    silentOpportunityDiscardRate: number;
    passedRegressionGate: boolean;
    activated: boolean;
    previousVersion: string | null;
  }> {
    await this.ensureInitializedRegistry();

    const approvedRes = await this.db.query<FeedbackExampleRow>(
      `SELECT * FROM training_feedback_examples
       WHERE review_status = 'approved_for_training'
       ORDER BY created_at ASC`
    );

    const extraExamples: LabeledEmailExample[] = approvedRes.rows.map((row) => ({
      id: `usr-${row.id}`,
      threadId: row.gmail_thread_id || `th-fbk-${row.id}`,
      senderOrgGroup: row.sender_org_group,
      datasetSource: 'consented_real_inbox_feedback',
      split: 'train',
      fromRaw: `sender@${row.sender_domain || 'example.org'}`,
      subject: row.redacted_subject,
      rawBody: row.redacted_body,
      isHtmlOnly: false,
      attachmentFilenames: Array.isArray(row.attachment_filenames_json) ? row.attachment_filenames_json : [],
      priorThreadCategories: Array.isArray(row.prior_thread_categories_json)
        ? row.prior_thread_categories_json
        : [],
      primaryCategory: row.corrected_primary_category,
      multiLabels:
        Array.isArray(row.corrected_multi_labels_json) && row.corrected_multi_labels_json.length > 0
          ? row.corrected_multi_labels_json
          : [row.corrected_primary_category],
      hardCaseTags: [],
    }));

    const currentActiveRes = await this.db.query<ModelRegistryEntry>(
      `SELECT * FROM ml_model_registry WHERE is_active = TRUE ORDER BY activated_at DESC NULLS LAST LIMIT 1`
    );
    const previousVersion = currentActiveRes.rows[0]?.model_version || null;

    const seqRes = await this.db.query<{ cnt: string }>(`SELECT COUNT(*)::text AS cnt FROM ml_model_registry`);
    const nextPatch = Number(seqRes.rows[0]?.cnt || '1');
    const newModelVersion = `spcr-email-intel-v1.1.${nextPatch}`;
    const versionedArtifactPath = path.join(
      this.rootDir,
      'ml',
      'artifacts',
      'versions',
      `${newModelVersion}.json`
    );

    const trainOut = await trainAndCompareEmailIntelligenceModels({
      rootDir: this.rootDir,
      cacheDir: this.options.cacheDir,
      modelVersion: newModelVersion,
      outputArtifactPath: versionedArtifactPath,
      extraApprovedTrainExamples: extraExamples,
      compareHybridMiniLm: params.compareHybridMiniLm ?? true,
    });

    // Regression Gate on Held-Out `test` split against pre-declared acceptance thresholds (`Section 6 & 7`)
    const thresholdsPath = path.join(this.rootDir, 'ml', 'config', 'acceptance_thresholds.json');
    const thresholds = PreDeclaredAcceptanceThresholdsSchema.parse(
      JSON.parse(fs.readFileSync(thresholdsPath, 'utf8'))
    );
    const corpus = loadOrInitializeSplitCorpus(this.rootDir);

    const candidateService = new EmailIntelligenceService({
      artifactPath: versionedArtifactPath,
      cacheDir: this.options.cacheDir,
    });
    await candidateService.ensureLoaded();

    const testRecords: PredictionRecordForEval[] = [];
    for (const ex of corpus.test) {
      const auth = await assessSenderAuthenticity(null, {
        fromRaw: ex.fromRaw,
        replyToRaw: ex.replyToRaw || null,
        authHeadersRaw: ex.authHeadersRaw || null,
        subject: ex.subject,
        bodyOrSnippet: ex.rawBody,
      });
      const pred = await candidateService.classifyEmail({
        fromRaw: ex.fromRaw,
        replyToRaw: ex.replyToRaw || null,
        authHeadersRaw: ex.authHeadersRaw || null,
        listUnsubscribeHeader: ex.listUnsubscribeHeader || null,
        inReplyTo: ex.inReplyTo || null,
        subject: ex.subject,
        rawBody: ex.rawBody,
        isHtmlOnly: ex.isHtmlOnly,
        attachmentFilenames: ex.attachmentFilenames,
        priorThreadCategories: ex.priorThreadCategories,
        isSuspiciousSender: auth.isSuspicious,
        riskFlags: auth.riskFlags,
      });
      testRecords.push({
        example: ex,
        predictedPrimary: pred.primaryCategory,
        predictedMultiLabels: pred.multiLabels,
        topConfidence: pred.topConfidence,
        margin: pred.margin,
        uncertaintyOutcome: pred.uncertaintyOutcome,
      });
    }
    const testEval = evaluatePredictionsComprehensively(testRecords, 100);

    const passedRegressionGate =
      testEval.macroF1 >= thresholds.minimumHeldOutMacroF1 &&
      testEval.relevantOpportunityRecall >= thresholds.minimumRelevantOpportunityRecall &&
      testEval.silentOpportunityDiscardRate <= thresholds.maximumSilentOpportunityDiscardRate;

    const shouldActivate = passedRegressionGate && params.autoActivate !== false;

    if (shouldActivate) {
      await this.db.query(`UPDATE ml_model_registry SET is_active = FALSE WHERE is_active = TRUE`);
    }

    await this.db.query(
      `INSERT INTO ml_model_registry (
        model_version, classifier_kind, architecture_summary, artifact_path, artifact_sha256,
        dataset_version, held_out_macro_f1, metrics_summary_json, is_active, previous_version,
        created_by_email, activated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10, $11, $12)`,
      [
        newModelVersion,
        trainOut.artifact.classifierKind,
        trainOut.artifact.architectureType,
        versionedArtifactPath,
        trainOut.artifactFileSha256,
        trainOut.datasetVersion,
        testEval.macroF1,
        JSON.stringify({
          accuracy: testEval.accuracy,
          macroF1: testEval.macroF1,
          relevantOpportunityRecall: testEval.relevantOpportunityRecall,
          silentOpportunityDiscardRate: testEval.silentOpportunityDiscardRate,
          approvedFeedbackIncluded: trainOut.splitCounts.extraApprovedFeedbackUsed,
          passedRegressionGate,
        }),
        shouldActivate,
        previousVersion,
        params.actorEmail,
        shouldActivate ? new Date().toISOString() : null,
      ]
    );

    if (shouldActivate) {
      this.emailIntelligence.reloadFromArtifactPath(versionedArtifactPath);
    }

    await recordAuditEvent(this.db, {
      actorEmail: params.actorEmail,
      eventType: 'ml_model_retrained',
      entityType: 'ml_model',
      entityId: newModelVersion,
      metadata: {
        previousVersion,
        approvedFeedbackIncluded: trainOut.splitCounts.extraApprovedFeedbackUsed,
        heldOutMacroF1: testEval.macroF1,
        passedRegressionGate,
        activated: shouldActivate,
      },
    });

    return {
      newModelVersion,
      artifactPath: versionedArtifactPath,
      approvedFeedbackIncluded: trainOut.splitCounts.extraApprovedFeedbackUsed,
      heldOutMacroF1: testEval.macroF1,
      relevantOpportunityRecall: testEval.relevantOpportunityRecall,
      silentOpportunityDiscardRate: testEval.silentOpportunityDiscardRate,
      passedRegressionGate,
      activated: shouldActivate,
      previousVersion,
    };
  }

  async rollbackModelVersion(params: {
    targetVersion?: string;
    actorEmail: string;
  }): Promise<{ rolledBackToVersion: string; artifactPath: string; previousActiveVersion: string | null }> {
    await this.ensureInitializedRegistry();

    const currentRes = await this.db.query<ModelRegistryEntry>(
      `SELECT * FROM ml_model_registry WHERE is_active = TRUE ORDER BY activated_at DESC NULLS LAST LIMIT 1`
    );
    const currentActive = currentRes.rows[0] || null;
    const desiredVersion = params.targetVersion || currentActive?.previous_version;

    if (!desiredVersion) {
      throw new Error('No previous model version available to roll back to.');
    }

    const targetRes = await this.db.query<ModelRegistryEntry>(
      `SELECT * FROM ml_model_registry WHERE model_version = $1`,
      [desiredVersion]
    );
    const targetEntry = targetRes.rows[0];
    if (!targetEntry) {
      throw new Error(`Target model version "${desiredVersion}" not found in ml_model_registry.`);
    }

    loadAndVerifyTrainedArtifact(targetEntry.artifact_path);

    await this.db.query(`UPDATE ml_model_registry SET is_active = FALSE WHERE is_active = TRUE`);
    await this.db.query(
      `UPDATE ml_model_registry SET is_active = TRUE, activated_at = NOW() WHERE model_version = $1`,
      [desiredVersion]
    );

    this.emailIntelligence.reloadFromArtifactPath(targetEntry.artifact_path);

    await recordAuditEvent(this.db, {
      actorEmail: params.actorEmail,
      eventType: 'ml_model_rolled_back',
      entityType: 'ml_model',
      entityId: desiredVersion,
      metadata: {
        rolledBackFrom: currentActive?.model_version || null,
        rolledBackTo: desiredVersion,
      },
    });

    return {
      rolledBackToVersion: desiredVersion,
      artifactPath: targetEntry.artifact_path,
      previousActiveVersion: currentActive?.model_version || null,
    };
  }
}
