import { Database, QueryExecutor } from '../db/database.js';
import { AppConfig } from '../config/env.js';
import { recordAuditEvent } from './auditService.js';

export interface ClassifierThresholds {
  candidateMinConfidence: number;
  reviewMinMargin: number;
}

export interface SpcrSettings {
  firstRunCompleted: boolean;
  privacyDisclosureAcceptedAt: string | null;
  groqDisclosureAcceptedAt: string | null;
  autoDraftHighConfidence: boolean;
  groqModel: string;
  monthlyBudgetInr: number | null;
  budgetConfirmedAt: string | null;
  usdToInrRate: number;
  collegeSignature: string;
  announcementTemplate: string;
  omitMissingFields: boolean;
  retentionDays: number;
  retentionPolicyValidated: boolean;
  extensionDistributionMode: 'zip_developer_mode' | 'browser_store_planned';
  classifierThresholds: ClassifierThresholds;
}

export const DEFAULT_ANNOUNCEMENT_TEMPLATE = [
  'PLACEMENT OPPORTUNITY NOTICE',
  '',
  'COMPANY: {{employer}}',
  'ROLE: {{role_title}}',
  'OPPORTUNITY: {{opportunity_type}}',
  'ELIGIBILITY: {{eligibility}}',
  'DEGREE / BRANCH: {{degree_branch}}',
  'BATCH: {{batch}}',
  'LOCATION / WORK MODE: {{location_work_mode}}',
  'CTC / STIPEND: {{salary_or_stipend}}',
  'DEADLINE: {{deadline}}',
  'HOW TO APPLY: {{how_to_apply}}',
  'JOB DESCRIPTION: {{jd_status}}',
  'CONTACT: {{contact}}',
  '',
  '{{college_signature}}',
].join('\n');

export function buildDefaultSettings(config: AppConfig): SpcrSettings {
  return {
    firstRunCompleted: false,
    privacyDisclosureAcceptedAt: null,
    groqDisclosureAcceptedAt: null,
    autoDraftHighConfidence: false, // Hard requirement: OFF by default
    groqModel: config.groqModel || 'openai/gpt-oss-20b',
    monthlyBudgetInr: null, // Hard requirement: undecided/null until owner sets & confirms
    budgetConfirmedAt: null,
    usdToInrRate: 86.0,
    collegeSignature: 'Issued by: Training and Placement Cell',
    announcementTemplate: DEFAULT_ANNOUNCEMENT_TEMPLATE,
    omitMissingFields: false,
    retentionDays: 90,
    retentionPolicyValidated: false,
    extensionDistributionMode: 'zip_developer_mode',
    classifierThresholds: {
      candidateMinConfidence: 0.42,
      reviewMinMargin: 0.05,
    },
  };
}

export async function getSettings(db: QueryExecutor, config: AppConfig): Promise<SpcrSettings> {
  const defaults = buildDefaultSettings(config);
  const res = await db.query<{ key: string; value_json: unknown }>('SELECT key, value_json FROM app_settings');
  const map = new Map<string, unknown>();
  for (const row of res.rows) {
    map.set(row.key, row.value_json);
  }
  const merged: SpcrSettings = {
    ...defaults,
    ...(map.has('settings') && typeof map.get('settings') === 'object' && map.get('settings') !== null
      ? (map.get('settings') as Partial<SpcrSettings>)
      : {}),
  };

  // Enforce invariant: autoDraftHighConfidence can NEVER remain true if disclosure or budget confirmation is absent
  if (!merged.groqDisclosureAcceptedAt || !merged.budgetConfirmedAt || !merged.monthlyBudgetInr || merged.monthlyBudgetInr <= 0) {
    merged.autoDraftHighConfidence = false;
  }

  return merged;
}

