# Provider reliability analysis

**Prepared October 30, 2026. Scope: VisionClaw inference-provider access,
application routing, and the tenant-audit recovery path.**

## Executive conclusion

We do not have evidence that all providers are down. We have a mixture of:

1. Working inference services that are not enabled for production or not exposed
   to the task that needs them.
2. A reachable paid fallback blocked by our own catalog adapter.
3. Actual rate limiting on the Replit route.
4. Historical upstream faults and workload-specific response failures.
5. Confusing status messages that combine scanning, review, authorization,
   provider availability, and normal job continuation.

The most practical foundation for owner work is the already integrated,
budget-guarded Mammouth transport, with Standard Compute as a demonstrated
candidate for bounded non-streaming review. Neither has been certified for
general production traffic. CheaperInference remains the owner's preferred
automatic paid recovery service, but its catalog adapter currently prevents
dispatch. Do not replace that policy silently.

For a customer-facing service, use a small, explicitly approved set of
independent transports with enforced spend and privacy policies. Do not count
disabled providers, expired trials, model aliases, or catalog-only access as
operational backups. Keep the application and queued jobs usable when no model
can finish immediately. No finite fallback chain guarantees continuous inference.

## What was checked

- Thirteen authenticated catalog/metadata endpoints, using credentials only
  inside existing runtime-backed requests. Twelve returned HTTP 200; the legacy
  Google route returned HTTP 400.
- Existing application routes for Replit, Standard Compute, CheaperInference,
  Mammouth GLM 5.3 Flash, and Mammouth Mistral Large 4.
- Structured extraction from a deterministic twenty-record fixture. Accepted
  results had to return exactly tenant 2's open record IDs: 2, 8, 14, and 20.
- Tool-call compatibility for both Mammouth models. Calls were validated but
  never executed as external actions.
- A separate small real-source audit through the existing Standard Compute
  audit adapter: 44 source lines; strict file/line/severity validation.
- Shared, development, and production flags without viewing secret values.
- A read-only production investigation of the preceding 24 hours, performed by
  the production-investigation agent, plus parent inspection of relevant code.
- Provider documentation and previous account-scope decisions.

These are point-in-time tests, not uptime measurements, a full production
conversation test, a large-context benchmark, or security clearance. Catalog
success does not establish a funded balance, inference entitlement, tools,
streaming, correctness, privacy suitability, or remaining subscription allowance.
Media providers, email, payments, telephony and browser services were not
included in this inference-provider investigation.

## Evidence matrix

