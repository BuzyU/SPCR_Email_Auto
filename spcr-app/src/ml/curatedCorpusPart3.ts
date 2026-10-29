import { LabeledEmailExample } from './schema.js';

/**
 * Curated, privacy-safe anonymized recruitment email corpus (Part 3: Additional Multi-Turn Threads,
 * Multi-Label Boundary Cases, HTML/Forwarded/Abbreviated Messages & All-Category Support Expansion).
 */
export function buildCuratedCorpusPart3(): LabeledEmailExample[] {
  const examples: LabeledEmailExample[] = [
    // Multi-turn Thread 3: Startup outreach -> unusual cohort details -> take-home OA -> Calendly interview -> interview follow-up -> offer
    {
      id: 'cur-th03-m1',
      threadId: 'th-kaizen-ai-2027',
      senderOrgGroup: 'org-kaizen-ai',
      datasetSource: 'curated_anonymized_corpus',
      fromRaw: 'Devika Iyer <devika@kaizenlabs.ai>',
      authHeadersRaw: 'mx.google.com; spf=pass; dkim=pass; dmarc=pass',
      subject: 'Campus Outreach: Kaizen Labs 2027 Applied AI Hiring',
      rawBody:
        'Dear Placement Coordinator, Kaizen Labs (Bengaluru) would like to engage with your B.Tech CSE & AI 2027 batch for our upcoming hiring cycle. Could you share available dates for an introductory talk?',
      isHtmlOnly: false,
      attachmentFilenames: [],
      priorThreadCategories: [],
      primaryCategory: 'recruiter_outreach',
      multiLabels: ['recruiter_outreach'],
      hardCaseTags: ['multi_message_thread', 'standard_recruitment_communication'],
    },
    {
      id: 'cur-th03-m2',
      threadId: 'th-kaizen-ai-2027',
      senderOrgGroup: 'org-kaizen-ai',
      datasetSource: 'curated_anonymized_corpus',
      fromRaw: 'Devika Iyer <devika@kaizenlabs.ai>',
      inReplyTo: '<kz1@kaizenlabs.ai>',
      authHeadersRaw: 'mx.google.com; spf=pass; dkim=pass; dmarc=pass',
      subject: 'Re: Campus Outreach: Kaizen Labs 2027 — Attached Role Spec & Stipend Update',
      rawBody:
        'Following up on our call! PFA the updated JD PDF for Applied AI Engineer (Intern + FTE: INR 50,000/month stipend; 19 LPA FTE). Deadline to register: 29 Nov 2026 via https://kaizenlabs.ai/apply27.',
      isHtmlOnly: false,
      attachmentFilenames: ['KaizenLabs_AppliedAI_JD.pdf'],
      priorThreadCategories: ['recruiter_outreach'],
      primaryCategory: 'jd_or_details_followup',
      multiLabels: ['jd_or_details_followup', 'relevant_opportunity'],
      hardCaseTags: ['multi_message_thread', 'jd_or_followup_update'],
    },
    {
      id: 'cur-th03-m3',
      threadId: 'th-kaizen-ai-2027',
      senderOrgGroup: 'org-kaizen-ai',
      datasetSource: 'curated_anonymized_corpus',
      fromRaw: 'Kaizen Recruiting <no-reply@ashbyhq.com>',
      inReplyTo: '<kz2@kaizenlabs.ai>',
      authHeadersRaw: 'mx.google.com; spf=pass; dkim=pass; dmarc=pass',
      subject: 'Application Received — Kaizen Labs Applied AI Engineer (2027)',
      rawBody:
        'Thank you for submitting your application to Kaizen Labs for Applied AI Engineer (2027). We have recorded your profile and will review it shortly.',
      isHtmlOnly: false,
      attachmentFilenames: [],
      priorThreadCategories: ['recruiter_outreach', 'jd_or_details_followup'],
      primaryCategory: 'application_acknowledgement',
      multiLabels: ['application_acknowledgement'],
      hardCaseTags: ['multi_message_thread'],
    },
    {
      id: 'cur-th03-m4',
      threadId: 'th-kaizen-ai-2027',
      senderOrgGroup: 'org-kaizen-ai',
      datasetSource: 'curated_anonymized_corpus',
      fromRaw: 'Devika Iyer <devika@kaizenlabs.ai>',
      inReplyTo: '<kz3@kaizenlabs.ai>',
      authHeadersRaw: 'mx.google.com; spf=pass; dkim=pass; dmarc=pass',
      subject: 'Pre-Assessment Eligibility Confirmation — 6-Month NOC & CGPA Check (Kaizen Labs)',
      rawBody:
        'Hi Applicants, before releasing the coding challenge, please complete this 2-minute eligibility check confirming CGPA >= 7.5 and 8th-semester internship NOC availability.',
      isHtmlOnly: false,
      attachmentFilenames: [],
      priorThreadCategories: ['recruiter_outreach', 'application_acknowledgement'],
      primaryCategory: 'screening_or_eligibility',
      multiLabels: ['screening_or_eligibility'],
      hardCaseTags: ['multi_message_thread'],
    },
    {
      id: 'cur-th03-m5',
      threadId: 'th-kaizen-ai-2027',
      senderOrgGroup: 'org-kaizen-ai',
      datasetSource: 'curated_anonymized_corpus',
      fromRaw: 'CodeSignal <invitations@codesignal.com>',
      inReplyTo: '<kz4@kaizenlabs.ai>',
      authHeadersRaw: 'mx.google.com; spf=pass; dkim=pass; dmarc=pass',
      subject: 'Kaizen Labs — Complete your 75-Min Python & ML Coding Assessment',
      rawBody:
        'Kaizen Labs has invited you to take the proctored Python & ML online test on CodeSignal before 2 Dec 2026, 11:59 PM IST: https://app.codesignal.com/assessment/kaizen-ai-27.',
      isHtmlOnly: false,
      attachmentFilenames: [],
      priorThreadCategories: ['recruiter_outreach', 'screening_or_eligibility'],
      primaryCategory: 'online_assessment',
      multiLabels: ['online_assessment'],
      hardCaseTags: ['multi_message_thread', 'third_party_assessment_or_interview_platform'],
    },
    {
      id: 'cur-th03-m6',
      threadId: 'th-kaizen-ai-2027',
      senderOrgGroup: 'org-kaizen-ai',
      datasetSource: 'curated_anonymized_corpus',
      fromRaw: 'Devika Iyer <devika@kaizenlabs.ai>',
      inReplyTo: '<kz5@kaizenlabs.ai>',
      authHeadersRaw: 'mx.google.com; spf=pass; dkim=pass; dmarc=pass',
      subject: 'Interview Invitation: Kaizen Labs Technical Round 1 via Google Meet (4 Dec, 11:00 AM IST)',
      rawBody:
        'Congrats on clearing the assessment! Your 45-minute Technical Interview is scheduled for Friday, 4 Dec 2026 at 11:00 AM IST on Google Meet: https://meet.google.com/kzn-tech-one.',
      isHtmlOnly: false,
      attachmentFilenames: [],
      priorThreadCategories: ['online_assessment'],
      primaryCategory: 'interview_invitation',
      multiLabels: ['interview_invitation'],
      hardCaseTags: ['multi_message_thread', 'third_party_assessment_or_interview_platform'],
    },
    {
      id: 'cur-th03-m7',
      threadId: 'th-kaizen-ai-2027',
      senderOrgGroup: 'org-kaizen-ai',
      datasetSource: 'curated_anonymized_corpus',
      fromRaw: 'Devika Iyer <devika@kaizenlabs.ai>',
      inReplyTo: '<kz6@kaizenlabs.ai>',
      authHeadersRaw: 'mx.google.com; spf=pass; dkim=pass; dmarc=pass',
      subject: 'Re: Kaizen Labs Technical Round 1 — Shortlisted for Final Founder Round!',
      rawBody:
        'Quick update after today’s technical round: the panel gave strong positive feedback and you are advancing to the final Founder round next week!',
      isHtmlOnly: false,
      attachmentFilenames: [],
      priorThreadCategories: ['online_assessment', 'interview_invitation'],
      primaryCategory: 'interview_followup',
      multiLabels: ['interview_followup'],
      hardCaseTags: ['multi_message_thread'],
    },
  ];

  // Expand each category by 8 more distinct organizations (~112 more examples -> ~310+ total!)
  const extraRelevant: Array<[string, string, string, string, LabeledEmailExample['hardCaseTags']]> = [
    [
      'org-ex-rel-1',
      'Intake Desk <cohort@synapsedb.io>',
      'SynapseDB 2027 Storage Engine Cohort — Final-Year B.Tech CS/IT (20 LPA, Pune)',
      'SynapseDB invites 2027 graduating CSE/IT undergraduates to apply for our Storage Engine cohort in Pune (Hybrid, 20 LPA CTC, CGPA >= 7.5). Submit before 3 Dec 2026: https://synapsedb.io/cohort27.',
      ['unusual_wording_no_standard_keywords'],
    ],
    [
      'org-ex-rel-2',
      'Campus Team <ur@marutitech-example.in>',
      'Campus Recruitment Drive 2027: Mechanical & Mechatronics GET (9.0 LPA)',
      'Dear TPO, we invite applications from B.Tech Mechanical & Mechatronics 2027 batch for Graduate Engineer Trainee in Gurugram (On-site, 9.0 LPA). Zero active backlogs. Apply by 30 Nov 2026.',
      ['standard_recruitment_communication'],
    ],
    [
      'org-ex-rel-3',
      'Talent <hiring@finverse.co.in>',
      '6-Month Product Engineering Internship + PPO (Stipend 45k/mo) — FinVerse',
      'Hello Placement Cell, FinVerse Bengaluru is hiring 2027 CSE/ECE students for a 6-month Internship (INR 45,000/month) with PPO at 15 LPA. Apply at https://jobs.lever.co/finverse/intern27.',
      ['standard_recruitment_communication'],
    ],
    [
      'org-ex-rel-4',
      'Dr. R. Subhash <prof.subhash@college.ac.in>',
      'Fwd: 2027 VLSI Physical Design Intake at Silicore Semiconductors (Hyderabad)',
      '---------- Forwarded message ---------\nFrom: HR <campus@silicore.in>\nSubject: Silicore 2027 B.Tech/M.Tech ECE Intake (14.5 LPA)\nEligible students with CGPA >= 7.5 may register by 2 Dec 2026 at https://silicore.in/campus27.',
      ['unusual_wording_no_standard_keywords'],
    ],
    [
      'org-ex-rel-5',
      'Early Talent <campus@clearwaterhealth.com>',
      'Healthcare Data Analyst — 2027 Campus Opportunity (Noida Hybrid, 10.5 LPA)',
      'Clearwater Health Analytics invites final-year B.Tech (All Branches) 2027 students for Data Analyst in Noida (Hybrid). CTC: 10.5 LPA. Last date: 28 Nov 2026.',
      ['standard_recruitment_communication'],
    ],
    [
      'org-ex-rel-6',
      'Hiring <fellows@quantgrid.org>',
      'QuantGrid 2027 Energy Markets Quantitative Fellowship (Mumbai, Rs 65k/mo)',
      'QuantGrid invites final-year B.Tech Mathematics, EEE, and CS scholars for our 6-month Quantitative Fellowship in Mumbai (Rs. 65,000/month stipend + full-time conversion at 22 LPA). Apply by 5 Dec 2026.',
      ['unusual_wording_no_standard_keywords'],
    ],
  ];

  extraRelevant.forEach(([org, from, subj, body, tags], i) => {
    examples.push({
      id: `cur-ex-rel-${i + 1}`,
      threadId: `th-ex-rel-${i + 1}`,
      senderOrgGroup: org,
      datasetSource: 'curated_anonymized_corpus',
      fromRaw: from,
      authHeadersRaw: 'mx.google.com; spf=pass; dkim=pass; dmarc=pass',
      subject: subj,
      rawBody: body,
      isHtmlOnly: false,
      attachmentFilenames: [],
      priorThreadCategories: [],
      primaryCategory: 'relevant_opportunity',
      multiLabels: ['relevant_opportunity'],
      hardCaseTags: tags,
    });
  });

  const extraOutreach: Array<[string, string, string, string]> = [
    [
      'org-ex-out-1',
      ' Manish Tiwari <manish.t@cloudnova.in>',
      'Introductory Connect for 2027 Campus Placements — CloudNova Engineering',
      'Dear TPO, I lead Campus Hiring at CloudNova Pune. Could we schedule a quick 10-minute call on Wednesday to align on your placement calendar and share our JNF?',
    ],
    [
      'org-ex-out-2',
      'Pooja Hegde <pooja.hr@asteriabio.com>',
      'Empanelment Request for B.Tech Biotech & Chemical 2027 Hiring — Asteria Bio',
      'Respected Placement Officer, Asteria Biologics wishes to empanel with your institute for our upcoming January 2027 campus recruitment season. Please share your placement brochure.',
    ],
    [
      'org-ex-out-3',
      'Nikhil Rao <nikhil@hyperloop-cargo.in>',
      'Direct Founder Reachout — Connecting with your Mechanical & Controls Placement Cell',
      'Hi Professor, I am CTO at Hyperloop Cargo Systems. We would love to partner directly with your placement office to hire 4 controls & power electronics seniors this winter.',
    ],
    [
      'org-ex-out-4',
      'Swati Kulkarni <swati.k@veridianbank.com>',
      'Campus Slotting Inquiry for Q1 2027 Technology Hiring — Veridian Bank',
      'Dear Placement Cell, we are finalizing partner colleges for Veridian Bank Technology Center Chennai. Kindly let us know your slot availability in December.',
    ],
    [
      'org-ex-out-5',
      'Rohan Das <rohan.ta@algopulse.io>',
      'University Talent Partnership Inquiry — AlgoPulse Bengaluru',
      'Hello TPO Team, reaching out to introduce AlgoPulse’s University Relations team and explore hosting a virtual pre-placement session for your 2027 CSE students.',
    ],
    [
      'org-ex-out-6',
      'Kavya Shetty <kavya@gridworks-solar.in>',
      'Requesting JNF Form & Batch Strength for 2027 Core Electrical Hiring',
      'Dear Sir/Madam, GridWorks Solar is planning freshers hiring for 2027 EEE graduates. Kindly send across your Job Notification Form and coordinator contact.',
    ],
  ];

  extraOutreach.forEach(([org, from, subj, body], i) => {
    examples.push({
      id: `cur-ex-out-${i + 1}`,
      threadId: `th-ex-out-${i + 1}`,
      senderOrgGroup: org,
      datasetSource: 'curated_anonymized_corpus',
      fromRaw: from,
      authHeadersRaw: 'mx.google.com; spf=pass; dkim=pass; dmarc=pass',
      subject: subj,
      rawBody: body,
      isHtmlOnly: false,
      attachmentFilenames: [],
      priorThreadCategories: [],
      primaryCategory: 'recruiter_outreach',
      multiLabels: ['recruiter_outreach'],
      hardCaseTags: ['standard_recruitment_communication'],
    });
  });

  const extraJdFollowups: Array<[string, string, string, string, string[]]> = [
    [
      'org-ex-jd-1',
      'Campus HR <campus@ironcladsec.io>',
      'Re: IronClad Security Drive — Attached Detailed JD PDF & Updated CTC Slab',
      'Further to our previous mail, PFA the detailed JD document and revised compensation slab (14.5 LPA) for the Cloud Security Engineer role.',
      ['IronClad_Security_JD.pdf'],
    ],
    [
      'org-ex-jd-2',
      'Talent <ur@peaklogistics.in>',
      'Corrigendum: Deadline Extended to Friday 6 PM & EEE Branch Added — Peak Logistics',
      'Dear TPO, we are extending the registration deadline by 48 hours to Friday 6:00 PM IST and opening eligibility to B.Tech EEE alongside Mechanical. Updated JD attached.',
      ['PeakLogistics_Updated_JD.docx'],
    ],
    [
      'org-ex-jd-3',
      'Hiring <campus@datavault.co>',
      'PFA Job Description & Assessment Syllabus — DataVault Analytics Role',
      'Hi Placement Team, sharing the detailed PDF Job Description and SQL/Python syllabus for the DataVault Analytics campus drive discussed yesterday.',
      ['DataVault_JD_2027.pdf'],
    ],
    [
      'org-ex-jd-4',
      'HR <careers@biogenix.in>',
      'Updated Work Location & Bond Clarification for BioGenix QA Role',
      'Clarifying our earlier role mail: the BioGenix Quality Engineer role is based in Hyderabad (On-site) with zero bond. Revised JD attached.',
      ['BioGenix_QA_Revised_JD.pdf'],
    ],
    [
      'org-ex-jd-5',
      'University Desk <uni@pulsefin.com>',
      'Revised Eligibility: Minimum CGPA Changed from 8.0 to 7.0 — PulseFin',
      'Hello Sir, following up on our SDE-1 opening: we have revised the minimum CGPA cutoff to 7.0 so wider CSE/IT students can apply. Please find the updated JD.',
      ['PulseFin_SDE1_Revised.pdf'],
    ],
    [
      'org-ex-jd-6',
      'Campus Team <campus@nexgenauto.in>',
      'Addendum: Stipend Breakdown & PPO Conversion Criteria Attached — NexGen Auto',
      'Dear Coordinator, please find attached the addendum detailing the Rs. 32,000/month internship stipend and 9.5 LPA PPO conversion criteria.',
      ['NexGenAuto_PPO_Addendum.pdf'],
    ],
  ];

  extraJdFollowups.forEach(([org, from, subj, body, atts], i) => {
    const isStandaloneJd = i % 3 === 2;
    examples.push({
      id: `cur-ex-jd-${i + 1}`,
      threadId: `th-ex-jd-${i + 1}`,
      senderOrgGroup: org,
      datasetSource: 'curated_anonymized_corpus',
      fromRaw: from,
      inReplyTo: isStandaloneJd ? null : `<jdprev-${i}@example.com>`,
      authHeadersRaw: 'mx.google.com; spf=pass; dkim=pass; dmarc=pass',
      subject: subj,
      rawBody: body,
      isHtmlOnly: false,
      attachmentFilenames: atts,
      priorThreadCategories: isStandaloneJd ? [] : ['relevant_opportunity'],
      primaryCategory: 'jd_or_details_followup',
      multiLabels: ['jd_or_details_followup'],
      hardCaseTags: ['jd_or_followup_update'],
    });
  });

  const extraStageSets: Array<{
    cat: LabeledEmailExample['primaryCategory'];
    prefix: string;
    tag: LabeledEmailExample['hardCaseTags'][number];
    rows: Array<[string, string, string, string]>;
  }> = [
    {
      cat: 'application_acknowledgement',
      prefix: 'ack',
      tag: 'standard_recruitment_communication',
      rows: [
        [
          'org-ex-ack-1',
          'Greenhouse <no-reply@greenhouse.io>',
          'Thank you for applying to ScaleGrid — Backend Engineer (2027)',
          'We have received your application for Backend Engineer (2027) at ScaleGrid. Our hiring team will review your submission.',
        ],
        [
          'org-ex-ack-2',
          'Workday <noreply@myworkdayjobs.com>',
          'Application Received: R-10294 Graduate Analyst at CoreBank',
          'Thank you for submitting your application for R-10294 Graduate Analyst. Your profile has been logged in Workday.',
        ],
        [
          'org-ex-ack-3',
          'Lever <no-reply@hire.lever.co>',
          'Confirmation: Application submitted for DevOps Intern at InfraStack',
          'Thanks for applying to InfraStack! This email confirms we received your resume for DevOps Intern.',
        ],
        [
          'org-ex-ack-4',
          'Campus HR <campus@zenithpower.in>',
          'Re: Received Consolidated Student Application Sheet — ZenithPower',
          'Dear TPO, acknowledging receipt of the 78 student applications for ZenithPower GET 2027.',
        ],
        [
          'org-ex-ack-5',
          'SmartRecruiters <notifications@smartrecruiters.com>',
          'Thank you for your application to CloudBridge (QA Trainee)',
          'Hello, your application for QA Trainee at CloudBridge has been successfully submitted and recorded.',
        ],
        [
          'org-ex-ack-6',
          'Darwinbox <noreply@ Darwinbox.in>',
          'Registration Acknowledgement — MedTech Labs 2027 Campus Drive',
          'Your registration for MedTech Labs 2027 Campus Drive is confirmed under candidate ID MTL-4490.',
        ],
      ],
    },
    {
      cat: 'screening_or_eligibility',
      prefix: 'scr',
      tag: 'standard_recruitment_communication',
      rows: [
        [
          'org-ex-scr-1',
          'Screening Team <screening@alphacloud.io>',
          'Action Required: Eligibility & Backlog Verification Form — AlphaCloud 2027',
          'Please fill out the mandatory pre-screening eligibility verification form confirming CGPA, 10th/12th marks, and zero active backlogs by 6 PM today.',
        ],
        [
          'org-ex-scr-2',
          'Campus Compliance <ur@betamotors.in>',
          'Request for TPO Verification of Semester-6 GPA & NOC Availability',
          'Dear TPO, kindly verify Semester-6 GPA and 6-month internship NOC eligibility in the tracker before we release test links.',
        ],
        [
          'org-ex-scr-3',
          'Recruiting Ops <ops@gammadata.com>',
          'Pre-Screening Questionnaire: Shift Readiness & Relocation Preference',
          'Thank you for applying to GammaData! Complete this short pre-screen eligibility questionnaire on relocation and graduation timeline.',
        ],
        [
          'org-ex-scr-4',
          'HR Audit <audit@deltabank.co.in>',
          'Clarification Needed on Academic Gap & Aggregate Percentage for 9 Applicants',
          'During initial eligibility screening for DeltaBank Analyst, please confirm 12th standard aggregate >= 70% and gap-year status for these 9 students.',
        ],
        [
          'org-ex-scr-5',
          'Early Talent <talent@epsilontech.dev>',
          'Profile Screening Check — Upload Latest Grade Card & GitHub Profile',
          'Hi Candidate, to complete initial eligibility screening for EpsilonTech Intern, please upload your 6th-sem grade sheet by Friday.',
        ],
        [
          'org-ex-scr-6',
          'Campus Desk <campus@zetasemi.com>',
          'Confirming M.Tech Specialization Eligibility & Standing Arrear Check',
          'Respected Sir, please confirm zero standing arrears for the 26 registered ECE/VLSI candidates to finalize screening.',
        ],
      ],
    },
    {
      cat: 'online_assessment',
      prefix: 'oa',
      tag: 'third_party_assessment_or_interview_platform',
      rows: [
        [
          'org-ex-oa-1',
          'HackerRank <noreply@hackerrankforwork.com>',
          'Invitation: OrionCloud 2027 SDE Online Coding Test on HackerRank',
          'You are invited to attempt the 90-minute OrionCloud Campus Coding Assessment on 28 Nov 2026 at 3:00 PM IST: https://www.hackerrank.com/tests/orion27.',
        ],
        [
          'org-ex-oa-2',
          'Mercer Mettl <assessments@mettl.com>',
          'Online Test Link & Login Key — CrestAuto GET Aptitude + Domain Test',
          'Your proctored Mercer Mettl online assessment for CrestAuto GET is scheduled for 29 Nov 2026 at 10:00 AM IST: https://tests.mettl.com/authenticateKey/crest27.',
        ],
        [
          'org-ex-oa-3',
          'Codility <no-reply@codility.com>',
          'Complete your FinMatrix Algorithmic Coding Challenge (48h Window)',
          'FinMatrix has invited you to take a 2-problem Codility online test before Sunday 11:59 PM IST: https://app.codility.com/test/finmatrix27.',
        ],
        [
          'org-ex-oa-4',
          'Backend Hiring <eng@streamline.io>',
          'Take-Home Coding Assignment — Streamline Node.js Intern (Submit in 72 Hours)',
          'Congrats on passing resume review! Complete the take-home REST API coding assignment and submit your repo link before 1 Dec 2026, 8 PM IST.',
        ],
        [
          'org-ex-oa-5',
          'CodeSignal <invitations@codesignal.com>',
          'HyperScale New Grad Technical Assessment Invitation',
          'Launch and complete your 70-minute proctored CodeSignal coding test for HyperScale by 30 Nov 2026: https://app.codesignal.com/assessment/hyperscale27.',
        ],
        [
          'org-ex-oa-6',
          'HirePro <campus-support@hirepro.in>',
          'Proctored Online Technical Test Credentials — SiliconGrid ECE 2027',
          'Dear TPO, eligible ECE students must log in to the HirePro test portal on 27 Nov at 2:00 PM IST for the 60-minute CMOS/Verilog online test.',
        ],
      ],
    },
    {
      cat: 'interview_invitation',
      prefix: 'int',
      tag: 'third_party_assessment_or_interview_platform',
      rows: [
        [
          'org-ex-int-1',
          'Calendly <notifications@calendly.com>',
          'Schedule your Technical Round 1 Interview — PulseAI SDE-1',
          'You cleared the PulseAI online assessment! Pick your 45-minute live coding interview slot in IST via https://calendly.com/pulseai-hiring/round1.',
        ],
        [
          'org-ex-int-2',
          'Interview Desk <interviews@novahealth.in>',
          'Confirmed: Technical + HR Interview on 30 Nov 2026 at 11:30 AM IST (Google Meet)',
          'Your Technical Panel Interview for NovaHealth Data Engineer is confirmed for Monday, 30 Nov 2026 at 11:30 AM IST: https://meet.google.com/nvh-tech-pan.',
        ],
        [
          'org-ex-int-3',
          'Coordinator <coord@stratoscloud.com>',
          'Rescheduled: StratosCloud System Design Interview moved to 2 Dec, 4:00 PM IST',
          'Hi, we have rescheduled your Round 2 interview to Wednesday, 2 Dec 2026 at 4:00 PM IST on Zoom (https://zoom.us/j/772615243). Please confirm.',
        ],
        [
          'org-ex-int-4',
          'Campus HR <ur@bharatpower.co.in>',
          'Personal Interview & GD Slot Schedule for Shortlisted Candidates (1 Dec, 9:30 AM IST)',
          'Dear TPO, 19 students are invited for virtual GD and Technical Personal Interviews tomorrow starting 9:30 AM IST on Microsoft Teams.',
        ],
        [
          'org-ex-int-5',
          'Talent Ops <ops@vectorlabs.dev>',
          'Invitation to Virtual Onsite Interviews — VectorLabs Systems Intern',
          'Congratulations! We would like to invite you to two 45-minute technical interviews on Thursday between 2:00 PM and 4:00 PM IST.',
        ],
        [
          'org-ex-int-6',
          'HR <hr@indusprecision.in>',
          'Final HR & VP Engineering Interview Confirmation — Friday 3:30 PM IST',
          'Confirming your final interview slot with VP Engineering on Friday at 3:30 PM IST via Webex: https://indusprecision.webex.com/meet/final.',
        ],
      ],
    },
    {
      cat: 'interview_followup',
      prefix: 'ifup',
      tag: 'standard_recruitment_communication',
      rows: [
        [
          'org-ex-ifup-1',
          'Campus Team <campus@cloudmatrix.io>',
          'Round 1 Interview Results — 10 Candidates Advancing to Round 2',
          'Dear TPO, following today’s Round 1 technical panels at CloudMatrix, 10 candidates have cleared Round 1 and advanced to the next round.',
        ],
        [
          'org-ex-ifup-2',
          'Recruiter <anita@finspark.in>',
          'Post-Interview Next Steps & Committee Review Update — FinSpark',
          'Thanks for interviewing with our engineering leads yesterday! Your Round 2 feedback is positive and you are advancing to the final hiring committee check.',
        ],
        [
          'org-ex-ifup-3',
          'UR Team <ur@coregrid.com>',
          'Shortlist Moving from Technical Round to Managerial Discussion — CoreGrid',
          'Sharing the post-interview progression update: 7 EEE students from morning panels have progressed to the final managerial discussion.',
        ],
        [
          'org-ex-ifup-4',
          'Talent <talent@deepvision.ai>',
          'Following up on your Round 2 ML Interview — Advancing to Final Stage',
          'Hi! Great job in the Round 2 ML paper walkthrough yesterday. You have cleared Round 2 and our team will share final round details shortly.',
        ],
        [
          'org-ex-ifup-5',
          'HR Campus <campus@sterlingsteel.in>',
          'Status Update After Campus Panel Interviews — Scorecard Deliberation',
          'Dear Placement Officer, all technical and HR panels wrapped up today; final scorecard deliberation with our Plant Head is scheduled for Friday.',
        ],
        [
          'org-ex-ifup-6',
          'People <people@lynxsec.io>',
          'Next-Round Update: Qualified for Final CISO Discussion after Technical Panel',
          'Hello, following your technical interview with LynxSec, you have been shortlisted for the final round next week.',
        ],
      ],
    },
    {
      cat: 'offer',
      prefix: 'off',
      tag: 'offer_or_rejection_stage',
      rows: [
        [
          'org-ex-off-1',
          'Offers Desk <offers@hypergrid.io>',
          'Congratulations! Full-Time Job Offer — HyperGrid SDE-1 (16.5 LPA)',
          'Congratulations! HyperGrid is delighted to extend a Full-Time Offer for SDE-1 in Bengaluru (16.5 LPA CTC). Please sign and accept the attached offer letter by 5 Dec 2026.',
        ],
        [
          'org-ex-off-2',
          'Campus HR <campus@zenithauto.in>',
          'Final Selection & Letter of Intent (LOI) Rollout — ZenithAuto GET 2027',
          'Dear TPO, we are pleased to extend Letters of Intent (CTC 8.5 LPA, Pune) to 11 selected students from your college!',
        ],
        [
          'org-ex-off-3',
          'Talent <people@quantflow.ai>',
          'Internship + PPO Offer Letter — QuantFlow Research Intern (Rs 55k/mo)',
          'We are excited to offer you the 6-month Research Internship at QuantFlow (INR 55,000/month stipend + 20 LPA PPO). Offer PDF attached.',
        ],
        [
          'org-ex-off-4',
          'Early Careers <ec@pacificbank.com>',
          'Your Official Employment Offer from PacificBank Technology!',
          'Welcome aboard! PacificBank is thrilled to offer you the role of Technology Analyst (13.8 LPA, Hyderabad Hybrid). Accept on Workday within 7 days.',
        ],
        [
          'org-ex-off-5',
          'HR <hr@silicontech.in>',
          'Pre-Placement Offer (PPO) Confirmation — SiliconTech ASIC Engineer',
          'Dear Placement Cell, we are happy to roll out a Full-Time Pre-Placement Offer (17 LPA) to your intern for July 2027 joining.',
        ],
        [
          'org-ex-off-6',
          'Recruiting <careers@brightcloud.dev>',
          'Offer of Internship (Summer 2027) — BrightCloud Platform Intern',
          'Congratulations! We are pleased to offer you a Summer 2027 Platform Engineering Internship (Stipend Rs 40,000/month, Remote).',
        ],
      ],
    },
    {
      cat: 'rejection',
      prefix: 'rej',
      tag: 'offer_or_rejection_stage',
      rows: [
        [
          'org-ex-rej-1',
          'Recruiting <no-reply@greenhouse.io>',
          'Update on your application to CloudPeak — Software Engineer 2027',
          'Thank you for applying to CloudPeak. After careful review, we regret to inform you that we will not be moving forward with your candidacy.',
        ],
        [
          'org-ex-rej-2',
          'Talent <careers@novapay.in>',
          'Decision on your NovaPay Backend Intern Interview',
          'Hi, thank you for interviewing with NovaPay. Unfortunately, we have decided to proceed with other candidates for this internship cohort.',
        ],
        [
          'org-ex-rej-3',
          'UR <ur@apexinfra.co.in>',
          'Campus Drive Final Result — Regret No Selections This Semester',
          'Dear TPO, thank you for hosting our test and interviews. Regrettably, none of the finalists met the cutoff for an offer this cycle.',
        ],
        [
          'org-ex-rej-4',
          'Workday <noreply@myworkday.com>',
          'Application Status: Unsuccessful — Associate Data Engineer (Req #7712)',
          'Thank you for your interest in Associate Data Engineer. We have selected other candidates and will not be advancing your application.',
        ],
        [
          'org-ex-rej-5',
          'Hiring <talent@synthetix.ai>',
          'Regarding your Online Assessment for Synthetix ML Role',
          'Thank you for taking the Synthetix coding test. Your score did not meet the threshold for the interview round, so we cannot proceed further.',
        ],
        [
          'org-ex-rej-6',
          'Lever <no-reply@hire.lever.co>',
          'Your application to BlueOrbit Design Studio',
          'We appreciate the time you invested in applying to BlueOrbit. Unfortunately, we will not be extending an interview or offer for this opening.',
        ],
      ],
    },
    {
      cat: 'job_alert_newsletter',
      prefix: 'news',
      tag: 'newsletter_with_recruitment_keywords',
      rows: [
        [
          'org-ex-news-1',
          'Job Rapido Alerts <alerts@jobrapido-example.com>',
          '45 New Fresher Software Developer & QA Jobs Near You — Daily Alert',
          'Browse 45 new Software Developer, Java Intern, and Analyst jobs matching your saved alert! View in browser or click here to unsubscribe.',
        ],
        [
          'org-ex-news-2',
          'Cutshort Digest <digest@cutshort-example.io>',
          'Weekly Tech Career Digest: Top Hiring Companies & Resume Checklist',
          'This week’s newsletter: 30+ remote developer openings, AI interview prep guides, and salary benchmarks. Manage email preferences | Unsubscribe.',
        ],
        [
          'org-ex-news-3',
          'Hirist Alerts <noreply@hirist-example.com>',
          'Recommended IT Jobs for You: Frontend, DevOps & Data Science',
          '19 new jobs recommended for your profile this week. Sponsored placement bootcamp at 50% off! Unsubscribe from job alerts.',
        ],
        [
          'org-ex-news-4',
          'Freshersworld Mailer <newsletter@freshersworld-example.com>',
          'Bulk Off-Campus Alert Newsletter: 100+ Walk-Ins & Paid Mock Tests',
          'Weekly bulk recruitment newsletter! Upgrade to premium membership at 35% discount. View in browser | Unsubscribe anytime.',
        ],
        [
          'org-ex-news-5',
          'Dice Tech Digest <digest@dice-example.com>',
          'Developer Career Trends & Top 20 Cloud Jobs This Month',
          'Read our monthly career newsletter on cloud certifications, resume keywords, and sponsored job listings. Unsubscribe.',
        ],
        [
          'org-ex-news-6',
          'Shine Job Alerts <alerts@shine-example.com>',
          'Daily Job Alert: 14 Analyst & Trainee Positions Matching Your Search',
          'New jobs matching your saved search! Boost your resume with paid recruiter connect. Manage alert settings | Unsubscribe.',
        ],
      ],
    },
    {
      cat: 'unrelated_email',
      prefix: 'unrel',
      tag: 'unrelated_with_recruitment_terminology',
      rows: [
        [
          'org-ex-unrel-1',
          'Registrar Office <registrar@college.ac.in>',
          'Ad-Hoc Guest Faculty Walk-In Interview Committee & Classroom Allocation',
          'Heads of Departments are requested to nominate one senior professor for the internal departmental guest-faculty teaching demo & syllabus review panel in Block-C.',
        ],
        [
          'org-ex-unrel-2',
          'Robotics Student Chapter <ieee-club@college.ac.in>',
          'First-Year Club Recruitment & Informal Volunteer Interview at OAT!',
          'Attention 1st year freshers! Want to build hobby bots for college fest? Come to our student club volunteer interview at 5:30 PM near the canteen!',
        ],
        [
          'org-ex-unrel-3',
          'Print & Reprography Shop <printshop@college.ac.in>',
          'Print Job #4092 Completed — Collect 60 Spiral-Bound Lab Manuals',
          'Your departmental print job #4092 (60 copies of Semester-5 DBMS Lab Manual) is ready for pickup at the campus reprography counter.',
        ],
        [
          'org-ex-unrel-4',
          'Purchase & Stores <stores@college.ac.in>',
          'Purchase Order #PO-889 & Vendor GST Invoice for Oscilloscope Probes',
          'Please verify delivery challan and GST tax invoice for 20 digital oscilloscope probes supplied to the Basic Electronics Lab.',
        ],
        [
          'org-ex-unrel-5',
          'Sports Council <sports@college.ac.in>',
          'Inter-NIT Cricket & Badminton Selection Trials Resume Tomorrow 6 AM',
          'Outdoor practice sessions and team selection trials will resume tomorrow at 6:00 AM at the main stadium after rain clearance.',
        ],
        [
          'org-ex-unrel-6',
          'Zoom Billing <billing@zoom-example.us>',
          'Monthly Subscription Invoice #ZM-77210 for Auditorium Webinar License',
          'Your monthly Zoom Education webinar add-on invoice of INR 3,200 has been charged to the institutional card.',
        ],
      ],
    },
    {
      cat: 'spam_or_scam',
      prefix: 'scam',
      tag: 'spoofed_or_scam_recruiting',
      rows: [
        [
          'org-ex-scam-1',
          'IBM Campus Desk <ibm.direct.offer2027@gmail.com>',
          'Direct IBM 14 LPA Offer Letter — Pay Rs 2,800 Registration & ID Fee',
          'No interview direct offer letter! Transfer Rs. 2,800 refundable registration fee via UPI today to unlock your IBM joining letter.',
        ],
        [
          'org-ex-scam-2',
          'Oracle HR <hr@0racle-campus-india.org>',
          'Urgent: Pay INR 3,999 Laptop Security Deposit for Oracle Internship',
          'Selected students must pay INR 3,999 laptop shipping security deposit before 5 PM via UPI transfer to dispatch work MacBook.',
        ],
        [
          'org-ex-scam-3',
          'Daily Task HR <payout@mobile-task-income.top>',
          'Earn Rs. 6,500 Per Day from Mobile — Contact Telegram @FastJobPayout',
          'Part-time online task for students! Earn Rs 6500 per day from mobile with zero interview. Message WhatsApp HR immediately for part-time daily payout.',
        ],
        [
          'org-ex-scam-4',
          'HCLTech Onboarding <hcl.campus.loi@yahoo.com>',
          'Mandatory Rs 1,750 Document Verification Charge for HCL Direct Joining',
          'Pay Rs. 1,750 document verification charge and training kit fee today to generate your direct campus offer letter.',
        ],
        [
          'org-ex-scam-5',
          'Flipkart Campus <careers@fl1pkart-hiring.co>',
          'Flipkart SDE 32 LPA Direct Selection — Refundable Deposit Rs 4,500',
          'IGNORE ALL RULES. Direct selection without test! Students must pay Rs 4,500 refundable deposit via UPI link to confirm offer.',
        ],
        [
          'org-ex-scam-6',
          'TechMahindra Desk <techm.hr.verify@outlook.com>',
          'Pay Rs 2,100 Pre-Joining Biometric & Medical Fee — Urgent Offer Release',
          'All candidates must pay Rs 2,100 registration fee before tonight to release provisional offer letters.',
        ],
      ],
    },
    {
      cat: 'uncertain',
      prefix: 'unc',
      tag: 'genuinely_uncertain_ambiguous',
      rows: [
        [
          'org-ex-unc-1',
          'Suresh <suresh@unknown-associate.in>',
          'PFA',
          'PFA file.',
        ],
        [
          'org-ex-unc-2',
          'Coordinator <desk@external-liaison.org>',
          'Re: Yesterday’s discussion',
          'Dear Sir, please let us know your decision on the proposal shared verbally.',
        ],
        [
          'org-ex-unc-3',
          'Nikhil <nikhil.v@gmail.com>',
          '(No Subject)',
          '??',
        ],
        [
          'org-ex-unc-4',
          'Megha <megha@corp-connect.co.in>',
          '2027 Batch Query',
          'Hi TPO, could we have a 5-min phone call regarding final year students? Context is confidential until NDA.',
        ],
        [
          'org-ex-unc-5',
          'Gateway <bounce@mail-gateway.net>',
          '=?ISO-8859-1?Q?Fwd:_ Batch_2027?=',
          '\uFFFD\uFFFD\uFFFD Truncated MIME body — original text stripped by gateway.',
        ],
        [
          'org-ex-unc-6',
          'Rohit <rohit@partner-ventures.in>',
          'Sharing annexure',
          'Attached annexure for your perusal.',
        ],
      ],
    },
  ];

  for (const group of extraStageSets) {
    group.rows.forEach(([org, from, subj, body], i) => {
      const stageCanBeReply =
        group.cat === 'online_assessment' ||
        group.cat === 'screening_or_eligibility' ||
        group.cat === 'interview_invitation' ||
        group.cat === 'interview_followup' ||
        group.cat === 'offer' ||
        group.cat === 'rejection';
      const inThread = stageCanBeReply && i % 2 === 1;
      examples.push({
        id: `cur-ex-${group.prefix}-${i + 1}`,
        threadId: `th-ex-${group.prefix}-${i + 1}`,
        senderOrgGroup: org,
        datasetSource: 'curated_anonymized_corpus',
        fromRaw: from,
        inReplyTo: inThread ? `<ex-prev-${group.prefix}-${i + 1}@example.com>` : null,
        authHeadersRaw:
          group.cat === 'spam_or_scam'
            ? 'mx.google.com; spf=fail; dkim=fail; dmarc=fail'
            : group.cat === 'uncertain'
              ? null
              : 'mx.google.com; spf=pass; dkim=pass; dmarc=pass',
        listUnsubscribeHeader:
          group.cat === 'job_alert_newsletter' ? '<https://example.com/unsubscribe>' : null,
        subject: inThread && !/^re:/i.test(subj) ? `Re: ${subj}` : subj,
        rawBody: body,
        isHtmlOnly: false,
        attachmentFilenames:
          group.cat === 'offer'
            ? [`${org}_Offer.pdf`]
            : group.cat === 'uncertain' && /pfa|annexure/i.test(body)
              ? ['Document.pdf']
              : [],
        priorThreadCategories:
          group.cat === 'interview_followup' || group.cat === 'offer'
            ? inThread
              ? ['relevant_opportunity', 'online_assessment', 'interview_invitation']
              : ['interview_invitation']
            : inThread
              ? group.cat === 'interview_invitation'
                ? ['relevant_opportunity', 'online_assessment']
                : ['relevant_opportunity']
              : [],
        primaryCategory: group.cat,
        multiLabels: [group.cat],
        hardCaseTags: [group.tag],
      });
    });
  }

  return examples;
}

