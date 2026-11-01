# Tenant audit continuity investigation — October 25, 2026

## Scope and status

Owner request: validate the four current automated CRITICAL candidates and find
why the tenant-isolation audit repeatedly fails to produce a complete report.
This investigation is not a certification of the entire application, a complete
security scan, or proof that no cross-tenant vulnerabilities exist.

The preceding incomplete report, its JSON evidence, checkpoint, prior completed
report and historical triage records were preserved in a verified owner-only
Google Drive archive before changes. Its reported coverage was 237/834 files,
105/326 chunks, with 285 raw findings including four CRITICAL and 249 HIGH.
These candidate counts are not confirmed exploitable vulnerability counts.

## Reproduced continuity defect and repair

Scheduled audit state is persisted with `jsonb_set` in
`server/lib/tenant-audit-job-state.ts`. Checkpoint integrity previously hashed
insertion-order `JSON.stringify` output. PostgreSQL `jsonb` retains object values
but reorders keys, including nested findings and receipts. A semantically
unchanged checkpoint therefore failed integrity validation when restored,
discarding completed progress.

The checksum now recursively canonicalizes object keys, preserves array order,
and hashes the complete unsigned checkpoint with a versioned domain separator.
Ordered legacy local checkpoints can still verify under their original checksum.
Unverifiable legacy database state is not silently re-signed or accepted.
Source/model/configuration bindings, contiguous chunk checks and incomplete-run
exit semantics remain enforced.

Verification:

- A regression first failed on the database-order fixture, then passed after repair.
- An actual read-only PostgreSQL `SELECT ...::jsonb` changed object order; the
  repaired checkpoint remained valid with its completed work intact.
- Source changes, holes in coverage and modified findings remain rejected.
- 58 targeted audit, tenant-boundary and scheduler-authority tests passed.
- Full TypeScript preflight passed.
- Independent review found no material bypass in the changed controls.

## Why other incomplete runs may still occur

- Editing server source, schema, audit implementation or evidence configuration
  legitimately invalidates prior coverage. These repairs themselves require a
  new source-bound pass; this must not be confused with repeatedly losing valid
  work between unchanged slices. Avoid source changes while a pass is running.
- Providers may fail or time out. The first restarted live pass observed an
  actual Profundo HTTP 503 and advanced its fallback machinery. A working key
  or catalog alone is not evidence of successful audit inference.
- Eight-chunk slices intentionally return incomplete status and continue under
  the existing bounded controller. A stopped/deferred slice is never a clean
  result. The final run must cover every required chunk and finish triage.

## Four CRITICAL candidates: bounded reachability review

| Candidate | Evidence and disposition |
|---|---|
| Business tools trust `tenant_id` | Known CRM, finance and legal handlers overwrite it with trusted `ctx.tenantId` after tool dispatch strips caller trust signals. No demonstrated non-owner attack path through these callers; the guard alone is not an authorization boundary. |
| Channel-route global UPSERT | This table is intentionally global (`UNIQUE(channel)`, no tenant column), and its API writes/deletes require authenticated platform-admin authority. Adding a tenant column/filter is not a justified fix for this report. Persona existence checking is a separate defense-in-depth concern. |
| Health audit archives proposal IDs globally | The HTTP entry point is owner/admin gated; global cleanup is intentional. The scheduled entry point needed an explicit owner floor, now added before import or mutation. No confirmed non-owner exploit was established. |
| Health audit disables stale heartbeat IDs globally | Same intentional global maintenance boundary. Scheduled `health_audit` now rejects absent, malformed and non-owner tenant identities before applying maintenance. Ordinary task approval is not authority for platform-wide cleanup. |

The scheduled owner floor is defense-in-depth against a wrongly approved or
misrouted task, not evidence that customer data was accessed. The review also
noted possible stale-selection/update races in legacy cleanup; these are not
established cross-tenant exploits and were not changed in this scoped repair.

## Operational boundary

Only workspace source was changed. Production has not been published or patched.
The configured bounded audit workflow was restarted against repaired workspace
source. A running workflow is not evidence of full completion. Do not issue a
clean report until all required coverage and final triage checks actually pass.
Do not remove source integrity checks, clear findings, reset checkpoints or
enable broader paid fallbacks merely to force a green result.

## Follow-up evidence — October 30, 2026

The archived alert `b7cc7d74-72fb-4469-9003-3cec37fce964`, generated at
2026-10-25T05:00:53.707Z, matches the externally quoted incident exactly:
833 files in scope, 741 unaudited (92 audited), 99 raw candidates, including
82 HIGH/CRITICAL. Chunk 45 exhausted its provider recovery pass. These were
partial automated candidates, not 82 verified exploitable vulnerabilities.

That historical coverage is no longer the latest state. The retained workspace
report on October 29 records 835/835 files and 326/326 successful chunks, zero
failed or pending chunks, and no source change during finalization. A live
workspace continuation on October 30 reused all 326 checkpointed chunks and
again reported 835/835. Production read-only job evidence independently showed
326 saved chunks and one saved precision-review batch in its current pending
audit; workspace precision state contained three saved review batches.
Those independent stores must not be presented as the same run or as completed
precision review.

The observed workspace continuation failed during precision review:

- Profundo: HTTP 503.
- Standard Compute: deadline exceeded.
- Openference: operator-disabled or not configured.
- Replit: HTTP 429.
- CheaperInference: provider catalog rejected.

The last error is a local admission/catalog failure, not proof of an upstream
inference outage. The logs do not establish its underlying catalog cause.
The controller retained completed work, exited the slice with recovery status 8,
released heavy-work admission, and scheduled delayed recovery.

The report renderer also labels every degraded result as “INCOMPLETE COVERAGE”
and substitutes “chunk cap in effect” when no chunks failed. Consequently it
mislabels incomplete precision review despite complete first-pass coverage.
This is a reporting defect, not evidence that the coverage counters are false.
Neither full first-pass coverage nor successful recovery unit tests establishes
that every retained candidate is a genuine isolation vulnerability.

Verification on October 30: 36 targeted offline tests passed across checkpoint
JSONB integrity, provider fallback, bounded completions, recovery controller,
and scheduling policy. No new live inference probes were launched, production
rows were not changed, and no source/configuration edits or publication were
performed during this follow-up. Keeping source unchanged preserves the
completed first-pass evidence while review remains incomplete. The reporting
defect and provider/catalog recovery blocker remain unresolved; no clean
security result is claimed.
