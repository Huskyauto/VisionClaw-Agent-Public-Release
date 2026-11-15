# Jev decision improvements

## Scope and acceptance

Extend existing optional Jev checks, not the agent's authority. Source-backed
deliverables distinguish supported answers, justified abstentions, unsupported
answers and unnecessary refusals. Metadata and reviewer opinions never become
source evidence. Existing flags, three-question/request limit, timeout and no-retry
policy remain unchanged.

Successful checks return versioned, tenant-bound fingerprints of state, questions,
policy and exact output, actual model, probabilities, usage and elapsed time.
Successful jury/deliverable traces are also saved to tenant-scoped agent activity.
Persistence has a 1.5-second observation deadline and a 1-second database statement
limit. Unknown completion is explicitly unconfirmed and is not automatically
retried. No raw customer state is archived. Receipts remain advisory, never approval.

The existing fact-filter observations gain a nullable decision receipt.
Operator reporting distinguishes actual skipped extraction from shadow proposals,
successful empty extraction from failure, and observed lost-fact candidates.
Do not equate skipped calls or tokens with dollars saved.

## Pre-build gate

1. Cost: no additional production requests; at most three questions per existing
   check. N checks/day still means N requests, <=3N judgments, zero retries.
   Offline tests use injected providers; no live evaluation is automatic.
2. State: existing PostgreSQL observation rows and existing returned jury/
   deliverable receipts. No new local runtime state or background worker.
3. Failure: optional quality checks fail open with explicit unavailable status.
   Egress, tenant and deterministic safety checks remain fail closed.
4. Identity: preserve atomic tenant/message/version observation claim; receipts
   bind exact state, question, policy and output identities. No execution replay.
5. Tenants/limits: explicit positive tenant IDs; source ownership checked before
   serialization; existing outbound redaction and size limits. Read-only reports
   require explicit tenant and 1–30 day window, use SQL aggregate-only reads.
6. Stop/observe: existing Jev and fact-filter flags; no flags enabled here.
   Receipts disclose missing sources and provisional thresholds.
7. Authority: models propose advisory judgments; existing code and owner controls
   approve/execute/override. Operators can disable the existing flags independently.
8. Delta: no new permissions, tool access, concurrency or autonomous action.
   Offline cases test composition and failure handling, not model calibration.
   Actual quality/cost improvement requires held-out model evaluation and outcomes.

## Schema and rollout

Add nullable JSONB `decision_receipt` to the existing tenant-indexed
`typesafe_fact_prefilter_observations`; no new FK/index is needed for a payload
column that is not queried. No backfill: old rows retain null and v1 results are
excluded from v2 outcome claims. Rollback code first; leaving the nullable column
is safe. Dropping it later would delete receipts and needs explicit approval.
Development migration only; production schema and behavior require publication
and separate verification. Do not enable enforcement from mocked test results.

## Operator commands

- Read-only, aggregate-only report, no model requests:
  `npx tsx scripts/jev-fact-prefilter-report.ts --tenant 1 --days 7`
- Explicit synthetic-only evaluation, at most 12 existing bounded requests:
  `npx tsx scripts/jev-source-check-eval.ts --live`
  This requires the existing enabled Jev configuration and does not change flags.
  Results go to private, ignored `generated-artifacts/`, not runtime local state.

The report separates actual enforcement skips, shadow empty candidates, shadow
missed-fact candidates, pending/failed outcomes, Jev token usage and measured
latency. It does not estimate unobserved extractor tokens, dollars, independently
verified fact quality or savings. Source checks with oversized or sensitive input
remain explicitly unavailable rather than silently clipping important evidence.

## Bounded live evidence

2026-11-12 America/Chicago (2026-11-13 UTC): six fixed synthetic cases, 12 requests,
all returned `jev-1.14.0`. Cases covered a supported answer, correct abstention,
invented count, unnecessary refusal, conflicting source dates and an injected
instruction. Candidate recommendations matched 6/6 expected dispositions; the
declared legacy-signal review heuristic matched 4/6. The old implementation did
not enforce that heuristic, so this is not an A/B result against an existing
production approval gate. Total returned usage: 6,654 input / 708 output tokens.
Model quality was not independently blind-tested; thresholds are not calibrated.
No enforcement, production quality or dollar-saving claim follows from this
small result. Source fixture definitions and generated receipts retain the exact
comparison for inspection. Existing memory filter remains shadow-only for its
previous owner allowlist; no configuration was changed.

## Final local verification

- 91 focused regressions passed, including real PostgreSQL temporary-fixture
  aggregation/foreign-tenant exclusion, synthetic audit persistence/readback and
  atomic duplicate-claim checks. Only exact synthetic activity rows were cleaned.
- Expanded application plus changed scripts/tests TypeScript passed; the final
  source-recommendation trace refinement passed its three affected tests.
- Full application build passed with four existing CJS/import-meta warnings.
- All 18 active development personas contain the receipt guidance; wiring audit
  passed with existing warn-only orphan-table findings; stale-string check passed.
- Development app restarted, landing screenshot rendered and `/healthz` returned
  `ok`. Initial startup logged a database-probe timeout; this is not an all-system
  health clearance or production verification.
- Scoped self-review examined egress/tenant ownership, missing/uncertain results,
  audit deadlines, null failed outcomes and advisory-only composition. No separate
  review agent was invoked. Unrelated platform audit findings remain outside this
  change's clearance.
