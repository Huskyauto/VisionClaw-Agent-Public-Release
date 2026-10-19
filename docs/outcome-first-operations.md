# Outcome-first operations

## Where to use it

- **Admin Tools → Cost vs Revenue → Outcome evidence:** choose 1–90 days and
  refresh. Available evidence shows delivery attempts, receipt-backed deliveries,
  completed deliveries without proof, failed attempts and pending work.
- **Home → Generate briefing:** new reports request evidence-linked decisions
  and retain a system-generated task-source/limitations appendix. Older reports
  remain unchanged; generate a new report to use the new format.
- **Build requests in chat / supervisor specialists:** substantial builds receive
  hardest-assumption, cheap-test, independent-evidence and stop-condition guidance.
  This is prompt guidance, not an enforced approval or verification gate.

## What the numbers mean

A receipt-backed delivery requires a completed delivery, stored Drive identity
and links, a matching durable artifact record, and no non-durable companion
record for that delivery and tenant. A package with multiple companion artifacts
counts as one delivery, not multiple outcomes. Counts use delivery creation time;
the measurement timestamp identifies the fetched snapshot.

The cost ratio divides all recorded estimated LLM cost for the same tenant and
period by those receipt-backed deliveries. It includes unrelated workloads and
failed attempts. It is a **mixed-workload period proxy**, not per-workflow
attribution, actual provider billing, content correctness, customer acceptance,
or inbox receipt. Zero proven receipts means unavailable, not free success.
Full semantic verification remains unknown. Historical incomplete receipts
remain unverified rather than being backfilled as successes.

If the outcome query fails, the existing cost report still loads with an explicit
outcome-unavailable state. No failed action is retried by this report.

## Authority and cost

No new model calls, provider integration, cron, schema, tool, persona, spend
permission, or publication privilege. The existing briefing generation call is
unchanged in count; its instructions/recorded source appendix are improved.
Briefing recommendations never authorize execution. Missing evidence is stated,
not fetched or invented. Custom section text remains untrusted input.

## Verification

Run:

```
./node_modules/.bin/tsx --test tests/lib/build-experiment-guidance.test.ts tests/lib/decision-brief.test.ts tests/lib/outcome-economics.test.ts tests/security/outcome-audit-isolation.test.ts
```

The PostgreSQL test creates connection-local temporary tables; it does not read
or mutate public customer records. It covers tenant isolation, missing proof,
failed companions, missing links, dates and invalid scope.

The changed chat path adds only a bounded synchronous string check. Provider
quality and latency are not established by those fixtures.

## Deliberately not added

No automatic Jev expansion, backup export/restore, terminology-normalization
layer, agent fleet, credit ladder, blockchain or hardware reservation. Those
require evidence of an actual bottleneck; they are not “free” improvements.
