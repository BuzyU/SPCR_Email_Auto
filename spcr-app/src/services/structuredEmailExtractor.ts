import { z } from 'zod';
import { extractUrlsFromText, SenderAuthenticityAssessment } from './authenticityService.js';
import { CATEGORY_METADATA, EmailIntelligenceCategory, UncertaintyOutcome, UncertaintyOutcomeZod } from '../ml/schema.js';
import { EmailIntelligencePrediction } from './emailIntelligenceService.js';

export const FieldEvidenceEntrySchema = z.object({
  value: z.string(),
  verbatimExcerpt: z.string().min(1),
  source: z.enum(['subject', 'body', 'headers', 'attachment']),
});

export type FieldEvidenceEntry = z.infer<typeof FieldEvidenceEntrySchema>;

/**
 * Mandatory Addendum Section 4:
 * Validated structured extraction schema for recruitment emails.
 * Missing or unsupported fields MUST remain `null` (or `[]` for link arrays) — NEVER invented!
 * Content relevance is kept strictly separate from source authenticity and security risk.
 */
export const StructuredEmailExtractionSchema = z.object({
  companyOrOrganization: z.string().nullable(),
  jobTitleOrRole: z.string().nullable(),
  recruiterOrSenderIdentity: z
    .object({
      displayName: z.string().nullable(),
      email: z.string().nullable(),
      domain: z.string().nullable(),
    })
    .nullable(),
  location: z.string().nullable(),
  workMode: z.enum(['remote', 'hybrid', 'onsite']).nullable(),
  employmentType: z.enum(['full_time', 'internship', 'internship_plus_ppo', 'contract', 'part_time']).nullable(),
  salaryOrStipend: z.string().nullable(),
  applicationLinks: z.array(z.string()),
  assessmentLinks: z.array(z.string()),
  interviewLinks: z.array(z.string()),
  deadline: z.string().nullable(),
  interviewDateTime: z
    .object({
      rawText: z.string(),
      timezone: z.string().nullable(),
    })
    .nullable(),
  recruitmentStage: z.string().nullable(),
  requestedNextAction: z.string().nullable(),
  attachmentReferences: z.array(
    z.object({
      filename: z.string(),
      kind: z.enum(['jd', 'offer', 'assignment', 'other']),
      parseStatus: z.string().optional(),
    })
  ),
  sourceIds: z.object({
    sourceMessageId: z.string(),
    gmailMessageId: z.string(),
    gmailThreadId: z.string().nullable(),
  }),
  evidence: z.record(z.string(), FieldEvidenceEntrySchema),
  classificationConfidence: z.object({
    primaryCategory: z.string(),
    multiLabels: z.array(z.string()),
    score: z.number(),
    margin: z.number(),
    isCalibratedProbability: z.literal(false),
    calibrationNote: z.string(),
    uncertaintyOutcome: UncertaintyOutcomeZod,
    uncertaintyReasons: z.array(z.string()),
  }),
  authenticityAndRisk: z.object({
    authenticityLabel: z.string(),
    transportAuthStatus: z.enum(['passed', 'failed', 'partial', 'unavailable']),
    riskFlags: z.array(z.string()),
    isSuspicious: z.boolean(),
    claimedIdentityVerified: z.literal(false),
    separationNote: z.string(),
  }),
});

export type StructuredEmailExtraction = z.infer<typeof StructuredEmailExtractionSchema>;

function matchWithExcerpt(
  text: string,
  regex: RegExp,
  source: 'subject' | 'body' | 'attachment'
): { value: string; excerpt: string; source: 'subject' | 'body' | 'attachment' } | null {
  const m = text.match(regex);
  if (!m) return null;
  const val = (m[1] || m[0] || '').trim().replace(/\s+/g, ' ');
  if (!val) return null;
  const idx = m.index ?? 0;
  const start = Math.max(0, idx - 25);
  const end = Math.min(text.length, idx + m[0].length + 35);
  const excerpt = text.slice(start, end).replace(/\s+/g, ' ').trim();
  return { value: val, excerpt, source };
}

