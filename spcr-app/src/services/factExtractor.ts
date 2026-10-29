import { extractUrlsFromText } from './authenticityService.js';

export const OPPORTUNITY_FACT_FIELDS = [
  'employer',
  'role_title',
  'opportunity_type',
  'job_location',
  'work_mode',
  'salary_or_stipend',
  'eligibility',
  'degree_branch',
  'batch',
  'CGPA_or_percentage',
  'backlog_rules',
  'deadline',
  'application_url',
  'application_process',
  'required_documents',
  'skills',
  'contact',
] as const;

export type OpportunityFactField = (typeof OPPORTUNITY_FACT_FIELDS)[number];

export interface ProvenancedFactCandidate {
  field: OpportunityFactField;
  value: string;
  sourceKind: 'email' | 'attachment';
  sourceRefId: string;
  sourceLabel: string;
  sourceExcerpt: string;
}

export interface MergedOpportunityFact {
  field: OpportunityFactField;
  value: string;
  sourceKind: 'email' | 'attachment' | 'manual_officer' | 'missing';
  sourceRefId: string | null;
  sourceLabel: string | null;
  sourceExcerpt: string | null;
  conflicts: Array<{
    value: string;
    sourceKind: 'email' | 'attachment';
    sourceRefId: string;
    sourceLabel: string;
    sourceExcerpt: string;
  }>;
}

function findSnippetMatch(text: string, regex: RegExp): { value: string; excerpt: string } | null {
  const m = text.match(regex);
  if (!m) return null;
  const captured = (m[1] || m[0] || '').trim().replace(/\s+/g, ' ');
  if (!captured) return null;
  const idx = m.index ?? 0;
  const start = Math.max(0, idx - 25);
  const end = Math.min(text.length, idx + m[0].length + 35);
  const excerpt = text.slice(start, end).replace(/\s+/g, ' ').trim();
  return { value: captured, excerpt };
}

