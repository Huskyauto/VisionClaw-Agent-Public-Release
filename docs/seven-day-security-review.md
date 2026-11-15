# Two separate seven-day security reviews

## Weekly source audit
The existing production scheduler owns Monday-based campaigns, one reserved
model-dispatch batch per UTC day, one-seventh sizing and a 15-minute child
deadline. Failed calls consume admission; no unlimited catch-up. The manual
workspace audit is not the recurrence owner. See
`docs/tenant-audit-weekly-batches.md`. Cached exact-input receipts are reused;
prefix resets alone do not prove that unchanged evidence was discarded.
Incomplete or source-stale coverage is never a clean audit.

## Database-isolation observation
`SECURITY_REVIEW_OBSERVATION_ENABLED=1` enables production-only passive evidence
after 60 seconds, refreshed at six-hour intervals. It records the catalog-only
RLS receipt and aggregate process-window scoped-transaction counters. It does
not duplicate application SQL, inspect customer rows, change roles, add
policies, enable RLS or claim to know what unwrapped queries would have blocked.

State uses owner-scoped terminal `agent_jobs` records of kind
`security_review_observation`, serialized by an advisory transaction lock.
One daily record is refreshed in place; first observation time is retained.
Source changes and unknown/unavailable policy probes within a day stay visible.
Restarts reset process counters; those counters are not whole-platform query
coverage. No SQL text, customer identity, args, results or credentials are stored.
The existing deployment source artifact identifies the observed source.

Seven distinct UTC dates AND seven full elapsed days change the report to
`owner_review_required`. Missed dates are not backfilled. Missing/invalid
observations, source changes, policy availability, absence of scoped traffic,
unmeasured raw queries and unmeasured blocked-query rates remain explicit gaps.
This status is an observation milestone, not a security pass or rollout approval.
Turn the flag off/remove it to stop new observations; retained records remain.

## Staged decisions, never automatic
1. **Day 1:** verify role/policy availability, existing tests, baseline and
   rollback prerequisites. Begin passive recording after publication/activation.
2. **Days 2–3:** inspect actual traffic counters and failure evidence. Run
   isolated development cross-tenant fixtures; do not probe customer rows.
3. **Days 4–6:** investigate missing transaction coverage and select one narrow
   route/table for a separately reviewed canary. No production canary is
   automatically authorized by this observation period.
4. **Day 7 and later:** after seven full days and at least seven observed dates,
   inspect the report and unresolved findings. Only Bob can approve any narrow
   enforcement rollout; route-specific isolation tests and rollback evidence
   are required first. If evidence is incomplete, continue observation.

Operator read-only inspection:
```sql
SELECT created_at,payload FROM agent_jobs
WHERE tenant_id=1 AND kind='security_review_observation'
ORDER BY created_at DESC LIMIT 8;
```
These rows and content-free `[security-review]` summaries are the evidence,
not a claim that seven days have already passed.

## Research adaptations
- `checkTrajectoryStep` adds offline fixed-code checks to existing trajectory
  scoring. It retains no raw tool args/results and is not an execution gate.
- Existing action-ledger timeout evidence now carries explicit unknown/confirmed
  markers through chat recovery. Unknown outcomes suppress generic retries;
  confirmed commits must not be reported as failed or dispatched again.
- No stored research proposal is approved/applied by this work. Historical
  compilation/held-out receipts do not authorize applying stale patches.
