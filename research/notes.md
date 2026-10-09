# Research Notes: CMMC Level 1 Government Reporting Questions

**Status:** complete — authorities checked through August 2026
**Depth:** Deep

## Plan

- **Question:** What exact facts, assessment questions, evidence details, and submission/affirmation fields does a company need for a CMMC Level 1 self-assessment and annual SPRS reporting?
- **Scope:** Current CMMC Level 1 self-assessment under FAR 52.204-21, 32 CFR Part 170, the official Level 1 Assessment Guide, and current DoD/SPRS instructions; distinguish government submission fields from preparation evidence.
- **Audience:** Product owner building a customer-facing CMMC Level 1 preparation questionnaire.
- **Deliverable:** A cited research report and a canonical question inventory that can become the product's versioned form.

## Focus Areas

| # | Area | Status | Sources |
|---|---|---|---|
| 1 | Statutory/regulatory reporting and affirmation fields | complete | eCFR 32 CFR 170.15, 170.22 |
| 2 | All 15 FAR safeguarding requirements and assessment objectives | complete | FAR 52.204-21; DoD CIO Level 1 Guide |
| 3 | Assessment scope, assets, systems, external providers, and evidence | complete | eCFR 32 CFR 170.19; DoD CIO Scoping Guide |
| 4 | SPRS workflow, annual cadence, status/result, and organizational identifiers | complete | SPRS Quick Entry Guide; DFARS 252.204-7021 |
| 5 | Customer questionnaire design, exclusions, and implementation risks | complete | Cross-checked against preceding authorities |

## Coverage Checklist

- [x] What exact organization, CAGE, scope, level, date, status, and result fields are reported to SPRS?
- [x] What are all 15 official Level 1 safeguarding requirements?
- [x] What determination statements/questions must be answered for each requirement?
- [x] What scope and asset facts must be identified before a company can answer accurately?
- [x] What evidence descriptions and assessor-ready details should be collected even if not uploaded to SPRS?
- [x] What must be signed/affirmed by the company's authorized official, and what must the product never do?
- [x] What changes for FCI versus CUI, and what conditions block a Level 1-ready result?

## Findings Log

### SPRS process and annual cycle (current through August 2026)

