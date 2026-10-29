import { LabeledEmailExample } from './schema.js';

/**
 * Curated, privacy-safe anonymized recruitment email corpus (Part 1: Categories 1–7 + Multi-Message Threads).
 * Modeled on realistic Indian college TPO / recruiter / ATS / assessment platform correspondence.
 * NOTE: Strictly labeled as `curated_anonymized_corpus` (never misrepresented as live private mailbox dumps).
 */
export function buildCuratedCorpusPart1(): LabeledEmailExample[] {
  const examples: LabeledEmailExample[] = [
    // =========================================================================
    // MULTI-MESSAGE THREADS (Grouped by threadId + senderOrgGroup so entire thread stays in one split)
    // =========================================================================
    {
      id: 'cur-th01-m1',
      threadId: 'th-aurora-semicon-2027',
      senderOrgGroup: 'org-aurora-semicon',
      datasetSource: 'curated_anonymized_corpus',
      fromRaw: 'Meera Krishnan <meera.k@aurorasemicon.com>',
      authHeadersRaw: 'mx.google.com; spf=pass; dkim=pass; dmarc=pass',
      subject: 'Campus Hiring Partnership 2027 — ASIC Verification & RTL Roles (Aurora Semicon)',
      rawBody:
        'Dear Training and Placement Officer,\n\nI lead University Talent at Aurora Semicon in Bengaluru. We would love to invite your 2027 graduating B.Tech/M.Tech ECE & EEE students for our Full-Time RTL Design and Verification intake. Compensation is 18.5 LPA CTC (14L base + stocks). Could you share batch strength and available dates in November?',
      isHtmlOnly: false,
      attachmentFilenames: [],
      priorThreadCategories: [],
      primaryCategory: 'recruiter_outreach',
      multiLabels: ['recruiter_outreach', 'relevant_opportunity'],
      hardCaseTags: ['multi_message_thread', 'standard_recruitment_communication'],
    },
    {
      id: 'cur-th01-m2',
      threadId: 'th-aurora-semicon-2027',
      senderOrgGroup: 'org-aurora-semicon',
      datasetSource: 'curated_anonymized_corpus',
      fromRaw: 'Meera Krishnan <meera.k@aurorasemicon.com>',
      inReplyTo: '<msg1@aurorasemicon.com>',
      authHeadersRaw: 'mx.google.com; spf=pass; dkim=pass; dmarc=pass',
      subject: 'Re: Campus Hiring Partnership 2027 — ASIC Verification & RTL Roles (Aurora Semicon)',
      rawBody:
        'Thanks for confirming the batch strength! PFA the detailed Job Description PDF and revised eligibility criteria (Minimum CGPA 7.5, zero active backlogs). Registration deadline is 18 Nov 2026 via https://careers.aurorasemicon.com/campus-2027.\n\nOn Tue, Nov 3, 2026 TPO wrote:\n> Dear Meera, we have 140 eligible ECE/EEE students.',
      isHtmlOnly: false,
      attachmentFilenames: ['Aurora_Semicon_ASIC_JD_2027.pdf'],
      priorThreadCategories: ['recruiter_outreach'],
      primaryCategory: 'jd_or_details_followup',
      multiLabels: ['jd_or_details_followup', 'relevant_opportunity'],
      hardCaseTags: ['multi_message_thread', 'jd_or_followup_update'],
    },
    {
      id: 'cur-th01-m3',
      threadId: 'th-aurora-semicon-2027',
      senderOrgGroup: 'org-aurora-semicon',
      datasetSource: 'curated_anonymized_corpus',
      fromRaw: 'Meera Krishnan <meera.k@aurorasemicon.com>',
      inReplyTo: '<msg2@aurorasemicon.com>',
      authHeadersRaw: 'mx.google.com; spf=pass; dkim=pass; dmarc=pass',
      subject: 'Re: Campus Hiring Partnership 2027 — Eligibility & 10th/12th Marks Sheet Verification',
      rawBody:
        'Hi Placement Team,\n\nBefore releasing test credentials, please share the verified Excel tracker confirming 10th, 12th, current CGPA, and active backlog count for the 92 registered applicants so we can complete eligibility screening by 5 PM.',
      isHtmlOnly: false,
      attachmentFilenames: ['Eligibility_Verification_Template.xlsx'],
      priorThreadCategories: ['recruiter_outreach', 'jd_or_details_followup'],
      primaryCategory: 'screening_or_eligibility',
      multiLabels: ['screening_or_eligibility'],
      hardCaseTags: ['multi_message_thread'],
    },
    {
      id: 'cur-th01-m4',
      threadId: 'th-aurora-semicon-2027',
      senderOrgGroup: 'org-aurora-semicon',
      datasetSource: 'curated_anonymized_corpus',
      fromRaw: 'Aurora Assessments via HackerRank <noreply@aurorasemicon.com>',
      inReplyTo: '<msg3@aurorasemicon.com>',
      authHeadersRaw: 'mx.google.com; spf=pass; dkim=pass; dmarc=pass',
      subject: 'Online Assessment Link: Aurora Semicon Digital Design Test (21 Nov, 10:00 AM IST)',
      rawBody:
        'Hello Shortlisted Candidates & TPO,\n\nThe 90-minute proctored Verilog & Digital Logic online assessment is scheduled on 21 Nov 2026 at 10:00 AM IST on HackerRank: https://www.hackerrank.com/tests/aurora-rtl-2027. Webcam is mandatory.',
      isHtmlOnly: false,
      attachmentFilenames: [],
      priorThreadCategories: ['recruiter_outreach', 'jd_or_details_followup', 'screening_or_eligibility'],
      primaryCategory: 'online_assessment',
      multiLabels: ['online_assessment'],
      hardCaseTags: ['multi_message_thread', 'third_party_assessment_or_interview_platform'],
    },
    {
      id: 'cur-th01-m5',
      threadId: 'th-aurora-semicon-2027',
      senderOrgGroup: 'org-aurora-semicon',
      datasetSource: 'curated_anonymized_corpus',
      fromRaw: 'Meera Krishnan <meera.k@aurorasemicon.com>',
      inReplyTo: '<msg4@aurorasemicon.com>',
      authHeadersRaw: 'mx.google.com; spf=pass; dkim=pass; dmarc=pass',
      subject: 'Re: Campus Hiring Partnership 2027 — Technical Round 1 Slots Confirmed',
      rawBody:
        'Hi Sir,\n\n18 students cleared the online test! We have scheduled Technical Panel Round 1 for 24 Nov 2026 between 9:30 AM and 4:00 PM IST on Microsoft Teams: https://teams.microsoft.com/l/meetup-join/aurora-r1. Please ask shortlisted candidates to join 10 minutes prior.',
      isHtmlOnly: false,
      attachmentFilenames: ['Shortlist_Round1_Slots.pdf'],
      priorThreadCategories: ['recruiter_outreach', 'jd_or_details_followup', 'online_assessment'],
      primaryCategory: 'interview_invitation',
      multiLabels: ['interview_invitation'],
      hardCaseTags: ['multi_message_thread', 'third_party_assessment_or_interview_platform'],
    },
    {
      id: 'cur-th01-m6',
      threadId: 'th-aurora-semicon-2027',
      senderOrgGroup: 'org-aurora-semicon',
      datasetSource: 'curated_anonymized_corpus',
      fromRaw: 'Meera Krishnan <meera.k@aurorasemicon.com>',
      inReplyTo: '<msg5@aurorasemicon.com>',
      authHeadersRaw: 'mx.google.com; spf=pass; dkim=pass; dmarc=pass',
      subject: 'Re: Campus Hiring Partnership 2027 — Round 1 Feedback & Advancement to Final Managerial Round',
      rawBody:
        'Quick update following today’s panels: 7 candidates have advanced to the Final Managerial + HR discussion tomorrow afternoon. Feedback on the remaining 11 has been shared with the panel coordinator.',
      isHtmlOnly: false,
      attachmentFilenames: [],
      priorThreadCategories: ['recruiter_outreach', 'interview_invitation'],
      primaryCategory: 'interview_followup',
      multiLabels: ['interview_followup'],
      hardCaseTags: ['multi_message_thread'],
    },
    {
      id: 'cur-th01-m7',
      threadId: 'th-aurora-semicon-2027',
      senderOrgGroup: 'org-aurora-semicon',
      datasetSource: 'curated_anonymized_corpus',
      fromRaw: 'Meera Krishnan <meera.k@aurorasemicon.com>',
      inReplyTo: '<msg6@aurorasemicon.com>',
      authHeadersRaw: 'mx.google.com; spf=pass; dkim=pass; dmarc=pass',
      subject: 'Final Selection & Offer Letters — Aurora Semicon 2027 Batch',
      rawBody:
        'Dear TPO,\n\nWe are delighted to extend Full-Time Employment Offers (CTC 18.5 LPA, Bengaluru On-site, joining July 2027) to 4 students from your institute! Provisional Letters of Intent are attached. Please share signed acceptance by 2 Dec 2026.',
      isHtmlOnly: false,
      attachmentFilenames: ['Aurora_Semicon_Offer_LOI_2027.pdf'],
      priorThreadCategories: ['recruiter_outreach', 'interview_invitation', 'interview_followup'],
      primaryCategory: 'offer',
      multiLabels: ['offer'],
      hardCaseTags: ['multi_message_thread', 'offer_or_rejection_stage'],
    },

    // Second multi-turn thread ending in rejection
    {
      id: 'cur-th02-m1',
      threadId: 'th-finbridge-quant-2027',
      senderOrgGroup: 'org-finbridge-analytics',
      datasetSource: 'curated_anonymized_corpus',
      fromRaw: 'Talent Desk <campus@finbridge.co.in>',
      authHeadersRaw: 'mx.google.com; spf=pass; dkim=pass; dmarc=pass',
      subject: 'FinBridge Analytics — Quantitative Risk Intern (6 Months, Mumbai Hybrid)',
      rawBody:
        'Greetings from FinBridge Analytics! We are opening applications for our Jan–Jun 2027 Quantitative Risk Internship (Stipend INR 55,000/month, PPO up to 16 LPA). Open to B.Tech CSE/Maths & Computing with CGPA >= 8.0. Apply before 14 Nov 2026 at https://jobs.lever.co/finbridge/quant-intern.',
      isHtmlOnly: false,
      attachmentFilenames: ['FinBridge_Quant_Intern_JD.pdf'],
      priorThreadCategories: [],
      primaryCategory: 'relevant_opportunity',
      multiLabels: ['relevant_opportunity'],
      hardCaseTags: ['multi_message_thread', 'standard_recruitment_communication'],
    },
    {
      id: 'cur-th02-m2',
      threadId: 'th-finbridge-quant-2027',
      senderOrgGroup: 'org-finbridge-analytics',
      datasetSource: 'curated_anonymized_corpus',
      fromRaw: 'Talent Desk <campus@finbridge.co.in>',
      inReplyTo: '<fb1@finbridge.co.in>',
      authHeadersRaw: 'mx.google.com; spf=pass; dkim=pass; dmarc=pass',
      subject: 'Re: FinBridge Analytics — Outcome of Final Campus Panel',
      rawBody:
        'Dear Placement Coordinator,\n\nThank you for hosting our panel yesterday. After careful deliberation, we regret to inform you that none of the 4 finalists met our stochastic modeling bar for this cycle, so we will not be extending offers this semester. We appreciate the students’ effort.',
      isHtmlOnly: false,
      attachmentFilenames: [],
      priorThreadCategories: ['relevant_opportunity', 'interview_invitation'],
      primaryCategory: 'rejection',
      multiLabels: ['rejection'],
      hardCaseTags: ['multi_message_thread', 'offer_or_rejection_stage'],
    },
  ];

  // =========================================================================
  // 1. relevant_opportunity (24 additional distinct organizations, including unusual wording & HTML-only & forwards)
  // =========================================================================
  const relevantOpportunities: Array<{
    org: string;
    from: string;
    subj: string;
    body: string;
    html?: boolean;
    atts?: string[];
    multi?: ('relevant_opportunity' | 'recruiter_outreach' | 'jd_or_details_followup')[];
    tags: LabeledEmailExample['hardCaseTags'];
  }> = [
    {
      org: 'org-vayunet-systems',
      from: 'Cohorts Team <intake@vayunet.io>',
      subj: 'VayuNet 2027 Kernel & Networking Residency — Nominations Open (Bengaluru)',
      body: 'Hello Placement Office,\n\nVayuNet is assembling its 2027 graduating B.Tech CSE/ECE systems cohort for a 6-month paid engineering residency (INR 50,000 per month stipend) converting to core staff at 19 LPA upon graduation. Minimum CGPA 7.5, zero standing arrears. Submit nominations by 22 Nov 2026 at https://vayunet.io/cohort-2027.',
      tags: ['unusual_wording_no_standard_keywords'],
    },
    {
      org: 'org-prana-biomed',
      from: 'Dr. Kavita Rao <k.rao@pranabiomed.in>',
      subj: '2027 Graduating Batch Fellowship — Signal Processing & Embedded Firmware (Pune)',
      body: 'Dear Professor In-Charge,\n\nPrana BioMed builds portable ICU diagnostics in Pune. We wish to onboard 3 final-year B.E./B.Tech Electronics or Instrumentation scholars starting January 2027. Monthly fellowship: Rs. 35,000 during semester + 12.5 LPA post-graduation conversion. Register before 19 Nov 2026: https://pranabiomed.in/fellowship-2027.',
      tags: ['unusual_wording_no_standard_keywords'],
    },
    {
      org: 'org-kinetix-robotics',
      from: 'Arjun Menon <arjun@kinetixbots.com>',
      subj: 'Autonomous Mobile Robot Fleet Team — 2027 Campus Intake (Chennai On-site)',
      body: 'Hi TPO,\n\nWe build warehouse AMRs in Chennai and are welcoming applications from 2027 passout Mechanical, Mechatronics, and ECE undergraduates for our C++ / ROS2 autonomy track. Package: 11 LPA CTC. Eligibility: 7.0 CGPA. Portal closes 30 Nov 2026: https://careers.kinetixbots.com/amr-2027.',
      tags: ['unusual_wording_no_standard_keywords'],
    },
    {
      org: 'org-dhruva-earth',
      from: 'People Operations <people@dhruvaearth.space>',
      subj: 'Payload Flight Software & Ground Segment Intake — Class of 2027',
      body: 'Dear Placement Cell,\n\nDhruva Earth Observation invites final-year B.Tech Aerospace, ECE, and CS students to join our Hyderabad mission control & flight software team (Full-Time, 14 LPA CTC, On-site). Apply by 25 Nov 2026 via https://dhruvaearth.space/intake27.',
      tags: ['unusual_wording_no_standard_keywords'],
    },
    {
      org: 'org-meridian-cloud',
      from: 'Campus Hiring <campus@meridiancloud.in>',
      subj: 'Campus Recruitment Drive 2027: Software Development Engineer - 1 (CTC 16 LPA)',
      body: 'Dear TPO,\n\nCompany: Meridian Cloud Technologies\nRole: Software Development Engineer - 1\nEmployment Type: Full-Time\nLocation: Hyderabad (Hybrid)\nCTC: 16.0 LPA\nEligible Branches: B.Tech CSE, IT, AI&DS (2027 Batch), CGPA >= 7.5, No active backlogs.\nApplication Deadline: 20 Nov 2026, 11:59 PM IST\nApply Link: https://meridiancloud.darwinbox.in/ms/candidate/careers/sde1',
      atts: ['MeridianCloud_SDE1_JD.pdf'],
      tags: ['standard_recruitment_communication'],
    },
    {
      org: 'org-suryapower-ev',
      from: 'University Relations <ur@suryapowerev.com>',
      subj: 'Graduate Engineer Trainee (Power Electronics & BMS) — 2027 Campus Drive',
      body: 'Dear Sir/Madam,\n\nSuryaPower EV Pvt Ltd is conducting a virtual + on-campus placement drive for 2027 graduating B.E/B.Tech EEE, ECE, and Mechanical students for the role of Graduate Engineer Trainee. CTC: 8.5 LPA at Hosur/Bengaluru plant. Last date to register: 27 Nov 2026. Form: https://suryapowerev.com/get-2027.',
      atts: ['SuryaPower_GET_2027.docx'],
      tags: ['standard_recruitment_communication'],
    },
    {
      org: 'org-veritas-cyber',
      from: 'Security Talent <talent@veritascyber.io>',
      subj: 'Summer Internship 2027 (2028 Batch) — Offensive Security & AppSec Intern',
      body: 'Hello TPO,\n\nVeritas Cyber Labs is hiring 3rd-year B.Tech CSE/Cybersecurity students (2028 batch) for a 2-month Summer Internship (May–July 2027, Remote). Stipend: INR 40,000/month. Top performers receive Pre-Placement Offers. Apply by 5 Dec 2026 at https://jobs.ashbyhq.com/veritascyber/appsec-intern.',
      tags: ['standard_recruitment_communication'],
    },
    {
      org: 'org-navachetana-fintech',
      from: 'HOD CSE <hod.cse@college.ac.in>',
      subj: 'Fwd: Campus Placement Opportunity at NavaChetana FinTech — Backend Go Engineer',
      body: 'Dear TPO, forwarding an opportunity shared by our 2021 alumnus at NavaChetana FinTech.\n\n---------- Forwarded message ---------\nFrom: Siddharth Jain <siddharth@navachetana.in>\nSubject: Hiring 2027 B.Tech CSE/IT for Backend Go Engineer (15 LPA, Bengaluru)\n\nHi Prof. Sharma, our payments team at NavaChetana FinTech is hiring 4 final-year engineers (15 LPA CTC, Hybrid Bengaluru). Apply by 24 Nov 2026: https://careers.navachetana.in/campus.',
      tags: ['standard_recruitment_communication'],
    },
    {
      org: 'org-zenith-retail-ai',
      from: 'Talent Team <careers@zenithretail.ai>',
      subj: 'HTML Notice: Data Science Intern + FTE (2027 Batch) — Zenith Retail AI',
      body: '<html><body><h2>Zenith Retail AI — Campus Drive 2027</h2><table><tr><td><b>Role:</b></td><td>Data Science Intern + PPO</td></tr><tr><td><b>Stipend / CTC:</b></td><td>INR 45,000/month | FTE 14 LPA</td></tr><tr><td><b>Location:</b></td><td>Gurugram (Hybrid)</td></tr><tr><td><b>Deadline:</b></td><td>29 Nov 2026</td></tr></table><p>Submit applications via <a href="https://zenithretail.keka.com/careers/apply/ds27">Zenith Careers Portal</a>.</p></body></html>',
      html: true,
      tags: ['empty_malformed_short_or_html_only', 'standard_recruitment_communication'],
    },
    {
      org: 'org-bharatgrid-infra',
      from: 'HR Campus <hr.campus@bharatgrid.co.in>',
      subj: 'Pool Campus Recruitment: Civil & Structural Design Trainee (7.2 LPA)',
      body: 'Dear Placement Officer,\n\nBharatGrid Infrastructure invites B.Tech Civil Engineering 2027 batch students (minimum 65% throughout, zero backlogs) for Structural Design Engineer Trainee in Mumbai & Ahmedabad (On-site). CTC: 7.2 LPA. Registration closes 28 Nov 2026.',
      atts: ['BharatGrid_Civil_JD.pdf'],
      tags: ['standard_recruitment_communication'],
    },
    {
      org: 'org-pixelcraft-studios',
      from: 'Rohan Kulkarni <rohan.pixelcraft@gmail.com>',
      subj: 'Frontend React/TypeScript Intern (Paid, Remote) for 2027/2028 Students — PixelCraft',
      body: 'Dear Placement Cell,\n\nPixelCraft Interactive is a bootstrapped 16-member product studio in Pune. We are hiring 2 Frontend Product Interns (6 months remote, stipend Rs 25,000/month, zero registration fees of any kind). Portfolio/GitHub link required. Apply by 26 Nov 2026 at https://pixelcraft.studio/internships.',
      tags: ['standard_recruitment_communication'],
    },
    {
      org: 'org-quantumpulse-health',
      from: 'Early Careers <earlycareers@quantumpulse.health>',
      subj: 'Business Analyst & Product Operations Associate — 2027 All Branches Open',
      body: 'Dear TPO,\n\nQuantumPulse Health is recruiting final-year B.Tech (All Branches) and MBA 2027 students for Product Operations & Healthcare Business Analyst in Chennai (Hybrid). Compensation: 9.5 LPA. Apply on Superset by 23 Nov 2026: https://app.joinsuperset.com/company/quantumpulse.',
      tags: ['third_party_assessment_or_interview_platform', 'standard_recruitment_communication'],
    },
    {
      org: 'org-induschem-process',
      from: 'Plant HR <planthr@induschem.in>',
      subj: 'Campus Selection for B.Tech Chemical & Petrochemical 2027 — Process Engineer',
      body: 'Respected Sir,\n\nIndusChem Speciality Ltd (Vadodara) wishes to recruit 6 Process Engineers from the 2027 B.Tech Chemical Engineering batch. Package: 8.0 LPA + subsidized accommodation. Eligibility: CGPA 7.0+. Please share interested student list by 30 Nov 2026.',
      tags: ['standard_recruitment_communication'],
    },
    {
      org: 'org-stratos-aviation',
      from: 'Campus Team <university@stratosdynamics.com>',
      subj: 'CFD & Flight Controls Simulation Intern (Stipend 38k/mo) — Stratos Dynamics',
      body: 'Hello Placement Office,\n\nStratos Dynamics invites M.Tech / B.Tech Mechanical & Aerospace 2027 students for a 6-month Simulation Internship in Bengaluru (On-site). Stipend: INR 38,000/month. Deadline: 1 Dec 2026. Apply: https://stratosdynamics.myworkdayjobs.com/en-US/campus/job/Sim-Intern.',
      tags: ['standard_recruitment_communication'],
    },
    {
      org: 'org-lattice-compilers',
      from: 'Compiler Group <llvm-hiring@latticecompute.ai>',
      subj: '2027 MLIR / GPU Compiler Cohort — Lattice Compute (Remote India, 22 LPA)',
      body: 'Hi Placement Cell,\n\nLattice Compute is selecting final-year CSE undergraduates with strong C++17 and compiler fundamentals for our GPU codegen team (22 LPA base, Remote India). Nominations close 21 Nov 2026 at https://jobs.greenhouse.io/latticecompute/mlir-2027.',
      tags: ['unusual_wording_no_standard_keywords'],
    },
    {
      org: 'org-graminpay-rural',
      from: 'Talent Acquisition <ta@graminpay.org.in>',
      subj: 'Android Kotlin SDE-1 & QA Automation Openings — 2027 Graduating Batch',
      body: 'Dear TPO,\n\nGraminPay Financial Inclusion Tech is hiring 2027 B.Tech CSE/IT/MCA students for Android Engineer (11 LPA) and SDET QA Engineer (9 LPA) in Noida (Hybrid). Minimum 6.5 CGPA. Apply before 25 Nov 2026: https://graminpay.zohorecruit.in/jobs/Careers.',
      atts: ['GraminPay_Campus_2027_JDs.pdf'],
      tags: ['standard_recruitment_communication'],
    },
    {
      org: 'org-aether-photonics',
      from: 'Optics Lab <fellows@aetherphotonics.com>',
      subj: 'Silicon Photonics Test & Characterization Intake — 2027 M.Tech/B.Tech Photonics & ECE',
      body: 'Dear Coordinator,\n\nAether Photonics invites 2027 graduating ECE and Engineering Physics students to join our cleanroom test bench team in IIT Madras Research Park, Chennai. Annual compensation: 13.5 LPA. Last date: 4 Dec 2026.',
      tags: ['unusual_wording_no_standard_keywords'],
    },
    {
      org: 'org-bluewave-maritime',
      from: 'Crewing & Tech HR <campus@bluewavemaritime.sg>',
      subj: 'Fleet IoT & Predictive Maintenance Analyst — 2027 Placement Drive',
      body: 'Greetings,\n\nBlueWave Maritime Analytics (Kochi & Chennai Hybrid) is recruiting 2027 B.Tech EEE/ECE/CSE graduates for our Fleet Telemetry Analytics team. CTC: 10.2 LPA. Apply by 29 Nov 2026: https://bluewavemaritime.com/careers/campus2027.',
      tags: ['standard_recruitment_communication'],
    },
  ];

  relevantOpportunities.forEach((item, idx) => {
    examples.push({
      id: `cur-rel-${idx + 1}`,
      threadId: `th-rel-${idx + 1}`,
      senderOrgGroup: item.org,
      datasetSource: 'curated_anonymized_corpus',
      fromRaw: item.from,
      authHeadersRaw: 'mx.google.com; spf=pass; dkim=pass; dmarc=pass',
      subject: item.subj,
      rawBody: item.body,
      isHtmlOnly: Boolean(item.html),
      attachmentFilenames: item.atts || [],
      priorThreadCategories: [],
      primaryCategory: 'relevant_opportunity',
      multiLabels: item.multi || ['relevant_opportunity'],
      hardCaseTags: item.tags,
    });
  });

  // =========================================================================
  // 2. recruiter_outreach (18 distinct organizations — direct recruiter intro, empanelment, slot request, direct reachout)
  // =========================================================================
  const recruiterOutreaches: Array<{
    org: string;
    from: string;
    subj: string;
    body: string;
    multi: ('recruiter_outreach' | 'relevant_opportunity')[];
    tags: LabeledEmailExample['hardCaseTags'];
  }> = [
    {
      org: 'org-helios-databrics',
      from: 'Neha Kapoor <neha.kapoor@heliosdata.io>',
      subj: 'Connecting for 2027 Campus Placement Season — Helios Data Systems',
      body: 'Dear Placement Officer,\n\nI head Campus Partnerships at Helios Data Systems. We are planning our Tier-1/Tier-2 engineering campus calendar for Dec 2026–Jan 2027 and would like to empanel your institute. Could we schedule a 15-minute intro call this week to understand placement policy, slot timelines, and batch demographics?',
      multi: ['recruiter_outreach'],
      tags: ['standard_recruitment_communication'],
    },
    {
      org: 'org-crestline-bank',
      from: 'Vikramaditya Sen <v.sen@crestlinebank.com>',
      subj: 'University Talent Introduction — Crestline Technology Center Pune',
      body: 'Good afternoon Dr. Nair,\n\nReaching out directly from Crestline Bank’s Technology Center in Pune. We plan to hire ~25 Technology Analysts from select colleges in Q1 2027 (13 LPA band) and wanted to check your Day-1/Day-2 slotting availability before sharing formal requisitions.',
      multi: ['recruiter_outreach', 'relevant_opportunity'],
      tags: ['standard_recruitment_communication'],
    },
    {
      org: 'org-nymbus-security',
      from: 'Priya Menon <priya@nymbussec.com>',
      subj: 'Direct Hiring Inquiry — Final Year Systems & Rust Enthusiasts',
      body: 'Hi TPO Team,\n\nI’m the co-founder’s talent partner at Nymbus Security. Two of your 2025 alumni on our team spoke highly of your systems programming lab. Could you connect me with your placement coordinator so we can explore a direct hiring drive for 2027 graduates?',
      multi: ['recruiter_outreach'],
      tags: ['unusual_wording_no_standard_keywords'],
    },
    {
      org: 'org-orbit-logistics',
      from: 'Sandeep Verma <sandeep.v@orbitlogistics.in>',
      subj: 'Request for Placement Brochure & 2027 Batch Strength Details',
      body: 'Dear Sir/Madam,\n\nGreetings from Orbit Supply Chain Tech! We are shortlisting partner institutes for our upcoming Management Trainee and Operations Research hiring cycle. Kindly share your 2026–27 placement brochure and branch-wise student count.',
      multi: ['recruiter_outreach'],
      tags: ['standard_recruitment_communication'],
    },
    {
      org: 'org-tectonic-ai',
      from: 'Aarav Mehta <aarav@tectonic-ai.com>',
      subj: 'Founder Outreach: Hiring Founding Junior ML Engineers from your 2027 Batch',
      body: 'Hello Professor,\n\nI am Aarav, CTO at Tectonic AI (Series A, Bengaluru). Rather than a generic portal post, I am reaching out directly to ask if you can recommend 5–8 standout ML/math undergraduates for our 18 LPA founding junior engineer track. Happy to share the JD once we connect.',
      multi: ['recruiter_outreach', 'relevant_opportunity'],
      tags: ['standard_recruitment_communication'],
    },
    {
      org: 'org-medvista-devices',
      from: 'Shruti Joshi <shruti.j@medvistadevices.in>',
      subj: 'Industry-Academia Campus Recruitment Tie-Up — MedVista R&D',
      body: 'Dear Training & Placement Cell,\n\nMedVista Devices is expanding its R&D center in Hyderabad. Please let us know the procedure to register as an official recruiter for your B.Tech Biomedical, ECE, and Mechanical 2027 cohorts.',
      multi: ['recruiter_outreach'],
      tags: ['standard_recruitment_communication'],
    },
    {
      org: 'org-polaris-semi',
      from: 'Karthik Subramanian <karthik.s@polarissilicon.com>',
      subj: 'Exploring 6-Month Internship Collaboration (Jan–Jun 2027) — Polaris Silicon',
      body: 'Dear Placement Dean,\n\nDoes your academic senate permit 8th-semester full-semester industry internships? Polaris Silicon is keen to host 6–10 VLSI & Embedded interns from Jan to June 2027 in Noida and Bengaluru. Looking forward to your confirmation.',
      multi: ['recruiter_outreach', 'relevant_opportunity'],
      tags: ['unusual_wording_no_standard_keywords'],
    },
    {
      org: 'org-clearledger-saas',
      from: 'Ankita Sharma <ankita@clearledger.io>',
      subj: 'Campus Drive Dates Request — ClearLedger SaaS Engineering',
      body: 'Hi Placement Office,\n\nWe hired 3 wonderful engineers from your 2026 batch and would love to return for the 2027 batch! Please let us know which dates between Dec 4 and Dec 15 are open for our virtual pre-placement talk and hiring process.',
      multi: ['recruiter_outreach'],
      tags: ['standard_recruitment_communication'],
    },
    {
      org: 'org-velox-motors',
      from: 'Rituraj Singh <rituraj.hr@veloxmotors.in>',
      subj: 'Empanelment for Core Mechanical & Automotive Hiring — Velox Motors',
      body: 'Respected TPO,\n\nI represent Talent Acquisition at Velox Electric Motors, Chakan Pune. Kindly share your campus recruitment policy form (JNF/INF) so our engineering VP can fill in compensation and role specifics.',
      multi: ['recruiter_outreach'],
      tags: ['standard_recruitment_communication'],
    },
    {
      org: 'org-brightpath-edtech',
      from: 'Tanvi Deshpande <tanvi@brightpathlabs.com>',
      subj: 'Direct Recruiter Connect — Product Design & Fullstack Roles',
      body: 'Hello Team,\n\nReaching out from BrightPath Product Labs, Mumbai. Who is the right faculty/student coordinator to coordinate a boutique hiring drive for UI/UX and TypeScript roles next month?',
      multi: ['recruiter_outreach'],
      tags: ['standard_recruitment_communication'],
    },
    {
      org: 'org-kovai-precision',
      from: 'Muruganandam P <hr@kovaiprecision.co.in>',
      subj: 'Campus Visit Proposal for Tooling & CNC Automation Engineers',
      body: 'Dear Placement Officer,\n\nKovai Precision Works wishes to visit your campus in December to interact with final-year Production and Mechanical students for our automation division. Please suggest convenient dates.',
      multi: ['recruiter_outreach'],
      tags: ['standard_recruitment_communication'],
    },
    {
      org: 'org-skybridge-telecom',
      from: 'Divya Nambiar <divya.nambiar@skybridgetelecom.com>',
      subj: '5G Protocol Stack Hiring — Introductory Note from SkyBridge HR',
      body: 'Dear Sir,\n\nI lead wireless R&D recruiting at SkyBridge Telecom (Chennai/Bengaluru). We are keen to engage with your ECE/Telecom department for 2027 freshers. Let us connect briefly on Tuesday.',
      multi: ['recruiter_outreach'],
      tags: ['standard_recruitment_communication'],
    },
  ];

  recruiterOutreaches.forEach((item, idx) => {
    examples.push({
      id: `cur-out-${idx + 1}`,
      threadId: `th-out-${idx + 1}`,
      senderOrgGroup: item.org,
      datasetSource: 'curated_anonymized_corpus',
      fromRaw: item.from,
      authHeadersRaw: 'mx.google.com; spf=pass; dkim=pass; dmarc=pass',
      subject: item.subj,
      rawBody: item.body,
      isHtmlOnly: false,
      attachmentFilenames: [],
      priorThreadCategories: [],
      primaryCategory: 'recruiter_outreach',
      multiLabels: item.multi,
      hardCaseTags: item.tags,
    });
  });

  // =========================================================================
  // 3. jd_or_details_followup (16 distinct orgs — corrigendum, attached JD, revised CTC/deadline/branches)
  // =========================================================================
  const jdFollowups: Array<{
    org: string;
    from: string;
    subj: string;
    body: string;
    atts: string[];
    prior: LabeledEmailExample['priorThreadCategories'];
  }> = [
    {
      org: 'org-nexora-systems',
      from: 'Campus HR <campus@nexorasystems.com>',
      subj: 'Re: Nexora Campus Drive — PFA Detailed Job Description & Compensation Breakup',
      body: 'Dear TPO,\n\nFurther to our earlier email, please find attached the detailed PDF Job Description for the Cloud Platform Engineer role along with the fixed vs variable CTC breakup (13.5 LPA fixed + 1.5L joining bonus).',
      atts: ['Nexora_Cloud_Platform_JD_v2.pdf'],
      prior: ['relevant_opportunity'],
    },
    {
      org: 'org-silveroak-analytics',
      from: 'Hiring Team <university@silveroak.ai>',
      subj: 'Corrigendum: CGPA Cutoff Relaxed to 6.75 & IT Branch Added — SilverOak Drive',
      body: 'Hi Placement Cell,\n\nQuick update on the Data Analyst opening shared yesterday: based on hiring manager approval, we have relaxed the CGPA requirement from 7.5 to 6.75 and added B.Tech Information Technology to eligible branches. Updated JD attached.',
      atts: ['SilverOak_Revised_JD.docx'],
      prior: ['relevant_opportunity'],
    },
    {
      org: 'org-terravolt-energy',
      from: 'HR Desk <careers@terravolt.in>',
      subj: 'Extension of Registration Deadline to 28 Nov 2026 — TerraVolt GET Role',
      body: 'Dear Coordinator,\n\nSince end-semester lab exams are underway at your college, we are extending the application deadline for the Graduate Engineer Trainee position from 22 Nov to 28 Nov 2026, 6:00 PM IST. All other JD terms remain unchanged.',
      atts: [],
      prior: ['relevant_opportunity'],
    },
    {
      org: 'org-cloudloom-tech',
      from: 'Ritika Garg <ritika@cloudloom.io>',
      subj: 'Attached: Role Specifications & Bond/Service Agreement Clarification — CloudLoom',
      body: 'Hello Sir,\n\nSharing the official JD document for DevOps Intern + FTE as requested on our call. Clarifying explicitly that there is ZERO service bond; stipend is INR 35,000/month in Pune (Hybrid).',
      atts: ['CloudLoom_DevOps_JD_2027.pdf'],
      prior: ['recruiter_outreach'],
    },
    {
      org: 'org-optima-supply',
      from: 'Campus Relations <cr@optimasupply.com>',
      subj: 'Updated Application Portal Link & JD PDF — Optima Operations Analyst',
      body: 'Hi Team,\n\nThe previous form link had a domain typo. Please circulate the corrected application URL https://careers.optimasupply.com/campus-2027 along with the attached Job Description PDF.',
      atts: ['Optima_Operations_Analyst_JD.pdf'],
      prior: ['relevant_opportunity'],
    },
    {
      org: 'org-vanguard-chip',
      from: 'VLSI Talent <vlsi-ur@vanguardchip.com>',
      subj: 'Addendum to Physical Design Intern JD — M.Tech Microelectronics Eligible',
      body: 'Dear TPO,\n\nPlease note an addendum to the Physical Design Intern details sent on Monday: M.Tech Microelectronics & VLSI 2027 students are also eligible alongside B.Tech ECE. Stipend revised upward to Rs. 45,000/month.',
      atts: ['VanguardChip_PD_Addendum.pdf'],
      prior: ['relevant_opportunity'],
    },
    {
      org: 'org-finpulse-payments',
      from: 'Campus Team <campus@finpulse.in>',
      subj: 'Job Description Document for Product Security Engineer (2027 Batch)',
      body: 'Dear Placement Cell,\n\nSending across the standalone Job Description DOCX for the Product Security Engineer position (CTC 14.2 LPA, Mumbai Hybrid) so students can review required OWASP & Linux skills before applying.',
      atts: ['FinPulse_ProdSec_JD.docx'],
      prior: ['recruiter_outreach'],
    },
    {
      org: 'org-ecosense-iot',
      from: 'Anirudh Bose <anirudh@ecosenseiot.in>',
      subj: 'Re: Firmware Role Details — Work Mode Updated to Remote for 8th Sem',
      body: 'Hi Professor,\n\nFollowing up on the Embedded Firmware role details: students can work Remote during their 8th semester project window (Jan–May) and transition to Bengaluru On-site in June 2027.',
      atts: [],
      prior: ['relevant_opportunity'],
    },
    {
      org: 'org-crimson-health',
      from: 'Talent Ops <talent@crimsonhealth.co>',
      subj: 'FAQs & Detailed Role Rubric Attached — Crimson Health QA & Backend Drive',
      body: 'Hello TPO,\n\nAttached are the detailed role rubrics, tech stack overview, and compensation FAQ sheet for both the Backend Python and QA Automation tracks discussed earlier.',
      atts: ['CrimsonHealth_Role_Rubric_FAQ.pdf'],
      prior: ['relevant_opportunity'],
    },
    {
      org: 'org-astrotek-radar',
      from: 'HR Division <hrd@astrotekradar.in>',
      subj: 'Revised Stipend & Relocation Support Details — AstroTek RF Interns',
      body: 'Dear Sir,\n\nIn continuation of our RF Engineering internship notice, management has approved Rs. 15,000 one-time relocation travel support in addition to the Rs. 30,000/month stipend at Hyderabad. Revised JD attached.',
      atts: ['AstroTek_RF_Intern_Revised_JD.pdf'],
      prior: ['relevant_opportunity'],
    },
    {
      org: 'org-omnidata-ware',
      from: 'University Team <uni@omnidataware.com>',
      subj: 'PFA Updated Job Description: Snowflake & Spark Data Engineer 2027',
      body: 'Dear Placement Officer,\n\nPlease find attached the finalized JD for the Data Engineercampus drive scheduled next month. Application deadline is 3 Dec 2026.',
      atts: ['OmniData_DataEngineer_JD.pdf'],
      prior: ['recruiter_outreach'],
    },
    {
      org: 'org-zephyr-fintech',
      from: 'Campus Desk <campus@zephyrfintech.com>',
      subj: 'Clarification on Backlog Criteria & Updated JD — Zephyr FinTech',
      body: 'Hi Team,\n\nClarifying a query from student coordinators: cleared historical backlogs are permitted as long as there are 0 active backlogs at the time of registration. Updated JD PDF attached.',
      atts: ['Zephyr_Updated_Eligibility_JD.pdf'],
      prior: ['relevant_opportunity'],
    },
  ];

  jdFollowups.forEach((item, idx) => {
    const isStandaloneJd = idx % 3 === 2;
    examples.push({
      id: `cur-jd-${idx + 1}`,
      threadId: `th-jd-${idx + 1}`,
      senderOrgGroup: item.org,
      datasetSource: 'curated_anonymized_corpus',
      fromRaw: item.from,
      inReplyTo: isStandaloneJd ? null : `<prev-${idx + 1}@${item.org}.com>`,
      authHeadersRaw: 'mx.google.com; spf=pass; dkim=pass; dmarc=pass',
      subject: item.subj,
      rawBody: item.body,
      isHtmlOnly: false,
      attachmentFilenames: item.atts,
      priorThreadCategories: isStandaloneJd ? [] : item.prior,
      primaryCategory: 'jd_or_details_followup',
      multiLabels: ['jd_or_details_followup'],
      hardCaseTags: ['jd_or_followup_update'],
    });
  });

  // =========================================================================
  // 4. application_acknowledgement (13 distinct orgs — ATS auto-receipts, nomination receipts)
  // =========================================================================
  const appAcks: Array<{ org: string; from: string; subj: string; body: string }> = [
    {
      org: 'org-ack-stripe-like',
      from: 'PayStack Global Recruiting <no-reply@greenhouse.io>',
      subj: 'Thank you for applying to PayStack Global — Software Engineer (New Grad 2027)',
      body: 'Hi Candidate,\n\nWe have received your application for the Software Engineer (New Grad 2027) role at PayStack Global. Our recruiting team will review your submission and reach out if there is a match. No further action is needed right now.',
    },
    {
      org: 'org-ack-workday-mfg',
      from: 'TitanForge Careers <myworkday@titanforge.com>',
      subj: 'Application Submitted: Graduate Engineer Trainee (Req ID: R-2027-4491)',
      body: 'Your application for R-2027-4491 Graduate Engineer Trainee has been successfully submitted on TitanForge Workday. You can view your application status anytime on the candidate home page.',
    },
    {
      org: 'org-ack-lever-ai',
      from: 'SynthWave AI <no-reply@hire.lever.co>',
      subj: 'Application received for ML Infrastructure Intern',
      body: 'Thanks for submitting your application to SynthWave AI for the ML Infrastructure Intern position! We have logged your resume and portfolio in our system.',
    },
    {
      org: 'org-ack-tpo-batch',
      from: 'Campus Team <campus@novagrid.in>',
      subj: 'Re: Student Registration Sheet Received — NovaGrid 2027 Drive',
      body: 'Dear TPO,\n\nAcknowledging receipt of the 114 student nominations and resume ZIP archive for the NovaGrid Systems Engineer drive. Our team will revert once initial shortlisting is complete.',
    },
    {
      org: 'org-ack-darwinbox',
      from: 'ApexPharma HR <noreply@apexpharma.darwinbox.in>',
      subj: 'Acknowledgement: Your candidature for Quality Assurance Trainee is recorded',
      body: 'Dear Applicant, thank you for registering for the Quality Assurance Trainee opening at ApexPharma Ltd. Your candidate reference ID is APX-88310.',
    },
    {
      org: 'org-ack-smartrec',
      from: 'EuroSys Engineering <notifications@smartrecruiters.com>',
      subj: 'We received your application — Junior Embedded Developer (Pune)',
      body: 'Hello, thank you for your interest in EuroSys Engineering. This automated message confirms your application for Junior Embedded Developer has been received.',
    },
    {
      org: 'org-ack-superset',
      from: 'Superset Notifications <noreply@joinsuperset.com>',
      subj: ' Enrollment Confirmed: You have applied to VectorScale 2027 Campus Drive',
      body: 'Your profile has been successfully enrolled for the VectorScale Solutions Software Analyst 2027 Campus Drive. Keep an eye on your inbox for further updates.',
    },
    {
      org: 'org-ack-ashby',
      from: 'ChronoDB Recruiting <no-reply@ashbyhq.com>',
      subj: 'Confirmation of your application to ChronoDB (Distributed Systems Intern)',
      body: 'Thank you for applying to ChronoDB! We confirm receipt of your application for Distributed Systems Intern (Summer 2027).',
    },
    {
      org: 'org-ack-icims',
      from: 'AeroLink Talent <autoreply@icims.aerolink.com>',
      subj: 'Thank you for your submission — Avionics Test Engineer I (Job #9921)',
      body: 'Dear Candidate, thank you for submitting your profile for Avionics Test Engineer I. Your submission is currently under initial review.',
    },
    {
      org: 'org-ack-zoho',
      from: ' FinCore Labs <careers-noreply@fincorelabs.in>',
      subj: 'Registration Successful — FinCore 2027 Off-Campus Hiring',
      body: 'Hi, we have received your registration form for FinCore Labs 2027 Off-Campus Hiring. Please retain registration ID FC27-1092 for future correspondence.',
    },
    {
      org: 'org-ack-keka',
      from: 'BrightByte Technologies <noreply@brightbyte.keka.com>',
      subj: 'Application Confirmation: Product Analyst Intern',
      body: 'We appreciate your interest in BrightByte Technologies. Your application for Product Analyst Intern has been logged successfully.',
    },
    {
      org: 'org-ack-tpo-nom',
      from: 'University Hiring <uh@macrologic.co.in>',
      subj: 'Acknowledgement of College Nomination List — MacroLogic 2027',
      body: 'Dear Placement Officer, confirming that we have received your institute’s consolidated nomination sheet of 68 students for the Associate Consultant role.',
    },
  ];

  appAcks.forEach((item, idx) => {
    examples.push({
      id: `cur-ack-${idx + 1}`,
      threadId: `th-ack-${idx + 1}`,
      senderOrgGroup: item.org,
      datasetSource: 'curated_anonymized_corpus',
      fromRaw: item.from,
      authHeadersRaw: 'mx.google.com; spf=pass; dkim=pass; dmarc=pass',
      subject: item.subj,
      rawBody: item.body,
      isHtmlOnly: false,
      attachmentFilenames: [],
      priorThreadCategories: [],
      primaryCategory: 'application_acknowledgement',
      multiLabels: ['application_acknowledgement'],
      hardCaseTags: ['standard_recruitment_communication'],
    });
  });

  // =========================================================================
  // 5. screening_or_eligibility (12 distinct orgs — eligibility check, CGPA/backlog verification, availability questionnaire)
  // =========================================================================
  const screenings: Array<{ org: string; from: string; subj: string; body: string }> = [
    {
      org: 'org-scr-1',
      from: 'Campus Compliance <screening@quantisglobal.com>',
      subj: 'Action Required: Complete Pre-Screening & Eligibility Questionnaire (Quantis 2027)',
      body: 'Dear Applicant / TPO,\n\nTo proceed to the technical round for Quantis Global SDE-1, all registered students must fill out the mandatory eligibility verification form (10th/12th %, active backlogs, 6-month internship NOC availability) by 17 Nov 2026, 5:00 PM IST: https://forms.quantisglobal.com/eligibility.',
    },
    {
      org: 'org-scr-2',
      from: 'University Desk <campus@vedahealth.in>',
      subj: 'Request for TPO Verified CGPA & Zero-Backlog Audit Sheet — VedaHealth',
      body: 'Dear Placement Officer,\n\nWe noticed 14 applicants entered self-declared CGPA without transcript proof. Kindly verify their 6th-semester GPA and confirm zero active arrears in the attached sheet so we can finalize the eligible pool.',
    },
    {
      org: 'org-scr-3',
      from: 'Recruiting Ops <ops@hyperioncloud.io>',
      subj: 'Pre-Screen Check: Work Authorization, Relocation &Jan 2027 Joining Availability',
      body: 'Hi Candidate,\n\nBefore scheduling assessments for Hyperion Cloud Support Engineer, please reply confirming: (1) willingness to work rotational shifts in Bengaluru, and (2) college NOC availability from 10 Jan 2027.',
    },
    {
      org: 'org-scr-4',
      from: 'Talent Screening <hr-screen@arclightsemi.com>',
      subj: 'Initial Profile Screening — Transcript & Project Abstract Request (ArcLight)',
      body: 'Hello,\n\nYour profile passed initial resume review for ArcLight Analog Design Intern. For eligibility & faculty-project alignment screening, please upload your latest grade card and a 1-page B.Tech project abstract by Friday.',
    },
    {
      org: 'org-scr-5',
      from: 'HR Campus <campus@credencefin.co.in>',
      subj: 'Eligibility Audit Discrepancy — Gap Year & Aggregate Marks Clarification',
      body: 'Dear TPO,\n\nDuring eligibility screening for Credence Financial Risk Analyst, 6 candidates showed a >1 year academic gap between XII and B.Tech. Please confirm whether they meet our <=12 month gap policy.',
    },
    {
      org: 'org-scr-6',
      from: 'Early Talent <earlytalent@nordicsoft.se>',
      subj: 'Recruiter Screening Questionnaire — NordicSoft Graduate Programme',
      body: 'Thank you for applying to NordicSoft Bengaluru. Please complete this 5-minute pre-screening questionnaire covering graduation month, preferred tech track, and notice/NOC readiness before 20 Nov 2026: https://nordicsoft.com/prescreen.',
    },
    {
      org: 'org-scr-7',
      from: 'Placement Audit <hiring@mahindratech-example.in>',
      subj: 'Branch & Diploma-Lateral Entry Eligibility Confirmation Request',
      body: 'Dear Sir,\n\nKindly confirm how many students in the submitted list are Diploma-to-Degree lateral entry candidates and confirm their Diploma aggregate >= 70% for our eligibility check.',
    },
    {
      org: 'org-scr-8',
      from: 'People Team <talent@cobaltsec.io>',
      subj: 'Shortlist Pre-Check: GitHub Handle & Coursework Verification',
      body: 'Hi Applicant, our engineering leads are screening applications for CobaltSec Intern. Please submit your active GitHub URL and confirm completion of Operating Systems & Computer Networks coursework.',
    },
    {
      org: 'org-scr-9',
      from: 'Campus Team <ur@zenithpharma.in>',
      subj: 'Medical Fitness & Shift Eligibility Declaration Form — Zenith Biologics',
      body: 'Dear Placement Coordinator, shortlisted B.Tech Biotech students must submit the preliminary cleanroom eligibility declaration prior to online testing.',
    },
    {
      org: 'org-scr-10',
      from: 'Talent Desk <screening@altairgrid.com>',
      subj: 'Verification of Six-Month Full-Time Internship Permission (NOC Check)',
      body: 'Dear TPO, before we issue OA invites for AltairGrid SDE Intern, we require official confirmation that shortlisted CSE/IT students will be granted 6-month on-site internship NOC in Pune.',
    },
    {
      org: 'org-scr-11',
      from: 'HR Operations <hrops@kaleidodata.com>',
      subj: 'Mandatory Pre-Assessment Eligibility Form — Deadline Today 8 PM IST',
      body: 'Candidates who applied for KaleidoData Associate Engineer must complete the eligibility validation form (pan-India relocation & 7.0 CGPA check) by 8:00 PM IST today to receive test credentials.',
    },
    {
      org: 'org-scr-12',
      from: 'Campus Screening <campus@tridentheavy.co.in>',
      subj: 'Requesting Verified Attendance & Standing Arrear Status for 42 Applicants',
      body: 'Respected TPO, kindly validate standing arrear status as of Semester 6 for the 42 Mechanical applicants so we can freeze the eligible batch.',
    },
  ];

  screenings.forEach((item, idx) => {
    const inThread = idx % 2 === 0;
    examples.push({
      id: `cur-scr-${idx + 1}`,
      threadId: `th-scr-${idx + 1}`,
      senderOrgGroup: item.org,
      datasetSource: 'curated_anonymized_corpus',
      fromRaw: item.from,
      inReplyTo: inThread ? `<scr-prev-${idx + 1}@${item.org}.com>` : null,
      authHeadersRaw: 'mx.google.com; spf=pass; dkim=pass; dmarc=pass',
      subject: inThread && !/^re:/i.test(item.subj) ? `Re: ${item.subj}` : item.subj,
      rawBody: item.body,
      isHtmlOnly: false,
      attachmentFilenames: [],
      priorThreadCategories: inThread ? ['relevant_opportunity'] : [],
      primaryCategory: 'screening_or_eligibility',
      multiLabels: ['screening_or_eligibility'],
      hardCaseTags: ['standard_recruitment_communication'],
    });
  });

  // =========================================================================
  // 6. online_assessment (14 distinct orgs — HackerRank, Codility, Mettl, CodeSignal, take-home assignments)
  // =========================================================================
  const assessments: Array<{ org: string; from: string; subj: string; body: string; atts?: string[] }> = [
    {
      org: 'org-oa-1',
      from: 'HackerRank Team <noreply@hackerrankforwork.com>',
      subj: 'Invitation: ByteForge Systems 2027 Campus Coding Assessment',
      body: 'You have been invited by ByteForge Systems to take the 120-minute Campus SDE Coding Test on HackerRank.\nWindow: 22 Nov 2026, 2:00 PM – 6:00 PM IST.\nStart Test Link: https://www.hackerrank.com/tests/byteforge-2027-sde\nEnsure stable internet and webcam access.',
    },
    {
      org: 'org-oa-2',
      from: 'Codility Assessments <no-reply@codility.com>',
      subj: 'NordStar FinTech — Online Algorithmic Assessment Link (Expires in 48 Hours)',
      body: 'Hello,\n\nNordStar FinTech Engineering has invited you to complete a 90-minute Codility coding challenge (3 tasks in C++/Java/Python). Complete before 24 Nov 2026 11:59 PM IST: https://app.codility.com/test/nordstar-campus-27/.',
    },
    {
      org: 'org-oa-3',
      from: 'Mercer Mettl <assessments@mettl.com>',
      subj: 'Test Credentials: IndusAuto GET Aptitude + Core Domain Online Test',
      body: 'Dear Candidate / TPO,\n\nThe proctored Mercer Mettl online test for IndusAuto Graduate Engineer Trainee is scheduled on 23 Nov 2026 at 11:00 AM IST. Test Link: https://tests.mettl.com/authenticateKey/indus2027. Download Mettl Secure Browser beforehand.',
    },
    {
      org: 'org-oa-4',
      from: 'CodeSignal <invitations@codesignal.com>',
      subj: 'Complete your CloudScale New Grad Technical Assessment on CodeSignal',
      body: 'CloudScale has requested that you complete the Proctored General Coding Assessment (70 mins) by 26 Nov 2026. Launch assessment: https://app.codesignal.com/assessment/cloudscale-ng27.',
    },
    {
      org: 'org-oa-5',
      from: 'Engineering Hiring <eng-hiring@pulsemetrics.ai>',
      subj: 'Take-Home Engineering Assignment — PulseMetrics Full-Stack Intern (72h Window)',
      body: 'Hi shortlisted candidates,\n\nCongrats on clearing initial screening! Attached is the take-home mini-project specification (build a paginated telemetry log viewer API + UI). Submit your Git repository link by 25 Nov 2026, 9:00 PM IST via https://pulsemetrics.ai/submit-assignment.',
      atts: ['PulseMetrics_TakeHome_Problem_Statement.pdf'],
    },
    {
      org: 'org-oa-6',
      from: 'SHL / AMCAT Campus <Assessments@myamcat.com>',
      subj: 'Online Test Slot & Login Pin — Sterling Global Analyst Campus Drive',
      body: 'Your online aptitude, SQL, and logical reasoning assessment for Sterling Global Analyst is live on 21 Nov 2026 from 4:00 PM to 5:30 PM IST at https://www.myamcat.com/sterling-drive-2027.',
    },
    {
      org: 'org-oa-7',
      from: 'TestGorilla <noreply@testgorilla.com>',
      subj: 'You are invited to an assessment by Veloce Product Studio',
      body: 'Veloce Product Studio has invited you to complete the Product Management & Analytical Thinking assessment (60 minutes). Deadline: 27 Nov 2026. Start here: https://assessment.testgorilla.com/veloce27.',
    },
    {
      org: 'org-oa-8',
      from: 'HirePro Campus <campus-support@hirepro.in>',
      subj: 'Mock Test + Live Online Coding Test Schedule — Kryon Networks 2027',
      body: 'Dear TPO,\n\nPlease share the HirePro test link with the 84 eligible students for Kryon Networks. Dry-run check: today 5 PM; Live 90-min C/Networking Online Assessment: tomorrow 10:00 AM IST at https://kryon.hirepro.in/exam.',
    },
    {
      org: 'org-oa-9',
      from: 'Design Hiring <design@luminaapps.co>',
      subj: 'UX Design Challenge Task (48 Hours) — Lumina Product Design Intern',
      body: 'Hello! For Round 1 of the Lumina Product Design Internship, please complete the attached UX critique & wireframe assignment and share your Figma link before Sunday 11:59 PM IST.',
      atts: ['Lumina_UX_Assignment_Brief.pdf'],
    },
    {
      org: 'org-oa-10',
      from: 'HackerEarth Assessments <support@hackerearth.com>',
      subj: 'QuantEdge ML & Python Challenge — Assessment Invitation',
      body: 'You are invited to participate in the QuantEdge 2027 Campus ML & Data Challenge on HackerEarth from 22 Nov 7:00 PM to 9:30 PM IST: https://assessment.hackerearth.com/challenges/hiring/quantedge-2027/.',
    },
    {
      org: 'org-oa-11',
      from: 'VLSI Hiring <silicon-test@chipworks.in>',
      subj: 'Online Written Test Link (CMOS, STA & Verilog) — ChipWorks 2027',
      body: 'Dear Placement Cell, shortlisted ECE students must attempt the 60-minute online technical test on 24 Nov 2026 at 3:00 PM IST in your college computer lab via https://exam.chipworks.in/vlsi27.',
    },
    {
      org: 'org-oa-12',
      from: 'Data Hiring <hiring@insightfoundry.io>',
      subj: 'SQL + Case Study Take-Home Test — InsightFoundry Business Analyst',
      body: 'Hi Candidate, please download the sample dataset and case prompt attached, write your SQL queries & 4-slide insight summary, and upload by Thursday 6 PM IST.',
      atts: ['InsightFoundry_SQL_Case_Assignment.pdf'],
    },
  ];

  assessments.forEach((item, idx) => {
    const inThread = idx % 2 === 1;
    examples.push({
      id: `cur-oa-${idx + 1}`,
      threadId: `th-oa-${idx + 1}`,
      senderOrgGroup: item.org,
      datasetSource: 'curated_anonymized_corpus',
      fromRaw: item.from,
      inReplyTo: inThread ? `<oa-prev-${idx + 1}@${item.org}.com>` : null,
      authHeadersRaw: 'mx.google.com; spf=pass; dkim=pass; dmarc=pass',
      subject: inThread ? `Re: Campus Recruitment 2027 — ${item.subj}` : item.subj,
      rawBody: item.body,
      isHtmlOnly: false,
      attachmentFilenames: item.atts || [],
      priorThreadCategories: inThread ? ['relevant_opportunity'] : [],
      primaryCategory: 'online_assessment',
      multiLabels: ['online_assessment'],
      hardCaseTags: ['third_party_assessment_or_interview_platform'],
    });
  });

  // =========================================================================
  // 7. interview_invitation (14 distinct orgs — scheduling, Calendly, rescheduling, panel confirmation)
  // =========================================================================
  const interviews: Array<{ org: string; from: string; subj: string; body: string; atts?: string[] }> = [
    {
      org: 'org-int-1',
      from: 'Calendly via NimbusTech <notifications@calendly.com>',
      subj: 'Invitation: Book your 45-min Technical Interview Slot — NimbusTech SDE-1',
      body: 'Congratulations on passing the NimbusTech coding test! Please select your 45-minute Technical Round 1 slot between 25 Nov and 27 Nov 2026 (IST) using our scheduling link: https://calendly.com/nimbustech-eng/sde1-round1.',
    },
    {
      org: 'org-int-2',
      from: 'Campus Panel <interviews@skylinefin.com>',
      subj: 'Interview Invitation: Skyline FinTech Technical + HR Rounds on 26 Nov 2026 (10:30 AM IST)',
      body: 'Dear TPO & Shortlisted Students,\n\n22 students have qualified for Skyline FinTech virtual interviews on Thursday, 26 Nov 2026 starting 10:30 AM IST via Google Meet: https://meet.google.com/abc-defg-hij. Panel schedule PDF attached.',
      atts: ['Skyline_Interview_Panel_Schedule.pdf'],
    },
    {
      org: 'org-int-3',
      from: 'Recruiting Coordinator <coord@deepstream.ai>',
      subj: 'Rescheduled: DeepStream Systems Design Interview moved to Friday 27 Nov, 3:00 PM IST',
      body: 'Hi Candidate,\n\nDue to an urgent production incident on the interviewer’s team, we need to reschedule your Systems Design interview from Thursday 11 AM to Friday, 27 Nov 2026 at 3:00 PM IST. Updated Zoom link: https://zoom.us/j/9918273645. Please reply to confirm.',
    },
    {
      org: 'org-int-4',
      from: 'University Relations <ur@apexmotors.in>',
      subj: 'On-Campus GD & Personal Interview Schedule Confirmation — Apex Motors (Dec 2)',
      body: 'Respected TPO,\n\nConfirming our 6-member technical & HR interview panel visit on 2 Dec 2026 at 9:00 AM IST for the 35 shortlisted Mechanical & EEE candidates. Kindly arrange 3 interview rooms.',
    },
    {
      org: 'org-int-5',
      from: 'GoodTime Scheduling <scheduling@goodtime.io>',
      subj: 'Action Required: Submit availability for Datacore Backend Engineer Virtual Onsite',
      body: 'You are invited to the Datacore Virtual Onsite Interview (2x 45-min coding & architecture rounds). Please submit 3 preferred time windows in IST by tomorrow: https://hire.goodtime.io/datacore/availability.',
    },
    {
      org: 'org-int-6',
      from: 'Talent Team <interviews@vervemedia.io>',
      subj: 'Confirmed: Round 1 Frontend Live-Coding Interview — 25 Nov 2026, 4:00 PM UTC+05:30',
      body: 'Your live-coding interview with Staff Engineer Rahul Verma at VerveMedia is confirmed for Wednesday, 25 Nov 2026 from 4:00 PM to 5:00 PM IST (UTC+05:30). Join link: https://meet.google.com/vrv-code-one.',
    },
    {
      org: 'org-int-7',
      from: 'HR Desk <hr@bharathydraulics.co.in>',
      subj: 'Call Letter for Final Personal Interview — Bharat Hydraulics GET 2027',
      body: 'Dear Shortlisted Candidate,\n\nYou are invited for the Technical & HR Personal Interview on 28 Nov 2026 at 11:00 AM IST on Microsoft Teams (https://teams.microsoft.com/l/meetup-join/bharat-pi). Keep semester mark sheets ready.',
    },
    {
      org: 'org-int-8',
      from: 'Hiring Ops <ops@quantalabs.dev>',
      subj: 'Slot Confirmation: Founder + CTO Interview — QuantaLabs Residency',
      body: 'Hi! Confirming your 30-minute final conversation with our CTO on Saturday, 28 Nov 2026 at 11:30 AM IST via Zoom: https://zoom.us/j/8172635401.',
    },
    {
      org: 'org-int-9',
      from: 'Campus Team <campus@zenithgrid.com>',
      subj: 'Group Discussion & Technical Interview Timings for Tomorrow (24 Nov, 9:00 AM IST)',
      body: 'Dear Placement Cell,\n\nSharing the batch-wise Webex links and exact time slots for tomorrow’s GD and Technical Round 1 for ZenithGrid Analyst candidates: https://zenithgrid.webex.com/meet/campus27.',
    },
    {
      org: 'org-int-10',
      from: 'Sneha Nair <sneha.hr@clearpulse.in>',
      subj: 'Can we schedule your HR & Culture Fit Interview tomorrow at 2:30 PM IST?',
      body: 'Hi! You did great in the technical rounds for ClearPulse QA Intern. Are you available tomorrow (25 Nov) at 2:30 PM IST for a 20-minute HR interview on Google Meet?',
    },
    {
      org: 'org-int-11',
      from: 'HireVue Invitations <no-reply@hirevue.com>',
      subj: 'Complete your Structured Video Interview — GlobalBank Technology Analyst 2027',
      body: 'Congratulations on advancing! Please complete your on-demand structured technical interview on HireVue before 27 Nov 2026 11:59 PM IST: https://app.hirevue.com/interview/globalbank27.',
    },
    {
      org: 'org-int-12',
      from: 'Panel Desk <panel@oriondefense.in>',
      subj: 'Rescheduling Technical Round 2 Panel for 4 ECE Candidates to 5:00 PM IST Today',
      body: 'Dear TPO, Panel-B ran 30 minutes behind schedule; the 4:00 PM Round-2 interviews for the 4 ECE candidates are rescheduled to 5:00 PM IST today on the same Teams link.',
    },
  ];

  interviews.forEach((item, idx) => {
    const inThread = idx % 2 === 1;
    examples.push({
      id: `cur-int-${idx + 1}`,
      threadId: `th-int-${idx + 1}`,
      senderOrgGroup: item.org,
      datasetSource: 'curated_anonymized_corpus',
      fromRaw: item.from,
      inReplyTo: inThread ? `<int-prev-${idx + 1}@${item.org}.com>` : null,
      authHeadersRaw: 'mx.google.com; spf=pass; dkim=pass; dmarc=pass',
      subject: inThread ? `Re: ${item.subj}` : item.subj,
      rawBody: item.body,
      isHtmlOnly: false,
      attachmentFilenames: item.atts || [],
      priorThreadCategories: inThread ? ['relevant_opportunity', 'online_assessment'] : [],
      primaryCategory: 'interview_invitation',
      multiLabels: ['interview_invitation'],
      hardCaseTags: ['third_party_assessment_or_interview_platform'],
    });
  });

  return examples;
}

