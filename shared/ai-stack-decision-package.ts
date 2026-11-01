/**
 * Owner launch materials only. No customer records, checkout, provider calls,
 * fulfillment automation or approvals are created by this content.
 */
export const DECISION_REVIEW_META = {
  name: "AI Stack Decision Review",
  path: "/income-opportunities/ai-stack-decision-review",
  price: 350,
  status: "Prepared · demand unvalidated · manual fulfillment",
  version: "1.0",
} as const;

export interface DecisionReviewDocument {
  id: string;
  title: string;
  audience: "Customer-ready copy" | "Illustrative sample" | "Owner operations";
  description: string;
  content: string;
}

export const DECISION_REVIEW_DOCUMENTS: DecisionReviewDocument[] = [
  {
    id: "offer",
    title: "Offer and scope",
    audience: "Customer-ready copy",
    description: "The promise, buyer, $350 pilot, deliverables, boundaries and service terms.",
    content: `# AI Stack Decision Review

## Decide what to build before you pay to build it

Get an evidence-backed recommendation for one AI workflow and up to three candidate systems. Understand what to use, what to avoid, and what to test before committing to implementation.

This service is for small AI implementation agencies and technical founders choosing an approach for an upcoming project. It is most useful when you already have a real workflow, a shortlist, a budget and a decision to make within 30 days.

## Founding pilot: $350

One workflow. Up to three named candidate systems, including your current approach if applicable. One decision-maker interview of up to 30 minutes. A fixed-scope written report. One clarification call of up to 20 minutes. One consolidated factual-correction round submitted within seven calendar days of delivery.

Price is a proposed pilot price, not evidence of customer demand. We accept at most two concurrent pilots initially; this is an operating capacity limit, not a scarcity claim.

## What you receive

1. A one-page executive decision: adopt, run a bounded trial, retain the current approach, or defer.
2. A side-by-side fit matrix covering workflow fit, recovery, human approval, customer separation, integrations, deployment and total operating cost.
3. A source register with links, access dates, reviewed versions where available, evidence labels and limitations.
4. A risk register distinguishing blockers from manageable gaps.
5. A 30-day validation plan with success measures, stop conditions and a fallback.
6. A cost worksheet separating quoted prices, customer estimates and unknown operating costs.

Final customer-specific deliverables are an accessible PDF report and editable Markdown companion, plus a CSV decision matrix. The customer may use the original analysis internally and share it with their implementation provider. Third-party source material remains subject to its own rights; copying or redistributing it is not included.

## Delivery commitment

The operator confirms the slot and scope in writing before accepting the engagement. Target delivery is five business days after scope acceptance, complete intake and confirmed payment through an approved method. Missing information pauses that clock; we explain what is missing and agree a revised date. Do not advertise an available slot until the operator confirms it.

## Boundaries

This is technical decision support, not implementation, a penetration test, security certification, legal advice or guaranteed savings. Baseline scope is public documentation/source review and supplied non-sensitive artifacts. Paid model experiments, production access, deployment, migrations, hands-on product trials and custom code are excluded unless separately approved in writing with a budget.

We do not need passwords, API keys, customer records or production credentials. Redacted diagrams, requirements and aggregate measurements are enough to start. If confidential access is essential, agree a separate secure arrangement before sharing anything.

## Corrections, cancellation and support

Reply with factual corrections within seven calendar days; one consolidated correction round is included. A changed workflow, new candidate or new requirements require a new scope, not a free revision.

Proposed pilot policy: cancellation before research starts receives a full refund. If we cannot fulfill the agreed scope, offer a mutually agreed extension or refund for undelivered work. If the written report omits an agreed deliverable, correct it at no extra charge; if we cannot, agree a proportionate refund. Refunds must be approved and processed through the original authorized payment channel; this document does not execute one. Mandatory customer rights remain unaffected.

## Booking language

Tell us the workflow, the systems you are considering and the decision deadline. We first confirm whether this fixed-scope review fits. No payment checkout or public booking form is enabled by this package.`,
  },
  {
    id: "sample",
    title: "Complete sample decision report",
    audience: "Illustrative sample",
    description: "A worked PurpleFlow decision with a baseline, evidence, costs and a validation plan.",
    content: `# Sample report: choosing an engine for an AI research service

**Illustrative sample — not a commissioned customer report.**
The buyer, requirements, workload and budget below are hypothetical. Repository observations come from the retained PurpleFlow source review. No customer deployment, performance benchmark or security audit was performed for this sample.

## 1. Executive decision

**Recommendation: retain the current worker approach for customer delivery; consider PurpleFlow only for a separate, non-sensitive internal experiment. Evidence confidence: Medium for documented feature gaps; Low for comparative economics and production suitability.**

PurpleFlow offers readable workflow definitions, per-step concurrency controls, failure routes and a visual canvas. Those are useful capabilities. However, its reviewed roadmap leaves interrupted-run recovery and durable waits unfinished, and multi-tenant hosting is a future idea. Those gaps conflict with this sample buyer's mandatory requirements.

The decision does not establish that an unspecified current worker is safe. Keep it only if it passes the same requirements below; otherwise pause customer automation and fulfill manually while evaluating a durable alternative.

## 2. Hypothetical buyer and decision

A two-person AI agency produces research reports for ten client organizations. It expects twenty reports per week, with jobs lasting between ten and sixty minutes. It wants to avoid losing work during a restart, mixing client data, sending duplicate reports or starting unapproved paid calls.

Its current approach is a database-backed job queue with checkpointed worker steps. This baseline is hypothetical, not a verified product implementation. Monthly infrastructure ceiling: $100 excluding models and operator labor. Budget and workload are customer-assumption examples, not market measurements.

The immediate choice is between retaining that approach and adopting PurpleFlow. A third candidate was not selected: filling all three slots is not required, and adding an unresearched name would weaken this report.

## 3. Non-negotiable acceptance criteria

- Restart a worker during a staged job and recover confirmed completed work without repeating a consequential action.
- Keep job inputs, credentials, outputs and logs isolated by customer, including negative cross-customer tests.
- Bind approval to the exact recipient and artifact before any real send.
- Enforce spending ceilings before provider calls, and record uncertain outcomes without blind retries.
- Preserve final deliverables outside temporary runtime storage.

## 4. Candidate comparison

| Requirement | Current worker baseline | PurpleFlow reviewed source | Decision impact |
|---|---|---|---|
| Human-readable workflow definition | Unknown until artifacts are supplied | TOML files and separate code scripts | Useful authoring advantage, not a mandatory gate |
| Stage concurrency and overflow routes | Unknown; require configuration and overload evidence | Implemented per-step queues, concurrency and overflow routing | Useful design reference |
| Restart and resume | Assumed checkpointing; must be demonstrated | Resumption is an open roadmap item | Blocks replacement for this workload |
| Durable long waits | Must be demonstrated if needed | Listed as unfinished | Blocks workflows requiring restart-safe waits |
| Customer separation | Assumed, not verified | Multi-tenancy is a future idea; shared runner visibility acknowledged | Blocks shared customer hosting |
| Credentials restricted to approved destinations | Must inspect credential/egress policy | Per-credential allowed-host locks planned | Requires further security design |
| All-branch joining | Explicit required-step accounting must be demonstrated | Waiting for all branches is planned | Do not treat a completed run as a complete report |
| Measured total cost | Customer actuals required | Published narrow author benchmark only | No savings claim supported |

## 5. What the efficiency benchmark does and does not show

The author's benchmark reports large concurrency and memory advantages over n8n. It provides scripts and configuration details, which makes it inspectable. But PurpleFlow ran many sleeping code items within a workflow while n8n ran separate HTTP-triggered executions. Storage and execution structures differed, most cases ran once, and the 512 MB cap applied to the code runner rather than the complete PurpleFlow stack.

Treat this as an author-reported demonstration of lightweight scheduling, not proof that real AI reports will use 200 times less memory. It does not measure model bills, full-host peak RAM, report acceptance, recovery correctness or support time.

## 6. Risk register

**Critical for this decision — customer separation:** no demonstrated multi-tenant boundary matching the requirement. Mitigation: no client data in the exploratory deployment; do not promote it to shared production on the basis of this review.

**High — interrupted paid work:** unfinished resumption could lose progress or require an operator to replay work. Mitigation: retain durable job orchestration; restart tests are mandatory for any alternative.

**High — incomplete output mistaken for success:** independent branches can fail while others continue. Mitigation: validate all mandatory sections and sources before acceptance; a run status alone is insufficient.

**Medium — underestimated operating costs:** model calls, database, retries, maintenance and operator intervention are absent from a sleeping-task benchmark. Mitigation: collect whole-workflow measurements on a matched synthetic workload.

## 7. Cost model

Use monthly total cost = infrastructure + model/API usage + storage/delivery + operator hours × agreed hourly value + expected rework. Unknown inputs remain blank; do not replace them with zero.

Hypothetical baseline example: $40 infrastructure + $60 models/APIs + $5 storage/delivery + four hours at $50/hour = $305/month before additional rework or taxes. These are illustrations, not observed prices. Twenty reports per week is approximately 86.7 reports/month using 52/12 weeks, giving about $3.52 per report at that illustrative total. Neither this baseline cost nor a PurpleFlow alternative cost has been measured.

For the candidate, infrastructure, model consumption and operator time are all unknown. The defensible savings claim today is **not established**.

## 8. Thirty-day validation plan

Days 1–5: record the current workflow, sources, approval points and actual costs. Verify the baseline meets the non-negotiable criteria. If it does not, stop unattended customer work.

Days 6–10: if the agency still values the authoring experience, run a separate experiment with synthetic data only, five concurrent jobs and no real customer sends. A person must approve any infrastructure or paid calls first.

Days 11–20: exercise normal completion, one branch failure, queue overload, worker restart, duplicate trigger and attempted cross-customer read. Record each case, expected outcome, actual outcome, latency and whole-host peak RAM. Security and mandatory-output failures cannot be averaged away by faster successful runs.

Days 21–30: compare accepted complete reports per dollar, operator minutes per accepted report and recovery behavior. Stop on any customer-boundary failure, duplicate side effect, unapproved charge or unexplained data loss. A missing restart/tenant capability is not fixed by more performance testing. Keep the baseline unless the alternative meets every mandatory condition.

## 9. Evidence register and limits

- Source-reviewed: PurpleFlow README and source at revision bd33b0e21c148df723e3e49cec9833248f9ac1a6: https://github.com/leetheguy/purple_flow/tree/bd33b0e21c148df723e3e49cec9833248f9ac1a6
- Source-reviewed: run queues and execution: https://github.com/leetheguy/purple_flow/blob/bd33b0e21c148df723e3e49cec9833248f9ac1a6/lib/purple_flow/run.ex
- Source-reviewed: unfinished capabilities: https://github.com/leetheguy/purple_flow/blob/bd33b0e21c148df723e3e49cec9833248f9ac1a6/specs/999_todo.md
- Author-reported benchmark, not reproduced: https://github.com/leetheguy/purple_flow/blob/bd33b0e21c148df723e3e49cec9833248f9ac1a6/docs/n8n_case_study.md

The retained review did not capture an independent access timestamp; this sample therefore anchors claims to the exact source revision rather than inventing one. Recheck current versions before a paid engagement. No proof of runtime gain, comprehensive security, or customer acceptance is claimed.

## 10. Customer decision record

Choose retain, bounded trial, defer or request more evidence. Record the decision owner, approved budget, accepted risks and next review date. This report recommends; it does not authorize purchases, deployment, data access or customer communication.`,
  },
  {
    id: "intake",
    title: "Intake and discovery",
    audience: "Customer-ready copy",
    description: "Plain-language intake questions, examples, qualification and a discovery call script.",
    content: `# Customer intake and discovery

Please send answers in a document or email reply. Do not include passwords, API keys, raw customer records or confidential source code. Every example below is illustrative, not a prefilled customer answer.

## Required intake

1. **Business and decision owner.** Enter the business name and person authorized to choose the system. Example: “Northside Automation; owner makes the final decision.”
2. **One workflow to review.** Describe what starts it, what it does and what finishes it. Example: “A client submits a topic; we research five sources and produce a reviewed PDF.”
3. **Decision you need to make.** State the choice, not just a technology interest. Example: “Keep our worker or adopt a workflow engine before onboarding clients.”
4. **Up to three candidates.** Give names and official URLs; count the current approach as one if you want it compared. Example: “Current worker; PurpleFlow.” Write “need help choosing” if there is no shortlist; shortlist discovery may require a separate scope.
5. **Current baseline.** Explain what works, what fails and what it costs. Example: “Jobs finish manually after a restart; operator spends two hours per week.”
6. **Volume and timing.** Give typical/peak jobs, duration and deadline. Example: “20 jobs weekly; peak five together; decision needed in 30 days.”
7. **Must-have safeguards.** List conditions that cannot be traded for speed. Example: “No cross-client data; approval before email; recover after restart.”
8. **Environment and integrations.** Describe hosting and required services without credentials. Example: “Node worker, PostgreSQL, Google Drive; no new language maintained internally.”
9. **Budget.** Separate build budget, monthly operating ceiling and test budget. Example: “$2,000 build; $100/month infrastructure; no paid trials without approval.”
10. **Data sensitivity.** Describe categories only. Example: “Public websites and internal drafts; no health or payment records.”
11. **Success measure.** Define a visible outcome. Example: “Complete 95 of 100 eligible reports without operator rescue, with every send approved.” This is a customer target, not our guarantee.
12. **Delivery contact and permission.** Provide the actual recipient email and confirm permission to send the report there. Example: “Use the address in my reply; send only the report, no marketing.”

## Optional evidence

Supply redacted architecture diagrams, aggregate invoices, representative error messages and sanitized output examples. Label estimates as estimates. Do not send personal data for hypothetical workload testing.

## Thirty-minute discovery script

Minutes 0–5: “What decision will this report change? What happens if you do nothing?”
Minutes 5–12: walk through one actual workflow and one failure.
Minutes 12–20: identify mandatory criteria, budget, ownership and deployment constraints.
Minutes 20–25: confirm candidates, evidence access and excluded work.
Minutes 25–30: read back deliverables, five-business-day target, correction policy and who approves the engagement.

## Qualification

Proceed only when there is a specific decision, an authorized buyer, a feasible shortlist, non-sensitive evidence and a scope deliverable within the pilot cap. Decline or rescope requests for security certification, broad platform selection, regulated professional advice, production penetration tests or guaranteed ROI.

If baseline measurements or access are missing, mark them unknown. Ask once for the exact missing information, pause the delivery clock and agree whether to continue with a limited-evidence report. Never invent a customer fact to keep the schedule.

## Engagement confirmation

Before research, confirm in writing: workflow; candidates; required evidence; mandatory gates; $350 pilot price; deliverables; start/deadline; correction policy; exclusions; delivery recipient; permitted retention. Ask for explicit acceptance. This package contains no active intake submission or data collection endpoint.`,
  },
  {
    id: "method",
    title: "Research and evidence method",
    audience: "Owner operations",
    description: "Repeatable source review, comparison matrix, confidence labels and quality gates.",
    content: `# Research and evidence method

## Start with the buyer's decision

Capture the agreed intake snapshot before research. Translate must-haves into yes/no acceptance criteria. Keep “unknown” distinct from “fails.” A candidate with an unknown mandatory safeguard cannot be recommended for unattended consequential use.

Evaluate the current baseline with the same criteria as alternatives. Do not compare a fully configured candidate with an artificially weak default baseline.

## Source register

For every material claim record: claim ID; exact claim; official URL; repository commit or product version; access date/time; relevant excerpt or code location; evidence class; confidence; limitation; effect on the decision. Retain links and short necessary excerpts, not copied books, private repositories or entire copyrighted documents.

Start with primary documentation, source, changelogs, license and deployment instructions. Trace important promises into implementation and tests. An author-written test is evidence that a case exists, not proof it passed in our environment. Marketing pages and benchmark headlines are claims to examine.

## Evidence labels

- **Customer-stated:** the buyer supplied it; not independently verified.
- **Hypothetical:** an illustrative scenario, never a real customer statement or observation.
- **Source-reviewed:** directly inspected documentation or implementation; no runtime verification implied.
- **Author-reported:** a third party reports a test/result we did not reproduce.
- **Executed:** we ran the stated check with recorded inputs, environment, outputs and costs.
- **Inferred:** an engineering conclusion derived from named facts.
- **Unknown:** information needed but absent.

Confidence is separate: High for direct, current and sufficiently complete evidence supporting the specific claim; Medium for direct but limited evidence; Low for assumptions, indirect or materially incomplete evidence. A source-reviewed feature may deserve Medium confidence while its production reliability remains unknown. Do not average these into a fake universal percentage.

## Comparison dimensions

Compare workflow fit; input/output handling; integrations; tenant/customer boundaries; credentials and egress; exact human approvals; restart recovery; duplicate/ambiguous side effects; queue and rate limits; deployment/maintenance burden; licensing; data retention; current cost and likely operator work.

Mandatory criteria are gates, not weighted points. Optional criteria may use a documented 0–3 scale: 0 absent, 1 partial, 2 adequate, 3 strong; unknown stays unscored. Any weights must be approved by the buyer before seeing the ranking. A high optional score cannot offset a mandatory security/recovery failure.

## Bounded runtime trials

Baseline pilot includes no runtime trial. If source review leaves a valuable question unresolved, propose a separate test with written authority, synthetic inputs, per-call and total budget, time bound, no customer side effects, and a stop condition.

Cases should include ordinary work, a failure, a counterexample and a boundary case. Preserve exact inputs and outputs. Separate engineer-visible examples from independent held-out validation. Capture failed and uncertain paid calls in cost accounting. Do not retry an ambiguous consequential operation automatically.

## Acceptance before report release

Every decisive claim has a source or a visible unknown. Every system has the same mandatory criteria assessed. Assumptions and examples are labeled. Costs include operator time or clearly state it is unknown. Benchmark methods are compared before repeating a multiplier. Recommendations identify what would disprove them. Check URLs and version identity. A second human or separately authorized reviewer checks material conclusions; if unavailable, disclose single-reviewer limitations rather than claiming independence.

## Verdict rules

Adopt only when mandatory criteria are demonstrated and change is justified. Trial when a bounded, affordable question remains. Retain when existing machinery meets the need and no meaningful improvement is shown. Defer when requirements, evidence, rights or budget are insufficient.

Never quietly promote an illustrative sample into a customer report. Copy the template, bind it to the customer's actual scope, refresh every time-sensitive claim and obtain the operator's final release approval.`,
  },
  {
    id: "fulfillment",
    title: "Fulfillment and support playbook",
    audience: "Owner operations",
    description: "Manual delivery, acceptance, privacy, failure recovery and refund handling.",
    content: `# Manual fulfillment and support playbook

## Control and state

This is an owner-operated advisory service, not an autonomous report generator. Keep each engagement in a separately access-controlled customer folder and a private engagement register. The launch workspace itself stores no customer intake.

Record engagement ID, accepted scope version, actual recipient, status, payment reference, source snapshot, artifact versions and hashes, delivery receipt and acceptance/correction outcome. Use the existing authorized customer system; do not store customer data in repository files.

States: inquiry → qualified → scope accepted → payment confirmed → research → draft review → approved → delivered → accepted or correction requested → closed. On missing data, use blocked with a named reason. A prepared template is never a paid or delivered engagement.

## Operator checklist

1. Confirm buyer, workflow, shortlist and fixed scope.
2. Obtain written acceptance and confirm an authorized payment method is actually available. Never claim checkout exists because this package exists.
3. Confirm payment through authoritative provider evidence before paid fulfillment; an email screenshot is not proof. Do not create or charge a payment from this workspace.
4. Collect redacted intake; confirm actual delivery recipient and confidentiality constraints.
5. Record baseline, source register, mandatory gates and unknowns.
6. Research and draft within the labor cap. Pause/rescope rather than buying unapproved experiments.
7. Review factual support, customer identity, confidentiality, links, accessibility and all promised deliverables.
8. Produce PDF and Markdown report plus CSV matrix. Open the actual files and inspect tables/links; compare their content with the approved draft.
9. Use the existing customer-delivery pipeline for private durable storage and customer-authorized delivery. Verify effective Drive permissions and exact artifact identity. Never expose a shared owner research folder.
10. Record provider receipt and independently confirm customer access/acknowledgment where possible. Provider acceptance is not inbox receipt.
11. Handle the included correction round, preserve version history and close with the agreed decision.

## Failure and recovery

Research failure: retain verified work, identify missing sources and pause or issue a limited-evidence report only with buyer agreement.
Export failure: keep the approved source; fix formatting without regenerating research or silently changing recommendations.
Upload failure: retain validated bytes and retry only the missing storage step.
Send timeout or local write failure after provider success: treat as uncertain completion, reconcile provider and engagement records before resending.
Wrong recipient or permission exposure: stop sharing immediately, revoke access, inform the owner and follow the established incident procedure; do not conceal it with a replacement email.
Missed deadline: notify the buyer before the commitment expires, agree an extension or refund for undelivered work.

## Privacy and retention

Proposed default, subject to written customer agreement: delete raw supplied working materials 30 days after final acceptance; retain the final report and minimal engagement/transaction evidence for 12 months unless lawful recordkeeping or a contract requires otherwise. Tax/transaction retention follows applicable requirements, not this proposed document schedule.

No automated deletion is implemented. The operator schedules and records retention review, honors approved deletion requests across working copies and explains any backup/legal retention limits. Never promise immediate erasure from backups we do not control.

## Customer acceptance

Ask whether all agreed deliverables are accessible, the facts match the supplied requirements, and the recommendation supports the named decision. “I disagree with the recommendation” is not itself a factual defect; record it and explain the evidence. Never mark satisfaction or commercial validation without actual customer confirmation.

Stop accepting new engagements at two concurrent pilots, on a privacy incident, when delivery capacity is exceeded or when payment/delivery channels are unverified. The owner can stop the service without cooperation from any agent.`,
  },
  {
    id: "economics",
    title: "Pricing and unit economics",
    audience: "Owner operations",
    description: "Explicit labor budget, scenario math, capacity and pilot decision criteria.",
    content: `# Pricing, cost and capacity

## Starting offer

Proposed founding pilot price: **$350 per engagement**. It is a test price, not a validated market price. Scope is one workflow and up to three candidates, including baseline. Do not list this as a live SKU or imply payment collection is enabled.

## Planned labor budget per pilot

- Qualification/scope: 0.5 hour.
- Source review and comparison: 1.5 hours.
- Draft/report production: 1.0 hour.
- Quality review/export: 0.5 hour.
- Clarification, delivery and included corrections: 0.5 hour.

Total target: four hours. Operator value assumption: $50/hour; replace with Bob's actual required rate before launch. Real discovery may exceed the allowance; record it rather than hiding presales labor.

## Illustrative contribution scenarios

Assume $350 revenue; $15 payment/admin allowance; $10 variable tooling/storage allowance. These are planning allowances, not quotes or observed bills. Baseline includes no paid runtime experiments.

| Scenario | Labor at $50/hour | Allowances | Contribution after valued labor | Contribution / revenue |
|---|---:|---:|---:|---:|
| Three hours | $150 | $25 | $175 | 50.0% |
| Four hours | $200 | $25 | $125 | 35.7% |
| Six hours | $300 | $25 | $25 | 7.1% |
| Eight hours | $400 | $25 | -$75 | -21.4% |

This is contribution before customer-acquisition cost, fixed overhead, refunds, taxes and owner profit distributions. It is not a net profit or revenue forecast. At these assumptions, labor break-even is ($350 − $25) / $50 = 6.5 hours before excluded costs.

## Scope and spend controls

At four hours, review remaining work. If the scope cannot be completed, pause and agree a narrower scope, separate quote or owner-funded overrun; never silently reduce promised deliverables. No paid provider call without explicit approval and a cap. Record failed calls, retries, review and exports in actual cost.

Start with no more than two concurrent engagements and two completed pilots per week. Eight fulfillment hours weekly plus acquisition/admin is a capacity assumption, not a booking promise. Confirm actual availability before offering delivery dates.

## Pilot ledger fields

Record revenue collected; refund/credit; payment fee; research minutes; interview minutes; report/review/export minutes; support/correction minutes; tooling/storage/model cost; presales minutes; acquisition cost; complete/on-time; access confirmed; buyer acceptance; willingness to refer or buy again.

Calculate contribution using actual hours and expenses, not model token cost alone. Keep collected revenue distinct from quoted price and authorized reservations distinct from actual charges.

## Three-pilot decision

Target three paid pilots as a learning sample, not statistical proof. Continue only if deliverables are accepted, there are no unresolved privacy/safety incidents, scope fits repeatably and actual contribution meets the owner's threshold. Proposed threshold: at least $100 contribution per pilot after labor valued at $50/hour, before excluded overhead; confirm it with Bob before launch.

If unpaid interest is high but nobody commits, revisit buyer/problem before reducing price. If buyers pay but delivery takes six-plus hours, narrow scope or raise price. A later $750 expanded review or agency retainer is an unvalidated expansion hypothesis, not an offer promised in this pilot.`,
  },
  {
    id: "launch",
    title: "Launch kit and buyer validation",
    audience: "Owner operations",
    description: "Ready-to-adapt outreach, landing copy, questions, objections and a three-pilot plan.",
    content: `# Launch kit — drafts, not sent or published

## Positioning

For small AI agencies and technical founders choosing an implementation approach, AI Stack Decision Review turns a shortlist into an evidence-backed build decision. Unlike a generic tool roundup, it evaluates your workflow, failure cases, operating burden and acceptance criteria.

## Landing copy draft

**Before you pay to build an AI system, check whether the stack fits the job.**

Bring one workflow and up to three candidate systems. Get a clear recommendation, a sourced comparison, an honest risk register and a practical validation plan. We separate source-reviewed capabilities, vendor claims, actual tests and unknowns.

Founding pilot: $350. Manual, fixed scope. Target five business days after accepted scope, complete intake and confirmed payment. Subject to operator availability. No guaranteed savings, implementation or security certification.

Call to action: “Request a scope check.” Use a real owner-approved contact channel when publishing; no working public form or checkout is supplied here. Do not insert a guessed email or booking URL.

## Direct outreach draft

Subject: A second look at your next AI stack decision

Hi — are you choosing tools for an AI workflow or client project right now?

I'm putting together a fixed-scope review: one workflow, up to three candidate systems, and a written recommendation covering fit, recovery, operating cost and the first test to run. The pilot price is $350. It's decision support, not an implementation pitch.

If that matches a decision you're making, I can share a worked sample and see whether the scope fits. If not, no problem.

Personalize only with verified, relevant context. Do not claim to have audited the recipient's system. Send only through an owner-approved channel and honor opt-outs. No bulk campaign is authorized.

## Public post draft

An AI tool can have an impressive demo and still be wrong for your project.

Can it recover after a restart? Keep customers separate? Prevent duplicate actions? Does the benchmark measure your actual workload?

I've been documenting these questions while building and evaluating agent systems. I'm preparing a small fixed-scope AI Stack Decision Review for agencies and technical founders: one workflow, up to three candidates, a sourced recommendation and a validation plan.

Proposed pilot price: $350. Ask for the sample if you have a real decision coming up. No promise that the newest tool wins.

## Five discovery questions

1. What stack decision did you make most recently, and what made it difficult?
2. What did a wrong choice cost in rework, money or delay?
3. What evidence would you need to trust an outside recommendation?
4. Who can approve a $350 review, and when would it be useful?
5. Would you commit to this exact scope now? If not, what specifically is missing?

## Objection responses

“I can ask an AI for free.” You can, and it may be enough. This service adds requirements tracing, source/version checks, explicit unknowns and a customer-specific recommendation reviewed by an operator. It does not promise infallibility.

“Will you implement it?” Not in the pilot. Implementation is separately scoped, and the recommendation must not depend on selling implementation.

“Can you certify it is secure?” No. We identify documented risks and missing evidence; a security assessment requires a different engagement.

“Why trust you?” Share the actual sample and explain methods and limitations. Do not claim customers, certifications, independent validation or savings we have not earned.

## First three paid pilots

First prepare the approved sample, available capacity, engagement terms and verified payment/delivery path. Identify ten relevant agencies/founders with genuine upcoming decisions; qualification is more important than list size. Owner reviews recipients and approves each outreach batch.

Aim for five discovery conversations and three paid pilots. These are learning targets, not forecasts. Record nonresponse, objections, declined engagements and unpaid interest separately from payment. Do not build a portal, membership or automated funnel before buyer evidence justifies it.

Review after three pilots or ten qualified conversations without a sale, whichever occurs first. Continue, narrow, reprice or stop based on actual acceptance, contribution and buyer reasons.`,
  },
  {
    id: "templates",
    title: "Report and delivery templates",
    audience: "Owner operations",
    description: "Customer report structure, CSV matrix schema, release checklist and delivery message.",
    content: `# Reusable templates and release checklist

These are intentional fill-in templates, not completed customer deliverables. Replace instructions with verified customer facts before release. Do not send unresolved fields as if they were finished work.

## Customer report structure

1. **Report identity:** customer business, workflow, decision owner, scope/version, issue date and source cutoff.
2. **Executive decision:** adopt/trial/retain/defer, why, confidence and the most important limitation.
3. **Customer situation:** goal, current baseline, workload, budget and source of each fact.
4. **Mandatory acceptance criteria:** exact observable safeguards; unknowns cannot be silently treated as passes.
5. **Candidate matrix:** same dimensions for every system, including baseline.
6. **Evidence register:** claim IDs, official URLs, access dates, versions, evidence labels and limitations.
7. **Risk register:** severity, affected use, evidence, mitigation, owner and remaining uncertainty.
8. **Economics:** infrastructure, models, storage, labor, acquisition/rework where relevant; actuals versus assumptions.
9. **Validation plan:** cases, test authority/budget, measurements, pass/fail, stop conditions and fallback.
10. **Decision record:** buyer's decision, accepted risks, responsible owner and next review trigger.

## CSV decision matrix

Use the header below and one row per criterion/candidate pair:

candidate,version,criterion,mandatory,result,evidence_class,confidence,claim_id,source_url,accessed_at,limitation,decision_effect

Allowed result values: demonstrated, partial, absent, unknown, not_applicable. Unknown is not zero and not a pass. Customer-controlled cells starting with =, +, - or @ must be escaped as text before spreadsheet export to prevent formula execution. Quote commas, quotes and newlines according to CSV rules. Do not include credentials or private source text.

## Source record template

Claim ID: assign a unique short ID.
Claim: write one specific assertion.
Source: official URL or approved supplied artifact.
Identity: product version/commit and access timestamp.
Class: Customer-stated / Hypothetical / Source-reviewed / Author-reported / Executed / Inferred / Unknown.
Support: precise excerpt or code reference, within source rights.
Limits: what this evidence does not establish.
Decision effect: which requirement or recommendation depends on it.

## Final release checklist

- Scope and customer identity match the accepted engagement.
- PDF, editable Markdown and CSV matrix exist and open correctly.
- No unresolved template instructions remain in the customer-specific report.
- Every material claim has support or is clearly unknown.
- All mandatory criteria appear in the matrix and executive decision.
- Prices, time estimates and examples are not mislabeled as actual results.
- Links work; reviewed versions and source cutoff are visible.
- No internal platform findings, private logs, customer secrets, copied restricted material or unrelated branding are included.
- A reviewer records approval of the exact exported version.
- Actual recipient and private delivery permissions are confirmed.
- Existing delivery receipts are reconciled before a retry.

## Delivery email draft

Subject: Your AI Stack Decision Review — final report

Your review is ready. The package includes the PDF report, editable Markdown companion and CSV comparison matrix for the workflow and candidates we agreed.

The main recommendation and its evidence limits appear on the first page. Please confirm you can open all three files. Send any factual corrections in one reply within seven calendar days; the included correction round covers the agreed scope.

Insert the verified private Drive view links returned by the authorized delivery process. Do not invent links or infer the destination address. Provider acceptance does not establish inbox receipt.

## Reuse and independence

Archive a sanitized methodological lesson only with appropriate rights and permission. Never use one customer's confidential evidence in another customer's report. Public samples must remain clearly illustrative. Disclose vendor commissions or implementation conflicts before recommending a candidate; no affiliate compensation is assumed in this package.`,
  },
];

export function buildDecisionReviewMarkdown(documentId?: string): string {
  const documents = documentId === undefined
    ? DECISION_REVIEW_DOCUMENTS
    : DECISION_REVIEW_DOCUMENTS.filter((document) => document.id === documentId);
  if (documents.length === 0) throw new Error("Unknown package document");
  return [
    `# ${DECISION_REVIEW_META.name} — launch package`,
    `Version ${DECISION_REVIEW_META.version} · ${DECISION_REVIEW_META.status}`,
    "Owner preparation materials. No payment checkout, prospect outreach, automatic fulfillment or publication is enabled.",
    ...documents.map((document) => `---\n\nAudience: ${document.audience}\n\n${document.content}`),
  ].join("\n\n");
}
