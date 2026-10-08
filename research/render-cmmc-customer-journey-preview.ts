import fs from "node:fs";
import path from "node:path";

type Objective = { question: string; baseline: string };
type Control = { domain: string; id: string; title: string; objectives: Objective[] };

const controls: Control[] = [
  {
    domain: "Access Control",
    id: "AC.L1-b.1.i",
    title: "Authorized Access Control",
    objectives: [
      { question: "Have all authorized users been identified?", baseline: "We maintain a current list of people authorized to use the in-scope systems, including their role and approval owner." },
      { question: "Have all processes acting on behalf of authorized users been identified?", baseline: "We identify service accounts, scheduled jobs, integrations, and other processes that act for a user." },
      { question: "Have all authorized devices and other systems been identified?", baseline: "We maintain an inventory of approved workstations, servers, mobile devices, and connected systems allowed to connect." },
      { question: "Is system access limited to authorized users?", baseline: "Access is granted only to approved users with individual accounts and is removed when authorization ends." },
      { question: "Is access limited to processes acting on behalf of authorized users?", baseline: "Service accounts and automated processes receive only the access needed for their approved job." },
      { question: "Is access limited to authorized devices and other systems?", baseline: "Network and application access is limited to managed or otherwise approved devices and systems." },
    ],
  },
  {
    domain: "Access Control",
    id: "AC.L1-b.1.ii",
    title: "Transaction & Function Control",
    objectives: [
      { question: "Are the transaction and function types authorized users may execute defined?", baseline: "For each role, we define which applications, transactions, and functions that role is allowed to perform." },
      { question: "Is access limited to those defined transaction and function types?", baseline: "Applications and permissions prevent users from performing transactions or functions outside their approved role." },
    ],
  },
  {
    domain: "Access Control",
    id: "AC.L1-b.1.iii",
    title: "External Connections",
    objectives: [
      { question: "Are connections to external systems identified?", baseline: "We keep a current list of external systems and services that connect to the in-scope environment." },
      { question: "Is use of external systems identified?", baseline: "We document why each external system is used and what FCI-related activity it supports." },
      { question: "Are connections to external systems verified?", baseline: "External connections are approved and checked against the intended system, owner, and business purpose." },
      { question: "Is use of external systems verified?", baseline: "We verify that external services are being used only for the approved purpose and by approved personnel." },
      { question: "Are connections to external systems controlled or limited?", baseline: "Firewalls, account permissions, configuration, or equivalent safeguards limit external connections to approved paths." },
      { question: "Is use of external systems controlled or limited?", baseline: "Company procedures and technical permissions limit what users can do with external systems." },
    ],
  },
  {
    domain: "Access Control",
    id: "AC.L1-b.1.iv",
    title: "Control Public Information",
    objectives: [
      { question: "Are individuals authorized to post or process information on public systems identified?", baseline: "We identify the people authorized to publish website, social, portal, or other public content." },
      { question: "Are procedures in place to ensure FCI is not posted or processed publicly?", baseline: "Our publishing procedure tells authorized staff to check content and keep FCI off public systems." },
      { question: "Is there a review before content is posted publicly?", baseline: "A designated reviewer checks proposed public content before it is published." },
      { question: "Is public content reviewed to ensure it does not include FCI?", baseline: "Published pages and public files are reviewed for accidental FCI exposure on a defined schedule." },
      { question: "Are mechanisms in place to remove and address improper FCI postings?", baseline: "We can remove an improper posting quickly, preserve an incident record, and notify the responsible owner." },
    ],
  },
  {
    domain: "Identification & Authentication",
    id: "IA.L1-b.1.v",
    title: "Identification",
    objectives: [
      { question: "Are system users identified?", baseline: "Users access systems through identifiable accounts tied to a named individual." },
      { question: "Are processes acting on behalf of users identified?", baseline: "Automated processes and service accounts have identifiable names, owners, and documented purposes." },
      { question: "Are devices accessing the system identified?", baseline: "Devices that access the environment have an identifiable asset name, owner, or management record." },
    ],
  },
  {
    domain: "Identification & Authentication",
    id: "IA.L1-b.1.vi",
    title: "Authentication",
    objectives: [
      { question: "Is each user authenticated or verified before system access?", baseline: "The system verifies each user’s identity before allowing access to organizational resources." },
      { question: "Is each process acting for a user authenticated or verified before access?", baseline: "Automated processes use an approved credential or equivalent verification before accessing resources." },
      { question: "Is each accessing or connecting device authenticated or verified before access?", baseline: "Devices are verified through management, network controls, certificates, or another documented method before access." },
    ],
  },
  {
    domain: "Media Protection",
    id: "MP.L1-b.1.vii",
    title: "Media Disposal",
    objectives: [
      { question: "Is media containing FCI sanitized or destroyed before disposal?", baseline: "Before disposal, FCI-containing paper and electronic media are sanitized or destroyed using an approved method." },
      { question: "Is media containing FCI sanitized before reuse?", baseline: "Before equipment or media is reassigned, we remove FCI using a documented sanitization process." },
    ],
  },
  {
    domain: "Physical Protection",
    id: "PE.L1-b.1.viii",
    title: "Limit Physical Access",
    objectives: [
      { question: "Are individuals authorized for physical access identified?", baseline: "We identify employees and other individuals who are allowed into areas containing in-scope systems or equipment." },
      { question: "Is physical access to organizational systems limited to authorized individuals?", baseline: "Only authorized individuals can physically access in-scope systems and their operating areas." },
      { question: "Is physical access to equipment limited to authorized individuals?", baseline: "In-scope computers, network devices, removable media, and related equipment are physically protected from unauthorized access." },
      { question: "Is physical access to operating environments limited to authorized individuals?", baseline: "Rooms, work areas, or other operating environments containing in-scope equipment are access-controlled." },
    ],
  },
  {
    domain: "Physical Protection",
    id: "PE.L1-b.1.ix",
    title: "Manage Visitors & Physical Access",
    objectives: [
      { question: "Are visitors escorted?", baseline: "Visitors entering protected areas are escorted by an authorized employee unless an approved exception applies." },
      { question: "Is visitor activity monitored?", baseline: "We monitor visitor activity in protected areas and record the responsible escort." },
      { question: "Are physical-access audit logs maintained?", baseline: "We retain badge, key, sign-in, or equivalent physical-access records for protected areas." },
      { question: "Are physical-access devices identified?", baseline: "Keys, badges, codes, and other physical-access devices are assigned an identifier and owner." },
      { question: "Are physical-access devices controlled?", baseline: "Access devices are issued, returned, disabled, and reviewed through a controlled process." },
      { question: "Are physical-access devices managed?", baseline: "We periodically review access-device assignments and promptly address lost, shared, or unneeded devices." },
    ],
  },
  {
    domain: "System & Communications Protection",
    id: "SC.L1-b.1.x",
    title: "Boundary Protection",
    objectives: [
      { question: "Is the external system boundary defined?", baseline: "We can identify where the in-scope environment connects to the internet, vendors, remote users, or other external systems." },
      { question: "Are key internal system boundaries defined?", baseline: "We identify important internal boundaries between user, server, production, guest, and other network areas." },
      { question: "Are communications monitored at the external boundary?", baseline: "External-boundary traffic is monitored through firewall, gateway, endpoint, or equivalent records." },
      { question: "Are communications monitored at key internal boundaries?", baseline: "Traffic across key internal boundaries is monitored where needed to identify unauthorized activity." },
      { question: "Are communications controlled at the external boundary?", baseline: "Boundary devices and rules allow only approved external communications and block unauthorized paths." },
      { question: "Are communications controlled at key internal boundaries?", baseline: "Internal segmentation and permissions control communications between key system areas." },
      { question: "Are communications protected at the external boundary?", baseline: "External communications are protected using appropriate secure protocols, filtering, and managed boundary devices." },
      { question: "Are communications protected at key internal boundaries?", baseline: "Communications across key internal boundaries use protections appropriate to the systems and FCI involved." },
    ],
  },
  {
    domain: "System & Communications Protection",
    id: "SC.L1-b.1.xi",
    title: "Public-Access System Separation",
    objectives: [
      { question: "Are publicly accessible system components identified?", baseline: "We identify website servers, public portals, cloud endpoints, and other components reachable by the public." },
      { question: "Are public components physically or logically separated from internal networks?", baseline: "Public-facing components are separated from internal networks through a documented physical or logical boundary." },
    ],
  },
  {
    domain: "System & Information Integrity",
    id: "SI.L1-b.1.xii",
    title: "Flaw Remediation",
    objectives: [
      { question: "Is the time to identify system flaws specified?", baseline: "Our vulnerability or maintenance procedure defines how quickly system flaws must be identified." },
      { question: "Are system flaws identified within that time?", baseline: "We identify flaws within the documented timeframe through vendor notices, scanning, monitoring, or review." },
      { question: "Is the time to report system flaws specified?", baseline: "Our procedure defines how quickly discovered flaws must be reported to the responsible owner." },
      { question: "Are flaws reported within that time?", baseline: "Discovered flaws are reported through a ticket, alert, or equivalent record within the defined timeframe." },
      { question: "Is the time to correct system flaws specified?", baseline: "Our procedure defines correction timeframes based on the flaw’s risk and the affected system." },
      { question: "Are system flaws corrected within that time?", baseline: "We correct or otherwise address flaws within the documented timeframe and retain the change or ticket record." },
    ],
  },
  {
    domain: "System & Information Integrity",
    id: "SI.L1-b.1.xiii",
    title: "Malicious Code Protection",
    objectives: [
      { question: "Are designated locations for malicious-code protection identified?", baseline: "We identify the endpoints, servers, email, gateways, or other locations where malicious-code protection is required." },
      { question: "Is protection from malicious code provided at each designated location?", baseline: "Approved anti-malware or equivalent protections are enabled and operating at each designated location." },
    ],
  },
  {
    domain: "System & Information Integrity",
    id: "SI.L1-b.1.xiv",
    title: "Update Malicious Code Protection",
    objectives: [
      { question: "Are malicious-code protection mechanisms updated when new releases are available?", baseline: "Protection tools receive updates when releases are available, and failed or outdated updates are reviewed." },
    ],
  },
  {
    domain: "System & Information Integrity",
    id: "SI.L1-b.1.xv",
    title: "System & File Scanning",
    objectives: [
      { question: "Is the frequency for malicious-code scans defined?", baseline: "Our procedure defines how often each applicable system is scanned for malicious code." },
      { question: "Are malicious-code scans performed at the defined frequency?", baseline: "Scheduled scans run at the defined frequency and results or exceptions are retained." },
      { question: "Are external files scanned in real time when downloaded, opened, or executed?", baseline: "Files from external sources are scanned in real time when downloaded, opened, or executed." },
    ],
  },
];

