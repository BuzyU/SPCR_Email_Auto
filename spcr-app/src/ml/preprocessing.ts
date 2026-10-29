import { EMAIL_INTELLIGENCE_CATEGORIES, EmailIntelligenceCategory } from './schema.js';

export interface EmailFeatureInput {
  fromRaw: string;
  replyToRaw?: string | null;
  authHeadersRaw?: string | null;
  listUnsubscribeHeader?: string | null;
  inReplyTo?: string | null;
  subject: string;
  rawBody: string;
  isHtmlOnly?: boolean;
  attachmentFilenames?: string[];
  priorThreadCategories?: EmailIntelligenceCategory[];
}

export interface NormalizedEmailRepresentation {
  cleanSubject: string;
  freshBodyText: string;
  quotedOrForwardedText: string;
  combinedPlainText: string;
  senderEmail: string;
  senderDomain: string;
  senderDisplayName: string;
  missingAndQualityIndicators: {
    isEmptyBody: boolean;
    isVeryShortBody: boolean;
    hasMissingSubject: boolean;
    isHtmlOnlySource: boolean;
    hasMalformedEncoding: boolean;
  };
  structuralSignals: {
    isReplySubject: boolean;
    isForwardSubject: boolean;
    hasInReplyToHeader: boolean;
    hasPriorThread: boolean;
    priorThreadDepth: number;
    isFreeWebmailDomain: boolean;
    isAssessmentPlatformSenderOrLink: boolean;
    isSchedulingOrMeetingLinkPresent: boolean;
    isAtsOrCareersPortalLinkPresent: boolean;
    isEduOrPlacementDomain: boolean;
    hasBulkOrUnsubscribeSignal: boolean;
    hasAuthFailureSignal: boolean;
    hasLookalikeOrReplyMismatchSignal: boolean;
    hasFeeOrScamDemandSignal: boolean;
    hasPdfOrDocxAttachment: boolean;
    hasJdAttachmentFilename: boolean;
    hasOfferAttachmentFilename: boolean;
    hasAssignmentAttachmentFilename: boolean;
    hasInternalAcademicOrAdminContext: boolean;
    hasUnusualCohortOrResidencyHiringCue: boolean;
  };
  tokens: string[];
  denseFeatures: number[];
}

const FREE_WEBMAIL_DOMAINS = new Set([
  'gmail.com',
  'googlemail.com',
  'yahoo.com',
  'yahoo.co.in',
  'outlook.com',
  'hotmail.com',
  'live.com',
  'rediffmail.com',
  'proton.me',
  'protonmail.com',
  'icloud.com',
]);

const ASSESSMENT_PLATFORM_PATTERNS =
  /\b(hackerrank|codility|mettl|mercer\s*mettl|codesignal|testgorilla|hirepro|amcat|cocubes|superset|pod\.ai|hackerearth|indiabix|leetcode|take[- ]?home\s+assignment|coding\s+(?:test|challenge|round)|online\s+(?:assessment|test)|proctored\s+test|oa\s+link)\b/i;

const SCHEDULING_OR_INTERVIEW_LINK_PATTERNS =
  /\b(calendly\.com|cal\.com|meet\.google\.com|zoom\.us|teams\.microsoft\.com|webex\.com|goodtime\.io|hirevue\.com)\b/i;

const ATS_PORTAL_PATTERNS =
  /\b(greenhouse\.io|lever\.co|myworkdayjobs\.com|workday\.com|ashbyhq\.com|smartrecruiters\.com|icims\.com|darwinbox\.in|keka\.com|zohorecruit\.com|joinsuperset\.com|careers\.[a-z0-9-]+)\b/i;

const LOOKALIKE_BRAND_PATTERNS =
  /\b(1nfosys|inf0sys|tcs[-_](?:hr|careers|hiring|india)|wipr0|accen1ure|amaz0n|g00gle|micr0soft|cogn1zant|capgem1ni|del0itte)\b/i;

