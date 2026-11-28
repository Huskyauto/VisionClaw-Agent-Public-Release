# Validated local-first runbook recovery

## Current continuity policy — November 26, 2026

Republish follow-through: memory tasks preserve uncertain started inference
as a distinct non-replayable outcome, including their own deadline. Genuine
pre-dispatch contention can still use enabled recovery. The dormant routine
wrapper now receives supervisor shutdown at its outer boundary as well as
local dispatch; shutdown cannot authorize its cloud closure.

Bob explicitly requested backup plans so Lenovo unavailability does not abandon
projects. The existing hosted-recovery flag was already `1` in development and
production; no environment setting was changed by this fix.

- Lenovo remains primary. Pre-generation contention can use an enabled,
  task-eligible Surface backup. Uncertain already-started local work is not
  restarted on another provider.
- If local routes have no capacity, enabled hosted recovery can submit once
  through the existing fast-tier router and autonomous budget reservation.
  Both the full runbook and short source-rule compiler use this policy.
- Cloud model-resolution, admission or budget unavailability **before any
  generation** keeps the same queue job pending under its existing tenant,
  environment, source, attempt and lease fences. Attempts stay monotonic.
- A real/uncertain generation still counts toward bounded failure limits.
  Cancellation, revocation, invalid owner/source and exhausted approval authority
  never authorize more work. This is not an unlimited paid retry loop.
- Memory categorization/digest/proposal work can return to its original hosted
  processor after local deferral when recovery is enabled. Independent review
  still owns consequential memory changes.

A controlled development diagnostic injected local unavailability without
disconnecting either laptop. The **real** hosted fast-tier path selected
`muse-spark-1.3-contributor`, reserved the existing budget, made one submission
and returned three source-grounded concepts in 4,765 ms. Receipt:
`generated-artifacts/legion-backup/live-proof.json`. This proves cloud recovery
under an injected outage, not a physical laptop shutdown or published-build
acceptance. No publishing or production setting changes were performed.

Verification after this fix: 101 focused provider, queue, memory, source-rule,
slot and routing regressions passed. Full TypeScript checking and production
build passed. Active persona guidance was synchronized and its wiring audit
passed (existing warn-only orphan-table notices remained). Review was scoped
self-review of these branches and their callers, not independent security
clearance or a new whole-repository audit.

**Earlier parallel allocation:** `docs/parallel-local-maintenance.md` superseded
the serial/shared-lock allocation below when `LOCAL_PARALLEL_ENABLED=1`.
Complex tasks no longer ask Surface for multi-concept output; simple tasks start
there. Hosted validation, budget and authority boundaries below remain in force.

Bob approved deterministic failed-response checks, then explicitly requested
normal hosted LLM recovery when both on-premise systems fail.

## Earlier design and boundaries (historical)

1. **Cost:** three screened sources × three queue attempts × at most one call
   per provider = at most 27 generation submissions/night (18 local, 9 hosted).
   Unchanged successful sources still reuse their results. Hosted work reserves
   the existing autonomous budget immediately before dispatch and uses normal
   provider cost tracking; local usage remains separately attributed at $0.
2. **State:** existing encrypted identity, advisory admission lock, queue and
   ledger; no new table, scheduler, daemon, credential or model weights.
3. **Failure:** Lenovo first; enabled Surface once after health, transport,
   timeout or response-validation failure; configured hosted fast tier once
   after both local options fail. All candidates pass identical runbook schema
   and exact-source checks. No approval/tool side effects can be replayed.
   Cancellation, revocation, invalid owner/source and admission contention do
   not trigger a paid rescue. All three failing remains an explicit task failure,
   not a reason to stop unrelated application work.
4. **Identity:** one immutable screened source snapshot/hash per task, existing
   source/environment/night queue identity. Local admission spans both local
   attempts; hosted recovery begins only after its release.
5. **Limits:** owner-only, original workspace, the same three source files;
   90 seconds/provider and 240 seconds for the entire task (within the existing
   five-minute queue lease), existing input/output caps. Hosted SDK retries disabled
   per submission. Provider-internal normal routing remains its own policy.
6. **Control:** exact `SURFACE_LOCAL_ENABLED=1` enables the second local attempt;
   exact `LOCAL_HOSTED_FALLBACK_ENABLED=1` enables hosted recovery, additionally
   requiring the existing background flag. Default off. Development only;
   production/publication remains separately authorized. Logs identify rejected
   stages and accepted providers without source/answer contents.
7. **Authority:** Bob chooses enabled routes; deterministic code selects and
   validates; models only propose concepts/source positions. Existing budget
   governor can refuse hosted spend. No persona-facing tool or authority change.
8. **Evidence:** offline injected-provider tests cover valid Lenovo, bad/empty/
   malformed/truncated answers, Surface recovery and rejection, hosted recovery,
   cancellation, disabled routes, budget refusal and cross-tenant denial.
   Live smoke checks are bounded and do not require another laptop outage.

This supersedes the earlier outage-only/no-hosted-fallback preparation contract
for these runbook tasks only. It does not move general chat, customer records,
customer deliverables, embeddings, jury decisions or other background tasks.

## Acceptance evidence — November 17, 2026

- **Offline:** 40 focused local-provider tests passed, including the full
  Lenovo → Surface → hosted chain with invalid local answers, primary-only
  success, task/schema/source rejection, bounded all-provider failure,
  cancellation/revocation, admission contention, hosted budget denial and
  offline-nightly recovery. No live credentials/providers are used by these
  injected transport fixtures.
- **Type safety:** expanded application TypeScript plus the changed workflow
  script and provider tests passed. Stale-string gate passed. Wiring audit
  passed with its existing advisory persona-sprawl/orphan-table warnings.
  No persona-facing surface changed; prompt/allowlist synchronization is not
  applicable to this internal compiler infrastructure.
- **Normal live route:** actual Zoom Out source compiled on Lenovo Qwen3 8b in
  11,662 ms; one concept/three server-extracted exact quotations, 1,551 input /
  29 output tokens, $0 inference charge, no Surface/hosted fallback.
- **Live hosted recovery:** controlled diagnostic injected failure of local
  routes without changing either laptop or production. The normal fast-tier
  router chose `muse-spark-1.3-contributor` through the existing Meta lane.
  Four concepts/four exact source quotations passed the same compiler checks.
  Owner ledger evidence: `llm.meta-direct`,
  `meta-direct/muse-spark-1.3-contributor`, 1,392 input/303 output tokens,
  recorded charge $0.000200. This is a real hosted recovery result under
  simulated local faults, not proof that the laptops were physically offline.
- **Surface quality limit retained:** two bounded diagnostic compilations
  rejected excess `lineStarts` references even with the clearer prompt. No
  truncation, coercion or weaker schema was introduced to make them pass.
  Surface remains a checked attempt, not a guarantee of a valid answer; the
  hosted recovery covers such failures. Rejected local completions were recorded
  at $0 with usage explicitly unreported.
- **Activation:** `SURFACE_LOCAL_ENABLED=1` and
  `LOCAL_HOSTED_FALLBACK_ENABLED=1` enabled in development only; app restarted
  successfully with its supervised node ready. Public landing capture loaded.
  No production settings, publication or laptop services changed.
- **Scoped self-review:** reviewed changed provider/worker/compiler/queue
  branches and callers, including silent-failure paths, owner/tenant checks,
  fixed endpoints, cancellation, budget-before-spend, retry bounds and
  provider accounting. No unsolicited reviewer agent or whole-platform
  security clearance. Provider transport timeouts remain observable failures,
  never plausible successful defaults.