const esc = (value: string) => value
  .replace(/&/g, "&amp;")
  .replace(/</g, "&lt;")
  .replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;");

const controlPages = controls.map((control) => `
  <section class="page control-page">
    <div class="eyebrow">${esc(control.domain)} · ${esc(control.id)}</div>
    <h2>${esc(control.title)}</h2>
    <p class="section-lede">Customer answer area preview. Select a truthful status, then adapt the baseline language to the company’s actual people, systems, locations, and procedures.</p>
    <div class="status-legend"><span class="status">MET</span><span class="status no">NOT MET</span><span class="status unsure">NOT APPLICABLE + RATIONALE</span></div>
    ${control.objectives.map((objective, index) => `
      <article class="objective">
        <div class="objective-number">${String(index + 1).padStart(2, "0")}</div>
        <div class="objective-body">
          <div class="question">${esc(objective.question)}</div>
          <div class="baseline"><strong>Generic baseline to adapt:</strong> “${esc(objective.baseline)}”</div>
          <div class="answer-line"><span>Your wording / evidence location:</span><i></i></div>
        </div>
      </article>
    `).join("")}
    <div class="control-footer">Do not copy the baseline unless it is accurate. A reviewer must validate each response against the actual environment.</div>
  </section>
`).join("");

const html = `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>CMMC Level 1 Customer Journey Preview</title>
<style>
  @page { size: Letter; margin: 0.52in; }
  * { box-sizing: border-box; }
  :root { --navy: #102a43; --blue: #1d70b8; --teal: #0b7a75; --ink: #243b53; --muted: #627d98; --pale: #f0f6fb; --line: #d9e2ec; --gold: #c98b2e; }
  body { margin: 0; font-family: Arial, Helvetica, sans-serif; color: var(--ink); font-size: 10pt; line-height: 1.38; }
  .page { page-break-after: always; min-height: 9.85in; position: relative; }
  .page:last-child { page-break-after: auto; }
  .cover { color: white; padding: 0.15in 0.16in; display: flex; flex-direction: column; justify-content: space-between; background: linear-gradient(145deg, #102a43 0%, #174e73 58%, #0b7a75 100%); }
  .cover:before { content: ""; position: absolute; width: 4.8in; height: 4.8in; border: 1px solid rgba(255,255,255,.18); border-radius: 50%; right: -1.8in; top: 1.0in; }
  .cover:after { content: ""; position: absolute; width: 3.3in; height: 3.3in; border: 1px solid rgba(255,255,255,.12); border-radius: 50%; right: -0.95in; top: 1.75in; }
  .brand { letter-spacing: .16em; text-transform: uppercase; font-size: 9pt; color: #b9e6e2; font-weight: 700; }
  .cover h1 { font-size: 34pt; line-height: 1.05; max-width: 6.5in; margin: 0.45in 0 0.16in; letter-spacing: -.03em; }
  .cover h1 span { color: #f2c879; }
  .cover .dek { font-size: 16pt; max-width: 6.4in; color: #e6f6f5; line-height: 1.3; }
  .cover-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; max-width: 7.3in; }
  .cover-stat { border-top: 2px solid #f2c879; padding-top: 8px; }
  .cover-stat b { display: block; font-size: 20pt; color: white; }
  .cover-stat small { color: #cfe9e7; font-size: 8.5pt; }
  .cover-note { border-top: 1px solid rgba(255,255,255,.32); padding-top: 12px; max-width: 7.3in; color: #d8eeec; font-size: 8.5pt; }
  .topline { display:flex; justify-content:space-between; align-items:center; border-bottom: 2px solid var(--navy); padding-bottom: 8px; margin-bottom: 22px; }
  .topline .brand { color: var(--teal); font-size: 8pt; }
  .topline .page-label { color: var(--muted); font-size: 8pt; }
  h2 { color: var(--navy); font-size: 24pt; line-height: 1.08; margin: 0 0 8px; letter-spacing: -.02em; }
  h3 { color: var(--navy); margin: 0 0 5px; font-size: 13pt; }
  .intro { font-size: 12pt; max-width: 7.15in; color: #486581; }
  .journey { display: grid; grid-template-columns: repeat(5, 1fr); gap: 9px; margin: 30px 0; }
  .step { background: var(--pale); border: 1px solid var(--line); border-top: 4px solid var(--blue); padding: 12px 9px; min-height: 1.72in; }
  .step:nth-child(2) { border-top-color: var(--teal); } .step:nth-child(3) { border-top-color: var(--gold); } .step:nth-child(4) { border-top-color: #7b61a8; } .step:nth-child(5) { border-top-color: #be5a3d; }
  .step-num { font-size: 18pt; font-weight: 700; color: var(--blue); } .step:nth-child(2) .step-num { color: var(--teal); } .step:nth-child(3) .step-num { color: var(--gold); } .step:nth-child(4) .step-num { color: #7b61a8; } .step:nth-child(5) .step-num { color: #be5a3d; }
  .step strong { display:block; color: var(--navy); margin: 5px 0; font-size: 9pt; } .step p { margin: 0; color: #526a80; font-size: 8pt; }
  .callout { background: #fff7e6; border-left: 4px solid var(--gold); padding: 12px 15px; margin: 18px 0; }
  .callout strong { color: #805b1c; }
  .two-col { display:grid; grid-template-columns: 1fr 1fr; gap: 18px; }
  .panel { border: 1px solid var(--line); border-radius: 5px; padding: 15px; background: white; }
  .panel h3 { border-bottom: 1px solid var(--line); padding-bottom: 7px; margin-bottom: 10px; }
  .panel ul { margin: 7px 0 0 18px; padding: 0; } .panel li { margin: 5px 0; font-size: 9pt; }
  .email-card { margin: 15px auto; max-width: 6.8in; border: 1px solid #cbd5e1; border-radius: 8px; box-shadow: 0 4px 12px rgba(16,42,67,.08); overflow: hidden; }
  .email-head { background:#f4f7fa; border-bottom:1px solid #d9e2ec; padding: 11px 15px; font-size: 8.5pt; color:#526a80; }
  .email-body { padding: 17px 20px 20px; } .email-body h3 { font-size: 16pt; } .email-body p { font-size: 9.5pt; }
  .fake-link { display:inline-block; background: var(--blue); color:white; text-decoration:none; padding: 11px 17px; border-radius: 4px; font-weight:700; margin: 7px 0 10px; }
  .security-strip { background:#e9f7f5; color:#17635f; padding: 9px 12px; border-radius:4px; font-size:8.5pt; }
  .browser { border: 1px solid #bcccdc; border-radius: 7px; overflow: hidden; box-shadow: 0 4px 14px rgba(16,42,67,.1); margin-top: 16px; }
  .browser-bar { background:#f0f4f8; padding:8px 12px; color:#829ab1; font-size:8pt; } .browser-bar span { display:inline-block; background:white; border:1px solid #d9e2ec; border-radius:3px; padding:3px 12px; width: 75%; margin-left:10px; color:#627d98; }
  .form-ui { padding: 17px; } .form-ui h3 { font-size: 15pt; } .form-ui .progress { height:6px; background:#e5edf5; border-radius: 99px; margin: 10px 0 15px; } .form-ui .progress b { display:block; width:31%; height:6px; background: var(--teal); border-radius:99px; }
  .form-question { border: 1px solid var(--line); padding: 12px; border-radius:5px; margin-top:10px; } .form-question .q { font-weight:700; color: var(--navy); font-size:9.5pt; } .form-question .hint { margin-top:6px; background:#f7fafc; padding:8px; color:#627d98; font-size:8pt; } .answer-box { margin-top:9px; height: 35px; border:1px dashed #9fb3c8; border-radius:4px; padding:7px; color:#9fb3c8; font-size:8pt; }
  .pills { display:flex; gap:5px; margin-top:9px; } .pill { border:1px solid #9fb3c8; color:#486581; padding:4px 7px; border-radius:20px; font-size:7.5pt; } .pill.active { background:#e9f7f5; color:#17635f; border-color:#67b9b1; }
  .report-cover { background: linear-gradient(145deg, #f2f7fb, #ffffff); border:1px solid var(--line); padding: 25px; min-height: 7.6in; position:relative; } .report-cover .stamp { color: var(--teal); border:1px solid #8bd1ca; display:inline-block; padding:5px 9px; font-size:8pt; text-transform:uppercase; letter-spacing:.11em; } .report-cover h3 { font-size:25pt; margin-top:38px; max-width:5.5in; } .report-cover .report-meta { color:#627d98; margin-top:10px; } .report-cover .report-footer { position:absolute; bottom:25px; left:25px; right:25px; border-top:1px solid var(--line); padding-top:11px; font-size:8pt; color:#627d98; }
  .metric-grid { display:grid; grid-template-columns:repeat(4,1fr); gap:9px; margin:16px 0; } .metric { background:var(--pale); padding:12px; border:1px solid var(--line); } .metric b { display:block; color:var(--navy); font-size:18pt; } .metric span { color:#627d98; font-size:8pt; }
  .result { padding:13px 15px; background:#e9f7f5; border-left:4px solid var(--teal); margin: 15px 0; } .result strong { color:#17635f; }
  .mini-table { width:100%; border-collapse:collapse; font-size:8.5pt; margin-top:12px; } .mini-table th { text-align:left; background:var(--navy); color:#fff; padding:7px; } .mini-table td { border:1px solid var(--line); padding:7px; } .mini-table tr:nth-child(even) td { background:#f7fafc; }
  .eyebrow { color:var(--teal); text-transform:uppercase; letter-spacing:.12em; font-size:8pt; font-weight:700; margin-bottom:8px; } .section-lede { color:#627d98; max-width:7in; margin:0 0 8px; font-size:9pt; } .status-legend { display:flex; gap:6px; margin: 10px 0 13px; } .status { border-radius:20px; background:#d9f2ef; color:#17635f; padding:3px 8px; font-size:7.5pt; font-weight:700; } .status.partial { background:#fff1cc; color:#805b1c; } .status.no { background:#fde3df; color:#8f3125; } .status.unsure { background:#e8eaf5; color:#514b82; }
  .objective { display:grid; grid-template-columns: 0.35in 1fr; gap:9px; border:1px solid var(--line); border-radius:4px; margin: 7px 0; padding: 8px 9px; break-inside: avoid; } .objective-number { color:var(--blue); font-size:10pt; font-weight:700; padding-top:2px; } .question { color:var(--navy); font-weight:700; font-size:8.5pt; } .baseline { margin-top:4px; background:#f7fafc; color:#526a80; padding:5px 7px; font-size:7.7pt; } .baseline strong { color:#486581; } .answer-line { display:flex; align-items:end; gap:7px; margin-top:6px; color:#829ab1; font-size:7.4pt; } .answer-line i { display:block; flex:1; border-bottom:1px dashed #9fb3c8; height:10px; } .control-footer { border-top:1px solid var(--line); color:#829ab1; margin-top:12px; padding-top:8px; font-size:7.5pt; }
  .sources { font-size:8.5pt; color:#526a80; } .sources li { margin:7px 0; } .footer-note { position:absolute; bottom:0; left:0; right:0; border-top:1px solid var(--line); padding-top:8px; color:#829ab1; font-size:7.5pt; }
</style>
</head>
<body>
  <section class="page cover">
    <div>
      <div class="brand">Customer journey preview · CMMC readiness</div>
      <h1>From secure link to a <span>submission-ready</span> preparation packet.</h1>
      <p class="dek">A visual concept for the CMMC Level 1 Self-Assessment Preparation workflow.</p>
    </div>
    <div>
      <div class="cover-grid">
        <div class="cover-stat"><b>15</b><small>official FAR safeguarding requirements</small></div>
        <div class="cover-stat"><b>59</b><small>underlying assessment objectives</small></div>
        <div class="cover-stat"><b>2</b><small>matched customer files: PDF + Word</small></div>
      </div>
      <p class="cover-note"><strong>Concept rule:</strong> Generic baseline language is a starting point only. The customer must replace it with truthful, company-specific wording and evidence locations. This packet is not a CMMC certificate, legal opinion, third-party assessment, or SPRS submission.</p>
    </div>
  </section>

  <section class="page">
    <div class="topline"><span class="brand">CMMC Level 1 · Customer journey</span><span class="page-label">01 / Overview</span></div>
    <h2>What the customer experiences</h2>
    <p class="intro">The customer receives a protected link, works through each section in plain language, and gets a clear preparation packet they can use while making their own official entry and affirmation in SPRS.</p>
    <div class="journey">
      <div class="step"><div class="step-num">01</div><strong>Secure invitation</strong><p>A named customer receives an expiring link with a plain-language explanation of what to prepare.</p></div>
      <div class="step"><div class="step-num">02</div><strong>Save as they go</strong><p>The form remembers progress and explains what each question is asking before the customer answers.</p></div>
      <div class="step"><div class="step-num">03</div><strong>Operator review</strong><p>We check completeness, scope, CUI diversion, and unsupported answers before any packet is generated.</p></div>
      <div class="step"><div class="step-num">04</div><strong>Matched files</strong><p>The final response snapshot becomes a branded PDF and Word file with the same content.</p></div>
      <div class="step"><div class="step-num">05</div><strong>Customer submits</strong><p>The company’s authorized official uses the packet to complete its own SPRS entry and affirmation.</p></div>
    </div>
    <div class="callout"><strong>Important wording:</strong> We prepare the company to self-assess. We do not certify the company, make its affirmation, log into SPRS for it, or promise a Government submission.</div>
    <div class="two-col">
      <div class="panel"><h3>What the customer supplies</h3><ul><li>Company and CAGE information</li><li>FCI scope and systems in scope</li><li>Truthful answers to all objective questions</li><li>Evidence locations and responsible owners</li><li>Affirming Official information</li></ul></div>
      <div class="panel"><h3>What the customer receives</h3><ul><li>Readiness result and blocked items</li><li>Evidence-organizing checklist</li><li>SPRS field checklist</li><li>PDF preparation packet</li><li>Editable Word preparation packet</li></ul></div>
    </div>
  </section>

  <section class="page">
    <div class="topline"><span class="brand">CMMC Level 1 · Customer journey</span><span class="page-label">02 / Invitation</span></div>
    <h2>The link the customer receives</h2>
    <p class="intro">The actual message should feel simple and safe. It should tell the customer what not to paste into the form and make the official responsibility unmistakable.</p>
    <div class="email-card">
      <div class="email-head"><strong>From:</strong> CMMC Readiness Team &nbsp; · &nbsp; <strong>Subject:</strong> Your CMMC Level 1 preparation questionnaire</div>
      <div class="email-body">
        <h3>Lake County Tool Works North — next step</h3>
        <p>We created a secure questionnaire to help your company prepare its CMMC Level 1 self-assessment. It should take about 30–45 minutes, and you can save your progress and return later.</p>
        <p>For each question, describe what your company actually does. We provide a generic example under every answer box to give you a starting point—please replace it with your own wording.</p>
        <a class="fake-link">Open secure questionnaire</a>
        <div class="security-strip"><strong>Security reminder:</strong> Do not paste FCI, CUI, passwords, credentials, system logs, screenshots, or technical diagrams into this form. Use an evidence location and the responsible person instead.</div>
        <p style="font-size:8.5pt;color:#627d98;">This link expires after 30 days and can be revoked by the program operator. If your contract data may be CUI, stop and contact us before continuing with a Level 1 form.</p>
      </div>
    </div>
    <div class="two-col">
      <div class="panel"><h3>Customer sees</h3><ul><li>Company name and named contact</li><li>Expiration and save/resume instructions</li><li>Scope and FCI/CUI warning</li><li>Support contact</li></ul></div>
      <div class="panel"><h3>Operator controls</h3><ul><li>Unique, revocable token</li><li>Public endpoint returns minimum data</li><li>Expired links reveal nothing</li><li>No automatic approval or delivery</li></ul></div>
    </div>
  </section>

  <section class="page">
    <div class="topline"><span class="brand">CMMC Level 1 · Customer journey</span><span class="page-label">03 / Questionnaire screen</span></div>
    <h2>Every answer box teaches without answering for them</h2>
    <p class="intro">The baseline appears as helper text. The customer chooses a status, writes in their own words, and records where supporting evidence can be found.</p>
    <div class="browser">
      <div class="browser-bar">Secure CMMC questionnaire <span>https://secure.example.com/cmmc/••••••••</span></div>
      <div class="form-ui">
        <div style="display:flex;justify-content:space-between;"><div><div class="eyebrow">Access Control · AC.L1-b.1.i</div><h3>Authorized Access Control</h3></div><div style="color:#627d98;font-size:8pt;">Section 4 of 15</div></div>
        <div class="progress"><b></b></div>
        <div class="form-question">
           <div class="q">[a] authorized users are identified;</div>
           <div class="pills"><span class="pill active">MET</span><span class="pill">NOT MET</span><span class="pill">NOT APPLICABLE</span></div>
          <div class="hint"><strong>Generic baseline to adapt:</strong> “We maintain a current list of people authorized to use the in-scope systems, including their role and approval owner.”</div>
          <div class="answer-box">Your wording and evidence location — for example, the name of a policy, system report, or owner. Do not paste the evidence itself.</div>
        </div>
        <div class="form-question">
          <div class="q">Have all authorized devices and other systems been identified?</div>
          <div class="hint"><strong>Generic baseline to adapt:</strong> “We maintain an inventory of approved workstations, servers, mobile devices, and connected systems allowed to connect.”</div>
          <div class="answer-box">Your wording and evidence location</div>
        </div>
        <div style="display:flex;justify-content:space-between;align-items:center;margin-top:14px;"><span style="color:#829ab1;font-size:8pt;">Saved just now · 31% complete</span><span class="fake-link" style="margin:0;padding:7px 12px;font-size:8pt;">Save and continue</span></div>
      </div>
    </div>
         <div class="callout"><strong>What “baseline” means:</strong> It is a plain-English scaffold, not a suggested answer to copy. If the customer cannot truthfully support the official determination statement, they should select Not met. A Not applicable determination requires a scope-based rationale in the report.</div>
  </section>

  <section class="page">
    <div class="topline"><span class="brand">CMMC Level 1 · Customer journey</span><span class="page-label">04 / Status logic</span></div>
    <h2>The result is honest before it is polished</h2>
    <div class="metric-grid"><div class="metric"><b>15</b><span>requirements reviewed</span></div><div class="metric"><b>59</b><span>objective prompts answered</span></div><div class="metric"><b>6 yrs</b><span>evidence retention period</span></div><div class="metric"><b>1 yr</b><span>annual status cycle</span></div></div>
    <div class="result"><strong>Ready for operator review</strong><br>All required questions are answered and the customer has provided evidence locations. This does not mean certified or ready to affirm until the operator validates the scope and responses.</div>
    <div class="panel" style="margin-top:14px;"><h3>Blocked / not ready to affirm</h3><ul><li>Any requirement is No, Partial, or Unknown.</li><li>Evidence location is missing or cannot be validated.</li><li>FCI scope is unclear or systems are omitted.</li><li>CUI is present or cannot be ruled out.</li><li>The assessment date or CAGE scope is missing.</li><li>The customer is trying to use a Level 1 POA&M.</li></ul></div>
    <h3 style="margin-top:22px;">What is reported to SPRS versus retained internally</h3>
    <table class="mini-table"><tr><th>Entered in SPRS</th><th>Retained by the company / used in the packet</th></tr><tr><td>CMMC Level; CMMC Status Date; CMMC Assessment Scope; all associated industry CAGE codes; compliance result</td><td>Objective answers, evidence locations, scope notes, asset context, reviewer notes, and supporting artifacts</td></tr><tr><td>Affirmation by the company’s authorized Affirming Official</td><td>Evidence artifacts retained for six years from the CMMC Status Date</td></tr></table>
    <div class="callout" style="margin-top:18px;"><strong>Customer-facing language:</strong> “This packet helps you prepare your own self-assessment. Your Affirming Official is responsible for reviewing the facts, entering the result in SPRS, and making the official affirmation.”</div>
  </section>

  <section class="page">
    <div class="topline"><span class="brand">CMMC Level 1 · Example deliverable</span><span class="page-label">05 / Report cover</span></div>
    <div class="report-cover">
      <span class="stamp">Preparation packet · draft preview</span>
      <h3>CMMC Level 1<br>Self-Assessment<br>Preparation Report</h3>
      <p class="report-meta"><strong>Prepared for:</strong> Lake County Tool Works North<br><strong>Assessment scope:</strong> Customer-defined FCI environment<br><strong>Status:</strong> Example layout — not a Government result</p>
      <div class="report-footer"><strong>Contents:</strong> Company profile · Scope and FCI boundary · 15 requirements / 59 objectives · Evidence checklist · SPRS preparation fields · Official responsibility notice<br><br>PDF and Word versions are generated from the same frozen response snapshot.</div>
    </div>
  </section>

  <section class="page">
    <div class="topline"><span class="brand">CMMC Level 1 · Example deliverable</span><span class="page-label">06 / Report body</span></div>
    <h2>What the finished report contains</h2>
    <div class="two-col">
      <div class="panel"><h3>1. Assessment profile</h3><ul><li>Legal organization and contact</li><li>Contract or flow-down context</li><li>All CAGE codes tied to scope</li><li>Status date and assessment scope</li><li>Affirming Official preparation details</li></ul></div>
      <div class="panel"><h3>2. Scope narrative</h3><ul><li>What FCI is handled</li><li>Where it is accessed, stored, transmitted, printed, or disposed</li><li>Systems, people, facilities, and providers in scope</li><li>CUI diversion result</li></ul></div>
      <div class="panel"><h3>3. Requirement findings</h3><ul><li>Each official requirement identifier</li><li>Every underlying objective</li><li>Customer wording</li><li>Evidence locator and owner</li><li>Operator review status</li></ul></div>
      <div class="panel"><h3>4. Submission checklist</h3><ul><li>Five SPRS result fields</li><li>AO transfer/affirmation steps</li><li>Annual reassessment reminder</li><li>Six-year evidence-retention reminder</li><li>Disclaimer and source citations</li></ul></div>
    </div>
    <div class="callout" style="margin-top:22px;"><strong>PDF + Word parity:</strong> The Word file is not a different report. It is the editable companion generated from the same response snapshot, so the customer can keep working in their own records without the two versions drifting.</div>
    <h3 style="margin-top:24px;">Example evidence wording</h3>
    <div class="panel"><p style="margin:0;color:#526a80;">“Access is limited through individual Microsoft 365 and workstation accounts. The office manager approves new access, the IT provider provisions it, and the quarterly user-access review is stored in the access-review folder.”</p><p style="margin:8px 0 0;color:#829ab1;font-size:8pt;">This is illustrative structure only. The customer must replace it with actual systems, owners, procedures, and evidence locations.</p></div>
  </section>

  ${controlPages}

  <section class="page">
    <div class="topline"><span class="brand">CMMC Level 1 · Final handoff</span><span class="page-label">Appendix / sources</span></div>
    <h2>What the customer can do with the files</h2>
    <div class="two-col">
      <div class="panel"><h3>PDF file</h3><ul><li>Easy to read and share internally</li><li>Fixed snapshot of the reviewed answers</li><li>Includes readiness status, scope, sources, and checklists</li></ul></div>
      <div class="panel"><h3>Word file</h3><ul><li>Editable internal workpaper</li><li>Can be updated when facts change</li><li>Must not be treated as a Government filing</li></ul></div>
    </div>
    <div class="callout"><strong>Before SPRS:</strong> The company’s Affirming Official reviews the actual environment and evidence, confirms the result, enters the required fields into SPRS, and makes the official affirmation. The preparation packet does not perform those actions.</div>
    <h3 style="margin-top:24px;">Official sources represented in this preview</h3>
    <ol class="sources">
      <li>32 CFR § 170.15 — Level 1 self-assessment, five SPRS result fields, all-MET requirement, annual assessment, no POA&amp;Ms, and six-year evidence retention.</li>
      <li>32 CFR § 170.19 — CMMC assessment scope.</li>
      <li>32 CFR § 170.22 — affirmation requirements.</li>
      <li>FAR 52.204-21 — 15 basic safeguarding requirements for covered contractor information systems.</li>
      <li>DoD CIO CMMC Assessment Guide — Level 1, Version 2.13 — the 59 underlying assessment objectives.</li>
      <li>DoD CIO CMMC Assessment Scope — Level 1, Version 2.13.</li>
      <li>SPRS CMMC Level 1 Self-Assessment Quick Entry Guide, Version 4.0.</li>
      <li>DFARS 252.204-7021 — contract eligibility and continuing-compliance context.</li>
    </ol>
    <div class="footer-note">Concept preview generated for product design discussion. Generic baseline text must be verified and rewritten for the customer’s real environment before use.</div>
  </section>
</body>
</html>`;

