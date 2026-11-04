# Run confirmation and compact-schema trial

## What Bob gets
Workflow Replay now includes a **Run confirmation** assessment for each selected
run. It is computed read-only from the existing authenticated, tenant-scoped
record; it never repeats tools or modifies the run's completion status.

The assessment distinguishes stored completion, step coverage, failed attempts
and independent outcome verification. A completed model/tool run is still
**unverified** for its business outcome. `success: true`, `verified: true`,
quality scores and another model's agreement cannot turn it green. Replanned
or duplicate steps are explicitly incomplete evidence against the original plan.
Historical runs can be assessed too; this is not a receipt captured at execution
time and does not prove artifact contents.

## One-click sidebar confirmation

Open **Confirmation** near the top of the sidebar, then click **Confirm latest
run**. This fetches your newest saved workflow run and assesses its existing
evidence without rerunning any actions. The result names the objective and run
ID, shows when you checked it, and counts passed, failed and unverified checks.
**View run details** opens that exact run in Workflow Replay.

Missing delivery/payment proof stays unverified even if all execution steps
reported success. Ordinary chats and projects without a saved workflow run are
not covered. This button does not run the engineering CLI or arbitrary project
tests. If the shown objective is not the project you meant, do not treat it as
confirmation of that project; use Replay to inspect the correct saved run.
Connection/authentication errors display a retry action, not an old result.

## Confirm a development project run

```sh
node --import tsx scripts/project-confirmation.ts --profile harness-rollout
```

This runs a reviewed offline test list without inherited API/database
credentials. It uses one process, a 768 MB heap limit and a 120-second deadline.
It makes zero model calls and does not execute arbitrary caller-provided
commands, files or projects.
Combined test output is stopped at 1 MiB while streaming, before any log read;
overflow cannot produce confirmation. The shared release runner caps logs at
8 MiB by default. Run-detail retrieval failures are shown explicitly in Replay,
with a retry action; stale detail is not presented as confirmation.

Before execution it saves the exact acceptance profile and source-file hashes.
Afterward it writes `confirmation.json`, `confirmation.md` and the original
test log under a new ignored `generated-artifacts/run-confirmations/run-*`
directory. **Confirmed** requires all declared tests to pass without skips,
todos or cancellation, with an unchanged source snapshot. Failure is **failed**;
missing/malformed evidence or changed source is **unverified**. Nonzero exit
codes preserve these distinctions. Generated local output is not durable
production storage; retain the report externally or rerun if lost.

`harness-rollout` confirms only its named offline checks. To support another
project, first add a reviewed profile and its explicit acceptance tests/source
closure in `scripts/lib/project-confirmation.ts`; never silently reuse these
checks as proof of a different project's success. The report's version and
SHA-256 identify its recorded inputs but are not a digital signature.

The existing `npm run release:check -- --base <commit-sha>` also emits a
confirmation report for its declared bounded commands. Its checks require
successful exits and stable source/membership; this is not an assertion that no
test was skipped, a whole-repository clearance or independent review approval.
Partial/blocked runs cannot produce a confirmed receipt.

## Limited prompt rollout and rollback

`COMPACT_OWNER_PLAN_SCHEMAS=1` enables only JSON-schema whitespace compaction
for internal owner-tenant plan LLM steps. It does not affect customer plans,
ordinary `llm_task` tools, replanning, models, permissions, refusal handling,
schema fields or instructions. Public tool arguments cannot select this
internal profile. Attempt telemetry includes `schemaFormat` and `promptProfile`.

The development setting is enabled for the trial. Production settings are
unchanged and nothing is published. Set it to `0` (or remove it) and restart
the application workflow to restore baseline formatting. Selection is evaluated
per call; no learned policy or database migration needs undoing.

## Broader fixed comparison

```sh
npx tsx scripts/harness-ab-sample.ts --run --representative
```

This is a separate frozen set of report, research, payment uncertainty,
outreach approval, tenant isolation and injection decisions. Missing-data
citations are explicit. Original fixtures and original scores remain unchanged.
Like the first sample, it is 44 sequential requests maximum, GPT-5.4 pinned,
512 output tokens, no retry or external fallback. Native model usage applies.
It does not execute tools or certify real customer journeys. Neither comparison
automatically promotes changes.

## Operator guidance
Use the report after relevant engineering work, not on every chat turn. Read
failed and unverified checks before claiming completion. External outcomes
(Inbox delivery, actual payment, fulfillment) need their own authoritative,
read-only verifier; never rerun the action merely to obtain confirmation.