| Route | Observed evidence | Current operational conclusion |
|---|---|---|
| Mammouth / GLM 5.3 Flash | Authenticated catalog HTTP 200; exact structured answer in 1.57s; exact tool call in 2.10s; reported model matched | Working owner diagnostic route. Credit-metered; explicit owner selection, tenant context and budget guards remain necessary |
| Mammouth / Mistral Large 4 | Exact structured answer in 4.29s; exact tool call in 1.48s; reported model matched | Working high-end owner diagnostic route. Not an automatically authorized customer or background fallback |
| Standard Compute / Gemini 3.1 Pro Preview | Catalog HTTP 200; exact structured answer in 6.82s; separate real-source probe completed with exact model identity and zero reported findings | Not generally down. Enabled in development, disabled in production; larger precision workloads still unverified |
| Replit / GPT-5.4 | Existing pinned application route rejected the fixture with HTTP 429 and code `RATELIMIT_EXCEEDED`; separate bounded classification check reproduced it | Actual rate-limit rejection at test time. Response does not establish whether the limiting layer is account, gateway, model or upstream |
| CheaperInference / Luna | Authenticated catalog HTTP 200 with 687 entries; existing app route rejected catalog before inference | Local adapter failure is proven; today's inference availability is not established |
| Profundo | Catalog HTTP 200 with 36 entries; disabled in development and production settings; workspace audit command overrides the flag and observed HTTP 503 | Do not count as a ready production fallback. Listing models is not current serving proof |
| Openference | Catalog HTTP 200 with 21 entries; shared operator disable remains active | Not currently a production backup. Default local `DeepSeek-V4-Pro` alias was not among the matching returned catalog identities; versioned `DeepSeek-V4-Pro-0813` was listed. Resolve and test identities before any re-enable |
| OpenRouter direct | Authenticated catalog HTTP 200 with 420 entries | Catalog reachable; no new inference probe. Existing approved Argon report route is scoped, not general fallback permission |
| OpenAI direct | Authenticated catalog HTTP 200 with 142 entries | Catalog access proven; no new inference probe or expanded metered permission |
| Anthropic direct | Authenticated catalog HTTP 200 with 14 entries | Catalog access proven; no new inference probe or expanded metered permission |
| Google report credential | Authenticated model list HTTP 200 with 60 models, including Argon | Report credential works for discovery. Existing report generation is a separate capability; no new generation proof |
| Google legacy credential | Model-list HTTP 400 | Legacy configuration needs diagnosis. Do not infer that the separate working report or Vertex credentials are broken |
| xAI direct | Authenticated catalog HTTP 200 with 14 entries | Discovery proven; inference not newly tested |
| Z.AI direct | Authenticated catalog HTTP 200 with 11 entries | Discovery proven; inference not newly tested |
| Reflection | Fixed Beam model metadata HTTP 200; existing readiness check false despite enabled flag | Expiring free-use approval is no longer current. Do not renew it or dispatch customer data automatically |
| Claude subscription bridge | Existing specialized bridge/credential path inspected, no new CLI execution | Configured credential is not fresh authentication or inference proof; not a generic tool-bearing customer API |
| Copilot | Existing owner-only CLI/chat path inspected, no new CLI execution | Owner quota and ingress authority apply. Not a generic background/customer fallback |
| Google Vertex and managed Google/Anthropic | Separate application paths, no new generation probes | Different credential/API contracts; do not merge their readiness with the legacy Google route |
| Perplexity and TypeSafe/Jev | Specialized research and judgment roles, not exercised | Not interchangeable general chat, coding, or audit backups |

The four Mammouth completions reported combined usage cost of **$0.00154952**
(about 0.155 US cents). This is provider-reported test usage, not a reconciled
invoice or an estimate of a full report/audit. Existing aggregate reservations
and settlement guards were used; no limit was raised or hold released.
Standard Compute consumes its subscription allowance; its remaining balance
was not independently checked.

## Root causes and distinctions

### 1. Catalog coupling disables otherwise unrelated inference

The CheaperInference parser accepts only particular identity/type/endpoint
combinations. The current catalog includes new combinations such as text batch
models at `/v4/ai/batch`, image models exposed at `/v1/chat/completions`, and
reranking at `/v1/rerank`. The first observed rejection was a valid-shaped text
identity advertising the batch endpoint.

Rejecting that unfamiliar entry rejects the whole catalog, so a known permitted
Luna chat model cannot reach its existing spend guard or inference request.
The provider is reachable; this failure is in our adapter.

Repair direction: validate each supported callable family strictly and separate
it from recognized discovery-only families. Unknown/unreviewed families must
remain non-callable and generate diagnostics; do not turn unfamiliar endpoints
into generic permission or accept malformed pricing. Test the exact current
catalog shapes and all dispatch/budget boundaries before shipping. Repair the
other new combinations too, not just the first failing batch entry.

### 2. Enabled flags, deployments, and workflow commands disagree

The shared Openference stop is active. Profundo is disabled in both environment
settings, but the workspace audit command explicitly sets `PROFUNDO_ENABLED=1`.
Standard Compute is enabled in development and disabled in production.
Reflection's enabled switch does not override its expired approval.

Consequently, the same named fallback chain behaves differently in each
environment. Configuration existence is being mistaken for execution readiness.
Use one effective-readiness view that reports permission, environment,
credential presence, model mapping, budget and recent validated completion
separately. Any operator override must be visible, not silently normalized away.

