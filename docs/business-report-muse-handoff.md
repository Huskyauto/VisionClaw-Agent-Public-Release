# Muse Spark business-report connector

## Current policy: direct report compiler (October 16, 2026)

Bob approved removing the external Spark/Muse dependency **only for the
Readiness/Executive report pipeline**. The broader Muse context integration is
unchanged. The connector material below documents historical compatibility;
it is not the current compilation route for new reports.

New jobs use server-owned `compilerMode: "gemini-direct-v1"`. Pending old
`wait_muse` jobs with no accepted reply adopt direct compilation when the new
worker is published; terminal jobs are never reset. Already accepted replies
are validated and reviewed without another compiler purchase. Only explicitly
marked `muse-legacy` records can appear in the external inbox or accept a POST;
normal report submissions return 409 on that connector.

The worker now runs retained evidence → initial three-model jury → direct
Google `gemini-4-argon` structured compilation → existing citation/quality
validation → final three-model jury → reviewed PDF/full MP3. Gemini's compiler
call is not an independent fourth vote. Its compilation must address valid
minority corrections, not merely copy the majority.

Before inference an atomic fenced claim moves the job to `compiling`, and
Postgres retains a per-revision reservation. After the response, exact candidate
JSON, request/digest binding, prompt/output hashes, served model and usage are
retained before validation. A crash, mismatch or uncertain completion stops
without automatic inference replay. At most two revision rounds remain allowed.

Compiler spend debits existing Aldon batch allocations when present, without
resetting or extending them. Other owner report jobs have a $3 aggregate
compiler-reservation cap; this does not enable a paid jury on unrelated jobs.
Manual forms disclose paid compilation. Existing report-only/customer approval
boundaries remain unchanged.

The direct credential is `GEMINI_REPORT_API_KEY`, with the existing
`GOOGLE_API_KEY` used only if the dedicated secret is absent. Neither Replit's
managed Gemini proxy nor OpenRouter substitutes for this compiler. The existing
Argon **jury seat** transport remains OpenRouter; compiler and jury roles are
distinct. The compiler's native endpoint is
`https://generativelanguage.googleapis.com/v1beta/models/gemini-4-argon:generateContent`.
`REPORT_EVIDENCE_HANDOFFS_DISABLED=1` still stops the whole review flow.

Missing/unrecognizable credentials defer before a compiler spend claim, with an
explicit setup-required status. The dedicated replacement credential passes
model metadata, and the funded project passed a live compiler fixture on
October 16. The production adapter returned served `gemini-4-argon`, with
3,359 input/1,251 output tokens and recorded estimated usage cost $0.019228.
Structural, quotation/source, action-plan and both majority/minority correction
validators passed. All successful compatibility probes plus that fixture
totaled an estimated $0.029296; rejected requests returned no usage.

For current REST requests use `thinkingLevel: "LOW"` and
`responseFormat.text: {mimeType: "APPLICATION_JSON", schema: ...}`. Live tests
rejected the fully bounded report decoder schema with HTTP 400 but accepted
its structural shape. Only the decoder receives a shape-only projection;
the full reply contract stays in the prompt and all server validators remain
unchanged. Native formatting is covered by regression tests.

This verifies the compiler/validators, not the final jury/PDF/MP3 or production
report journey. Publication remains separately authorized.

**Production rerun follow-up, October 16:** The retained Executive compilation
failed exact-quotation and total-word checks. A fresh Readiness run stopped at
initial jury because Claude returned JSON followed by legacy citation/unknown
labels; its nonempty response was rejected by the strict JSON parser, not lost.
The staged prompt fix separates bound report votes from generic code-review
formatting and puts evidence fields inside the JSON vote. It does not accept
mixed/truncated/ambiguous responses or weaken owned-receipt checks. Native
compilation also receives count-aware section/action word targets and explicit
single-source, exact-quotation guidance. Hard validators, three model seats,
minority corrections, budgets and final-review requirements stay unchanged.
These prompt fixes need publication and live verification. Existing terminal
paid attempts remain locked; a rerun is not permission to reset their allocations.

