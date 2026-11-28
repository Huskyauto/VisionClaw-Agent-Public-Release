# Lenovo Mellum backend offload

## November 27 recovery evidence

The guarded conversation executor adds a public `conversationId` alias alongside
the sealed `_conversationId`. The diagnostic boundary removes that alias only
when the values match; unknown inputs and mismatched IDs remain invalid.

After a stopped development connection was recovered without discarding its
encrypted identity, an actual owner-Felix conversation completed the fixed probe:
Mellum returned exactly `42` in 1,214 ms, activity receipt 845, usage accounting
confirmed and no hosted fallback. The synthetic workload batch passed 15/15
ordinary cases and 2/2 controls. One of four missing-fact traps returned an
irrelevant acknowledgment and was rejected, so the overall batch did not pass.
Do not lower that acceptance threshold or enable broad routing on this evidence.

After the November 27 republish, production Felix invoked the diagnostic once
and received `status:"disabled"`, with no served model or fallback. The owner
maintenance endpoint and current startup log both reported
`not_primary_project`: the background flag was on, but the workspace-ID-only
gate refused the published runtime. Whether its workspace ID was missing or
different was not exposed; an attempted shell diagnostic was unavailable.

The published identity repair keeps the original workspace ID check for
development. For published execution (`REPLIT_DEPLOYMENT=1`), it instead
requires the exact generated hostname `vison-claw-agent.replit.app` in Replit's
managed `REPLIT_DOMAINS` list. This hostname was independently confirmed through
deployment metadata. A copied workspace ID, custom domain alone, missing domain
list, backup hostname, request Host, or deployment flag alone cannot authorize
a published backup. This change does not activate routine routing, alter
credentials or reset the private node.

After the identity repair was republished on November 27, production configuration
reported `enabled` and transport readiness was true. Actual owner-Felix
conversation 769 invoked the arithmetic diagnostic once: the exact configured
Mellum model returned raw `42` in 2,020 ms, with usage accounting confirmed,
no hosted fallback, and zero metered cloud cost for this local probe.
Activity receipt 951 was independently read back through the tenant-scoped
production API and matched the exact probe ID, conversation, served model and
output. No generation was repeated to verify persistence. This confirms the
production connection and fixed diagnostic, not arbitrary workload accuracy.

Saved environment settings do not prove what the current process sees.
Inspect `legionConfiguration.reason` on the
authenticated owner-only endpoint: `background_flag_disabled` means the process
did not receive exact `LEGION_BACKGROUND_ENABLED=1`; `not_primary_project` means
the original-project identity gate refused the runtime. Neither permits
bypassing the gate or starting a second node. `legionTransportReady` separately
reports supervisor readiness, not model accuracy. No environment values or
private connection identity are exposed.

Production connection acceptance passed; broad model-quality acceptance and
routine-compaction activation remain outstanding.

## Felix API diagnostic repair

The owner's Felix conversation can use the existing provider diagnostic:

```json
{"provider":"legion-local","local_check":"status"}
```

For the explicit synthetic arithmetic acceptance, call `test_api_keys` with:

```json
{"provider":"legion-local","local_check":"arithmetic"}
```

This is a fixed, server-owned “What is 17 + 25? Reply with only the number.”
request, not an arbitrary-prompt gateway. It requires the trusted owner tenant,
Felix persona, existing background opt-in, confirmed supervised transport and
the exact configured Mellum model. One shared admission slot and one request
are used; Qwen, Surface and cloud fallbacks are excluded. No automatic retry.
Caller-supplied prompts, model names, URLs and authority fields are not accepted.

`status:"complete"` includes a durable activity-log `receipt`, the exact
`servedModel`, exact `rawOutput`, and `latencyMs`. Latency covers the local
worker including admission and accounting, not Felix's full API turn.
`providerReportedCostUsd:null` means that the provider did not report dollar
cost. `meteredCloudCostUsd:0` is limited to this local probe; it does not measure
laptop operating cost or Felix's separate cloud reply.
`usageLedgerConfirmed` independently reports whether token-usage accounting
was confirmed. False/throw/timeout remains explicit even when the separate
provider-proof activity receipt was saved; none authorizes another generation.
The receipt is bound to the trusted conversation ID. An uncertain receipt write
reports `receipt_unconfirmed`, not acceptance or permission to repeat generation.

Suggested tester instruction:
“In this owner-Felix API conversation, call test_api_keys with provider
legion-local and local_check arithmetic. Do not answer the arithmetic yourself.
Report the returned receipt ID, actual served model, exact raw output, local
latency and any recorded cost. Stop if unavailable or unconfirmed; do not
substitute another model.”