### 3. Model lists and tiny completions do not certify real workloads

Standard Compute's successful tests disprove a blanket claim that it is down.
They do not explain or repair the larger audit review timeouts. Investigate
actual batch byte/token size, reasoning allowance, response identity, output
completeness and deadlines using retained failed workload evidence.

The audit invocation uses a 55-second route bound, while the pinned Standard
Compute SDK allows 90 seconds. The smaller outer bound wins. Do not simply
increase every timeout: size and checkpoint tasks, then set a coherent total
deadline and stop starting calls when insufficient time remains.

The ordinary chat route has a default 12-second stream-creation setting and
model-specific recovery policy. Measure the effective per-model policy before
diagnosing a paid stream failure; do not assume the SDK timeout controls it.
Non-streaming structured tests do not certify browser streaming or long tool loops.

### 4. Rate limiting and error handling need account-wide coordination

The Replit rejection is real, but the underlying quota source is not established.
Do not call it a revoked key, exhausted credit balance, or permanent outage.
Classify 429 with safe error code and Retry-After metadata, pace shared account
usage, and give interactive work priority over nonurgent research/audits.

The general provider health cache is process-local. Separate web, worker and
workflow processes can still hit the same account. A global provider label also
cannot describe every model's capabilities or every quota class accurately.
Use durable account/provider admission with bounded concurrency, a small queue,
quota-aware delays and a circuit breaker. Do not globally change another
tenant's authorization or billing policy because one diagnostic request failed.

### 5. Audit completion is not the same as scanning or job settlement

The first pass already retained 326 completed chunks and 835-file coverage.
Precision review remains incomplete. Workspace and production have independent
saved review state and must not be reported as one completed run.

The production investigation found hourly skips/failures and 23 “completion
fenced” warnings in its 24-hour window. Parent code inspection shows the audit
handler deliberately moves a running job back to pending on continuation or
provider backoff. The generic worker then attempts normal completion and logs a
fenced no-op. Thus these warnings alone do **not** prove an unexpected lease-loss
bug; some can be expected continuation. Distinguish that intentional outcome
from actual lease expiry/reclaim in logging and worker completion contracts.

The separate workspace-verifier request-aborted errors are not proof that the
audit or providers caused those errors. Production resource metrics could not
be retrieved, so CPU/memory/concurrency causation is unproven.

### 6. “Free” labels are not billing evidence

Official Replit documentation says managed AI integration usage is billed at
public API prices against Replit credits. Local `$0` ledger assumptions do not
establish account-level zero billing. Subscription gateways also have terms,
quotas and/or finite allowances. Billing class and remaining headroom belong in
readiness, not just the model name or a `costClass` field.

## Proposed reliable operating design

This is a recommendation, not an implemented configuration.

### Small, explicit task-specific route sets

- **Owner interactive work:** evaluate the demonstrated Mammouth Flash route for
  routine work and Mistral Large 4 for harder work under existing owner-only
  metered controls. Automatic adoption requires the same explicit policy
  decision as any change from owner-selected access.
- **Owner non-streaming review/audits:** Standard Compute's exact model pin is a
  candidate after realistic batch testing. Production enablement must be
  deliberate. Preserve known identity; opaque smart routing is not independent
  jury evidence.
- **Automatic paid recovery:** repair CheaperInference under the existing
  owner-only $20 shared daily ceiling. Do not bypass the whole-catalog guard
  with a raw client, reduce the discount floor, or free ambiguous reservations.
- **Customer-serving resilience:** qualify one direct maker API and one
  independent gateway route under explicit customer-data terms and per-tenant
  paid limits. Working owner subscriptions/credits are not permission to
  subsidize customer traffic. Do not switch every request to paid services.
- **Profundo, Openference and Reflection:** retain as disabled/conditional
  candidates until their access, model identity, terms and representative task
  behavior pass. Do not make three nominally configured lanes look like three
  operational backups.