export function inferCompanyAndRoleFromHeadersAndText(input: {
  fromDisplayName: string;
  fromDomain: string;
  subject: string;
  text: string;
}): { companyName: string; roleTitle: string } {
  const cleanSubject = input.subject.replace(/^(?:re|fw|fwd)\s*:\s*/gi, '').trim();

  // Explicit `Company:` / `Employer:` / `Organization:` labels in body/JD
  const explicitCompany =
    findSnippetMatch(input.text, /(?:Company(?:\s+Name)?|Employer|Organization)\s*:\s*([^\n\r|.;]{2,70})/i)?.value ||
    findSnippetMatch(cleanSubject, /[—–|-]\s*([A-Z][A-Za-z0-9&.,' -]{2,55})(?:\s*\(|$)/)?.value ||
    findSnippetMatch(cleanSubject, /^([A-Z][A-Za-z0-9&.' ]{2,45})\s+Campus\s+(?:Hiring|Recruitment|Drive)/i)?.value;

  let companyName = explicitCompany || '';
  if (!companyName && input.fromDisplayName) {
    const cleanedDisp = input.fromDisplayName
      .replace(/\s*[-|–]\s*(?:Talent|HR|Campus|University|Recruit.*).*$/i, '')
      .trim();
    if (cleanedDisp && !/@/.test(cleanedDisp) && cleanedDisp.length <= 50) {
      companyName = cleanedDisp;
    }
  }
  if (!companyName && input.fromDomain) {
    const root = input.fromDomain.split('.')[0] || '';
    if (root && !['gmail', 'yahoo', 'outlook', 'hotmail', 'proton'].includes(root.toLowerCase())) {
      companyName = root
        .split(/[-_]/)
        .map((w) => (w ? w[0]!.toUpperCase() + w.slice(1) : ''))
        .join(' ');
    }
  }
  if (!companyName) companyName = 'Not specified';

  // Role title inference from explicit source patterns only (never fabricated!)
  const explicitRole =
    findSnippetMatch(input.text, /(?:Role(?:\s*\d+)?|Position|Job\s+Title|Designation|Profile)\s*:\s*([^\n\r|.;]{3,80})/i)
      ?.value ||
    findSnippetMatch(
      cleanSubject,
      /Role\s*\d+\s*:\s*([^\n\r(—–|-]{3,75})/i
    )?.value ||
    findSnippetMatch(
      cleanSubject,
      /(?:for|Hiring(?:\s+for)?|Job\s+Description\s+for)\s+([A-Z][A-Za-z0-9/& -]{3,65}?)(?:\s*(?:\(|—|–|\||-|202\d|$))/i
    )?.value ||
    findSnippetMatch(
      input.text,
      /\b((?:Graduate\s+Engineer\s+Trainee|Software\s+(?:Development\s+)?Engineer(?:\s+Intern)?|Full[- ]Stack\s+Software\s+Engineer|Data\s+(?:Engineering|Science|Analyst)\s*(?:Intern)?|Healthcare\s+Business\s+Analyst|Embedded\s*&\s*ROS\s+Engineer|Junior\s+Robotics\s+Engineer|VLSI\s+(?:Design\s+)?Verification(?:\s+Intern)?|Cloud\s+Support\s+Associate|Backend\s+(?:Java\/Go\s+)?Engineer))\b/i
    )?.value;

  const roleTitle = explicitRole ? explicitRole.replace(/\s+/g, ' ').trim() : 'Not specified';
  return { companyName, roleTitle };
}

/**
 * Deterministically extracts source-supported facts with verbatim excerpts from a single email or JD text.
 * Never fabricates missing fields; returns only facts explicitly evidenced in `text`.
 */
export function extractFactsFromSingleSource(params: {
  text: string;
  subject?: string;
  fromDisplayName?: string;
  fromDomain?: string;
  sourceKind: 'email' | 'attachment';
  sourceRefId: string;
  sourceLabel: string;
}): ProvenancedFactCandidate[] {
  const out: ProvenancedFactCandidate[] = [];
  const fullText = params.subject ? `${params.subject}\n${params.text}` : params.text;

  const pushFact = (field: OpportunityFactField, match: { value: string; excerpt: string } | null) => {
    if (!match || !match.value || match.value.toLowerCase() === 'not specified') return;
    out.push({
      field,
      value: match.value,
      sourceKind: params.sourceKind,
      sourceRefId: params.sourceRefId,
      sourceLabel: params.sourceLabel,
      sourceExcerpt: match.excerpt,
    });
  };

  // Employer & Role if explicitly stated
  const explicitEmployer = findSnippetMatch(
    fullText,
    /(?:Company(?:\s+Name)?|Employer|Organization)\s*:\s*([^\n\r|.;]{2,70})/i
  );
  pushFact('employer', explicitEmployer);

  const explicitRole =
    findSnippetMatch(fullText, /(?:Role(?:\s*\d+)?|Position|Job\s+Title|Designation)\s*:\s*([^\n\r|.;]{3,80})/i) ||
    (params.subject
      ? findSnippetMatch(params.subject, /for\s+(?:the\s+)?([A-Z][A-Za-z0-9/& -]{3,60}?)(?:\s+position|\s+role|\s*\(|$)/i)
      : null);
  pushFact('role_title', explicitRole);

  // Opportunity type
  if (/\binternship\b/i.test(fullText) && /\b(?:ppo|full[- ]?time|fte|conversion)\b/i.test(fullText)) {
    pushFact('opportunity_type', {
      value: 'Internship + Full-Time (PPO)',
      excerpt: findSnippetMatch(fullText, /([^\n\r.]*internship[^\n\r.]*)/i)?.excerpt || 'Internship + PPO',
    });
  } else if (/\bintern(?:ship|s)?\b/i.test(fullText)) {
    pushFact('opportunity_type', {
      value: 'Internship',
      excerpt: findSnippetMatch(fullText, /([^\n\r.]*intern(?:ship|s)?[^\n\r.]*)/i)?.excerpt || 'Internship',
    });
  } else if (/\b(?:full[- ]?time|fte|graduate\s+engineer\s+trainee)\b/i.test(fullText)) {
    pushFact('opportunity_type', {
      value: 'Full-Time',
      excerpt: findSnippetMatch(fullText, /([^\n\r.]*(?:full[- ]?time|fte|trainee)[^\n\r.]*)/i)?.excerpt || 'Full-Time',
    });
  }

  // Salary / CTC / Stipend
  const compMatch =
    findSnippetMatch(fullText, /(?:CTC|Compensation|Salary|Package(?:\s+of)?|Stipend)\s*(?::|of|-)?\s*((?:INR|Rs\.?|₹)?\s*\d+(?:\.\d+)?\s*(?:LPA|Lakhs?\s+per\s+annum|,\d{3}\s*(?:per\s+month|\/month|pm))(?:\s*(?:with|;|and)\s*[^\n\r.;]{3,45})?)/i) ||
    findSnippetMatch(fullText, /(\d+(?:\.\d+)?\s*LPA)/i) ||
    findSnippetMatch(fullText, /((?:INR|Rs\.?)\s*\d{1,3}(?:,\d{3})+\s*(?:per\s+month|\/month))/i);
  pushFact('salary_or_stipend', compMatch);

  // CGPA / Percentage
  const cgpaMatch =
    findSnippetMatch(fullText, /(?:Minimum\s+CGPA|CGPA(?:\s+relaxed\s+to)?|Eligibility\s*:\s*CGPA)\s*(?::|>=|of|to)?\s*(\d+(?:\.\d+)?(?:\s*(?:and\s+above|\+|\/10))?)/i) ||
    findSnippetMatch(fullText, /(CGPA\s*(?:>=|>|:)?\s*\d+\.\d+)/i) ||
    findSnippetMatch(fullText, /(\d{2}(?:\.\d+)?%\s*(?:and\s+above|throughout|aggregate))/i);
  pushFact('CGPA_or_percentage', cgpaMatch);

  // Backlog rules
  const backlogMatch = findSnippetMatch(
    fullText,
    /\b((?:zero|no|0|\d+)\s+(?:active\s+)?backlogs?(?:\s+allowed)?|backlog\s+rule\s+[^\n\r.;]{3,40})/i
  );
  pushFact('backlog_rules', backlogMatch);

  // Degree / branch
  const degreeMatch =
    findSnippetMatch(fullText, /(?:Eligible\s+Branches?|Degree\s*\/?\s*Branch|Streams?)\s*:\s*([^\n\r.;]{3,90})/i) ||
    findSnippetMatch(
      fullText,
      /\b((?:B\.?\s*Tech|B\.?\s*E\.?|M\.?\s*Tech|MCA|MBA)(?:\s*(?:\/|,|and)\s*(?:B\.?\s*Tech|M\.?\s*Tech|MCA|MBA))*\s*(?:\([^)]{2,50}\)|(?:CSE|IT|ECE|EEE|Robotics|AI-DS|Mechanical|All\s+Branches)(?:[\s,/&]+(?:CSE|IT|ECE|EEE|Robotics|AI-DS|Mechanical|All\s+Branches))*))/i
    );
  pushFact('degree_branch', degreeMatch);

  // Batch
  const batchMatch =
    findSnippetMatch(fullText, /(?:Batch|Graduating\s+Year)\s*:\s*(202\d(?:\s*(?:&|and|,|\/)\s*202\d)*)/i) ||
    findSnippetMatch(fullText, /\b(202\d(?:\s*(?:&|and|\/)\s*202\d)?\s+(?:graduating\s+)?batch)\b/i);
  pushFact('batch', batchMatch);

  // Location & Work Mode
  const locMatch =
    findSnippetMatch(fullText, /(?:Job\s+)?Location\s*:\s*([^\n\r|.;]{2,60})/i) ||
    findSnippetMatch(fullText, /\b((?:Bengaluru|Bangalore|Hyderabad|Pune|Chennai|Mumbai|Gurugram|Noida|Delhi|Remote)\s*(?:office|\((?:Hybrid|On-site|Remote)\))?)/i);
  pushFact('job_location', locMatch);

  const modeMatch = findSnippetMatch(fullText, /\b(Hybrid|Remote|Work\s+from\s+Office|On-?site|In-?office)\b/i);
  pushFact('work_mode', modeMatch);

  // Deadline (preserve exact date wording / timezone)
  const deadlineMatch =
    findSnippetMatch(
      fullText,
      /(?:Last\s+date\s+to\s+apply|Application\s+deadline|Deadline|Extension\s+of\s+deadline\s+to|Apply\s+(?:by|before))\s*:?\s*([^\n\r.;]{4,55})/i
    );
  pushFact('deadline', deadlineMatch);

  // Application URL (strictly extracted from source text)
  const urls = extractUrlsFromText(fullText);
  if (urls[0]) {
    pushFact('application_url', {
      value: urls[0],
      excerpt: urls[0],
    });
  }

  // Contact email if in body
  const bodyContact = findSnippetMatch(
    params.text,
    /(?:Contact|Reach\s+out\s+to|Queries)\s*:\s*([^\n\r;]{4,70})/i
  );
  pushFact('contact', bodyContact);

  return out;
}

function normalizeFactComparable(field: OpportunityFactField, val: string): string {
  const base = val.trim().toLowerCase().replace(/\s+/g, ' ');
  if (field === 'CGPA_or_percentage') {
    const num = base.match(/\d+(?:\.\d+)?/);
    return num ? num[0] : base;
  }
  if (field === 'application_url') {
    return val.trim().replace(/\/+$/, '');
  }
  return base;
}

/**
 * Merges fact candidates across linked emails and parsed JD attachments.
 * NEVER silently hides disagreements — conflicting values from different sources are preserved in `conflicts`!
 */
export function mergeProvenancedFacts(candidates: ProvenancedFactCandidate[]): {
  facts: MergedOpportunityFact[];
  missingFields: OpportunityFactField[];
  hasConflicts: boolean;
} {
  const byField = new Map<OpportunityFactField, ProvenancedFactCandidate[]>();
  for (const c of candidates) {
    const list = byField.get(c.field) || [];
    list.push(c);
    byField.set(c.field, list);
  }

  const facts: MergedOpportunityFact[] = [];
  const missingFields: OpportunityFactField[] = [];
  let hasConflicts = false;

  for (const field of OPPORTUNITY_FACT_FIELDS) {
    const entries = byField.get(field) || [];
    if (entries.length === 0) {
      facts.push({
        field,
        value: 'Not specified',
        sourceKind: 'missing',
        sourceRefId: null,
        sourceLabel: null,
        sourceExcerpt: null,
        conflicts: [],
      });
      missingFields.push(field);
      continue;
    }

    // Latest source wins primary display slot while keeping ALL distinct prior/concurrent values visible in `conflicts`!
    const primary = entries[entries.length - 1]!;
    const primaryNorm = normalizeFactComparable(field, primary.value);
    const conflicts: MergedOpportunityFact['conflicts'] = [];

    const seenNorms = new Set<string>([primaryNorm]);
    for (const item of entries) {
      const norm = normalizeFactComparable(field, item.value);
      if (!seenNorms.has(norm)) {
        seenNorms.add(norm);
        conflicts.push({
          value: item.value,
          sourceKind: item.sourceKind,
          sourceRefId: item.sourceRefId,
          sourceLabel: item.sourceLabel,
          sourceExcerpt: item.sourceExcerpt,
        });
      }
    }

    if (conflicts.length > 0) {
      hasConflicts = true;
    }

    facts.push({
      field,
      value: primary.value,
      sourceKind: primary.sourceKind,
      sourceRefId: primary.sourceRefId,
      sourceLabel: primary.sourceLabel,
      sourceExcerpt: primary.sourceExcerpt,
      conflicts,
    });
  }

  return { facts, missingFields, hasConflicts };
}

export function renderPlainTextAnnouncementFromFacts(params: {
  template: string;
  factsMap: Record<string, string>;
  jdStatusText: string;
  collegeSignature: string;
  omitMissingFields: boolean;
}): string {
  const getVal = (key: string) => {
    const v = (params.factsMap[key] || '').trim();
    return v && v.toLowerCase() !== 'not specified' ? v : 'Not specified';
  };

  const loc = getVal('job_location');
  const mode = getVal('work_mode');
  const locMode =
    loc !== 'Not specified' && mode !== 'Not specified'
      ? `${loc} (${mode})`
      : loc !== 'Not specified'
        ? loc
        : mode;

  const eligParts = [
    getVal('eligibility') !== 'Not specified' ? getVal('eligibility') : '',
    getVal('CGPA_or_percentage') !== 'Not specified' ? `CGPA/Marks: ${getVal('CGPA_or_percentage')}` : '',
    getVal('backlog_rules') !== 'Not specified' ? `Backlogs: ${getVal('backlog_rules')}` : '',
  ].filter(Boolean);

  const applyParts = [
    getVal('application_url') !== 'Not specified' ? getVal('application_url') : '',
    getVal('application_process') !== 'Not specified' ? getVal('application_process') : '',
  ].filter(Boolean);

  const substitutions: Record<string, string> = {
    employer: getVal('employer'),
    role_title: getVal('role_title'),
    opportunity_type: getVal('opportunity_type'),
    eligibility: eligParts.length > 0 ? eligParts.join(' | ') : 'Not specified',
    degree_branch: getVal('degree_branch'),
    batch: getVal('batch'),
    location_work_mode: locMode,
    salary_or_stipend: getVal('salary_or_stipend'),
    deadline: getVal('deadline'),
    how_to_apply: applyParts.length > 0 ? applyParts.join(' — ') : 'Not specified',
    jd_status: params.jdStatusText || 'Not specified',
    contact: getVal('contact'),
    college_signature: params.collegeSignature.trim(),
  };

  let rendered = params.template;
  for (const [key, val] of Object.entries(substitutions)) {
    rendered = rendered.replaceAll(`{{${key}}}`, val);
  }

  if (params.omitMissingFields) {
    rendered = rendered
      .split('\n')
      .filter((line) => !/:\s*Not specified\s*$/i.test(line.trim()))
      .join('\n');
  }

  return rendered.replace(/\n{3,}/g, '\n\n').trim();
}