export async function updateSettings(
  db: Database,
  config: AppConfig,
  actorEmail: string,
  patch: Partial<SpcrSettings> & { confirmBudget?: boolean; acceptGroqDisclosure?: boolean; acceptPrivacyDisclosure?: boolean }
): Promise<SpcrSettings> {
  return db.withTransaction(async (tx) => {
    const current = await getSettings(tx, config);
    const nowIso = new Date().toISOString();

    const next: SpcrSettings = {
      ...current,
      ...(patch.firstRunCompleted !== undefined ? { firstRunCompleted: Boolean(patch.firstRunCompleted) } : {}),
      ...(patch.groqModel !== undefined ? { groqModel: patch.groqModel.trim() } : {}),
      ...(patch.usdToInrRate !== undefined && patch.usdToInrRate > 0 ? { usdToInrRate: patch.usdToInrRate } : {}),
      ...(patch.collegeSignature !== undefined ? { collegeSignature: patch.collegeSignature } : {}),
      ...(patch.announcementTemplate !== undefined ? { announcementTemplate: patch.announcementTemplate } : {}),
      ...(patch.omitMissingFields !== undefined ? { omitMissingFields: Boolean(patch.omitMissingFields) } : {}),
      ...(patch.retentionDays !== undefined ? { retentionDays: Math.min(Math.max(1, Math.floor(patch.retentionDays)), 365) } : {}),
      ...(patch.retentionPolicyValidated !== undefined
        ? { retentionPolicyValidated: Boolean(patch.retentionPolicyValidated) }
        : {}),
      ...(patch.extensionDistributionMode !== undefined
        ? { extensionDistributionMode: patch.extensionDistributionMode }
        : {}),
      ...(patch.classifierThresholds !== undefined
        ? {
            classifierThresholds: {
              candidateMinConfidence: Math.min(Math.max(0.2, patch.classifierThresholds.candidateMinConfidence), 0.95),
              reviewMinMargin: Math.min(Math.max(0.01, patch.classifierThresholds.reviewMinMargin), 0.5),
            },
          }
        : {}),
    };

    if (patch.acceptPrivacyDisclosure) {
      next.privacyDisclosureAcceptedAt = current.privacyDisclosureAcceptedAt || nowIso;
    }

    if (patch.acceptGroqDisclosure) {
      next.groqDisclosureAcceptedAt = current.groqDisclosureAcceptedAt || nowIso;
    } else if (patch.groqDisclosureAcceptedAt === null) {
      next.groqDisclosureAcceptedAt = null;
      next.autoDraftHighConfidence = false;
    }

    if (patch.monthlyBudgetInr !== undefined) {
      if (patch.monthlyBudgetInr === null || patch.monthlyBudgetInr <= 0) {
        next.monthlyBudgetInr = null;
        next.budgetConfirmedAt = null;
        next.autoDraftHighConfidence = false;
      } else {
        next.monthlyBudgetInr = Number(patch.monthlyBudgetInr.toFixed(2));
        if (patch.confirmBudget) {
          next.budgetConfirmedAt = nowIso;
          // Sync current month's budget row
          const monthKey = nowIso.slice(0, 7);
          const capUsd = Number((next.monthlyBudgetInr / next.usdToInrRate).toFixed(6));
          await tx.query(
            `INSERT INTO groq_monthly_budgets (month_key, cap_inr, usd_to_inr_rate, cap_usd, updated_at)
             VALUES ($1, $2, $3, $4, NOW())
             ON CONFLICT (month_key) DO UPDATE
             SET cap_inr = EXCLUDED.cap_inr,
                 usd_to_inr_rate = EXCLUDED.usd_to_inr_rate,
                 cap_usd = EXCLUDED.cap_usd,
                 updated_at = NOW()`,
            [monthKey, next.monthlyBudgetInr, next.usdToInrRate, capUsd]
          );
        } else {
          // Changing budget without explicit confirmation requires confirmation
          next.budgetConfirmedAt = null;
          next.autoDraftHighConfidence = false;
        }
      }
    } else if (patch.confirmBudget && next.monthlyBudgetInr && next.monthlyBudgetInr > 0) {
      next.budgetConfirmedAt = nowIso;
      const monthKey = nowIso.slice(0, 7);
      const capUsd = Number((next.monthlyBudgetInr / next.usdToInrRate).toFixed(6));
      await tx.query(
        `INSERT INTO groq_monthly_budgets (month_key, cap_inr, usd_to_inr_rate, cap_usd, updated_at)
         VALUES ($1, $2, $3, $4, NOW())
         ON CONFLICT (month_key) DO UPDATE
         SET cap_inr = EXCLUDED.cap_inr,
             usd_to_inr_rate = EXCLUDED.usd_to_inr_rate,
             cap_usd = EXCLUDED.cap_usd,
             updated_at = NOW()`,
        [monthKey, next.monthlyBudgetInr, next.usdToInrRate, capUsd]
      );
    }

    if (patch.autoDraftHighConfidence !== undefined) {
      if (patch.autoDraftHighConfidence) {
        if (!next.groqDisclosureAcceptedAt) {
          throw new Error('Cannot enable automatic Groq formatting before accepting the Groq data-flow disclosure.');
        }
        if (!next.monthlyBudgetInr || !next.budgetConfirmedAt) {
          throw new Error('Cannot enable automatic Groq formatting before setting and confirming a monthly budget cap.');
        }
        next.autoDraftHighConfidence = true;
      } else {
        next.autoDraftHighConfidence = false;
      }
    }

    await tx.query(
      `INSERT INTO app_settings (key, value_json, updated_at)
       VALUES ('settings', $1::jsonb, NOW())
       ON CONFLICT (key) DO UPDATE SET value_json = EXCLUDED.value_json, updated_at = NOW()`,
      [JSON.stringify(next)]
    );

    await recordAuditEvent(tx, {
      actorEmail,
      eventType: 'settings_updated',
      entityType: 'app_settings',
      entityId: 'settings',
      metadata: {
        autoDraftHighConfidence: next.autoDraftHighConfidence,
        groqModel: next.groqModel,
        monthlyBudgetInr: next.monthlyBudgetInr,
        budgetConfirmed: Boolean(next.budgetConfirmedAt),
        groqDisclosureAccepted: Boolean(next.groqDisclosureAcceptedAt),
        retentionDays: next.retentionDays,
      },
    });

    return next;
  });
}

