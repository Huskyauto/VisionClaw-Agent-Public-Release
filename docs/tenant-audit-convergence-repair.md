# Source-current audit recovery repair

Scheduling update: retain the convergence and exact-input validation rules here,
but use the weekly campaign and daily limits in
[tenant-audit-weekly-batches.md](tenant-audit-weekly-batches.md).

## Scope and authority

The owner authorized a complete inspection, up to $10 in consultations, and
implementation of the verified correction. Fable 5.2 supplied the advisory
design; the implementation remains Replit Agent's responsibility. No release,
production flag, schema/RLS change, new paid provider or wider agent authority
was authorized or applied.

The completed Fable inspection cost **$1.298480**, with exact returned model
identity and a persisted ledger/settlement receipt. The earlier unsuccessful
complex consultation cost $0.770024 and produced no visible recommendation.
Both outcomes are retained, not conflated.

## Diagnosis and engineering judgment

- **Confirmed:** a whole-corpus hash invalidated all prefix progress on any
  server-source change. A multi-hour serial audit therefore raced normal edits.
- **Confirmed:** controller/runtime deadlines were reported using the same
  status as provider outages, adding inappropriate provider backoff.
- **Confirmed:** saved provider failure streaks did not reset after success.
- **Confirmed:** precision keys included unrelated global source and positional
  batches; cached work was included in the next budget claim.
- **Not demonstrated:** repeated chunk log lines prove concurrent execution.
  Chunks contain multiple units, so those lines alone do not establish duplication.
- **Not adopted:** replaying a possibly dispatched paid provider merely because
  a process died. Paid requests now have a durable write-ahead attempt marker
  independent of coverage-prefix/cache resets. Exact paid request identity binds
  system/user bytes, route and effective output cap. Within the campaign, unknown
  outcomes require explicit operator retry; only a proven pre-dispatch yield can
  restore an unused cursor. New campaigns retain the existing fresh-review policy.
- **Not adopted:** promoting a sparse or partly blocked manifest to full
  clearance. Existing contiguous chunk-prefix validation and unresolved-unit
  blocking remain. A genuinely poison unit still fails closed and needs
  diagnosis; this is not evidence that every reported finding was repaired.

## Design gate

1. **Cost/scale:** reuse only exact validated inputs. Consultations remain inside
   the owner's $10 ceiling and the shared aggregate spending guard. No model
   concurrency or automatic paid retry was added.
2. **State:** the existing fenced job payload owns scheduled progress. The new
   unit ledger is nested in its existing checkpoint, with an independent
   semantic checksum, a 6 MiB ledger bound and the existing 8 MiB field bound.
   Local files remain diagnostic/standalone state, not a production fallback.
3. **Failure:** invalid checksums, input drift, malformed findings, unknown
   receipt identities, capacity errors and lost leases never grant clearance.
   Source/prompt/config drift rebuilds the current prefix; only matching unit
   receipts may reduce fresh model work.
4. **Identity:** SHA-256 binds exact labelled, line-numbered unit bytes and
   evidence-producing code, prompt, routes and limits. The coordinator remains
   the single writer. Each fresh result is checkpointed before another unit.
5. **Tenant/limits:** no new table or query; existing owner-tenant/attempt/lease
   fencing, spend admission, provider pins and report/readiness checks remain.
6. **Stop/observe:** existing workflow/job cancellation remains effective.
   Children receive an absolute scheduling deadline and yield before starting
   work that cannot fit. Logs distinguish fresh dispatches and exact-input
   reuse; offline preflight reports both parent chunks and real model units.
7. **Authority:** Fable proposes; Agent verifies and edits; deterministic tests
   and existing guards enforce; the owner controls publication. Neither the
   model nor the cache may modify approval, evaluator or spending rules.
8. **Delta evidence:** isolated provider/clock/storage tests compare cold,
   changed-source, inserted-file, tampered-cache, deadline and provider-success
   scenarios. No whole-platform security or production acceptance claim follows.

## Implementation