Gateways may share upstream makers or capacity. A change of hostname/model does
not prove independent failure domains. Preserve exact models where required,
and restrict gateway provider choices to the approved privacy and capability set.

### Request and job contracts

1. At admission, validate tenant, allowed data, tool policy, task requirements,
   enabled transport, budget and account capacity.
2. Select only a route whose actual model and capabilities meet those needs.
3. Apply an outer wall clock, bounded network/SDK timeouts, no hidden layered
   retry multiplication, and limited attempts. Honor Retry-After where present.
4. Validate structured output, tool calls, model identity and completion state.
   Never equate HTTP 200 with useful completion.
5. Persist completed work before handoff; give each consequential action an
   identity. Do not repeat emails, payments or deliveries on model retries.
6. On transient failure, use an authorized alternative or save a delayed retry.
   Treat refusal as a policy outcome, not a signal to evade controls.
7. If all routes fail, keep the website, job status and saved work accessible.
   Say “delayed” with a next attempt, rather than pretending completion or
   spinning forever.

### Operator view

Show one row per effective environment/account/model route with:
permission state, configured/not configured, data class, spend headroom,
remaining known allowance, last validated structured/tool/stream completion,
actual model, latency distribution, safe error category, cooldown, next attempt
and running/queued work. Never expose key values or raw request/error bodies.

Use event-driven readiness plus low-frequency bounded canaries. Do not introduce
a new always-running LLM monitoring bill. Reserve foreground capacity first and
make deferred work observable.

### Acceptance before calling it reliable

- Actual production owner and customer journeys, including streaming, tools,
  reconnects, long outputs and cancellation.
- Injected provider timeout, 429, 503, malformed response, wrong model, expired
  permission, disabled route, budget exhaustion and unavailable database.
- Saved jobs resume after process restart without duplicate side effects.
- Cross-tenant, explicit pin, privacy and spend limits hold during every failover.
- Measure successes, latency, rate limits, retry counts and cost over a real
  observation window. These short diagnostics cannot establish an uptime SLA.
- The security audit finishes source-bound review; findings are individually
  verified or supported by explicit false-positive evidence. No clean result
  from a partial review.

## Priority order

1. Repair CheaperInference's supported/discovery catalog boundary with tests.
2. Reconcile effective environment/workflow settings and publish an accurate
   readiness inventory; do not auto-enable stopped or expired routes.
3. Replay a retained realistic review batch through a demonstrated authorized
   route and measure why larger batches fail. Preserve successful saved work.
4. Correct audit status and intentional-continuation logging.
5. Add account-wide scheduling and coherent deadlines where evidence shows a
   gap; preserve all tenant, policy, spend and no-duplicate-action controls.
6. Qualify and observe the small production route set before promising uptime.

## Boundaries and sources

No production configuration, source, database rows or routing defaults were
changed. No provider was re-enabled, approval renewed, spending limit raised,
Git commit/push performed, or deployment published. Diagnostic scripts and
sanitized evidence are local working files, not production features.

Primary implementation references: `server/providers.ts`,
`server/lib/cheaper-inference-automatic.ts`, `server/lib/standard-compute.ts`,
`server/lib/mammouth.ts`, `server/lib/reflection-owner-work.ts`,
`server/provider-recovery.ts`, `server/lib/tenant-audit-runner.ts`,
`server/job-worker.ts`, and `scripts/lib/tenant-audit-completion.ts`.

External documentation consulted:

- https://docs.replit.com/features/integrations/replit-ai-integrations
- https://docs.replit.com/billing/managing-spend
- https://docs.standardcompute.com/models
- https://openrouter.ai/docs/guides/routing/provider-selection
- https://ai.google.dev/gemini-api/docs/troubleshooting

Evidence timestamps and sanitized catalog/probe summaries are retained locally.
No credentials, customer messages, or raw sensitive provider errors are included
in this report.