const GENERIC_PLATFORM_DOMAINS = new Set([
  'gmail.com',
  'googlemail.com',
  'yahoo.com',
  'outlook.com',
  'hotmail.com',
  'rediffmail.com',
  'proton.me',
  'greenhouse.io',
  'lever.co',
  'hire.lever.co',
  'ashbyhq.com',
  'myworkday.com',
  'myworkdayjobs.com',
  'smartrecruiters.com',
  'hackerrankforwork.com',
  'hackerrank.com',
  'codility.com',
  'mettl.com',
  'codesignal.com',
  'testgorilla.com',
  'hirepro.in',
  'myamcat.com',
  'calendly.com',
  'goodtime.io',
  'hirevue.com',
  'joinsuperset.com',
]);

export function extractValidatedStructuredEmailInfo(params: {
  sourceMessageId: string;
  gmailMessageId: string;
  gmailThreadId: string | null;
  subject: string;
  bodyText: string;
  attachmentTexts: Array<{ filename: string; parseStatus?: string; extractedText?: string | null }>;
  prediction: EmailIntelligencePrediction;
  authenticity: SenderAuthenticityAssessment;
}): StructuredEmailExtraction {
  const { subject, bodyText, attachmentTexts, prediction, authenticity } = params;
  const cleanSubject = prediction.representation.cleanSubject;
  const cleanBody = prediction.representation.combinedPlainText || bodyText || '';
  const combinedAttText = attachmentTexts
    .map((a) => a.extractedText || '')
    .filter(Boolean)
    .join('\n');

  const evidence: Record<string, FieldEvidenceEntry> = {};
  const setEv = (field: string, hit: { value: string; excerpt: string; source: 'subject' | 'body' | 'headers' | 'attachment' } | null): string | null => {
    if (!hit || !hit.value) return null;
    evidence[field] = {
      value: hit.value,
      verbatimExcerpt: hit.excerpt,
      source: hit.source,
    };
    return hit.value;
  };

  // 1. Company or organization (ONLY when supported by explicit text/subject or corporate domain; NEVER treated as verified!)
  const companyHit =
    matchWithExcerpt(cleanBody, /(?:Company(?:\s+Name)?|Employer|Organization)\s*:\s*([^\n\r|.;]{2,65})/i, 'body') ||
    matchWithExcerpt(combinedAttText, /(?:Company(?:\s+Name)?|Employer|Organization)\s*:\s*([^\n\r|.;]{2,65})/i, 'attachment') ||
    matchWithExcerpt(cleanSubject, /(?:at|from|—|–|-)\s*([A-Z][A-Za-z0-9&.' ]{2,45})(?:\s*\(|$)/, 'subject') ||
    matchWithExcerpt(cleanSubject, /^([A-Z][A-Za-z0-9&.' ]{2,40})\s+(?:202\d|Campus|Internship|Online|Technical)/, 'subject');

  let companyOrOrganization = setEv('companyOrOrganization', companyHit);
  if (
    !companyOrOrganization &&
    authenticity.fromDomain &&
    authenticity.fromDomain !== 'unknown' &&
    !GENERIC_PLATFORM_DOMAINS.has(authenticity.fromDomain.toLowerCase()) &&
    !/\.(?:edu|ac\.in|edu\.in)$/i.test(authenticity.fromDomain)
  ) {
    const domRoot = authenticity.fromDomain.split('.')[0] || '';
    if (domRoot.length >= 3) {
      const formatted = domRoot
        .split(/[-_]/)
        .map((w) => (w ? w[0]!.toUpperCase() + w.slice(1) : ''))
        .join(' ');
      companyOrOrganization = setEv('companyOrOrganization', {
        value: `${formatted} (unverified domain claim)`,
        excerpt: authenticity.fromEmail || authenticity.fromDomain,
        source: 'headers',
      });
    }
  }

  // 2. Job title or internship role
  const roleHit =
    matchWithExcerpt(cleanBody, /(?:Role(?:\s*\d+)?|Position|Job\s+Title|Designation|Profile)\s*:\s*([^\n\r|.;]{3,75})/i, 'body') ||
    matchWithExcerpt(combinedAttText, /(?:Role(?:\s*\d+)?|Position|Job\s+Title|Designation|Profile)\s*:\s*([^\n\r|.;]{3,75})/i, 'attachment') ||
    matchWithExcerpt(
      cleanSubject,
      /(?:for|Role\s*:|Hiring\s*:|Drive\s*:\s*|—\s*)([A-Z][A-Za-z0-9/&+ -]{3,60}?(?:Engineer(?:\s*-\s*1)?|Intern(?:ship)?|Trainee|Analyst|Consultant|Designer|Developer|Associate|Fellow(?:ship)?|Residency|Cohort))(?:\s*(?:\(|—|-|\||$))/i,
      'subject'
    ) ||
    matchWithExcerpt(
      cleanBody,
      /\b((?:Graduate\s+Engineer\s+Trainee|Software\s+(?:Development\s+)?Engineer(?:\s*-\s*1|\s+Intern)?|Data\s+(?:Science|Engineering|Analyst)(?:\s+Intern)?|Product\s+(?:Design|Operations)\s*(?:Intern|Associate)?|Quantitative\s+(?:Risk\s+)?(?:Intern|Fellowship)|Backend\s+(?:Go\s+)?Engineer|Applied\s+(?:AI|ML)\s+Engineer))\b/i,
      'body'
    );
  const jobTitleOrRole = setEv('jobTitleOrRole', roleHit);

  // 3. Recruiter or sender identity
  const recruiterOrSenderIdentity =
    authenticity.fromEmail || authenticity.fromDisplayName
      ? {
          displayName: authenticity.fromDisplayName || null,
          email: authenticity.fromEmail || null,
          domain: authenticity.fromDomain !== 'unknown' ? authenticity.fromDomain : null,
        }
      : null;
  if (recruiterOrSenderIdentity?.email) {
    evidence.recruiterOrSenderIdentity = {
      value: recruiterOrSenderIdentity.email,
      verbatimExcerpt: `${recruiterOrSenderIdentity.displayName || ''} <${recruiterOrSenderIdentity.email}>`.trim(),
      source: 'headers',
    };
  }

  // 4. Location & remote/hybrid/onsite
  const locHit =
    matchWithExcerpt(cleanBody, /(?:Job\s+)?Location\s*:\s*([^\n\r|.;]{2,55})/i, 'body') ||
    matchWithExcerpt(combinedAttText, /(?:Job\s+)?Location\s*:\s*([^\n\r|.;]{2,55})/i, 'attachment') ||
    matchWithExcerpt(
      `${cleanSubject}\n${cleanBody}`,
      /\b((?:Bengaluru|Bangalore|Hyderabad|Pune|Chennai|Mumbai|Gurugram|Noida|New\s+Delhi|Ahmedabad|Vadodara|Kochi|Hosur))(?:\s*(?:On-?site|Hybrid|office|plant|\())?/i,
      'body'
    );
  const location = setEv('location', locHit);

  let workMode: 'remote' | 'hybrid' | 'onsite' | null = null;
  const modeHit =
    matchWithExcerpt(cleanBody, /\b(Remote|Hybrid|On-?site|Work\s+from\s+Office|In-?office)\b/i, 'body') ||
    matchWithExcerpt(cleanSubject, /\b(Remote|Hybrid|On-?site)\b/i, 'subject') ||
    matchWithExcerpt(combinedAttText, /\b(Remote|Hybrid|On-?site|Work\s+from\s+Office)\b/i, 'attachment');
  if (modeHit) {
    const rawM = modeHit.value.toLowerCase();
    workMode = rawM.includes('remote') ? 'remote' : rawM.includes('hybrid') ? 'hybrid' : 'onsite';
    evidence.workMode = {
      value: workMode,
      verbatimExcerpt: modeHit.excerpt,
      source: modeHit.source,
    };
  }

  // 5. Employment type
  let employmentType: 'full_time' | 'internship' | 'internship_plus_ppo' | 'contract' | 'part_time' | null = null;
  const combinedSource = `${cleanSubject}\n${cleanBody}\n${combinedAttText}`;
  if (/\b(?:intern(?:ship)?|residency|fellowship)\b/i.test(combinedSource) && /\b(?:ppo|pre[- ]placement\s+offer|fte\s+conversion|full[- ]?time\s+conversion|intern\s*\+\s*fte)\b/i.test(combinedSource)) {
    const h = matchWithExcerpt(cleanBody, /([^\n\r.]*(?:ppo|intern\s*\+\s*fte|conversion)[^\n\r.]*)/i, 'body') ||
      matchWithExcerpt(cleanSubject, /([^\n\r.]*(?:ppo|intern\s*\+\s*fte)[^\n\r.]*)/i, 'subject');
    employmentType = 'internship_plus_ppo';
    if (h) evidence.employmentType = { value: employmentType, verbatimExcerpt: h.excerpt, source: h.source };
  } else if (/\b(?:intern(?:ship)?|summer\s+intern|6[- ]month\s+intern)\b/i.test(combinedSource)) {
    const h = matchWithExcerpt(cleanBody, /([^\n\r.]*intern(?:ship)?[^\n\r.]*)/i, 'body') ||
      matchWithExcerpt(cleanSubject, /([^\n\r.]*intern(?:ship)?[^\n\r.]*)/i, 'subject');
    employmentType = 'internship';
    if (h) evidence.employmentType = { value: employmentType, verbatimExcerpt: h.excerpt, source: h.source };
  } else if (/\b(?:full[- ]?time|fte|graduate\s+engineer\s+trainee|employment\s+offer)\b/i.test(combinedSource)) {
    const h = matchWithExcerpt(cleanBody, /([^\n\r.]*(?:full[- ]?time|fte|trainee|employment\s+offer)[^\n\r.]*)/i, 'body') ||
      matchWithExcerpt(cleanSubject, /([^\n\r.]*(?:full[- ]?time|trainee)[^\n\r.]*)/i, 'subject');
    employmentType = 'full_time';
    if (h) evidence.employmentType = { value: employmentType, verbatimExcerpt: h.excerpt, source: h.source };
  } else if (/\bpart[- ]?time\b/i.test(combinedSource)) {
    employmentType = 'part_time';
  }

  // 6. Salary or stipend (ONLY when explicitly stated)
  const salaryHit =
    matchWithExcerpt(
      cleanBody,
      /(?:CTC|Compensation|Package|Stipend|Fellowship)\s*(?::|of|-)?\s*((?:INR|Rs\.?|₹)?\s*\d+(?:\.\d+)?\s*(?:LPA|Lakhs?\s+per\s+annum|(?:,\d{3}|k)\s*(?:\/\s*mo(?:nth)?|per\s+month))(?:\s*(?:\+|with|\|)\s*[^\n\r.;]{3,40})?)/i,
      'body'
    ) ||
    matchWithExcerpt(cleanBody, /(\b(?:INR|Rs\.?|₹)\s*\d{1,3}(?:,\d{3})+\s*(?:per\s+month|\/month)\b)/i, 'body') ||
    matchWithExcerpt(cleanBody, /(\b\d+(?:\.\d+)?\s*LPA\b)/i, 'body') ||
    matchWithExcerpt(cleanSubject, /(\b\d+(?:\.\d+)?\s*LPA\b|\bRs\.?\s*\d+k\/mo\b)/i, 'subject') ||
    matchWithExcerpt(combinedAttText, /(\b\d+(?:\.\d+)?\s*LPA\b)/i, 'attachment');
  const salaryOrStipend = setEv('salaryOrStipend', salaryHit);

  // 7. Categorize links strictly from verbatim extracted URLs (application vs assessment vs interview)
  const allUrls = extractUrlsFromText(`${cleanSubject}\n${cleanBody}\n${combinedAttText}`).filter(
    (u) => !/unsubscribe|unsub/i.test(u)
  );
  const applicationLinks: string[] = [];
  const assessmentLinks: string[] = [];
  const interviewLinks: string[] = [];

  for (const url of allUrls) {
    if (
      /hackerrank|codility|mettl|codesignal|testgorilla|hirepro|myamcat|hackerearth|submit-assignment|exam\./i.test(
        url
      )
    ) {
      assessmentLinks.push(url);
    } else if (/calendly|cal\.com|meet\.google\.com|zoom\.us|teams\.microsoft\.com|webex\.com|goodtime\.io|hirevue\.com/i.test(url)) {
      interviewLinks.push(url);
    } else {
      applicationLinks.push(url);
    }
  }
  if (applicationLinks.length > 0) {
    evidence.applicationLinks = {
      value: applicationLinks.join(', '),
      verbatimExcerpt: applicationLinks[0]!,
      source: 'body',
    };
  }
  if (assessmentLinks.length > 0) {
    evidence.assessmentLinks = {
      value: assessmentLinks.join(', '),
      verbatimExcerpt: assessmentLinks[0]!,
      source: 'body',
    };
  }
  if (interviewLinks.length > 0) {
    evidence.interviewLinks = {
      value: interviewLinks.join(', '),
      verbatimExcerpt: interviewLinks[0]!,
      source: 'body',
    };
  }

  // 8. Assessment or application deadline
  const deadlineHit =
    matchWithExcerpt(
      cleanBody,
      /(?:Application\s+deadline|Last\s+date(?:\s+to\s+(?:apply|register))?|Complete\s+before|Submit(?:\s+nominations|\s+applications)?\s+(?:by|before)|Apply\s+(?:by|before)|Portal\s+closes|Deadline)\s*:?\s*([^\n\r.;]{4,55})/i,
      'body'
    ) ||
    matchWithExcerpt(
      combinedAttText,
      /(?:Application\s+deadline|Last\s+date|Deadline)\s*:?\s*([^\n\r.;]{4,55})/i,
      'attachment'
    );
  const deadline = setEv('deadline', deadlineHit);

  // 9. Interview date, time & timezone
  let interviewDateTime: { rawText: string; timezone: string | null } | null = null;
  if (
    prediction.primaryCategory === 'interview_invitation' ||
    prediction.multiLabels.includes('interview_invitation') ||
    interviewLinks.length > 0
  ) {
    const dtHit =
      matchWithExcerpt(
        cleanBody,
        /(?:scheduled\s+(?:for|on)|confirmed\s+for|moved\s+to|on)\s+((?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)?[,\s]*\d{1,2}\s+[A-Z][a-z]{2,8}(?:\s+202\d)?[^\n\r.;]{0,45}?(?:\d{1,2}:\d{2}\s*(?:AM|PM)|AM|PM)(?:\s*(?:IST|UTC[+-]\d{2}:\d{2}|GMT|EST|PST))?)/i,
        'body'
      ) ||
      matchWithExcerpt(
        cleanSubject,
        /(\d{1,2}\s+[A-Z][a-z]{2,8}(?:\s+202\d)?[,\s]+\d{1,2}:\d{2}\s*(?:AM|PM)(?:\s*(?:IST|UTC[+-]\d{2}:\d{2}))?)/i,
        'subject'
      );
    if (dtHit) {
      const tzMatch = dtHit.value.match(/\b(IST|UTC[+-]\d{2}:\d{2}|UTC|GMT|EST|PST|CET)\b/i);
      interviewDateTime = {
        rawText: dtHit.value,
        timezone: tzMatch ? tzMatch[1]!.toUpperCase() : null,
      };
      evidence.interviewDateTime = {
        value: dtHit.value,
        verbatimExcerpt: dtHit.excerpt,
        source: dtHit.source,
      };
    }
  }

  // 10. Current recruitment stage & requested next action
  const recruitmentStage = CATEGORY_METADATA[prediction.primaryCategory].recruitmentStage;
  const actionMap: Partial<Record<EmailIntelligenceCategory, string>> = {
    relevant_opportunity: 'Review eligibility/terms and circulate or register eligible candidates before deadline',
    recruiter_outreach: 'Reply to recruiter with placement brochure, batch strength, or proposed campus drive dates',
    jd_or_details_followup: 'Review updated JD/corrigendum and update linked opportunity facts',
    application_acknowledgement: 'No immediate action required; retain application receipt in thread',
    screening_or_eligibility: 'Complete eligibility verification sheet or pre-screening form before cutoff',
    online_assessment: 'Complete proctored online test or take-home assignment within window',
    interview_invitation: 'Confirm/book interview slot and join panel link on time',
    interview_followup: 'Track shortlisted candidates advancing to next interview round',
    offer: 'Review offer terms / LOI and record signed candidate acceptance by deadline',
    rejection: 'Record closed/unsuccessful outcome on linked thread',
    spam_or_scam: 'DO NOT pay fees or click untrusted links; retain flagged security evidence',
    uncertain: 'Inspect raw message and attachments manually to clarify sender intent',
  };
  const requestedNextAction = actionMap[prediction.primaryCategory] || null;

  // 11. Attachment references
  const attachmentReferences = attachmentTexts.map((a) => {
    const fn = a.filename;
    const kind: 'jd' | 'offer' | 'assignment' | 'other' = /\b(?:jd|job[_\s-]?desc|corrigendum|addendum|rubric)\b/i.test(fn)
      ? 'jd'
      : /\b(?:offer|loi|appointment)\b/i.test(fn)
        ? 'offer'
        : /\b(?:assignment|problem|takehome|case|challenge)\b/i.test(fn)
          ? 'assignment'
          : 'other';
    return {
      filename: fn,
      kind,
      ...(a.parseStatus ? { parseStatus: a.parseStatus } : {}),
    };
  });

  const structured: StructuredEmailExtraction = {
    companyOrOrganization,
    jobTitleOrRole,
    recruiterOrSenderIdentity,
    location,
    workMode,
    employmentType,
    salaryOrStipend,
    applicationLinks,
    assessmentLinks,
    interviewLinks,
    deadline,
    interviewDateTime,
    recruitmentStage,
    requestedNextAction,
    attachmentReferences,
    sourceIds: {
      sourceMessageId: params.sourceMessageId,
      gmailMessageId: params.gmailMessageId,
      gmailThreadId: params.gmailThreadId,
    },
    evidence,
    classificationConfidence: {
      primaryCategory: prediction.primaryCategory,
      multiLabels: prediction.multiLabels,
      score: prediction.topConfidence,
      margin: prediction.margin,
      isCalibratedProbability: false,
      calibrationNote: prediction.calibrationNote,
      uncertaintyOutcome: prediction.uncertaintyOutcome as UncertaintyOutcome,
      uncertaintyReasons: prediction.uncertaintyReasons,
    },
    authenticityAndRisk: {
      authenticityLabel: authenticity.label,
      transportAuthStatus: authenticity.transportAuthStatus,
      riskFlags: authenticity.riskFlags,
      isSuspicious: authenticity.isSuspicious,
      claimedIdentityVerified: false,
      separationNote:
        'Claimed company names, logos, and display names are NEVER treated as proof of authenticity; transport headers and scam risk are evaluated independently of content relevance.',
    },
  };

  return StructuredEmailExtractionSchema.parse(structured);
}