- **Exact-input ledger:** preserve reusable receipts across a global prefix
  reset only after validating the previous checkpoint and ledger. Prune edited
  or deleted units; revalidate path/line bindings for every current receipt.
  Old v1 checkpoints without a ledger get no inferred per-unit receipts.
- **Stable packing anchors:** deterministic path anchors limit downstream
  repacking. SHA-256, not the anchor hash, establishes receipt identity.
  On the same 858-file corpus, 814 → 823 model units (+1.1%); 327 → 353
  parent chunks. Fully cached chunks do not consume the fresh-work slice quota.
- **Precision:** use stable file-local batches, exact rendered inputs, full
  referenced-file hashes, schema-index hash and producer contract. Prune stale
  keys and reserve only for uncached batches. Revalidate complete target sets
  even on cache hits. Suppression/deferral rules are re-read at finalization.
- **Deadlines:** pass remaining absolute deadlines to local and scheduled
  children. A graceful yield is pending work; hard scheduling timeouts use
  distinct exit 9. Only actual provider exhaustion uses provider-backoff exit 8.
  Hard timeouts without completed-unit/prefix/precision progress use a separate
  bounded stall counter: back off, then stop after three. Cursor, heartbeat and
  provider-health writes do not masquerade as progress.
- **Provider health:** reset the route's failure streak after a validated
  response; content-validation failures retain unresolved findings but do not
  falsely quarantine a working transport. Explicit refusals still retain the
  existing conservative treatment.

## Acceptance and limits

The actual load/save/audit-unit wiring is tested against isolated durable-state
and provider doubles, not merely duplicated helper logic. It proves that a
changed global snapshot rebuilds current coverage while only changed/new exact
inputs dispatch, and that insertion does not relabel old findings as new work.

The full-corpus first pass, complete precision pass, fresh evidence hash,
unchanged finalization source, severe-finding dispositions and independent
republish-readiness check still control final status. Partial work never turns
green. A completed campaign expires its local cache as before; reuse does not
create permanent security certification across all future audit campaigns.

Production publication and several real full scheduled cycles remain separate
acceptance evidence. This repair does not assert they have run.

## Fable correction-review triage

The independent correction review completed with a $1.824424 ledger receipt.
Its findings were checked against the code, not accepted as security certification:

- **HIGH reliability:** cached-prefix replay still consumed the fresh slice
  quota. Fixed with tested cache-aware planning; 300 cached chunks plus the next
  fresh chunk now fit one slice with a fresh-work quota of one. Budget estimates
  charge only fresh chunks. This was a convergence defect, not a discovered
  exploitable tenant-isolation vulnerability.
- **MEDIUM:** an optional ledger-restore exception erased an independently
  valid prefix. Fixed with an isolated restore failure boundary and an actual
  checkpoint-loader regression containing a later unsplittable source line.
- **MEDIUM:** advancing a provider cursor did not forbid later paid wraparound.
  Fixed with fenced write-ahead exact-request attempt markers for both scan and
  precision; failed persistence never dispatches a backup. Content-only
  exhaustion remains incomplete but is not labeled provider unavailability.
- **LOW/MEDIUM scheduling:** hard-killed children without completed work could
  promptly repeat. Fixed with semantic-progress fingerprints and three-strike
  bounded deadline deferral, preserving monotonic real attempt numbers.
- **LOW:** receipt capacity is now reserved before inference; attempt counts
  increment only after deadline admission. Provider success health writes occur
  outside fallback and after durable output, so telemetry failure cannot
  re-dispatch an already validated response.
- **LOW accepted boundary:** cache age is campaign-bound, not time-TTL-bound.
  A new producer contract or campaign invalidates reuse; unchanged inputs inside
  a still-active campaign may be reused without a separate time expiry.
- **Missing-context risk resolved:** the actual scheduler refuses to enqueue a
  new job while any audit is pending/running, regardless of day/source key.
  Thus an active job retains its ledger across continuations. New completed/
  failed campaigns intentionally do not inherit clearance. Local single-writer
  still relies on the existing shared heavy-work admission lane.