## Status and scope

Server-side implementation for owner-operated AI Readiness Audits and Executive/Company Opportunity Reports, including the money-making-opportunities variant. Not a general private-chat forwarding channel.

Bob authorized needed customer business context, including supplied financial figures and workflows. Contact details, payment data and credentials are excluded. Muse's privacy practices are not assumed to replace these safeguards.

**External prerequisite:** Muse's existing watcher must consume this protocol. Queueing a Spark message is not receipt or completion. This workspace cannot modify Meta's product/watcher. Publishing the server remains a separate owner action. Until a matching compilation arrives, reports stay pending and do not go to customers.

**October 15 live evidence:** The authenticated external client retrieved both Aldon packets and submitted matching compilations accepted by the quotation/section validators. This proves connector consumption and reply, not independent attestation of Meta's served model identity. Both final juries blocked delivery: executive had an Argon connection failure, an inline GPT citation that failed the vote format, and a valid Claude FIX; readiness had the same GPT format failure and split valid votes. Both compilations remain retained, with no official report assembly or customer delivery. Owner-only review exports are explicitly marked unapproved and do not change those states.

## Watcher contract

### Quality contract for newly queued reports

New jobs carry `qualityContractVersion: 1`. These are public-source advisory
reports for prospects, not private operational audits. The watcher must consume
the returned instruction and `correctionChecklist`, preserving the normal
sections/quotes contract and additionally returning:

```json
{
  "actionPlan": [{
    "priority": 1,
    "action": "Specific small pilot",
    "sourceIds": ["S1"],
    "benefit": "Business benefit hypothesis",
    "effort": "Labelled planning estimate and validation step",
    "cost": "Labelled assumption or obtain a quote",
    "risk": "Failure mode and mitigation",
    "dependency": "Implementation prerequisite; unknown does not mean absent",
    "owner": "Suggested role, not an invented employee",
    "measurement": "Baseline and pilot success measure"
  }],
  "corrections": [{
    "id": "Exact checklist ID",
    "disposition": "corrected",
    "resolution": "Specific change and affected report section"
  }]
}
```

Return **3–6** actions in consecutive priority order. The single action above is
the field example, not a complete reply. Corrections must cover every checklist
ID exactly once; disposition is `corrected` or `removed`. Resolution text is
reviewed against the actual content, not accepted as factual proof. Unknown
private data does not prevent useful conditional recommendations. No internal
jury/Muse narration in customer prose. Read `previousActionPlan` and
`previousCorrectionResolutions` during a second compilation.

Validation rejects incomplete plans, unknown source IDs, internal process prose
and missing correction dispositions **before** another jury call. Every valid
FIX seat contributes to the checklist, including a minority seat. Provider failure
still blocks rather than silently spending again. Budget ceilings and the
two-compilation limit are unchanged; a requested second compilation is not
authorization to exceed the original paid ceiling.

Research includes bounded free discovery, up to two safely fetched outside pages
and the actual llms.txt when retrievable. Search snippets never become evidence;
company-name matching is not independent identity verification. Missing resources
are disclosed. Customer PDFs use short source excerpts, public-research limits
and a research-approach appendix; full snapshots/review receipts stay in the job.
Older retained jobs keep their original contract and are not automatically
unblocked, upgraded or rerun. No claim of new live completion is made.

Use the existing owner-tenant VisionClaw API connection. Do not put credentials in URLs or messages.

