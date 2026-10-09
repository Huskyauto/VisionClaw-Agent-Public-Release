# CMMC Level 1: Full Government-Reporting and Assessment Question Inventory

**Research status:** Complete through August 2026  
**Purpose:** Define the exact questionnaire a company needs to prepare a CMMC Level 1 self-assessment and annual SPRS reporting package.  
**Important:** This is a preparation workpaper, not a CMMC certification, legal opinion, third-party assessment, or submission to SPRS.

## The short answer

A Level 1 company does **not** upload a 59-question form to the Government.

It must:

1. Assess the 15 basic safeguarding requirements using their underlying **59 assessment objectives**.
2. Achieve a supported result that allows a `Final Level 1 (Self)` status. Every applicable Level 1 requirement must be MET; POA&Ms are not permitted for Level 1.
3. Enter at least five result fields in SPRS.
4. Have the company’s authorized Affirming Official affirm compliance in SPRS.
5. Retain the assessment evidence used to support the result for **six years** from the CMMC Status Date.

The 59 objective questions below are what our customer form must capture to help a company prepare accurately. The five SPRS fields are the smaller set actually reported into the Government system.

## 1. Applicability gate — ask before collecting the form

These questions determine whether the Level 1 flow is appropriate at all.

1. Does a DoD solicitation, contract, option, extension, or subcontract require `CMMC Level 1 (Self)`?
2. What contract, solicitation, subcontract, or flow-down creates that requirement?
3. Does the company process, store, or transmit **Federal Contract Information (FCI)** for that work?
4. Is any data handled by the proposed scope **Controlled Unclassified Information (CUI)**, or could it be CUI?
5. If CUI is present or uncertain, what system, asset, external provider, or data flow is involved?

**Routing rule:** Level 1 is for FCI. A “yes” or “unknown” to CUI must stop the Level 1-ready workflow and route the company to contract/security review for the applicable CMMC level. Do not solve that by excluding the relevant system.

**Why this matters:** FAR 52.204-21 defines a covered contractor information system as one the contractor owns or operates that processes, stores, or transmits FCI. The CMMC scope rules and Level 1 Assessment Guide use FCI in place of CUI in the relevant objectives. [@far-basic-safeguarding] [@ecfr-cmmc-l1-self-assessment]

## 2. The five minimum Level 1 results reported in SPRS

For each Level 1 self-assessment result, 32 CFR § 170.15 requires at least:

1. **CMMC Level** — Level 1.
2. **CMMC Status Date** — the date for the submitted assessment result.
3. **CMMC Assessment Scope** — a clear description of the information system(s) addressed.
4. **All industry CAGE code(s)** associated with the information system(s) in that assessment scope.
5. **Compliance result** — the outcome that supports a `Final Level 1 (Self)` status.

The regulation does **not** list a NIST 800-171 numerical score, UEI, evidence upload, policy upload, screenshots, network diagram, or per-control answers as required Level 1 SPRS result fields. The company should retain evidence, not assume it is supposed to upload it to SPRS. [@ecfr-cmmc-l1-self-assessment]

### Questions our form must ask for the five fields

1. Confirm the assessment is **CMMC Level 1**.
2. What is the planned or actual CMMC Status Date?
3. In plain language, what information system(s) make up the CMMC Assessment Scope?
4. List every industry CAGE code associated with those information system(s).
5. What is the supported compliance result: `Final Level 1 (Self)` candidate or not ready to submit?

## 3. Affirmation and annual-cycle questions

These do not replace the Government’s SPRS workflow. They prepare the company to use it correctly.

1. Who is the proposed **Affirming Official**: full name, title, business email, and business phone?
2. Is that person a senior representative responsible for the organization’s CMMC compliance and authorized to affirm continuing compliance?
3. Does the intended SPRS user have PIEE access and the `SPRS Cyber Vendor User` role?
4. If the data-entry user is not the Affirming Official, who will transfer the record to the AO?
5. Has the company completed a new Level 1 self-assessment within the last year?
6. Has the company affirmed current compliance within the last year?
7. Has any change occurred in the company’s Level 1 compliance since its CMMC Status Date?
8. If a contract is already active, what CMMC UID(s) must be provided or updated with the Contracting Officer?