const FEE_OR_SCAM_PATTERNS =
  /\b(registration\s+fee|security\s+deposit|refundable\s+deposit|laptop\s+(?:dispatch|shipping|security)\s+fee|training\s+fee\s+mandatory|pay\s+(?:inr|rs\.?|₹)\s*\d+|upi\s+transfer|document\s+verification\s+charge|telegram\s+@|whatsapp\s+hr\s+immediately\s+for\s+part[- ]?time\s+daily\s+payout|earn\s+rs\.?\s*\d+\s*per\s+day\s+from\s+mobile|no\s+interview\s+direct\s+offer\s+letter)\b/i;

const BULK_NEWSLETTER_PATTERNS =
  /\b(unsubscribe|manage\s+(?:email\s+)?preferences|email\s+alert\s+settings|view\s+(?:this\s+email\s+)?in\s+browser|daily\s+job\s+alert|weekly\s+(?:job|career|hiring)\s+(?:digest|newsletter|roundup)|jobs?\s+matching\s+your\s+(?:saved\s+)?search|recommended\s+jobs\s+for\s+you|top\s+\d+\s+(?:hiring\s+companies|developer\s+jobs|jobs\s+this\s+week)|sponsored\s+bootcamp|enroll\s+now\s+at\s+\d+%\s+off)\b/i;

const INTERNAL_ADMIN_CONFUSER_PATTERNS =
  /\b(career\s+advancement\s+scheme|cas\s+promotion|faculty\s+appraisal|senate\s+minutes|syllabus\s+revision|invigilation\s+duty|library\s+(?:overdue|fine|return\s+notice)|cracking\s+the\s+coding\s+interview\s+book|hostel\s+mess|canteen\s+tender|student\s+(?:fest|club|chapter)\s+volunteer|annual\s+cultural\s+fest|electricity\s+shutdown|water\s+supply\s+maintenance|gst\s+tax\s+invoice|cloud\s+billing\s+statement|flight\s+itinerary|naac\s+ssr|nba\s+accreditation)\b/i;

const UNUSUAL_HIRING_COHORT_PATTERNS =
  /\b(graduating\s+cohort|engineering\s+residency|202[5-9]\s+(?:cohort|batch|graduates|passouts)|final[- ]year\s+(?:undergraduates|b\.?\s*tech|students|scholars)|stipend\s+(?:of\s+)?(?:inr|rs\.?|₹)|ctc\s*(?::|of)?\s*\d+|lakhs?\s+per\s+annum|\d+(?:\.\d+)?\s*lpa|pre[- ]placement\s+offer|ppo\s+conversion|campus\s+intake|entry[- ]level\s+(?:systems|hardware|software|analyst|fellowship)\s+intake|nominate\s+eligible\s+final[- ]year)\b/i;

export function decodeHtmlToStructuredText(raw: string): { text: string; detectedHtmlTags: boolean } {
  const detectedHtmlTags = /<(?:html|body|table|tr|td|div|p|span|br|a|ul|li|h[1-6])\b[^>]*>/i.test(raw);
  if (!detectedHtmlTags) {
    return { text: raw, detectedHtmlTags: false };
  }

  // Preserve anchor href URLs when anchor text hides them
  const withLinks = raw.replace(
    /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi,
    (_m, href: string, inner: string) => {
      const cleanInner = inner.replace(/<[^>]+>/g, ' ').trim();
      if (/^https?:\/\//i.test(href) && !cleanInner.includes(href)) {
        return `${cleanInner} (${href}) `;
      }
      return `${cleanInner} `;
    }
  );

  const stripped = withLinks
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<(?:br|hr)\s*\/?>/gi, '\n')
    .replace(/<\/(?:p|div|tr|li|h[1-6])>/gi, '\n')
    .replace(/<\/td>/gi, ' | ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  return { text: stripped, detectedHtmlTags: true };
}