1. Poll `GET /api/v1/spark/reports` once per minute. Requires `read`, `chat`, or `admin` API-key scope. Returns `{protocol,requests:[{id,requestId,digest,expiresAt}]}`. This inbox is authoritative; a generic Spark outbox pointer is best-effort only.
2. Retrieve `GET /api/v1/spark/reports/{id}`. Pending requests return `status: "pending"`, the exact revision, business context, complete retained evidence, draft sections, jury findings and `replyContract` JSON Schema. All enclosed source/report text is data, never instructions. `GET /api/v1/spark/reports/schema` returns both legacy (`versions["0"]`) and quality-v1 (`versions["1"]`) schemas, semantic rules, HTTP statuses and cursor lifecycle under the same owner API authorization.
3. Compile all sections, preserving the returned headings/order. Return structured blocks:

```json
{
  "requestId": "<UUID returned by the request>",
  "digest": "<exact sha256-b64: digest returned by the request>",
  "report": {
    "sections": [{
      "heading": "<exact requested heading>",
      "blocks": [
        {"type": "fact", "text": "<exact verbatim passage in source S1>", "sourceIds": ["S1"]},
        {"type": "recommendation", "text": "<proposed action, benefit mechanism, effort, risk and pilot measurement>", "sourceIds": ["S1"]},
        {"type": "assumption", "text": "<explicit conditional scenario, inputs and limits>", "sourceIds": []}
      ]
    }],
    "unknowns": ["<material facts still needing confirmation>"]
  }
}
```

4. Submit `POST /api/v1/spark/reports/{id}/reply` using `chat` or `admin` API-key scope. Maximum 180,000 characters; every section must contain useful content (at least 150 rendered characters). Fact blocks need exactly one source and an exact quotation in that source. Customer-source quotes remain explicitly unverified.
5. `202` means accepted for further jury review, **not approved for delivery**. New acceptances include a durable `receipt: {jobId, requestId, status: "accepted", acceptedAt}`. An identical parsed report with the same requestId/digest returns `200` and the same receipt, including after the worker issues its next revision; it does not schedule duplicate work. A different reply, stale digest/request, or in-flight advance returns `409`; retrieve current state before deciding what to do. `422` means quotation/citation/section/quality validation failed: correct and resubmit the same revision. `503` means unavailable/stopped, not an empty inbox or permission to bypass review.
   Advance the outbox cursor only after this handoff's `202` receipt or matching identical-reply `200` acceptance. Do not require another `202` after a lost first response. A follow-up GET returns `200`, `status: "accepted"`, the receipt and review phase while this revision remains current; acceptance is not final jury approval. A new correction round returns a new pending revision. Unaccepted expired requests return `410`, `status: "expired"`. Authorized missing jobs return `404`; other non-waiting unaccepted states return `409`, `status: "blocked"`.
   Legacy acceptances made before receipts were introduced explicitly return `legacyAcceptance: true`, `receipt: null`. An identical-reply `200` also includes jobId/requestId and is the documented legacy equivalent for cursor advancement; it never invents a historical acceptance timestamp.
6. The jury may request one additional compilation with a new UUID/digest. Use the new retained compiled draft and correction history, not an earlier cached draft. Maximum two Muse rounds; pending work expires after 24 hours.

### Malformed reply diagnostics

HTTP `400` is a structural rejection, not an accepted compilation. After the
contract repair is published, `issues` contains at most 64 entries with a
schema-field `path`, fixed validation `code`, and numeric `minimum`/`maximum`
where relevant. For example, `report.sections.0.blocks.0.text` with
`code: "too_big", maximum: 3000` means split or shorten that block while
preserving the required substantive section and exact source quotations.
`issueCount` and `issuesTruncated` explicitly disclose when the bounded diagnostic list omits errors. Quality-v1 semantic errors use `422` with safe field paths and fixed codes; quality checks collect multiple issues before rejecting. Source/quotation failures remain a fixed `422` rejection rather than echoing source content. Server logs include the job ID and the safe structural/quality issue list.
No submitted values, unknown key names, or raw parser messages are returned.
Correct the same retained Muse compilation against the same request/digest;
do not create another report, reset reservations, or treat rejection as approval.
Legacy production may return only the generic 400 error until republished.

