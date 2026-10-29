import { QueryExecutor } from '../db/database.js';

export type TransportAuthStatus = 'passed' | 'failed' | 'partial' | 'unavailable';

export type HonestAuthenticityLabel =
  | 'Known sender note (authentication signals passed; company legitimacy not independently established)'
  | 'Known sender note (authentication signal unavailable)'
  | 'Authentication signals passed; company legitimacy not independently established'
  | 'Authentication signal unavailable'
  | 'Needs review'
  | 'Suspicious indicator found';

export interface AuthenticityAssessment {
  fromEmail: string;
  fromDomain: string;
  fromDisplayName: string;
  replyToEmail: string | null;
  replyToDomain: string | null;
  transportAuthStatus: TransportAuthStatus;
  spfResult: string;
  dkimResult: string;
  dmarcResult: string;
  knownSenderNote: { category: string; note: string } | null;
  riskFlags: string[];
  signals: string[];
  label: HonestAuthenticityLabel;
  isSuspicious: boolean;
}

export type SenderAuthenticityAssessment = AuthenticityAssessment;

const FREE_WEBMAIL_DOMAINS = new Set([
  'gmail.com',
  'googlemail.com',
  'yahoo.com',
  'yahoo.co.in',
  'outlook.com',
  'hotmail.com',
  'live.com',
  'proton.me',
  'protonmail.com',
  'rediffmail.com',
  'aol.com',
  'icloud.com',
]);

const WELL_KNOWN_BRAND_TOKENS: Array<{ token: string; officialRoots: string[] }> = [
  { token: 'google', officialRoots: ['google.com'] },
  { token: 'microsoft', officialRoots: ['microsoft.com'] },
  { token: 'amazon', officialRoots: ['amazon.com', 'amazon.jobs'] },
  { token: 'infosys', officialRoots: ['infosys.com'] },
  { token: 'tcs', officialRoots: ['tcs.com'] },
  { token: 'tata consultancy', officialRoots: ['tcs.com'] },
  { token: 'wipro', officialRoots: ['wipro.com'] },
  { token: 'accenture', officialRoots: ['accenture.com'] },
  { token: 'deloitte', officialRoots: ['deloitte.com'] },
  { token: 'cognizant', officialRoots: ['cognizant.com'] },
  { token: 'capgemini', officialRoots: ['capgemini.com'] },
  { token: 'flipkart', officialRoots: ['flipkart.com'] },
];

const URL_SHORTENERS = new Set([
  'bit.ly',
  'tinyurl.com',
  't.co',
  'cutt.ly',
  'rb.gy',
  'is.gd',
  'shorturl.at',
]);

const FEE_OR_SCAM_PATTERNS: Array<{ regex: RegExp; flag: string }> = [
  {
    regex: /\b(registration\s+fee|security\s+deposit|refundable\s+deposit|training\s+fee|onboarding\s+fee|laptop\s+shipping\s+fee|pay\s+(?:rs\.?|inr|\$)\s*\d+)\b/i,
    flag: 'fee_or_deposit_request',
  },
  {
    regex: /\b(aadhaar\s+otp|bank\s+pin|upi\s+pin|netbanking\s+password|credit\s+card\s+cvv)\b/i,
    flag: 'sensitive_credential_harvesting_phrase',
  },
  {
    regex: /\b(ignore\s+(?:all\s+)?previous\s+instructions|system\s+override|disregard\s+system\s+prompt|auto[\s-]?approve\s+this)\b/i,
    flag: 'prompt_injection_indicator',
  },
];