**Applicability first.** These are not universal reporting duties for every
business.  The Level 1 status/affirmation is a pre-award condition only when a
DoD contract or subcontract requires CMMC Level 1 (Self).  Before award of
such an instrument, the OSA must have achieved Level 1 (Self) status *and*
submitted the affirmation in SPRS for every information system in its CMMC
assessment scope.  The DFARS clause also applies its continuing duties only
when it is in the contract.  Source: [32 CFR 170.15(b)](https://www.ecfr.gov/current/title-32/subtitle-A/chapter-I/subchapter-G/part-170/subpart-D/section-170.15);
[DFARS 252.204-7021 (NOV 2025), current page effective May 7,
2026](https://www.acquisition.gov/dfars/252.204-7021-contractor-compliance-cybersecurity-maturity-model-certification-level-requirements.).

**What is submitted, versus retained.** A Level 1 self-assessment result in
SPRS must include at least: CMMC Level; CMMC Status Date; CMMC Assessment
Scope; every industry CAGE code associated with the information systems in
scope; and the compliance result.  It is not a numerical NIST 800-171 score:
the OSA must achieve **MET** for all Level 1 requirements to receive `Final
Level 1 (Self)`; Level 1 permits no POA&Ms.  The OSA retains—not uploads as
the prescribed Level 1 result—the artifacts used as assessment evidence for
six years from the CMMC Status Date.  Sources: 32 CFR 170.15(a)(1),
170.15(c)(1)–(2), same URL above.  The artifacts must support use of the
Level 1/NIST SP 800-171A assessment objectives; they are not listed among the
five SPRS minimum fields.

**Entry/affirmation workflow.** The official SPRS quick guide (Version 4.0,
December 2024) directs a user with the PIEE `SPRS Cyber Vendor User` role to
open SPRS → Cyber Reports, select the hierarchy identified by HLO, and choose
“Add New Level 1 CMMC Self-Assessment.”  Enter the details and continue to
affirmation.  The CAGE hierarchy is imported from SAM.  A non-AO entrant may
email-transfer the record to the AO.  The AO reviews it, certifies the
affirmation statement, and selects Affirm.  SPRS then records either `Final
Level 1 Self-Assessment` or `No CMMC Status` and assigns a CMMC UID.  The AO
is the senior representative of the OSA responsible for compliance and
authorized to affirm continuing compliance; the AO also needs PIEE/`SPRS Cyber
Vendor User` access.  Sources:
[Quick Entry Guide v4.0](https://www.sprs.csd.disa.mil/pdf/CMMCQuickEntryGuide.pdf),
pp. 1–3, dated Dec. 2024; [Affirming Official tutorial
transcript](https://www.sprs.csd.disa.mil/pdf/training/AffirmingOfficialTutorialforCMMC-Transcript.pdf),
pp. 1–2 (undated).

**Annual/current cycle.** The OSA must conduct and submit a new Level 1
self-assessment annually.  Affirmation is required for every Level 1
self-assessment; §170.22 requires the AO to affirm current compliance after
each assessment and annually thereafter in SPRS.  For contractual
“current” status, Final Level 1 (Self) must be no more than one year old,
there must have been no changes in compliance since its Final CMMC Status
Date, and the AO’s corresponding affirmation must also be no more than one
year old.  The SPRS guide says a Final Level 1 Self-Assessment automatically
changes to `No CMMC Status (Expired Assessment)` after one year.  Sources:
32 CFR 170.15(a)(1)–(2) and
[32 CFR 170.22](https://www.ecfr.gov/current/title-32/subtitle-A/chapter-I/subchapter-G/part-170/subpart-D/section-170.22);
DFARS 252.204-7021(a), (d)(3), (e)(2)–(3); Quick Entry Guide p. 3.

**Relevant change caveat.** The authorities above make “no changes in
compliance” a condition of *current* status; they do not state a universal
fixed number of days in which a Level 1 OSA must file a replacement
self-assessment after a relevant change.  A contractor therefore must not
represent its status/current affirmation as current after a compliance change.
For a contract containing 252.204-7021, it must report changed SPRS-generated
CMMC UID(s) to the Contracting Officer during the contract's life.  Any
additional update timing can be contract-specific.

**Visibility and contract consequence.** Per the Dec. 2024 SPRS guide, Final
Level 1 Self-Assessment is the only Level 1 status type visible to Government
personnel.  That is a Government-view statement, not a statement that the
record is public.  Under the clause, the contractor may process/store/transmit
FCI only on systems with the CMMC status level required by the contract, must
maintain annual affirmations for applicable UIDs, and provides applicable UIDs
to the Contracting Officer.  The clause must be flowed down (with stated
exceptions) where the subcontract will process/store/transmit FCI or CUI.

**Phase status.** The DFARS CMMC rule was effective November 10, 2025; the
current official DFARS Subpart 204.75 page is marked revised Nov. 10, 2025.
As of Aug. 2026, the program is in the initial phased implementation period,
so CMMC inclusion depends on the acquisition/contract action and DoD
procedures—not every DoD award automatically carries Level 1.  Source:
[DFARS Subpart 204.75](https://www.acq.osd.mil/dpap/dars/dfars/html/current/204_75.htm).

### Source capture

Saved under `research/sources/`: `CMMCQuickEntryGuide-v4.pdf` and extracted
`sprs-cmmc-level-1-quick-entry-guide-v4.txt`;
`sprs-cmmc-affirming-official-tutorial.pdf` and extracted transcript;
`acquisition-gov-dfars-252-204-7021-current.html`; and eCFR source captures.
The eCFR interactive pages returned anti-automation/request-access markup to
direct HTTP capture; the regulatory facts above were independently obtained
from the official eCFR search result/current text.

## Conflicts & Open Questions

- The official FAR clause has 15 safeguarding requirements; the Level 1 Assessment Guide expresses the corresponding model as 15 requirement identifiers with multiple assessment objectives. Any alternate 17-count representation must be explained rather than used as the product's headline count.

## Gaps

- The official Quick Entry Guide text does not enumerate the entry-screen
  values for “CMMC Assessment Scope” or define a particular event as a
  “relevant change.” Do not invent either as an SPRS field or deadline.
- The cited Level 1 tutorial shows the initial pending-affirmation workflow;
  unlike its Level 2 discussion, it does not document an annual-affirmation
  button/window for Level 1. The binding Level 1 rule instead requires an
  annual self-assessment result plus affirmation.

## Complete, minimum-data customer questionnaire

**Design rule.** This is an intake and assessment-workpaper questionnaire, not
an assertion that a customer may submit a result.  Collect one answer per
information system/assessment scope and retain an evidence *locator*, rather
than uploading evidence or collecting unneeded content.  A user-facing
four-state control answer (`Yes / No / Partial / Unknown`) is useful intake
data, but is **not** an official SPRS result.  Before submission, the assessor
must convert the supported result to the official `MET`, `NOT MET`, or `N/A`
finding convention in the Assessment Guide.  A Final Level 1 (Self) requires
MET for all applicable Level 1 requirements; “Partial,” “No,” or “Unknown”
cannot be submitted as Final and cannot be covered by a POA&M.

### A. Required profile and submission-preparation questions

1. What legal organization is the OSA, and which CAGE hierarchy/HLO will be
   used in SPRS? Identify the person entering the record and confirm that
   person has the PIEE **SPRS Cyber Vendor User** role.
2. List **every industry CAGE code associated with the information systems in
   this assessment scope**. (This, not arbitrary corporate affiliates, is the
   required Level 1 input.)
3. Select `CMMC Level 1`; enter the planned/actual CMMC Status Date; provide
   the plain-language CMMC Assessment Scope; and state the compliance result.
   These five items are the minimum Level 1 results submitted to SPRS under
   32 CFR 170.15(a)(1)(i).
4. Name the proposed Affirming Official (name, title, business contact
   information). Confirm they are a senior OSA representative responsible for
   CMMC compliance and authorized to affirm continuing compliance. Confirm
   their PIEE/SPRS access or transfer path. These identity details belong in
   the affirmation, not in the five assessment-result fields.
5. Is a DoD solicitation, award, option/extension, or subcontract requiring
   `Level 1 (Self)` identified? Record contract/solicitation and applicable
   CMMC UID(s), if issued. Do **not** make this an unconditional requirement
   for an organization with no such contractual CMMC requirement.
6. Has the organization had any change in compliance since the status date?
   `Yes` is a current-status blocker; the rule does not supply a general
   replacement-submission deadline. Record changed systems/controls and
   contract-specific notice requirements.

### B. Scope questions (ask before control questions)

1. Describe the FCI received from, or generated for, the Government under the
   relevant contract; identify each place it is accessed, entered, edited,
   generated, manipulated, printed, at rest, or transferred.
2. Inventory every information system and asset that processes, stores, or
   transmits that FCI. For each, record: name/identifier; owner; function;
   FCI action (process/store/transmit); hosting/location; connected systems;
   responsible technical role; and evidence locator (asset inventory, data
   flow, diagram, contract workflow, or configuration record).
3. Identify the people, facilities, technology, and external service
   providers involved in processing, storing, or transmitting FCI. State
   whether each is in the assessment scope and why.
4. For every proposed exclusion, answer: does it process, store, or transmit
   FCI? If no, give the basis/evidence. Such an asset is out of scope; do not
   ask it to satisfy the 15 practices.
5. Identify any in-scope Specialized Asset: GFE; IoT/IIoT; OT; Restricted
   Information System; or Test Equipment. Record its FCI relationship and
   category. Under the Level 1 scoping rule these are not assessed against
   CMMC requirements, but documenting them prevents silently treating them as
   ordinary assessed assets.
6. **CUI diversion/segregation check:** Does any proposed Level 1 system
   process, store, or transmit CUI, or could the described contract data be
   CUI? If yes/unknown, stop the Level 1-only path, record the system/data
   flow and owner, and obtain contract/security review for the applicable
   CMMC level. CUI is not part of Level 1 assessment scoping; it is not
   legitimate to relabel it as FCI or merely exclude the system.

### C. Reusable response fields for every requirement

For each of the fifteen rows below, collect only:

* intake answer: **Yes / No / Partial / Unknown / N/A candidate**;
* systems, people, facilities, and external providers to which it applies;
* accountable role (for example system owner, IT/security administrator,
  facilities/visitor manager, HR/access approver, or public-web owner);
* evidence locator and date (policy/procedure section, system/configuration
  path, report/log, ticket, training record, inventory/diagram, physical
  access record, or interviewee)—not evidence content;
* exception/N/A rationale and assessor decision; and
* remediation blocker, owner, target date, and dependency.

“N/A candidate” must be validated against the official objective and scope;
it is not a way to bypass a requirement.  A non-MET Level 1 requirement
blocks Final Level 1 (Self), since there are no POA&Ms.

| Official Level 1 requirement / questionnaire question |
|---|
| **AC.L1-b.1.i — Authorized Access Control:** Are authorized users, processes acting for users, and devices/other systems identified, and is access limited to each authorized user, process, and device? |
| **AC.L1-b.1.ii — Transaction & Function Control:** Are the transaction/function types authorized users may execute defined, and is access limited to those defined types? |
| **AC.L1-b.1.iii — External Connections:** Are external-system connections and their use identified, verified, and controlled/limited? |
| **AC.L1-b.1.iv — Control Public Information:** Are authorized posters identified; are procedures and a pre-posting review in place to prevent FCI on public systems; is public content reviewed; and can improper FCI be removed/addressed? |
| **IA.L1-b.1.v — Identification:** Are system users, processes acting for users, and accessing devices identified? |
| **IA.L1-b.1.vi — Authentication:** Is each user, process acting for a user, and accessing/connecting device authenticated or verified before system access? |
| **MP.L1-b.1.vii — Media Disposal:** Is FCI-containing media sanitized or destroyed before disposal and sanitized before reuse? |
| **PE.L1-b.1.viii — Limit Physical Access:** Are authorized persons identified and physical access to systems, equipment, and operating environments limited to them? |
| **PE.L1-b.1.ix — Manage Visitors & Physical Access:** Are visitors escorted/monitored, physical-access audit logs maintained, and physical-access devices identified, controlled, and managed? |
| **SC.L1-b.1.x — Boundary Protection:** Are external and key internal boundaries defined, and are communications at each monitored, controlled, and protected? |
| **SC.L1-b.1.xi — Public-Access System Separation:** Are public-system components identified and their subnetworks physically or logically separated from internal networks? |
| **SI.L1-b.1.xii — Flaw Remediation:** Are timeframes defined and met for identifying, reporting, and correcting system flaws? |
| **SI.L1-b.1.xiii — Malicious Code Protection:** Are designated protection locations identified and protected from malicious code? |
| **SI.L1-b.1.xiv — Update Malicious Code Protection:** Are malicious-code protection mechanisms updated when new releases are available? |
| **SI.L1-b.1.xv — System & File Scanning:** Is scan frequency defined and performed, and are files from external sources scanned in real time when downloaded, opened, or executed? |

The questions mirror the Level 1 Assessment Guide objectives and the
15 basic safeguarding requirements in FAR 52.204-21; this deliberately does
not add vendor-framework controls.

### D. Submission, retention, and acknowledgment

**Submit to SPRS:** the five minimum Level 1 assessment-result fields above,
then the AO affirmation electronically. The Quick Entry Guide says to enter
assessment details, continue to affirmation, have the AO review, certify
review of the affirmation statement, and select **Affirm**. It does not
publish the exact on-screen affirmation text in its extracted instructions.

**Retain, do not characterize as prescribed SPRS uploads:** the evidence
artifacts supporting the assessment and the questionnaire/evidence locators.
32 CFR 170.15(c)(2) requires the OSA to retain assessment-evidence artifacts
for **six years from the CMMC Status Date**.

**Official required acknowledgment content (safe product wording):**
“I attest that the OSA has implemented and will maintain all applicable CMMC
security requirements for the information systems within the CMMC Assessment
Scope.” The product must display this as a pre-submission confirmation for the
named AO only, along with their name, title, and contact information; it must
not auto-affirm, claim this is verbatim SPRS UI text, or substitute another
employee's acceptance. This wording tracks 32 CFR 170.22(b), which requires a
statement attesting to that substance. The exact SPRS-screen acknowledgment is
an unresolved source gap in the retrieved public quick guide.

## Sources, dates, and conflicts

1. **Binding regulation:** [eCFR, 32 CFR 170.15](https://www.ecfr.gov/current/title-32/subtitle-A/chapter-I/subchapter-G/part-170/subpart-D/section-170.15), current text retrieved August 2026; source capture
   `sources/ecfr-32-cfr-170-15-level-1-self-assessment.txt`.  It supplies the
   five SPRS fields, annual assessment, no-POA&M rule, scope/assessment
   procedure, and six-year artifact retention.
2. **Binding regulation:** [eCFR, 32 CFR 170.19](https://www.ecfr.gov/current/title-32/subtitle-A/chapter-I/subchapter-G/part-170/subpart-D/section-170.19) and [170.22](https://www.ecfr.gov/current/title-32/subtitle-A/chapter-I/subchapter-G/part-170/subpart-D/section-170.22), current text retrieved August 2026; captures
   `sources/ecfr-32-cfr-170-19-assessment-scope.json` and
   `sources/ecfr-32-cfr-170-22-affirmation.json`.
3. **Contract rule:** [DFARS 204.75](https://www.acquisition.gov/dfars/subpart-204.75-cybersecurity-maturity-model-certification), page change/effective date **May 7, 2026**, capture
   `sources/acquisition-gov-dfars-204-75.html`; and
   [DFARS 252.204-7021 (NOV 2025)](https://www.acquisition.gov/dfars/252.204-7021-contractor-compliance-cybersecurity-maturity-model-certification-level-requirements.),
   current page effective May 7, 2026, capture
   `sources/acquisition-gov-dfars-252-204-7021.txt`.
4. **Official guide (guidance, not independently binding text):** DoD CIO,
   [CMMC Assessment Guide—Level 1, Version 2.13, September 2024](https://dodcio.defense.gov/Portals/0/Documents/CMMC/AssessmentGuideL1v2.pdf),
   capture `sources/dod-cio-cmmc-level-1-assessment-guide-v2.13.txt`.
5. **Official scoping guide (guidance):** DoD CIO,
   [CMMC Assessment Scope—Level 1, Version 2.13, September 2024](https://dodcio.defense.gov/Portals/0/Documents/CMMC/ScopingGuideL1.pdf),
   capture `sources/dod-cio-cmmc-level-1-scoping-guide-v2-13-september-2024.json`.
6. **Official system instructions:** SPRS, [CMMC Level 1 Self-Assessment Quick
   Entry Guide, Version 4.0, December 2024](https://www.sprs.csd.disa.mil/pdf/CMMCQuickEntryGuide.pdf),
   captures `sources/CMMCQuickEntryGuide-v4.pdf` and
   `sources/sprs-cmmc-level-1-quick-entry-guide-v4.txt`.

**Conflict resolved:** Some secondary material calls Level 1 “17 controls.”
The governing FAR/Level 1 guide identify **15** basic safeguarding
requirements; the larger number confuses requirements with multiple assessment
objectives. This questionnaire uses 15.  The Assessment Guide's
`MET/NOT MET/N/A` is also not the same as an intake UI's four-state response;
only the former is an assessment determination.