(async () => {
  const outDir = path.join(process.cwd(), "uploads");
  const outPath = path.join(outDir, "CMMC-Level-1-Customer-Journey-Preview.pdf");
  fs.mkdirSync(outDir, { recursive: true });

  const key = process.env.BROWSERLESS_API_KEY;
  if (!key) {
    throw new Error("BROWSERLESS_API_KEY is not configured");
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 90_000);
  try {
    const response = await fetch(`https://production-sfo.browserless.io/pdf?token=${key}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        html,
        options: {
          format: "Letter",
          landscape: false,
          printBackground: true,
          margin: { top: "0.52in", bottom: "0.52in", left: "0.52in", right: "0.52in" },
        },
      }),
    });
    if (!response.ok) throw new Error(`Browserless returned ${response.status}: ${(await response.text()).slice(0, 250)}`);
    const pdf = Buffer.from(await response.arrayBuffer());
    if (pdf.length < 1000 || pdf.subarray(0, 5).toString() !== "%PDF-") throw new Error("Browserless returned invalid PDF output");
    fs.writeFileSync(outPath, pdf);
    console.log(`CMMC_PREVIEW_PDF=${outPath}`);
    console.log(`CMMC_PREVIEW_SIZE=${pdf.length}`);
    console.log(`CMMC_PREVIEW_CONTROLS=${controls.length}`);
    console.log(`CMMC_PREVIEW_OBJECTIVES=${controls.reduce((total, control) => total + control.objectives.length, 0)}`);
  } finally {
    clearTimeout(timer);
  }
})().catch((error) => {
  console.error(`CMMC_PREVIEW_ERROR=${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});