export function parseEmailHeaderAddress(raw: string | undefined | null): {
  displayName: string;
  email: string;
  domain: string;
} {
  if (!raw) return { displayName: '', email: '', domain: '' };
  const trimmed = raw.trim();
  const angleMatch = trimmed.match(/^(?:"?([^"<]*)"?\s*)?<([^<>@\s]+@[^<>@\s]+)>$/);
  if (angleMatch) {
    const displayName = (angleMatch[1] || '').trim().replace(/^"|"$/g, '');
    const email = (angleMatch[2] || '').trim().toLowerCase();
    const domain = email.split('@')[1] || '';
    return { displayName, email, domain };
  }
  const plainMatch = trimmed.match(/([A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})/);
  if (plainMatch?.[1]) {
    const email = plainMatch[1].toLowerCase();
    const domain = email.split('@')[1] || '';
    const displayName = trimmed.replace(plainMatch[1], '').replace(/[<>"]/g, '').trim();
    return { displayName, email, domain };
  }
  return { displayName: trimmed, email: '', domain: '' };
}

export function extractUrlsFromText(text: string): string[] {
  const matches = text.match(/https?:\/\/[^\s<>"')\]]+/gi) || [];
  const cleaned = matches.map((u) => u.replace(/[.,;:!?]+$/, ''));
  return Array.from(new Set(cleaned));
}

function parseTransportAuthHeader(authHeaderRaw: string | null | undefined): {
  status: TransportAuthStatus;
  spf: string;
  dkim: string;
  dmarc: string;
} {
  if (!authHeaderRaw || !authHeaderRaw.trim()) {
    return { status: 'unavailable', spf: 'unavailable', dkim: 'unavailable', dmarc: 'unavailable' };
  }
  const spfMatch = authHeaderRaw.match(/\bspf=([a-z0-9_-]+)/i);
  const dkimMatch = authHeaderRaw.match(/\bdkim=([a-z0-9_-]+)/i);
  const dmarcMatch = authHeaderRaw.match(/\bdmarc=([a-z0-9_-]+)/i);

  const spf = spfMatch?.[1]?.toLowerCase() || 'unavailable';
  const dkim = dkimMatch?.[1]?.toLowerCase() || 'unavailable';
  const dmarc = dmarcMatch?.[1]?.toLowerCase() || 'unavailable';

  if (spf === 'unavailable' && dkim === 'unavailable' && dmarc === 'unavailable') {
    return { status: 'unavailable', spf, dkim, dmarc };
  }

  const values = [spf, dkim, dmarc];
  if (values.some((v) => v === 'fail' || v === 'hardfail' || v === 'permerror' || v === 'quarantine' || v === 'reject')) {
    return { status: 'failed', spf, dkim, dmarc };
  }
  if ((spf === 'pass' && dkim === 'pass') || dmarc === 'pass') {
    return { status: 'passed', spf, dkim, dmarc };
  }
  return { status: 'partial', spf, dkim, dmarc };
}

function hasDigitLetterTyposquat(domain: string): boolean {
  const labels = domain.toLowerCase().split('.');
  const mainLabel = labels[0] || '';
  // Lookalike substitutions such as g00gle, am4zon, micr0soft, inf0sys, paypa1
  return /[a-z]+[01345][a-z]+/.test(mainLabel) && !/^(b2b|web3|ai21|c3|f5|m365|o2|s3)$/.test(mainLabel);
}

/**
 * Evaluates sender authenticity and risk signals independently from placement relevance.
 * NEVER fetches external URLs (zero SSRF) and NEVER outputs a false "Company verified" badge.
 */
export async function assessSenderAuthenticity(
  db: QueryExecutor | null,
  input: {
    fromRaw: string;
    replyToRaw?: string | null;
    authHeadersRaw?: string | null;
    subject: string;
    bodyOrSnippet: string;
    urls?: string[];
  }
): Promise<AuthenticityAssessment> {
  const parsedFrom = parseEmailHeaderAddress(input.fromRaw);
  const parsedReplyTo = input.replyToRaw ? parseEmailHeaderAddress(input.replyToRaw) : null;
  const auth = parseTransportAuthHeader(input.authHeadersRaw);

  const riskFlags: string[] = [];
  const signals: string[] = [];

  if (auth.status === 'unavailable') {
    signals.push('Transport authentication headers (SPF/DKIM/DMARC) unavailable in message metadata.');
  } else {
    signals.push(`Header auth results — SPF: ${auth.spf}, DKIM: ${auth.dkim}, DMARC: ${auth.dmarc}`);
  }

  if (auth.status === 'failed') {
    riskFlags.push('transport_auth_failed');
  }

  const fromDomain = parsedFrom.domain;
  const replyToDomain = parsedReplyTo?.domain || null;

  if (!fromDomain) {
    riskFlags.push('missing_or_malformed_from_domain');
  }

  // Reply-To mismatch check
  if (replyToDomain && fromDomain && replyToDomain !== fromDomain) {
    riskFlags.push(`reply_to_domain_mismatch:${replyToDomain}`);
    signals.push(`Reply-To domain (${replyToDomain}) differs from From domain (${fromDomain}).`);
  }

  // Punycode / IDN homograph check
  if (fromDomain.includes('xn--') || (replyToDomain && replyToDomain.includes('xn--'))) {
    riskFlags.push('punycode_idn_lookalike_domain');
    signals.push('Sender domain uses Punycode (xn--), a common homograph spoofing vector.');
  }

  // Digit-for-letter lookalike check
  if (fromDomain && hasDigitLetterTyposquat(fromDomain)) {
    riskFlags.push('digit_substitution_lookalike_domain');
    signals.push(`Sender domain (${fromDomain}) contains digit-inside-word substitution pattern.`);
  }

  // Suspicious high-abuse TLD + brand hyphenation check
  const combinedHeaderAndSubject = `${parsedFrom.displayName} ${input.subject}`.toLowerCase();
  for (const brand of WELL_KNOWN_BRAND_TOKENS) {
    if (combinedHeaderAndSubject.includes(brand.token)) {
      const matchesOfficial = brand.officialRoots.some(
        (root) => fromDomain === root || fromDomain.endsWith(`.${root}`)
      );
      if (!matchesOfficial) {
        if (FREE_WEBMAIL_DOMAINS.has(fromDomain)) {
          riskFlags.push(`brand_impersonation_on_free_webmail:${brand.token}`);
          signals.push(
            `Display name/subject mentions "${brand.token}" while sending from free webmail (${fromDomain}).`
          );
        } else if (fromDomain.includes(brand.token.replace(/\s+/g, ''))) {
          riskFlags.push(`lookalike_brand_domain:${fromDomain}`);
          signals.push(`Domain (${fromDomain}) contains brand token "${brand.token}" outside official domain.`);
        }
      }
    }
  }

  if (FREE_WEBMAIL_DOMAINS.has(fromDomain)) {
    signals.push(`Sent from consumer webmail provider (${fromDomain}); verify recruiter identity manually.`);
  }

  // Inspect URLs purely as strings (NEVER fetch!)
  const urls = input.urls || extractUrlsFromText(input.bodyOrSnippet);
  for (const rawUrl of urls) {
    try {
      const parsed = new URL(rawUrl);
      const host = parsed.hostname.toLowerCase();
      if (parsed.protocol === 'http:') {
        riskFlags.push('insecure_http_link');
      }
      if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) {
        riskFlags.push('raw_ip_address_url');
      }
      if (URL_SHORTENERS.has(host)) {
        riskFlags.push(`shortened_url:${host}`);
      }
      if (host.includes('xn--') || hasDigitLetterTyposquat(host)) {
        riskFlags.push(`suspicious_link_domain:${host}`);
      }
    } catch {
      riskFlags.push('malformed_url_in_body');
    }
  }

  // Fee / deposit / prompt injection scam scan
  const fullInspectText = `${input.subject}\n${input.bodyOrSnippet}`;
  for (const pat of FEE_OR_SCAM_PATTERNS) {
    if (pat.regex.test(fullInspectText)) {
      riskFlags.push(pat.flag);
      signals.push(`Detected high-risk content pattern: ${pat.flag}`);
    }
  }

  // Check owner-maintained sender notes (informational; not a blind allowlist)
  let knownSenderNote: { category: string; note: string } | null = null;
  if (db && (parsedFrom.email || fromDomain)) {
    const noteRes = await db.query<{ category: string; note: string }>(
      `SELECT category, note FROM sender_notes
       WHERE LOWER(domain_or_email) = $1 OR LOWER(domain_or_email) = $2
       LIMIT 1`,
      [parsedFrom.email.toLowerCase(), fromDomain.toLowerCase()]
    );
    if (noteRes.rows[0]) {
      knownSenderNote = noteRes.rows[0];
      signals.push(`Owner sender note (${knownSenderNote.category}): ${knownSenderNote.note}`);
      if (knownSenderNote.category === 'caution') {
        riskFlags.push('owner_caution_sender_note');
      }
    }
  }

  const highSeverityFlags = riskFlags.filter(
    (f) =>
      f !== 'insecure_http_link' &&
      !f.startsWith('shortened_url:')
  );
  const isSuspicious = highSeverityFlags.length > 0;

  let label: HonestAuthenticityLabel;
  if (isSuspicious) {
    label = 'Suspicious indicator found';
  } else if (riskFlags.length > 0 || FREE_WEBMAIL_DOMAINS.has(fromDomain)) {
    label = 'Needs review';
  } else if (knownSenderNote) {
    label =
      auth.status === 'passed'
        ? 'Known sender note (authentication signals passed; company legitimacy not independently established)'
        : 'Known sender note (authentication signal unavailable)';
  } else if (auth.status === 'passed') {
    label = 'Authentication signals passed; company legitimacy not independently established';
  } else if (auth.status === 'partial') {
    label = 'Needs review';
  } else {
    label = 'Authentication signal unavailable';
  }

  return {
    fromEmail: parsedFrom.email,
    fromDomain,
    fromDisplayName: parsedFrom.displayName,
    replyToEmail: parsedReplyTo?.email || null,
    replyToDomain,
    transportAuthStatus: auth.status,
    spfResult: auth.spf,
    dkimResult: auth.dkim,
    dmarcResult: auth.dmarc,
    knownSenderNote,
    riskFlags,
    signals,
    label,
    isSuspicious,
  };
}

