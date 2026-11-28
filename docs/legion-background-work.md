# Lenovo background worker — current scope

**November 26 Mellum update:** Lenovo is primary under the existing admission
and source contracts. It now uses the fixed Mellum model and verbatim Spark
guardrail, with one bounded validation retry; selected reasoning proposals use
Qwen3 8B for that retry. See `docs/legion-mellum-offload.md` for scope and actual
development evidence. Older allocation/activation descriptions below are
historical; production acceptance is not established by this update.

**Current owner-approved parallel allocation:** see
`docs/parallel-local-maintenance.md`. With the parallel flag, Lenovo and Surface
have independent inference slots and different task classes. The serial
Surface-as-backup allocation below is historical/legacy mode, not the current
parallel-work contract. The identity, source and authority restrictions remain.

## Second laptop preparation

The Surface companion shares this daemon and generation lock, not a second
node identity. The screened-runbook compiler always tries Lenovo first.
With exact `SURFACE_LOCAL_ENABLED=1`, a failed health check, transport, timeout,
empty/incomplete response or task-validation failure gets one Surface attempt.
With exact `LOCAL_HOSTED_FALLBACK_ENABLED=1`, exhausted local attempts get one
submission to the existing configured hosted fast-tier system, after an atomic
autonomous-budget reservation. Every candidate passes the same schema and
source-grounding checks before acceptance. Each new task starts with Lenovo.
Cancellation/revocation never trigger recovery, and admission contention waits
rather than spending hosted tokens. Current contract: `docs/local-response-failover.md`.
Earlier preparation and live-connection evidence: `docs/surface-local-preparation.md`.

## Working in development

- The main app owns the supervised Tailscale daemon. Identity is restored from
  the existing encrypted, environment-bound store; a permanent holder prevents
  uncertain takeover. Known clean exits can restart with backoff, at most three
  attempts. Uncertain stop/save failures require operator inspection.
- Exact `LEGION_BACKGROUND_ENABLED=1` enables only the original owner's
  installation. Development and production use different identities/proxy ports.
  The flag is enabled in **development only**. Disable with 0/remove and restart
  the app/workflows; restarting is required to pick up platform setting changes.
- Exact `LEGION_NIGHTLY_ENABLED=1` independently enables the local nightly
  scheduler. Both flags are enabled in development only; production is unset.
  Bob reports Lenovo is configured always online with no hibernation/sleep.
- Pinned build-time staging ships actual Tailscale 1.104.7 executables, verified
  against the same archive checksum as the Nix derivation. No model weights or
  credentials are packaged. Runtime does not download executables.
- Delegation progress labels are deterministic: **zero model calls**. Labels
  contain fixed activity categories, not task/customer values, and unchanged
  labels are not emitted repeatedly.
- Knowledge refresh selects only TDD, Zoom Out and Module Girth Guard runbooks
  for local compilation. It reads/screen-checks the actual allowlisted source,
  sends numbered lines without DB context, constrains JSON at Ollama and then
  checks the response again. The server extracts quotations itself.

## Runtime boundaries

Only owner-scoped internal text; no customer records, chat routing, tools,
security verdicts, approvals, code execution, customer deliverables or embedding
changes. Qwen3 8b only in this slice; 14b escalation is not yet wired.

The fixed local endpoints are reached through the private proxy. One advisory
lock serializes local app/workflow inference across both laptop attempts;
hosted recovery releases local capacity first. At most one submission per
provider/task, with a 240-second whole-task deadline below the queue lease.
If all routes fail, only that task fails/retries under the existing queue; the
application continues. Status labels still use no model.
Other knowledge-refresh work keeps its existing rules.

Inference is bounded to 90 seconds, 12,000 input characters, 2,048 output tokens.
Local ledger entries record owner, operation, model, reported token usage and
zero inference charge, including invalid returned completions. Missing Surface
usage is explicit, never measured zero. Hosted recovery uses normal provider
cost tracking; queue results mark hosted cost unknown rather than falsely free.
Content-free logs include latency/provider/fallback. Electricity, laptop uptime and app hosting are not
claimed free, and avoided dollar savings have not been measured.

## Observed evidence

The app restored its development identity and logged its supervised node ready.
A real call to the same helper used by knowledge refresh compiled Zoom Out:
four concepts, five exact source passages, 63,343 ms, 1,538 prompt/1,763
completion tokens, no hosted fallback. An earlier malformed response was rejected,
not silently accepted or billed to a hosted recovery.

Thirteen focused tests passed, plus full application TypeScript, targeted
worker/staging TypeScript, stale-string/wiring gates and a public landing capture.
The staging helper produced a runnable tailscaled 1.104.7.

The normal scheduler created three development jobs. TDD completed on its second
real attempt; a separate read of its persisted result confirmed the source hash
and every exact quotation. Zoom Out deferred for occupied capacity without a
generation. Module Girth Guard was correctly rejected for invalid model-selected
range arithmetic; its failed queue record was preserved, not relabeled successful.

The corrected compiler asks only for bounded starting-line selections; the server
computes short exact excerpts. It also requests Ollama's documented
`reasoning_effort: "none"` instead of relying on prompt-only `/no_think`.
A live corrective Module Girth Guard helper check returned four concepts/six
grounded quotations in 11,027 ms, 2,034 input/96 output tokens, zero inference
charge and no hosted fallback. This helper success is not a replacement queued
completion: the original failed job stays failed for that window. A complete
unattended three-source night has not yet been demonstrated.

## Durable nightly pilot

The app now schedules a fixed, bounded batch at **02:00 America/Chicago**, with
calendar/DST-safe catch-up after restart. The existing durable queue handles
each source independently and stores the validated concepts/exact quotations
as advisory job results. It does not edit the skills or promote model advice
into persona policy. There is no additional model call for scheduling itself.

At most one job/source/environment/night, at most three real attempts/job
(non-retryable validation errors can stop earlier). Successful
unchanged source hashes are reused without inference. Source changes supersede
an old job rather than changing its input. First attempts are staggered; the
cross-process inference lock remains authoritative. Busy/disabled jobs wait
15 minutes; offline laptops no longer block explicitly enabled hosted recovery.
Pre-dispatch capacity deferral
keeps claim attempts monotonic and raises the allowance; real generation failure
never receives that refund. Deferral and terminal completion require the exact
owner/claim and a live lease. At most nine task attempts/night, each with at most
two local submissions and one budget-gated hosted submission.

The full Agent Knowledge Refresh workflow remains **not started**. It is not
needed by this independent nightly pilot. Its concept upserts/embedding backfill
are separate; nightly job results are retained for review, not silently applied.
Build staging copies all three screened runbooks into the publication bundle;
the runtime reader is CJS-safe and refuses non-allowlisted/non-regular sources.

## Remaining rollout

The hosted app process must also be running; an always-on Lenovo alone does not
run this app's scheduler. The pilot is development-only, not live Felix routing.
No persona-facing tool/parameter or security approval surface changed.

Production flags/schema/publication and restart continuity, broader task routing,
quality comparisons, 14b escalation, standing-grant controls/UI and Spark–Felix
repair remain open. No other overnight jobs or expert/security/customer decisions
were moved. Do not describe the whole nightly system or whole build as complete.
