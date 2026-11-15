# Weekly tenant-isolation audit, bounded daily batches

## Owner-approved operating policy

The full model-assisted audit runs as one weekly campaign with at most one
scheduled model-dispatch batch per UTC day. It no longer starts a fresh campaign
each day or chains source slices every 30 seconds.

- Campaign weeks start Monday at 00:00 UTC.
- Each batch targets `ceil(current required chunks / 7)` uncached chunks. Replaying
  independently validated exact-input receipts does not consume that target.
- Each dispatched child has a **15-minute wall-clock limit**, including source
  scanning and any final precision review. The lease is renewed while it runs.
- A transaction-scoped platform advisory lock serializes daily reservations
  across replicas and across legacy/new campaign rows. Reservation occurs before
  spawn. A failed child, crash or provider outage does not buy a second batch.
- Incomplete work waits until the following UTC day. Missed days do not trigger
  unlimited catch-up. A provider failure may perform an inexpensive queue
  transition before daily admission defers it; it cannot dispatch again today.
- Capacity deferral before reservation consumes no model batch.
- Existing checkpoints, exact-input receipts, precision cache and paid-attempt
  evidence are preserved. New campaigns inherit evidence, never old completion
  flags or authority. No existing job rows are deleted or rewritten by deployment.
- Completion requires the existing full current-source coverage, precision,
  unreadable-file and evidence checks. Source changes still invalidate affected
  input evidence; they cannot retain a stale all-clear.
- An unfinished prior-week campaign carries forward without a second overlapping
  campaign. It is marked overdue. Seven calendar days are a target, not a promise:
  slow providers, large source changes or final review can require more days.
- Terminal findings remain separate from coverage completion. Existing finding
  handling and quick GitHub security/database tests on code changes remain intact.
  This schedule does not make raw model allegations confirmed security findings.

The minute-level scheduler is only a due/freshness check, not permission to run
another model batch. Planned overnight waits receive an informational notice
explicitly saying coverage is incomplete. Unchanged status logs are deduplicated.
The existing `TENANT_AUDIT_SCHEDULE_ENABLED=0` stops new scheduler enqueueing;
it does not cancel an already queued/running job. Existing queue cancellation
and fenced child-authority checks remain the control for active work.

## Implementation and verification boundaries

`tenant-audit-cron.ts` owns campaign creation. `claimAuditDailyBatch` in
`tenant-audit-job-state.ts` owns durable daily admission.
`tenant-audit-runner.ts` supplies the exact internal `AUDIT_WEEKLY_BATCH=1`
child setting and enforces the time limit. The script applies weekly sizing
only when it also has scheduled-job authority. Standalone/manual workflow
commands keep their explicitly requested bounded-run behavior; the workflow
named “Tenant Isolation Audit Nightly” is not the recurrence owner.

No schema, provider credentials, global spending limits, publication settings,
quick CI triggers, permissions or security-clearance criteria change.

### Design gate

1. Cost: at most seven automatic child starts per full UTC week, each capped at
   15 minutes; existing per-call/provider spend limits still apply. Retries
   cannot reset a daily reservation.
2. State: existing PostgreSQL job payloads, not an in-memory or local-file clock.
3. Failure: fail closed for completion and admission. Retain evidence on all
   recoverable paths; missed work remains incomplete and may become overdue.
4. Identity: existing tenant/kind/job/attempt/lease fences plus a global daily
   reservation; campaign dedupe uses week and source.
5. Scope: owner tenant only; no new customer data or tool access.
6. Observation/stop: existing owner notices, checkpoint reports, queue controls,
   and schedule stop flag. No publication is performed by this change.
7. Authority: deterministic scheduling code limits the audit. Models cannot
   alter reservations, approve findings or rewrite completion checks.
8. Capability: no new autonomy/concurrency/provider access. Work cadence is
   reduced, with deterministic offline tests instead of billable live audit runs.