Felix's conversation reply may still be served by Spark. Its outer API model
field is not the nested Mellum probe's served-model evidence. Offline adapter,
dispatcher, scope and capped-menu tests do not prove production connectivity.
After an authorized republish, repeat this test through the actual owner API.

## Implemented scope

The fixed `legion-local` backend now requests
`hf.co/JetBrains/Mellum2.1-12B-A2.5B-Instruct-GGUF:MXFP4_MOE`.
The exact Spark guardrail is the first system message, before task instructions.
The existing memory category, source selection, dream digest/proposal and
screened engineering runbook contracts still independently validate results.
Lenovo is primary; Surface remains an explicitly enabled, contract-checked backup.

There is at most one Lenovo validation retry. Ordinary tasks retry Mellum;
`dream-proposals` retries `qwen3:8b`. Transport failures do not buy speculative
retries. Existing cancellation, owner-only scope, provider revocation, accounting,
per-device database locks and source checks remain in force.

The new routine helper has server-owned extraction, classification, transform,
bounded-text, normalized-exact and custom-validator contracts. Its only new
production-code caller is **short owner conversation compaction**. It preserves
the existing archive, exact identifiers, quality checks and original cloud
closure. Long histories and explicit corrections stay on the stronger route.
Other helper contracts are preparation, not claims that all matching platform
workloads are already routed locally. No tools or customer routing were added.

## Activation and rollback

`LEGION_ROUTINE_ENABLED=1` is a separate, exact opt-in, default off. It also
requires the original workspace's existing `LEGION_BACKGROUND_ENABLED=1`,
`APP_ACCESS_MODE=owner-only`, and recent successful model warmup. The helper's
entire local attempt budget is 30 seconds, including retries and accounting;
failure, invalid output or busy admission invokes the original cloud closure.
Caller cancellation and tenant mismatch do not authorize a cloud retry.

Startup and four-minute maintenance issue a synthetic, single-flight warmup in
the same per-device slot. Failed warmup disables new routine offload until a
later successful warmup. It is not a guarantee against an unrelated manual model
unload between readiness checks.

Set the routine flag to `0`/remove it and restart to restore the original
compaction route. Existing native local tasks retain their existing controls.
No production configuration or publication is authorized by this document.

## Evidence, November 26, 2026, America/Chicago

The owner approved recovery of the stale **development** connection fence.
No daemon was running locally; a compare-and-swap recovery preserved the
encrypted identity and did not touch production. VisionClaw then connected and
passed its synthetic Mellum warmup.

Run `npx tsx scripts/legion-mellum-acceptance.ts --run` only for an intentional
development acceptance check. Unknown or absent flags refuse execution. It
never starts another daemon, executes tools, selects cloud fallback or changes
activation flags. All fixtures are synthetic. Each case traverses the existing
VisionClaw native worker and guarded runtime transport, with a deterministic
checker, served-model verification and normal accounting.

Results are retained at `generated-artifacts/mellum-acceptance/latest.json`:

- 15/15 category-equivalent workload fixtures passed, including hallucination guard.
- 4/4 unknowable-fact traps returned exactly `I don't have that information.`
- Both arithmetic/extraction controls passed.
- Median observed round trip: 406 ms; zero cloud calls.

The historical benchmark's exact prompt texts were not supplied. These are
equivalent categories, not evidence of an identical historical replay. The
tool-JSON fixture tests representation, not the guarded executor or a tool loop.

## Deliberately incomplete

**Continuity follow-through:** a later controlled development check proved one
real budget-gated hosted fallback under injected local unavailability (three
source-grounded concepts, 4,765 ms). Busy-device fallback and pre-generation
cloud-capacity job retention are now implemented. See
`docs/local-response-failover.md`. Neither laptop was disconnected and no
production configuration changed.

Published-build acceptance remains unverified. The new routine flag stays off
until the remaining acceptance is satisfied and activation is approved.
The routine-summary closure has deterministic injected-failure coverage; the
real cloud receipt above exercises the screened runbook path. The live batch does not establish a persisted
compaction journey. Actual tool loops, broad document/email drafting routing,
automatic daily owner rollups and reasoning retries beyond the existing
dream-proposals lane remain outside this implementation.

Per-call worker logs retain workload, provider, served model, latency and token
counts. Routine logs record acceptance/fallback and cloud calls avoided without
prompt/response bodies. Native usage persists in the existing ledger; this is
not yet the requested owner-readable daily pass/fallback rollup.