**Government rule:** The authorized official—not this product, its operator, or another employee—must affirm in SPRS. A current Final Level 1 (Self) status and its related affirmation are both no more than one year old, and there must have been no change in compliance since the Final CMMC Status Date. [@ecfr-cmmc-l1-self-assessment] [@ecfr-cmmc-affirmation] [@sprs-l1-quick-entry] [@dfars-cmmc-contract-clause]

## 4. Scope and evidence-preparation questions

Level 1 does not require the company to upload a standalone scope diagram to SPRS. However, without these answers, a company cannot reliably assess the correct systems or retain credible evidence.

### 4.1 FCI and data-flow questions

1. Describe each type of FCI received from, or generated for, the Government under the relevant contract.
2. For each FCI type, where is it received, entered, created, edited, processed, stored, printed, transmitted, or disposed?
3. What users, systems, devices, locations, and providers can access it?
4. What public systems, if any, could expose the FCI?

### 4.2 Asset, location, and provider questions

For every system or asset that processes, stores, or transmits FCI:

1. What is its name or identifier?
2. Who owns it and who is technically responsible?
3. What is its function?
4. Does it process, store, or transmit FCI?
5. Where is it hosted or located?
6. Which systems, devices, networks, or providers connect to it?
7. Which evidence locator supports this description: inventory, data flow, configuration record, service contract, ticket, interview, or diagram?

Also ask:

1. Which people, facilities, technologies, and external service providers are involved in handling FCI?
2. Is each item in scope, out of scope, or a specialized asset? Why?
3. For every proposed exclusion, does it process, store, or transmit FCI? What evidence proves it does not?
4. Does the scope contain Government Furnished Equipment, IoT/IIoT, Operational Technology, a Restricted Information System, or Test Equipment? If yes, record the category and FCI relationship separately.

Do not treat the more expansive Level 2/Level 3 “Security Protection Asset” category as a Level 1 requirement. [@ecfr-cmmc-scope] [@dod-l1-scoping-guide]

### 4.3 Evidence-locator questions used for every requirement

For each requirement/objective, ask:

1. What is the company’s answer: `Yes`, `No`, `Partial`, `Unknown`, or `N/A candidate`?
2. Which in-scope system(s), people, facility, and external provider does the answer cover?
3. Who is accountable for it?
4. Where is the supporting evidence located, and what is its date? Collect the **locator**, not FCI, CUI, passwords, screenshots, logs, or secret material.
5. Is there an exception or N/A rationale? What qualified reviewer validates it?
6. If the answer is No, Partial, or Unknown, what blocks completion, who owns the fix, what is the target date, and what dependency exists?

For production assessment handling, customer `Yes/No/Partial/Unknown` responses are intake signals—not Government findings. The documented assessment result uses the assessment-guide convention `MET`, `NOT MET`, or a supported `N/A` determination. A Level 1 package must not call a company ready for final submission when an objective remains unsupported. [@dod-l1-assessment-guide] [@ecfr-cmmc-l1-self-assessment]

## 5. The complete 59-objective questionnaire

The questions below mirror the official Level 1 Assessment Guide’s assessment objectives. For Level 1, wherever the source objective says CUI, evaluate the same question for FCI. [@ecfr-cmmc-l1-self-assessment] [@dod-l1-assessment-guide]

### Access Control

#### AC.L1-b.1.i — Authorized Access Control (6 questions)

1. Have all authorized users been identified?
2. Have all processes acting on behalf of authorized users been identified?
3. Have all devices, including other systems, authorized to connect to the system been identified?
4. Is system access limited to authorized users?
5. Is system access limited to processes acting on behalf of authorized users?
6. Is system access limited to authorized devices, including other systems?