export function splitFreshAndQuotedEmailBody(plainText: string): {
  freshBody: string;
  quotedOrForwarded: string;
} {
  const lines = plainText.split(/\r?\n/);
  const freshLines: string[] = [];
  const quotedLines: string[] = [];
  let inForwardedOrReplyBlock = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (
      /^-{3,}\s*Forwarded message\s*-{3,}/i.test(trimmed) ||
      /^Begin forwarded message:/i.test(trimmed) ||
      /^-{3,}\s*Original Message\s*-{3,}/i.test(trimmed) ||
      /^On\s+.+wrote:$/i.test(trimmed)
    ) {
      inForwardedOrReplyBlock = true;
      quotedLines.push(trimmed);
      continue;
    }

    if (trimmed.startsWith('>')) {
      quotedLines.push(trimmed.replace(/^>+\s*/, ''));
    } else if (inForwardedOrReplyBlock) {
      quotedLines.push(trimmed);
    } else {
      freshLines.push(trimmed);
    }
  }

  return {
    freshBody: freshLines.join('\n').trim(),
    quotedOrForwarded: quotedLines.join('\n').trim(),
  };
}

function parseAddressHeader(raw: string): { displayName: string; email: string; domain: string } {
  const trimmed = (raw || '').trim();
  const angleMatch = trimmed.match(/^(.*?)<([^<>@\s]+@[^<>@\s]+)>$/);
  if (angleMatch) {
    const displayName = (angleMatch[1] || '').replace(/^["']|["']$/g, '').trim();
    const email = (angleMatch[2] || '').trim().toLowerCase();
    const domain = email.split('@')[1] || 'unknown';
    return { displayName, email, domain };
  }
  const simpleMatch = trimmed.match(/([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/);
  if (simpleMatch) {
    const email = simpleMatch[1]!.toLowerCase();
    return {
      displayName: trimmed.replace(simpleMatch[0], '').replace(/[<>"]/g, '').trim(),
      email,
      domain: email.split('@')[1] || 'unknown',
    };
  }
  return { displayName: trimmed, email: '', domain: 'unknown' };
}

function tokenizeSegment(text: string, prefix: string, includeBigrams: boolean): string[] {
  const normalized = text
    .toLowerCase()
    .replace(/https?:\/\/([a-z0-9.-]+)(?:\/[^\s)]*)?/gi, (_m, host: string) => ` urlhost_${host.replace(/[^a-z0-9]/g, '_')} `)
    .replace(/₹|rs\.?\s*\d/gi, ' inr_currency ')
    .replace(/\b(\d+(?:\.\d+)?)\s*lpa\b/gi, ' ctc_lpa ')
    .replace(/\bcgpa\b/gi, ' cgpa_metric ')
    .replace(/\bb\.?\s*tech\b/gi, ' btech_deg ')
    .replace(/\bm\.?\s*tech\b/gi, ' mtech_deg ')
    .replace(/\bpfa\b/gi, ' pfa_attached ')
    .replace(/\bfyi\b/gi, ' fyi_note ')
    .replace(/\boa\b/gi, ' oa_token ')
    .replace(/\bjd\b/gi, ' jd_token ')
    .replace(/\bppo\b/gi, ' ppo_token ')
    .replace(/\bfte\b/gi, ' fte_token ')
    .replace(/[^a-z0-9_]+/g, ' ')
    .trim();

  if (!normalized) return [];
  const words = normalized.split(/\s+/).filter((w) => w.length >= 2 && w.length <= 36);
  const out: string[] = [];
  for (const w of words) {
    out.push(`${prefix}${w}`);
  }
  if (includeBigrams) {
    for (let i = 0; i + 1 < words.length; i++) {
      out.push(`${prefix}${words[i]}_${words[i + 1]}`);
    }
  }
  return out;
}

export const DENSE_STRUCTURAL_FEATURE_NAMES: readonly string[] = [
  'is_empty_body',
  'is_very_short_body',
  'has_missing_subject',
  'is_html_only_source',
  'has_malformed_encoding',
  'log_subject_len',
  'log_fresh_body_len',
  'log_quoted_body_len',
  'is_reply_subject',
  'is_forward_subject',
  'has_in_reply_to',
  'has_prior_thread',
  'prior_thread_depth_capped',
  'is_free_webmail_domain',
  'is_assessment_platform',
  'is_scheduling_or_meeting_link',
  'is_ats_or_careers_portal',
  'is_edu_or_placement_domain',
  'has_bulk_or_unsubscribe',
  'has_auth_failure',
  'has_lookalike_or_reply_mismatch',
  'has_fee_or_scam_demand',
  'has_pdf_or_docx_attachment',
  'has_jd_attachment_filename',
  'has_offer_attachment_filename',
  'has_assignment_attachment_filename',
  'has_internal_academic_or_admin_context',
  'has_unusual_cohort_or_residency_cue',
  ...EMAIL_INTELLIGENCE_CATEGORIES.map((c) => `prior_thread_had_${c}`),
];

export function extractEmailRepresentation(input: EmailFeatureInput): NormalizedEmailRepresentation {
  const rawSubject = (input.subject || '').trim();
  const hasMissingSubject = rawSubject.length === 0 || /^\(no\s+subject\)$/i.test(rawSubject);
  const isReplySubject = /^re\s*:/i.test(rawSubject);
  const isForwardSubject = /^(?:fw|fwd)\s*:/i.test(rawSubject);
  const cleanSubject = rawSubject.replace(/^(?:(?:re|fw|fwd)\s*:\s*)+/i, '').trim();

  const rawBody = input.rawBody || '';
  const hasMalformedEncoding = /\uFFFD{2,}|=\?[A-Za-z0-9_-]+\?[QB]\?|(?:%[0-9A-F]{2}){6,}/.test(
    `${rawSubject}\n${rawBody}`
  );

  const decoded = decodeHtmlToStructuredText(rawBody);
  const isHtmlOnlySource = Boolean(input.isHtmlOnly || decoded.detectedHtmlTags);
  const combinedPlainText = decoded.text.trim();

  const { freshBody, quotedOrForwarded } = splitFreshAndQuotedEmailBody(combinedPlainText);
  const effectiveFresh = freshBody || quotedOrForwarded;

  const isEmptyBody = combinedPlainText.replace(/\s+/g, '').length === 0;
  const isVeryShortBody = !isEmptyBody && combinedPlainText.replace(/\s+/g, ' ').length < 24;

  const sender = parseAddressHeader(input.fromRaw || '');
  const replyTo = input.replyToRaw ? parseAddressHeader(input.replyToRaw) : null;
  const authRaw = (input.authHeadersRaw || '').toLowerCase();

  const fullText = `${rawSubject}\n${combinedPlainText}`;
  const attNames = input.attachmentFilenames || [];
  const priorCats = input.priorThreadCategories || [];

  const isFreeWebmailDomain = FREE_WEBMAIL_DOMAINS.has(sender.domain);
  const isAssessmentPlatformSenderOrLink =
    ASSESSMENT_PLATFORM_PATTERNS.test(fullText) || ASSESSMENT_PLATFORM_PATTERNS.test(sender.domain);
  const isSchedulingOrMeetingLinkPresent = SCHEDULING_OR_INTERVIEW_LINK_PATTERNS.test(fullText);
  const isAtsOrCareersPortalLinkPresent = ATS_PORTAL_PATTERNS.test(fullText) || ATS_PORTAL_PATTERNS.test(sender.domain);
  const isEduOrPlacementDomain =
    /\.(?:edu|ac\.in|edu\.in)$/i.test(sender.domain) || /\b(?:tpo|placement|training\s+and\s+placement)\b/i.test(sender.displayName);

  const hasBulkOrUnsubscribeSignal =
    Boolean(input.listUnsubscribeHeader && input.listUnsubscribeHeader.trim()) ||
    /^(?:noreply|no-reply|alerts|newsletter|digest|jobalerts|notifications)@/i.test(sender.email) &&
      BULK_NEWSLETTER_PATTERNS.test(fullText) ||
    BULK_NEWSLETTER_PATTERNS.test(fullText);

  const hasAuthFailureSignal = /\b(?:spf=fail|spf=softfail|dkim=fail|dmarc=fail)\b/.test(authRaw);
  const hasReplyMismatch =
    Boolean(replyTo?.domain && sender.domain !== 'unknown' && replyTo.domain !== sender.domain && FREE_WEBMAIL_DOMAINS.has(replyTo.domain));
  const hasDisplayBrandSpoof =
    isFreeWebmailDomain &&
    /\b(infosys|tcs|tata\s+consultancy|wipro|accenture|google|microsoft|amazon|deloitte|flipkart|cognizant|capgemini|ibm|oracle)\b/i.test(
      `${sender.displayName} ${rawSubject}`
    );
  const hasLookalikeOrReplyMismatchSignal =
    LOOKALIKE_BRAND_PATTERNS.test(`${sender.domain} ${fullText}`) || hasReplyMismatch || hasDisplayBrandSpoof;

  const hasFeeOrScamDemandSignal = FEE_OR_SCAM_PATTERNS.test(fullText);

  const hasPdfOrDocxAttachment = attNames.some((f) => /\.(?:pdf|docx|doc)$/i.test(f));
  const hasJdAttachmentFilename = attNames.some((f) => /\b(?:jd|job[_\s-]?desc|role|eligibility|corrigendum|opening)\b/i.test(f));
  const hasOfferAttachmentFilename = attNames.some((f) => /\b(?:offer[_\s-]?letter|loi|letter[_\s-]?of[_\s-]?intent|internship[_\s-]?offer)\b/i.test(f));
  const hasAssignmentAttachmentFilename = attNames.some((f) => /\b(?:assignment|problem[_\s-]?statement|take[_\s-]?home|challenge|task)\b/i.test(f));

  const hasInternalAcademicOrAdminContext = INTERNAL_ADMIN_CONFUSER_PATTERNS.test(fullText);
  const hasUnusualCohortOrResidencyHiringCue = UNUSUAL_HIRING_COHORT_PATTERNS.test(fullText);

  // Build rich multi-zone lexical tokens (subject, fresh body, quoted/forwarded body, attachment names, domain category)
  const tokens: string[] = [
    ...tokenizeSegment(cleanSubject, 'subj:', true),
    ...tokenizeSegment(effectiveFresh.slice(0, 3500), 'body:', true),
    ...tokenizeSegment(quotedOrForwarded.slice(0, 1500), 'quote:', false),
    ...tokenizeSegment(attNames.join(' '), 'att:', false),
  ];

  if (isFreeWebmailDomain) tokens.push('meta:free_webmail');
  if (isAssessmentPlatformSenderOrLink) tokens.push('meta:assessment_platform');
  if (isSchedulingOrMeetingLinkPresent) tokens.push('meta:meeting_or_calendar_link');
  if (isAtsOrCareersPortalLinkPresent) tokens.push('meta:ats_portal');
  if (isEduOrPlacementDomain) tokens.push('meta:edu_domain');
  if (hasBulkOrUnsubscribeSignal) tokens.push('meta:bulk_unsubscribe');
  if (hasAuthFailureSignal) tokens.push('meta:auth_fail');
  if (hasLookalikeOrReplyMismatchSignal) tokens.push('meta:lookalike_or_spoof');
  if (hasFeeOrScamDemandSignal) tokens.push('meta:fee_scam');
  if (isEmptyBody) tokens.push('meta:empty_body');
  if (isVeryShortBody) tokens.push('meta:very_short_body');
  if (priorCats.length > 0) {
    tokens.push('meta:in_existing_thread');
    tokens.push(`meta:thread_last_${priorCats[priorCats.length - 1]}`);
  }

  const priorSet = new Set(priorCats);
  const denseFeatures: number[] = [
    isEmptyBody ? 1 : 0,
    isVeryShortBody ? 1 : 0,
    hasMissingSubject ? 1 : 0,
    isHtmlOnlySource ? 1 : 0,
    hasMalformedEncoding ? 1 : 0,
    Math.log1p(cleanSubject.length),
    Math.log1p(effectiveFresh.length),
    Math.log1p(quotedOrForwarded.length),
    isReplySubject ? 1 : 0,
    isForwardSubject ? 1 : 0,
    input.inReplyTo ? 1 : 0,
    priorCats.length > 0 ? 1 : 0,
    Math.min(priorCats.length, 5),
    isFreeWebmailDomain ? 1 : 0,
    isAssessmentPlatformSenderOrLink ? 1 : 0,
    isSchedulingOrMeetingLinkPresent ? 1 : 0,
    isAtsOrCareersPortalLinkPresent ? 1 : 0,
    isEduOrPlacementDomain ? 1 : 0,
    hasBulkOrUnsubscribeSignal ? 1 : 0,
    hasAuthFailureSignal ? 1 : 0,
    hasLookalikeOrReplyMismatchSignal ? 1 : 0,
    hasFeeOrScamDemandSignal ? 1 : 0,
    hasPdfOrDocxAttachment ? 1 : 0,
    hasJdAttachmentFilename ? 1 : 0,
    hasOfferAttachmentFilename ? 1 : 0,
    hasAssignmentAttachmentFilename ? 1 : 0,
    hasInternalAcademicOrAdminContext ? 1 : 0,
    hasUnusualCohortOrResidencyHiringCue ? 1 : 0,
    ...EMAIL_INTELLIGENCE_CATEGORIES.map((c) => (priorSet.has(c) ? 1 : 0)),
  ];

  return {
    cleanSubject,
    freshBodyText: freshBody,
    quotedOrForwardedText: quotedOrForwarded,
    combinedPlainText,
    senderEmail: sender.email,
    senderDomain: sender.domain,
    senderDisplayName: sender.displayName,
    missingAndQualityIndicators: {
      isEmptyBody,
      isVeryShortBody,
      hasMissingSubject,
      isHtmlOnlySource,
      hasMalformedEncoding,
    },
    structuralSignals: {
      isReplySubject,
      isForwardSubject,
      hasInReplyToHeader: Boolean(input.inReplyTo),
      hasPriorThread: priorCats.length > 0,
      priorThreadDepth: priorCats.length,
      isFreeWebmailDomain,
      isAssessmentPlatformSenderOrLink,
      isSchedulingOrMeetingLinkPresent,
      isAtsOrCareersPortalLinkPresent,
      isEduOrPlacementDomain,
      hasBulkOrUnsubscribeSignal,
      hasAuthFailureSignal,
      hasLookalikeOrReplyMismatchSignal,
      hasFeeOrScamDemandSignal,
      hasPdfOrDocxAttachment,
      hasJdAttachmentFilename,
      hasOfferAttachmentFilename,
      hasAssignmentAttachmentFilename,
      hasInternalAcademicOrAdminContext,
      hasUnusualCohortOrResidencyHiringCue,
    },
    tokens,
    denseFeatures,
  };
}

/**
 * Privacy-preserving PII minimization for stored user corrections (`training_feedback_examples`).
 * Strips phone numbers, personal roll numbers, and email local-parts while retaining domain & recruitment semantics.
 */
export function redactPersonalInfoForFeedback(text: string): string {
  return (text || '')
    .replace(/\b(?:\+?91[-\s]?)?[6-9]\d{9}\b/g, '[REDACTED_PHONE]')
    .replace(/\b([a-zA-Z0-9._%+-]+)@([a-zA-Z0-9.-]+\.[a-zA-Z]{2,})\b/g, (_m, _local: string, dom: string) => `[REDACTED_USER]@${dom.toLowerCase()}`)
    .replace(/\b\d{2}[A-Z]{2,4}\d{3,6}\b/g, '[REDACTED_ROLL_NO]')
    .slice(0, 4000);
}

