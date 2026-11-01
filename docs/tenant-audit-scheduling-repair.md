# Tenant audit recurrence repair

Scope: run the existing read-only auditor from the always-on production VM,
through the durable job queue, and publish persistent owner notifications when
coverage is incomplete, stalled or missing. Workspace Run is not a timer.

Design gate:
1. Cost: five explicit routes: Profundo / Claude Sonnet 5, Standard Compute /
   pinned Gemini 3.1 Pro Preview, Openference / DeepSeek V4 Pro, Replit-managed
   GPT-5.4, then named CheaperInference / GPT-5.6 Luna. Memberships/prepaid
   allowances are finite; native Replit billing still applies. The sole direct
   paid recovery is the already-approved owner automatic CheaperInference path,
   guarded by its shared $20 UTC-day reserve/settle cap. No generic paid
   fallback or automatic repair. One parent chunk per
   scheduled invocation, at most 2,048 invocations per audit, with bounded retries.
2. State: tenant-1 agent_jobs payload stores the checkpoint, precision responses,
   report, per-unit receipts and the next-writer cursor. Local source checkpoints
   and precision-progress files support standalone recovery; scheduled recovery
   uses the database, never a local mirror.
3. Failure: incomplete never means green. Capacity defers without consuming a
   failed attempt. Each source/precision unit has five independent routes,
   55 seconds each, with abort and SDK retries disabled. Fast failures can try
   all five; a 170-second pass budget allows at most three full timeout windows.
   Insufficient time preserves the untried next writer rather than starting a
   partial paid request. Outages
   return exit 8 and persist a delayed continuation (5, 10, 20, 40, then 60 minutes).
   Real attempt fences remain monotonic. Code/configuration failures still stop;
   persistent notification is independent of mail-provider acceptance.
4. Identity: UTC-day plus exact source-hash dedupe key; no new daily job while a previous job is active.
   All state writes require tenant, job kind, running status, attempt and lease.
5. Isolation/limits: platform-owner job only; existing heavy-work lock, source
   validation and budget gates remain. Child wall clock is bounded below lease.
6. Stop: cancellation/lease loss prevents child writes and further model calls;
   existing disabled run controls remain. Scheduler can be disabled explicitly.
7. Authority: auditing only; no auto-fix, jury apply, rule changes or publication.
8. Evidence: test recurrence, dedupe, stale/partial warnings, wrong-tenant fences,
   command selection, fallback progression and checkpoint restoration offline. Production coverage
   remains unproven until the published runner completes its full source scan
   and precision pass. No paid full-scan smoke test.

Operational guidance: the production scheduler is automatic; do not create a
heartbeat prompt task or restart workspace Run as a substitute. Inspect the
tenant-1 `tenant_isolation_audit` job in `/operator` and its fenced payload
`auditCheckpoint`, `auditReport`, `auditPrecision` and `auditProgressAt`.
Owner dashboard notifications explain missing, incomplete, stalled, changed-source
and completed-with-findings outcomes. They are persistent notices, not verified
email delivery. The operator may cancel the exact job; the running child is
stopped on lease/cancellation detection and cannot persist under an old claim.
Disable recurrence with `TENANT_AUDIT_SCHEDULE_ENABLED=0` and restart/republish.
Manual workspace audits still use diagnostic local files; they are not proof
that the production scheduled job ran. Never bypass fingerprint checks, widen
the source-audit permission to customers, or trigger a metered provider fallback.

Source changes invalidate old checkpoints by design. Never preserve apparent
coverage by disabling source fingerprint validation. Cache precision responses
by exact request identity so bounded child restarts do not repay completed work.

Verification: focused offline tests and bounded TypeScript passed. The bundled
plain-Node `--preflight-only` command read the current source/schema and produced
833 files / 325 chunks with `auditExecuted:false`; it does not prove model or
production coverage. The probe makes no job, provider, budget, mail or report
writes. Build-time imports have existing CJS `import.meta` warnings; these are
not proof those unrelated optional runtime paths were exercised.

Prior independent review findings addressed: live source freshness; historical warning
resolution/reopening; effective-model-bound precision cache; exact JSON-escaping
capacity reservation before dispatch; tenant/kind/attempt/live-lease fences on
both capacity and real-work continuation; monotonic attempts after real work;
three-real-code-failure ceiling (not provider outages); transient DB preflight retry versus deterministic
bundle/authority stop. Missing bundles stop immediately, while transient reads
use the bounded failure policy when durable state is available. Capacity
unavailability does not dispatch or consume model-failure budget. No production
publication, current full-scan claim, mail inbox receipt, commit or push.