Short owner roles such as `Web owner`, `Sales` and `IT` are valid. Owner text must
be nonblank and at most 1,200 characters. Other action text fields require at
least 10 non-padding characters and at most 1,200 characters. The shared Zod
definitions generate the published JSON Schema and also validate action text
at the downstream quality boundary. The response contract does not silently
rewrite the stored compilation.

The Aldon paid-jury approval expires **2026-10-17 04:00 UTC (October 16, 11 p.m.
CDT)**, earlier than job 1642's **2026-10-17 09:08 UTC (4:08 a.m. CDT)** report
expiry. Extending a handoff would not extend paid-call authorization. This
repair changes neither deadline, reservation nor report content; no automatic
extension/reissue or paid replay is authorized.

## Evidence and authority

Sources carry IDs, retrieval dates and snapshot hashes. The customer PDF includes source excerpts/URLs, explicit limits/unknowns, and a review record. Quotations prove what the captured source said, not that it was true. Recommendations and financial scenarios are not verified outcomes or guaranteed profits.

The connector represents server-computed digests as `sha256-b64:` plus the base64url encoding of the 32 digest bytes. Echo the complete value, including its prefix. Source hashes are verified against the exact retained text before representation changes. Internal durable bindings/PDF receipts remain hexadecimal; legacy hexadecimal reply bindings remain accepted only on an exact match. The credential scanner still scans the entire outward packet; arbitrary hex strings and real credentials in prose are not exempted.

Each juror separately reads the same tenant/revision-bound retained snapshot. This is **not three independent live research investigations**. The report-specific evidence profile does not replace or weaken the normal session/platform jury investigation profile.

Muse compiles; jury critiques; fixed quotation/citation validators constrain acceptance; the owner approves customer delivery through the existing review queue. No jury/Muse verdict sends customer email.

## Operator use and recovery

### Full spoken report companion

Both finalizers now require a full-report MP3 before reporting a new PDF ready.
The fixed ElevenLabs Flash voice reads the exact final customer sections,
including the action plan, source appendices and disclaimer; there is no
summary/rewrite stage. A first PDF page contains a real clickable Google Drive
reader link, plus a copyable URL and playback/download instructions.

Audio is created only after the existing report approval gate. Report-only
still sends no customer email and creates no customer charge. The current
Aldon review block is not bypassed by audio generation.

One tenant/order/kind/content/voice identity has one durable control receipt.
Reserve up to 36,000 characters against the included ElevenLabs allowance
before generation. Oversized reports stop, never truncate. No provider fallback
or automatic retry follows uncertain paid generation or upload. Recovery may
reuse durable completed MP3 bytes; uncertain claims require owner attention.
Customer-safe Drive upload verifies reader permissions before exposing a URL.
Anyone holding that link can listen; do not describe it as authenticated or
recipient-restricted. Other account usage can consume shared allowance too.

PDF recovery rejects intermediate renderer bytes without the audio page.
Source changes require publishing before affecting the running production
pipeline. Operational details: docs/report-audio-design.md.

### Report only: owner sends and bills outside the platform

The adjacent sidebar entries are **AI Readiness Reports** and **Company Reports**
(Executive Report and Money-Making Opportunities tabs). Both manual forms have
**Report only — no customer email or customer charge**, checked by default.
The corresponding manual POSTs accept `reportOnly: true` (also the default if
omitted). This choice suppresses supplied customer emails, delivery context,
review-queue/offline-paid records and customer delivery even after durable resume.
The finished validated PDF remains downloadable by the owner. No Stripe checkout,
invoice or customer charge is created. Normal AI generation costs still apply.

To prepare platform delivery, explicitly uncheck the box and enter a recipient;
the existing owner "Approve & ship" boundary still applies. Unchecking does not
charge a card. Paid storefront/webhook orders are unchanged, and older queued
jobs are not silently switched to report-only.

### Fresh Aldon completion authorization