#### AC.L1-b.1.ii — Transaction & Function Control (2 questions)

1. Are the transaction and function types that authorized users may execute defined?
2. Is access limited to those defined transaction and function types for authorized users?

#### AC.L1-b.1.iii — External Connections (6 questions)

1. Are connections to external systems identified?
2. Is use of external systems identified?
3. Are connections to external systems verified?
4. Is use of external systems verified?
5. Are connections to external systems controlled or limited?
6. Is use of external systems controlled or limited?

#### AC.L1-b.1.iv — Control Public Information (5 questions)

1. Are individuals authorized to post or process information on publicly accessible systems identified?
2. Are procedures identified that ensure FCI is not posted or processed on publicly accessible systems?
3. Is a review process in place before any content is posted to a publicly accessible system?
4. Is public content reviewed to ensure that it does not include FCI?
5. Are mechanisms in place to remove and address an improper posting of FCI?

### Identification and Authentication

#### IA.L1-b.1.v — Identification (3 questions)

1. Are system users identified?
2. Are processes acting on behalf of users identified?
3. Are devices accessing the system identified?

#### IA.L1-b.1.vi — Authentication (3 questions)

1. Is each user’s identity authenticated or verified before system access?
2. Is each process acting on behalf of a user authenticated or verified before system access?
3. Is each device accessing or connecting to the system authenticated or verified before system access?

### Media Protection

#### MP.L1-b.1.vii — Media Disposal (2 questions)

1. Is system media containing FCI sanitized or destroyed before disposal?
2. Is system media containing FCI sanitized before it is released for reuse?

### Physical Protection

#### PE.L1-b.1.viii — Limit Physical Access (4 questions)

1. Are individuals authorized for physical access identified?
2. Is physical access to organizational systems limited to authorized individuals?
3. Is physical access to equipment limited to authorized individuals?
4. Is physical access to operating environments limited to authorized individuals?

#### PE.L1-b.1.ix — Manage Visitors & Physical Access (6 questions)

1. Are visitors escorted?
2. Is visitor activity monitored?
3. Are audit logs of physical access maintained?
4. Are physical access devices identified?
5. Are physical access devices controlled?
6. Are physical access devices managed?

### System and Communications Protection

#### SC.L1-b.1.x — Boundary Protection (8 questions)

1. Is the external system boundary defined?
2. Are key internal system boundaries defined?
3. Are communications monitored at the external system boundary?
4. Are communications monitored at key internal system boundaries?
5. Are communications controlled at the external system boundary?
6. Are communications controlled at key internal system boundaries?
7. Are communications protected at the external system boundary?
8. Are communications protected at key internal system boundaries?

#### SC.L1-b.1.xi — Public-Access System Separation (2 questions)

1. Are publicly accessible system components identified?
2. Are subnetworks for publicly accessible system components physically or logically separated from internal networks?

### System and Information Integrity

#### SI.L1-b.1.xii — Flaw Remediation (6 questions)

1. Is the time to identify system flaws specified?
2. Are system flaws identified within that specified time frame?
3. Is the time to report system flaws specified?
4. Are system flaws reported within that specified time frame?
5. Is the time to correct system flaws specified?
6. Are system flaws corrected within that specified time frame?

#### SI.L1-b.1.xiii — Malicious Code Protection (2 questions)

1. Are designated locations for malicious-code protection identified?
2. Is protection from malicious code provided at each designated location?

#### SI.L1-b.1.xiv — Update Malicious Code Protection (1 question)

1. Are malicious-code protection mechanisms updated when new releases are available?

#### SI.L1-b.1.xv — System & File Scanning (3 questions)

1. Is the frequency for malicious-code scans defined?
2. Are malicious-code scans performed at the defined frequency?
3. Are real-time malicious-code scans performed for files from external sources as they are downloaded, opened, or executed?

## 6. Submission workflow and retention checklist

After the assessment is supported:

