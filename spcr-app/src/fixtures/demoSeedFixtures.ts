import { Database } from '../db/database.js';
import { buildValidDocxBuffer, buildValidTextPdfBuffer } from '../utils/documentFixtures.js';
import { RoutingAndDispatchService } from '../services/routingAndDispatchService.js';
import { ScreeningAndMatchingService } from '../services/screeningAndMatchingService.js';
import { randomId } from '../utils/crypto.js';

export async function seedSyntheticDemoWorkspace(params: {
  db: Database;
  actorEmail: string;
  routingService: RoutingAndDispatchService;
  screener: ScreeningAndMatchingService;
}) {
  const { db, actorEmail, routingService, screener } = params;

  // Check if demo sections already exist so seeding is idempotent
  const existingSec = await db.query<{ cnt: string }>('SELECT COUNT(*)::text AS cnt FROM sections');
  let seededSectionsCount = 0;

  if (Number.parseInt(existingSec.rows[0]?.cnt || '0', 10) === 0) {
    const cseSec = await routingService.createSection(actorEmail, {
      name: 'B.Tech CSE & IT — 2027 Batch',
      description: 'Final-year Computer Science and Information Technology sections',
      sortOrder: 1,
      eligibilityTags: ['cse', 'it', '2027'],
    });
    const circuitSec = await routingService.createSection(actorEmail, {
      name: 'B.Tech Circuit Branches (ECE/EEE) — 2027',
      description: 'Electronics, Communication, and Electrical 2027 sections',
      sortOrder: 2,
      eligibilityTags: ['ece', 'eee', 'robotics', '2027'],
    });
    const allEngSec = await routingService.createSection(actorEmail, {
      name: 'All B.Tech Final Year Announcements',
      description: 'Cross-branch placement notices',
      sortOrder: 3,
      eligibilityTags: ['b.tech', 'all branches', '2027'],
    });
    seededSectionsCount = 3;

    // Register manual WhatsApp groups (note overlapping section memberships + one similar-named pair for warning verification)
    await routingService.registerGroup(actorEmail, {
      visibleName: 'TPO CSE-A & CSE-B 2027 Official',
      aliasOrNotes: 'Verified with Class Representatives on 15 Oct 2026 (142 students)',
      verifiedNow: true,
      sectionIds: [cseSec!.id, allEngSec!.id],
    });
    await routingService.registerGroup(actorEmail, {
      visibleName: 'TPO IT 2027 Official Announcements',
      aliasOrNotes: 'IT Final Year Notice Group (68 students)',
      verifiedNow: true,
      sectionIds: [cseSec!.id, allEngSec!.id],
    });
    await routingService.registerGroup(actorEmail, {
      visibleName: 'TPO ECE & Robotics 2027 Official',
      aliasOrNotes: 'ECE + Robotics Final Year (118 students)',
      verifiedNow: true,
      sectionIds: [circuitSec!.id, allEngSec!.id],
    });
    // Similar-named group entry to demonstrate non-merging duplicate warning
    await routingService.registerGroup(actorEmail, {
      visibleName: 'TPO IT 2027 Announcements Backup',
      aliasOrNotes: 'Secondary coordinator group — verify before selecting both',
      verifiedNow: false,
      sectionIds: [],
    });

    // Add an informational owner sender note
    await db.query(
      `INSERT INTO sender_notes (id, domain_or_email, category, note)
       VALUES ($1, 'northstar-health.in', 'known_company', 'Visited campus in 2025; HR coordinator Ritu Sharma')
       ON CONFLICT DO NOTHING`,
      [randomId('sn')]
    );
  }

  // Seed synthetic emails showcasing:
  // 1) Unknown legitimate company + valid PDF JD (Kestrel Robotics)
  // 2) Two-email sequence: Details email + follow-up DOCX JD with conflicting CGPA (VeridianGrid)
  // 3) Suspicious free-webmail corporate impersonation + fee request (flagged in Needs Review, never auto-formatted)
  // 4) Unrelated campus library mail (screened locally with zero Groq calls, body discarded)
  const kestrelPdf = buildValidTextPdfBuffer([
    [
      'Company: Kestrel Robotics Pvt. Ltd.',
      'Role: Junior Robotics Engineer',
      'Opportunity Type: Full-Time',
      'Location: Pune (Hybrid)',
      'CTC: 9.5 LPA',
      'Eligible Branches: B.Tech CSE, IT, ECE, Robotics (2027 Batch)',
      'Minimum CGPA: 7.0',
      'Backlogs: Zero active backlogs allowed',
      'Application Deadline: 14 November 2026, 5:00 PM IST',
      'Apply Here: https://careers.kestrelrobotics.in/campus-2027',
    ],
  ]);

  const veridianDocx = buildValidDocxBuffer([
    'Company: VeridianGrid Analytics',
    'Role: Data Engineering Intern',
    'Location: Bengaluru (Hybrid)',
    'Stipend: INR 35,000 per month with 11 LPA PPO',
    'Minimum CGPA: 8.0', // Intentional conflict with email body's 7.5 so officer sees conflict banner!
    'Backlogs: 0 active backlogs',
    'Deadline: 19 November 2026',
    'Apply Link: https://veridiangrid-analytics.com/internships',
  ]);

  const scan1 = await screener.scanEmailMessage(
    {
      gmailMessageId: 'demo-msg-kestrel-001',
      gmailThreadId: 'demo-thread-kestrel',
      rfcMessageId: '<kestrel-001@kestrelrobotics.in>',
      fromRaw: '"Ananya Rao - Talent Acquisition" <ananya.rao@kestrelrobotics.in>',
      authHeadersRaw: 'mx.google.com; spf=pass; dkim=pass; dmarc=pass',
      subject: 'Campus Recruitment Drive 2027 — Kestrel Robotics Pvt. Ltd. (Junior Robotics Engineer)',
      receivedAt: '2026-10-29T09:15:00Z',
      bodyText:
        'Dear Training & Placement Officer,\nKestrel Robotics Pvt. Ltd. invites applications from your 2027 graduating B.Tech CSE, IT, ECE, and Robotics batch for the Full-Time role of Junior Robotics Engineer.\nCTC: 9.5 LPA | Location: Pune (Hybrid)\nMinimum CGPA: 7.0 | Zero active backlogs.\nApplication deadline: 14 November 2026, 5:00 PM IST.\nApply link: https://careers.kestrelrobotics.in/campus-2027\nContact: ananya.rao@kestrelrobotics.in',
      attachments: [
        {
          filename: 'Kestrel_Robotics_JD_2027.pdf',
          declaredMime: 'application/pdf',
          buffer: kestrelPdf,
        },
      ],
      sourceOrigin: 'synthetic_fixture',
    },
    'auto_monitor',
    actorEmail
  );

  const scan2a = await screener.scanEmailMessage(
    {
      gmailMessageId: 'demo-msg-veridian-001',
      gmailThreadId: 'demo-thread-veridian',
      rfcMessageId: '<veridian-001@veridiangrid-analytics.com>',
      fromRaw: '"Vikram Menon" <hr@veridiangrid-analytics.com>',
      authHeadersRaw: '', // Demonstrates honest 'Authentication signal unavailable'
      subject: 'Summer Internship + PPO Opportunity — Data Engineering Intern | VeridianGrid Analytics',
      receivedAt: '2026-10-29T10:00:00Z',
      bodyText:
        'Dear Placement Officer,\nVeridianGrid Analytics is hiring Data Engineering Interns from 2027 batch B.Tech CSE and IT.\nStipend: INR 35,000 per month | Minimum CGPA: 7.5 | Zero active backlogs.\nDeadline: 16 November 2026.\nApply at https://veridiangrid-analytics.com/internships\nDetailed JD follows in our next email.',
      attachments: [],
      sourceOrigin: 'synthetic_fixture',
    },
    'auto_monitor',
    actorEmail
  );

  const scan2b = await screener.scanEmailMessage(
    {
      gmailMessageId: 'demo-msg-veridian-002',
      gmailThreadId: 'demo-thread-veridian',
      rfcMessageId: '<veridian-002@veridiangrid-analytics.com>',
      inReplyTo: '<veridian-001@veridiangrid-analytics.com>',
      fromRaw: '"Vikram Menon" <hr@veridiangrid-analytics.com>',
      authHeadersRaw: 'mx.google.com; spf=pass; dkim=pass; dmarc=pass',
      subject: 'Re: Summer Internship + PPO Opportunity — Data Engineering Intern | Attached JD',
      receivedAt: '2026-10-29T10:25:00Z',
      bodyText:
        'Dear Sir,\nFollowing up on our previous mail, please find attached the DOCX Job Description for Data Engineering Intern (note updated deadline 19 November 2026).',
      attachments: [
        {
          filename: 'VeridianGrid_DataEng_Intern_JD.docx',
          declaredMime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          buffer: veridianDocx,
        },
      ],
      sourceOrigin: 'synthetic_fixture',
    },
    'auto_monitor',
    actorEmail
  );

  const scan3 = await screener.scanEmailMessage(
    {
      gmailMessageId: 'demo-msg-suspicious-001',
      gmailThreadId: 'demo-thread-suspicious',
      fromRaw: '"Infosys Campus Drive Team" <infosys.direct.offer2027@gmail.com>',
      authHeadersRaw: 'mx.google.com; spf=pass; dkim=pass',
      subject: 'Urgent Infosys Direct Offer Drive — Rs 1200 Registration Fee Required',
      receivedAt: '2026-10-29T11:05:00Z',
      bodyText:
        'Dear TPO, Direct offer letters at 8 LPA for 2027 batch without technical interview. Students must pay Rs 1200 refundable registration fee before tonight at http://198.51.100.77/register.',
      attachments: [],
      sourceOrigin: 'synthetic_fixture',
    },
    'auto_monitor',
    actorEmail
  );

  const scan4 = await screener.scanEmailMessage(
    {
      gmailMessageId: 'demo-msg-unrelated-001',
      gmailThreadId: 'demo-thread-library',
      fromRaw: '"Central Library" <library@college.example.edu>',
      authHeadersRaw: 'mx.google.com; spf=pass; dkim=pass; dmarc=pass',
      subject: 'Library Overdue Notice — Return Reference Books by Friday',
      receivedAt: '2026-10-29T11:30:00Z',
      bodyText: 'Reminder to return two reference books issued on your faculty card before Friday.',
      attachments: [],
      sourceOrigin: 'synthetic_fixture',
    },
    'auto_monitor',
    actorEmail
  );

  return {
    seededSectionsCount,
    scannedMessages: [scan1, scan2a, scan2b, scan3, scan4],
    totalGroqCallsMade: 0,
  };
}