Bob explicitly approved a **new $6 jury ceiling ($3 per report)** plus bounded,
separately metered Jev classification. Use
`paidJuryBatch: "aldon-completion-2026-10-15"` with `reportOnly: true` for one new full executive
report and one new readiness report for exact company/domain below. Same models,
lease/revision binding, nonrefundable pre-dispatch claims, no retries or extra
inference, and 2026-10-17 04:00 UTC expiry. Initial and compiled reviews share the
same per-report cap. Prior batch records and $2/$4 limits remain unchanged.
The new approval does not unblock/rewrite previous terminal reports or certify a
finished PDF. Publish staged changes before using the production watcher.

### Customer-feedback coverage

New readiness and executive/company reports use the same bounded feedback
collector. Two free discovery searches lead to at most three safe candidate
page reads, with no paid extraction or connector requirement. Discovery snippets
never become evidence. Outside review identity requires the matching company
name and an exact company-website link; structured reviews must additionally
bind their business entity to that website/name. Location and purchase status
remain explicitly unverified. Only up to three excerpts and 300 quoted characters
per page are retained, without reviewer names or ratings. Plain-text reviews
without supported structured binding remain unassessed, not inferred absent.
Network byte caps may produce partial captures even when JSON parses. Generic
company/outside prose with review/Google/feedback indicators is conservatively
omitted, not reclassified as independent reviews. This text screen cannot prove
the origin or licence of otherwise unmarked prose.

Company homepage social links, directory descriptions and customer-review
opinions have separate source labels. Company links do not establish posting
activity, account ownership, reputation or sentiment. Google review content
remains excluded pending a permitted retention/export route; Facebook/X review
and mention access is explicitly unavailable without an authorized route.
Unavailable or empty samples cannot support good/bad-service conclusions.
Public posts/social mentions are not independently collected by this change.

Feedback source text, retrieval dates, hashes and access/sample limitations stay
in the existing evidence snapshot, drafting, jury/Muse packet and final source
appendices. Recommendations use actual attributed feedback when available;
otherwise they disclose that sentiment was not assessed. The collector does
not approve, post responses, send customer mail, alter existing blocked jobs,
reset budgets or start another paid run.

Use the existing Website Audit or Executive Report form. It shows jury review, waiting for Muse, assembly, ready, or error. Pending reports survive restarts through `agent_jobs`; manual job mappings can be recovered by their retained operator UUID even if the local sidecar was lost.

`REPORT_EVIDENCE_HANDOFFS_DISABLED=1` stops new handoffs and advancement. It never enables an unreviewed fallback. API report reads/replies also stop. Existing general Spark coordination remains separate.

Jury spend is claimed before inference; uncertain calls are not repeated. PDF assembly uses a content-bound filename short enough to survive the renderer's filename cap, an assembly intent, durable bytes and a fulfillment receipt. A restart recovers the exact retained PDF. If completion is uncertain and no durable bytes are found, the job stops rather than renders twice.

For a terminal/expired/uncertain report, inspect its job evidence and correct the input/connection before starting a new run. Do not manually change the phase or invent a received Muse reply. No automatic new paid API is used as a Muse substitute.

### One-time Aldon comparison jury authorization

The owner approved paid jury reviews for **one full executive report and one readiness report** for Aldon Company (`https://www.aldonco.com/`). Authenticated manual runner requests may include `paidJuryBatch: "aldon-comparison-2026-10-15"`; executive requests must use `focus: "full"`. This is not a general paid-report setting and does not authorize the opportunities-only variant. Approval expires at 2026-10-17 04:00 UTC.

The fixed seats are GPT-5.4 (direct OpenAI), **Gemini 4 Argon** (`google/gemini-4-argon` through OpenRouter), and Claude Opus 5.5 (direct Anthropic): three model developers, with the Gemini transport disclosed. Bob explicitly replaced Sonnet. Each separately reads the retained report snapshot; this is not independent live research. No alias or Sonnet fallback is permitted.