1. Enter the five required Level 1 result fields in SPRS.
2. If the user is not the Affirming Official, transfer the assessment record to the AO in SPRS.
3. The AO reviews the details, certifies review of the Government affirmation statement, and selects **Affirm** in SPRS.
4. Retain the evidence artifacts used to support the assessment for six years from the CMMC Status Date.
5. Reassess and submit a new Level 1 result annually; maintain annual affirmation.
6. If the company’s compliance changes, do not represent its prior status as current. For contracts carrying DFARS 252.204-7021, report changed CMMC UID(s) to the Contracting Officer as required by the clause.

## 7. Product guardrails

- Use the official count: **15 requirements, 59 assessment objectives**. Do not market “17 controls.”
- Never say that the company is “CMMC certified” at Level 1; the correct result is `Final Level 1 (Self)` after the company’s own assessment and affirmation.
- Do not promise that a PDF/Word packet has been submitted to the Government.
- Do not make a company official’s affirmation on their behalf.
- Do not allow FCI, CUI, passwords, credentials, system logs, screenshots, or technical drawings to be pasted or uploaded in the initial product; collect only evidence locations and responsible owners.
- Do not treat a POA&M as valid for Level 1. A gap needs to be fixed before the company can obtain a Final Level 1 (Self) result.
- Re-check the cited regulations, guide version, and SPRS instructions before each public release because CMMC implementation details may change.

## Sources

All substantive requirements in this report are drawn from official Government sources captured in `research/sources/`.

1. [32 CFR § 170.15 — Level 1 self-assessment and affirmation](https://www.ecfr.gov/current/title-32/subtitle-A/chapter-I/subchapter-G/part-170/subpart-D/section-170.15) — binding regulation; current text checked August 2026. [@ecfr-cmmc-l1-self-assessment]
2. [32 CFR § 170.19 — CMMC assessment scope](https://www.ecfr.gov/current/title-32/subtitle-A/chapter-I/subchapter-G/part-170/subpart-D/section-170.19) — binding regulation; current text checked August 2026. [@ecfr-cmmc-scope]
3. [32 CFR § 170.22 — CMMC affirmation requirements](https://www.ecfr.gov/current/title-32/subtitle-A/chapter-I/subchapter-G/part-170/subpart-D/section-170.22) — binding regulation; current text checked August 2026. [@ecfr-cmmc-affirmation]
4. [FAR 52.204-21 — Basic Safeguarding](https://www.ecfr.gov/current/title-48/chapter-1/subchapter-H/part-52/subpart-52.2/section-52.204-21) — binding contract clause. [@far-basic-safeguarding]
5. [CMMC Assessment Guide — Level 1, v2.13](https://dodcio.defense.gov/Portals/0/Documents/CMMC/AssessmentGuideL1v2.pdf) — official guidance; September 2024. [@dod-l1-assessment-guide]
6. [CMMC Assessment Scope — Level 1, v2.13](https://dodcio.defense.gov/Portals/0/Documents/CMMC/ScopingGuideL1.pdf) — official guidance; September 2024. [@dod-l1-scoping-guide]
7. [SPRS CMMC Level 1 Self-Assessment Quick Entry Guide, v4.0](https://www.sprs.csd.disa.mil/pdf/CMMCQuickEntryGuide.pdf) — official system instructions; December 2024. [@sprs-l1-quick-entry]
8. [DFARS 252.204-7021](https://www.acquisition.gov/dfars/252.204-7021-contractor-compliance-cybersecurity-maturity-model-certification-level-requirements.) — contract eligibility and continuing-compliance clause; NOV 2025 text. [@dfars-cmmc-contract-clause]

## Research limitations

- The public SPRS Quick Entry Guide describes the workflow but does not publish every live screen value or the exact affirming-statement text. The product should use the current SPRS UI as the final source of that workflow and should never present its own acknowledgment as a verbatim Government affirmation.
- Authorities impose a “no change in compliance” condition for current status, but the reviewed sources do not publish a universal fixed number of days to replace a Level 1 result after every relevant change. Contracts can add specific reporting obligations.