- **Existing trust boundary:** SHA-256 checksums detect corruption, not an
  authorized state writer. Job-state writes remain owner-tenant/kind/attempt/
  lease fenced; no new public write endpoint was added.

### Classification follow-up

Fable's next review correctly identified overly strict terminal classification
when some routes were skipped, an already-attempted paid request incorrectly
ending the whole pass, and an unsplittable chunk pruning too broadly. These
were fixed and reproduced with focused regressions:

- Only a pass that actually dispatches all five routes can conclude all-content
  failure. Cooldowns, disabled/previously attempted routes and an incomplete
  time window remain untried/recovery work.
- An existing paid marker makes that route unavailable for that exact request;
  it is not a content error that stops the campaign. Marker persistence moved
  after eligibility and resolution, immediately before SDK creation. Admission
  persistence failure remains fail-closed and cannot dispatch a backup.
  Conservative uncertainty remains if cancellation or an SDK-internal reserve
  fails after marker admission; automatic retry still cannot assume no dispatch.
- Unsplittable chunks lose only their own reuse keys, not unrelated receipts or
  an independently valid current prefix.
- Graceful no-progress yields also use the bounded stall gate.
- Fully completed local campaigns clear their paid-attempt map. Scheduled maps
  remain scoped to their job/campaign. Late database marker writes atomically
  merge keys so they cannot erase a newer request's uncertainty receipt.
- Pure cached replay promotes a bounded batch under the existing fence before
  fresh work, avoiding per-unit full-payload database round trips.
- Recovery is also bounded when an invalid unit is indistinguishable from
  indefinitely unavailable routes: twelve consecutive recovery passes without
  completed work stop with an explicit unresolved-work error. Genuine completed
  work resets that counter; ordinary provider backoff remains, rather than
  treating one malformed response plus cooled routes as terminal.
- Completed non-resumable local campaigns also clear their local paid markers.
  The real SDK pre-dispatch admission-failure seam is covered by a regression,
  in addition to the outer fallback-admission failure case.

## Final local verification

Fable's final narrow closure check recorded **$0.416240** and reported no
confirmed new blocking defect in the shown closure changes. It still did not
execute tests or certify production. Two small non-blocking follow-ups were
then fixed: completed work resets both recovery and deadline-stall streaks, and
durable payloads are serialized/bound once rather than duplicated in SQL.
Local marker clearing follows successful checkpoint removal.

- **138/138** focused audit/Fable/Astra regression tests passed.
- **85/85** dispatch and safety seam regressions passed.
- TypeScript and the production build passed; four existing import.meta/CJS
  build warnings remain.
- Actual PostgreSQL planned five generated state/backoff statements using
  **EXPLAIN without ANALYZE**: zero update statements were executed.
- Bundled offline preflight loaded the canonical **858 files / 353 parent
  chunks / 823 model units**, with `auditExecuted: false`.
- Agent wiring and stale-string checks passed. No persona-facing tool,
  parameter, permission or schema surface was added.

All retained Fable ledger entries total **$7.372080**, including the earlier
successful direct review and the unsuccessful token-exhausted consultation.
The original failed 60-second request still has a separate unresolved
60-cent hold and no settled usage. Both known cost and that hold remain within
the owner's $10 ceiling; neither is proof of final provider invoice charges.

Remaining boundaries: a full real scheduled audit and post-publication cycles
have not been verified; a new deployment/contract intentionally cold-starts
legacy checkpoints without receipts. Receipt freshness is campaign-bound.
State integrity assumes the existing authorized writer/fencing boundary, not
an unforgeable model certificate. Progress fingerprints are operational retry
signals, not security-clearance evidence; only final current full coverage can
clear the audit.

## Rollback

Revert the repair's source changes. Producer-contract changes invalidate the
new cache; the old global-source prefix checks remain conservative. No schema
rollback is needed. Retain diagnostic reports and spending evidence; never
re-sign old state or manufacture completed coverage to avoid a cold restart.