Source gathering uses the existing SSRF-safe retrieval, with the potentially paid extraction fallback disabled for these runs. Failed direct retrieval remains an explicit evidence limitation. **Before drafting**, Jev classifies source roles in bounded, redacted batches; labels and usage are retained with the complete original evidence. Jev does not decide factual truth or remove sources. Classification failure stops this scoped run before expensive review. Section drafting forbids metered fallback and skips paid section ensembles/auxiliary CoVe; mandatory evidence and jury checks remain. Muse Spark then compiles the report and the same jury reviews the compilation.

Optional jury aggregation, embedding-concordance and post-jury TypeSafe inference are skipped. The separate pre-review Jev classification is intentional, not a hidden extra frontier call, and is **not represented as free or included in the $4 jury cap**.

Before each single dispatch, a transaction/advisory lock reserves a conservative UTF-8-byte input estimate plus framing and 4,096 output tokens. A completed `business_report_jury_budget` control record in `agent_jobs` stores one allocation per kind, bound to the first operator UUID. Initial and compiled reviews share that allocation: **$2 each, $4 combined**, with no refund/replay after uncertain completion. Reservations are conservative cap usage, not proof of actual provider charges. Normal usage accounting remains separate.

Argon was verified in the public OpenRouter model catalog, not via a paid inference probe. Its reported introductory rate is $2/M input and $10/M output; report reservations use the higher published post-intro $4/$20 ceiling. The scoped Argon completion operation rejects generic/ungranted use, forces the exact model, 4,096 output tokens, no SDK retries and no provider fallbacks. Missing/mismatched returned model identity fails the seat, retaining the reservation and the safe observed identity in its error. It is not added to general model-selection menus.

SDK and parameter-repair retries are disabled. Both the existing direct-jury permission and report stop switch still apply. Provider/approval/budget failure blocks the report; do not start another run to evade a used allocation. Actual answers/model identities/usage/owned snapshot receipts are retained in the review job's `paidJuryRuns`, and survive phase checkpoints.

Do not automatically restore failed jobs or use a local compilation as a Muse reply. Production publication, real paid inference, external Muse receipt, finished PDFs and the comparison must each be verified separately.

### Explicit recovery of the October 15 unspent drafts

The two fresh Aldon drafts stopped before any paid reservation because the budget control record used `completed`, which is not a valid queue status. It now uses `succeeded`. The separate audit-write failure is corrected by explicitly typing the JSON object key as text. Errors retain safe PostgreSQL codes, not private SQL parameters.

After publishing this repair, the authenticated owner may POST an empty JSON object to `/api/admin/business-report/{operatorJobId}/resume-unspent`, with the ordinary session CSRF token. This resumes the **same** retained sources, Jev labels, sections, request identity and budget allocation; it does not gather sources or draft again. Current operator IDs are executive `294a157b-f21d-4d3d-926e-cb7adf7eff17` and readiness `f5600b9b-ac7e-44f3-b8d7-7bb56d1b5604`.

Recovery is one-time and fails closed unless the report is the exact unexpired approved Aldon batch, terminally blocked at its initial jury, with no jury result, compilation, assembly or reservation for that report kind. Recovery and reservation share one transaction lock. Any reservation—including a failed/uncertain paid call—prevents recovery; neither the $2/$4 ceiling nor the approval expiration changes.

Required repair verification: `REPORT_POSTGRES_TEST=1 npx tsx --test tests/unit/business-report-postgres.test.ts tests/unit/business-report-recovery-route.test.ts tests/unit/business-report-paid-jury.test.ts tests/unit/business-report-review.test.ts`. The PostgreSQL fixture uses a connection-local temporary table, the real queue status constraint, production SQL and fake final model dispatch; it rolls back all rows and makes no paid calls. `REPORT_RETAINED_FIXTURE` optionally supplies a privately retained input JSON for the same check. This proves SQL/recovery behavior, not live provider or Muse completion.