## Automatic fallback and handoff

`AUDIT_PROVIDER_LANE` selects the primary, not an exclusive transport. The four
other routes follow in their fixed order. Subscription/native routes are pinned;
the named paid route requires automatic owner admission, exact served-model
identity and the existing aggregate reservation, never caller owner-selection
booleans. Failure cannot quietly enter a generic direct API-key recovery.
Provider operator kill switches remain authoritative.

Parent chunks are divided into at most 30,000-character, file-labelled source
units. Large files retain original line numbers and up to 150 overlapping context
lines (bounded to half a window so long lines cannot cause one-line progress).
After each complete validated response, its findings and actual writer identity
are committed before another unit starts. Only when every unit finishes is the
parent chunk counted as covered. A pre-dispatch next-writer receipt means a hung
process can be killed and resumed on the next route. The interrupted unit may
need another call; completed sibling units and prior chunks are not reworked.
No claim is made that unseen tokens from a hung provider can be recovered.

Precision verification uses the same five-route policy. Its completed responses
are retained by exact source/prompt/batch/policy identity, independent of which
route finished. Refusal, truncation, empty content, invalid JSON or findings from
outside the supplied unit are failures, never clean coverage.

State remains source-bound and checksum-validated. A code/audit-policy change
invalidates prior clearance; preserving work across provider failure does not
authorize reusing stale security coverage. Publishing a changed source revision
can enqueue a new run even if the previous revision's daily run stopped.

Operational stop controls: `TENANT_AUDIT_SCHEDULE_ENABLED=0`, job cancellation,
provider-specific stops, the 2,048-claim ceiling and the existing heavy-work
admission/budget checks. After that finite ceiling, the terminal audit remains
incomplete and the daily scheduler can create the next day's run. Availability
recovery does not grant the auditor permission to edit code or change its gates.

Final workspace verification: 56 focused tests passed, TypeScript clean with a
3 GB heap bound, and the standalone plain-Node bundle passed preflight
(833 files / 325 parent chunks; no audit executed by preflight). The application
started and its public page rendered. Independent review's provider-disable
override was fixed; a proposed header-forgery issue was disproven using actual
line-numbered source, with original-file/actual-unit line checks added separately.

The restarted live audit exercised all three routes but completed no unit:
Profundo returned 503, Openference was unavailable, and the native Replit
route was rejected. A separate tiny bounded native-route probe identified 429
`RATELIMIT_EXCEEDED`. Provider availability and completed full production coverage
remain unproven. Do not describe this as a completed security scan.

## Expanded-provider correction

Do not equate three configured audit routes with the owner's complete inventory.
Openference is explicitly disabled; Reflection's temporary free approval expired
October 19. Neither condition is an upstream outage and neither is overridden.
Standard Compute produced a complete textual refusal for the source-audit probe,
not a successful audit. Explicit refusals receive an audit-only one-hour cooldown
without reformulating the request or changing global jury/provider permissions.
Other failures receive per-route 5–60-minute cooldowns. Health records are
persisted behind the same tenant/attempt/lease fence; malformed state fails closed.
Disabled/cooled routes are skipped without model calls.

CheaperInference's live model catalog expanded to 520 entries. The old 300-entry
guard and unrecognized embedding/speech/transcription/realtime/image-edit entries
made the integration unusable before inference. The parser now permits at most
1,000 entries while retaining identity, exact-endpoint and price validation.
Those known extra API families remain discovery-only; unknown families still
fail closed. No new modality execution permission was granted.

A real fixed 44-line owner-source probe completed through CheaperInference and
passed the JSON/path/line contract. This is real inference evidence, not whole
audit clearance. Probe commands are bounded and preserve raw completed responses:
`npx tsx scripts/tenant-audit-provider-probe.ts --provider=standard-compute`
or `--provider=cheaperinference`. Reusing the same probe reads its retained
response without another call; `--retry` explicitly requests a new attempt.
Artifacts stay in private `.local/audit-provider-probes`, not public uploads.

Operator disable, tenant scope, discount floor and abort status are rechecked
after the paid reservation and immediately before dispatch. A stop during
admission prevents the provider call and leaves the conservative hold intact.
