# Future Agent Operations & Platform Development Register

**Status:** Living backlog for later review  
**Last reviewed:** August 21, 2026  
**Source:** the attached compilation, *Latest Innovations in Agent Operations and Techniques*, cross-checked against the current VisionClaw roadmap and known limitations.

This document records ideas that may become useful future development. It is
intentionally broader than the committed roadmap. An entry here is **not** a
promise, an implementation decision, or permission to expand the platform
without evidence.

The purpose is to avoid losing good ideas while also avoiding speculative
engineering. Reopen an item when its trigger occurs, then run the normal
design, security, cost, tenant-isolation, and verification gates before
building it.

## How to use this register

Each entry has:

- **Disposition:** already covered, improve later, or defer.
- **Why it matters:** the user or operational outcome it could improve.
- **Current position:** what VisionClaw already has that is relevant.
- **Revisit trigger:** evidence that would justify spending engineering time.
- **Guardrails:** constraints that must be part of any future implementation.

### Priority meanings

- **P0 — Safety or reliability prerequisite:** revisit before materially
  increasing autonomy or adding a high-stakes action surface.
- **P1 — High-leverage platform improvement:** strong candidate when a concrete
  customer or operational need appears.
- **P2 — Product expansion:** useful, but demand or a partner should lead.
- **P3 — Watch only:** interesting research or model-specific direction with no
  current implementation case.

## Executive summary

The source compilation mostly describes capabilities VisionClaw already has in
some form: plan/execute orchestration, parallel work, safety gates, budgets,
approval queues, prompt-injection defenses, persona tool allowlists, memory
retrieval, browser/computer-use surfaces, and sandboxed execution.

The most meaningful future work is not “adopt every new agent framework.” It is
to make the existing controls more explicit and compositional:

1. Aggregate risk scoring so individually safe actions cannot combine into a
   dangerous outcome.
2. A unified action-oversight matrix that operators can understand and audit.
3. Task-scoped capabilities instead of relying only on persona-scoped access.
4. Stronger undo, checkpoint, cancellation, and idempotency behavior for
   long-running work.
5. Bounded replanning and reflective failure memory so recovery improves without
   turning a failed run into an unreviewed policy change.
6. Better evidence and evaluation for autonomous loops before they are allowed
   to change production behavior.

## 1. Oversight, safety, and accountability

### 1.1 Unified action-level oversight matrix — **P0 / improve later**

**Idea:** Define four consistent oversight tiers for actions:

- **T1 — Observe:** execute automatically and record the action.
- **T2 — Notify:** execute automatically, but alert the operator and provide a
  revoke or recovery path where possible.
- **T3 — Approve:** require human approval before execution.
- **T4 — Forbid or multi-party approval:** reserve for catastrophic,
  irreversible, or legally sensitive actions.

**Why it matters:** VisionClaw already has tool policies, intent gates,
destructive-tool controls, approval queues, budgets, and persona restrictions.
They are powerful but distributed. A single matrix would make decisions easier
to explain, audit, and apply consistently when a new tool is added.

**Current position:** Related controls are already shipped. This is primarily a
governance and consistency improvement, not a reason to replace the current
policy system.

**Revisit trigger:** A new high-stakes tool, a customer asking for an
explanation of why an action paused, or two existing policy layers assigning
different practical outcomes to similar actions.

**Guardrails:** The matrix must be advisory only until every action has a
deterministic enforcement point. A documentation table must never be mistaken
for authorization.

### 1.2 Composition-aware risk and anti-tier laundering — **P0 / future build**

**Idea:** Detect when a sequence of low-risk actions becomes high-risk in
aggregate, such as many small reads followed by an export or many individually
small financial actions that exceed a meaningful threshold.

**Why it matters:** Per-action classification can miss cumulative data
exfiltration, escalating spend, repeated outreach, or a chain that changes
system state in a dangerous direction.

**Current position:** Per-tool policy, spend ceilings, rate limits, tenant
scoping, event/ledger records, and approval controls provide partial defenses.
There is not yet a single documented sliding-window policy for aggregate
intent across otherwise separate actions.

**Revisit trigger:** A concrete incident or test case showing that a permitted
sequence can bypass the intended oversight tier; or a new autonomous workflow
that performs many related actions in one mission.

**Guardrails:**

- Use a bounded, tenant-scoped action window with explicit expiry.
- Include action type, target, quantity, cost, and data sensitivity as needed;
  never retain more raw content than necessary.
- Escalate conservatively. False positives may pause work; false negatives
  must not silently authorize a dangerous sequence.
- Keep the central executor as the final enforcement point.
- Test concurrent actions, retries, partial failure, and replay.

### 1.3 Circuit breakers, kill switches, and action budgets — **P0 / maintain**

**Idea:** Stop a mission when it repeatedly fails, exceeds a resource budget,
shows anomalous behavior, or is manually disabled.

**Current position:** VisionClaw already has bounded loops, process/watchdog
controls, cost ceilings, owner overrides, rate limiting, approval paths, and
fail-closed safety outcomes.

**Future work:** Consolidate operator visibility and verify that every new
autonomous loop has:

- a hard action and cost ceiling;
- a kill switch checked before expensive or irreversible work;
- a circuit breaker for repeated failures;
- an idempotency key and reclaim behavior;
- a clear terminal status;
- a recovery or abandonment path.

**Revisit trigger:** Any new background worker, autonomous spend path, or
multi-hour mission.

### 1.4 Reversibility and undo for lower-risk state changes — **P1**

**Idea:** Prefer soft-delete, versioning, snapshots, or compensating actions
for changes that are not inherently irreversible.

**Why it matters:** Human approval reduces risk but does not make a successful
action undoable. A mistaken customer update or configuration change can still
require manual repair.

**Current position:** High-risk calls receive stronger approval treatment, but
lower-risk updates do not uniformly create rollback snapshots.

**Revisit trigger:** A customer needs to recover from an incorrect update, or a
  tool becomes capable of changing a larger set of records.

**Guardrails:** Never imply that an email, payment, external API mutation, or
  other irreversible action can be undone when it cannot. Store minimal,
  tenant-scoped before/after metadata and protect snapshots as sensitive data.

### 1.5 Task-level capability scoping — **P1**

**Idea:** Give an agent only the tools and data needed for one task, even when
  its persona has broader capabilities for other work.

**Why it matters:** Persona-level least privilege is stronger than a global
  tool list, but a long-running or externally initiated task may still receive
  more capability than it needs.

**Current position:** Persona allowlists, trusted-persona restrictions, tool
  policy checks, executor checks, and tenant isolation already provide several
  layers.

**Revisit trigger:** A workflow needs to delegate untrusted or customer-supplied
  work to a persona with broader tools, or a security review identifies a
  meaningful gap between persona permissions and task needs.

**Guardrails:** Scope must be enforced at execution time, not only described in
  prompts. The task capability set must never widen because of untrusted task
  content. Keep an explicit escape hatch for genuinely open-ended tasks, with
  approval where needed.

### 1.6 Quarantined processing of untrusted content — **P0 / maintain**

**Idea:** Use a lower-privilege or structurally isolated processing step to
  turn web pages, files, emails, and external agent responses into sanitized
  data before a privileged planner or executor sees them.

**Current position:** VisionClaw already has external-content security,
 untrusted-data fences, upload scanning, prompt-injection defenses, and guarded
 tool execution.

**Future work:** Standardize the boundary contract for every new external-input
 surface: allowed fields, provenance, redaction, permitted transformations,
 expiration, and what the privileged layer is forbidden to infer.

**Revisit trigger:** A new connector, document type, browser surface, webhook,
 or inbound agent protocol.

**Guardrails:** Sanitization is not authorization. The privileged executor must
 independently re-check tenant, tool, target, and approval policy.

### 1.7 Sandboxed code and command execution — **P0 / maintain**

**Idea:** Run agent-generated code in ephemeral, isolated environments and
  destroy them after collecting a bounded result.

**Current position:** VisionClaw has guarded shell/code paths, spawn environment
  protections, path validation, sandbox-related execution surfaces, and
  production-specific restrictions.

**Future work:** Reassess isolation strength if arbitrary code execution,
  customer-provided packages, or untrusted multi-tenant workloads expand.

**Revisit trigger:** A requirement to execute arbitrary customer code, install
  arbitrary dependencies, use long-lived processes, or offer stronger
  tenant-to-tenant isolation than the current deployment model provides.

**Guardrails:** Do not introduce Docker, a new remote runner, or a GPU sandbox
  solely because the source compilation recommends it. First define the threat
  model, persistence model, network policy, resource limits, image provenance,
  secret boundary, and cleanup proof.

## 2. Orchestration and long-running autonomy

### 2.1 Plan-then-execute quality and DAG execution — **P0 / improve later**

**Idea:** Have a reasoning-heavy planner produce a validated plan or DAG and a
  bounded executor perform the work, running independent steps in parallel.

**Current position:** VisionClaw already has planner/executor patterns,
  delegation depth limits, parallel work, checkpoint/resume patterns, plan
  replay, process governance, and completion verification.

**Future work:**

- validate DAGs before execution: no cycles, missing inputs, or hidden
  dependencies;
- make retries, cancellation, and partial completion explicit;
- cap fan-out by tenant, mission, action type, and cost;
- preserve traceability from plan node to tool call to deliverable;
- allow a failed node to invalidate dependent nodes rather than producing
  plausible but incomplete output.

**Revisit trigger:** A workflow needs meaningful parallelism, or an ambiguous
  prompt causes repeated over-fan-out or inconsistent partial results.

**Guardrails:** Never allow a planner-generated DAG to bypass tool policy,
  tenant checks, approval gates, or the final executor guard.

### 2.2 Long-running frontier missions — **P1**

**Idea:** Let a mission operate for hours or days while preserving state,
  recovering from crashes, and reporting meaningful progress.

**Current position:** Checkpoint/resume, job keys, leases, claim-before-spend,
  heartbeat tasks, watchdogs, bounded loops, and completion verification
  already exist in related workflows.

**Future work:** Provide a consistent mission lifecycle:

`planned → claimed → running → waiting → needs approval → completed /
failed / cancelled / expired`

Include operator pause/resume/cancel, durable progress, stale-worker recovery,
idempotent side effects, and a final independent quality check.

**Revisit trigger:** A customer needs a mission longer than the current request
  lifecycle, or background work is repeatedly lost at process/deploy boundaries.

**Guardrails:** Every mission needs a semantic job identity, a hard cost ceiling,
  a maximum lifetime, a tenant-scoped lease, and a recovery story before it can
  run unattended.

### 2.3 Fan-out and concurrency governance — **P0 / improve later**

**Idea:** Prevent ambiguous requests from creating too many simultaneous
  agents, calls, browser sessions, or external side effects.

**Current position:** Per-tenant caps, process governance, rate limits, and
  bounded delegation exist. Known limitations still include over-fan-out on
  broad prompts.

**Revisit trigger:** Observed cost spikes, provider throttling, queue
  starvation, or a mission that produces duplicate work.

**Guardrails:** Prefer pacing and single-flight deduplication over simply
  adding more parallelism. Record why work was suppressed or delayed.

### 2.4 Dynamic replanning and execution-aware recovery — **P0 / future build**

**Idea:** Replace brittle, one-shot plans with a bounded replanner that
inspects the actual result of each step and chooses a safe alternative when an
API fails, data is incomplete, or an expected precondition changes.

**Why it matters:** A static plan can be correct when created and wrong by the
time it reaches step six. Replanning could recover useful work without forcing
the user to restart the entire mission.

**Current position:** VisionClaw has plan/executor flows, provider fallbacks,
tool-level self-correction for selected deliverables, repository repair loops,
checkpoint/resume patterns, and explicit failure handling. These are
workflow-specific rather than one universal replanner.

**Revisit trigger:** A real workflow repeatedly fails because an intermediate
  result changes the remaining strategy, or users routinely have to restart
  long-running work after a recoverable provider or data failure.

**Guardrails:**

- Replanning may select among pre-authorized strategies; it may not widen tool
  permissions, tenant scope, budget, or approval status.
- Validate the revised plan before execution: dependency graph, inputs,
  idempotency, side effects, cost, and safety tier.
- Preserve the original plan, failure evidence, revised plan, and reason for
  the change.
- Cap replans by mission, step, time, and cost to prevent an infinite recovery
  loop.
- Do not retry an irreversible side effect unless the integration proves it is
  idempotent or a human approves the recovery.

### 2.5 Visible multi-agent “war room” — **P2 / defer**

**Idea:** Show multiple specialist agents proposing, challenging, and
  converging in one visible conversation.

**Current position:** Ensemble and jury mechanisms already provide the
  substantive proposer/critic behavior. The missing element is presentation:
  visible turns and disagreement.

**Revisit trigger:** Bob wants an operator-facing review room for planning,
  architecture, or creative work.

**Guardrails:** Start as an internal/operator surface. Do not expose raw
  untrusted agent debate to customers without an injection, privacy, and
  liability review.

### 2.6 Outbound A2A agent mesh — **P2 / defer**

**Idea:** Discover and delegate to external agents using a stable agent-to-agent
  protocol.

**Current position:** VisionClaw can publish an agent card and already has
  internal subagents, tools, and MCP surfaces. An outbound external-agent
  client is intentionally deferred.

**Revisit trigger:** A specific external agent Bob wants to call, partner
  demand, or a stable protocol version with real ecosystem adoption.

**Guardrails:** Treat external agents as untrusted inputs and external
  services: SSRF protection, identity verification, tenant isolation, tool
  policy, approval, timeout, cost cap, and replay protection are mandatory.

## 3. Memory, context, and knowledge

### 3.1 Explicit tri-tier memory model — **P1 / improve later**

**Idea:** Make the distinctions between working memory, episodic memory, and
  semantic memory explicit in storage, retrieval, lifecycle, and UI.

**Current position:** VisionClaw already uses session context, vector-backed
  knowledge, graph memory, retrieval ranking, HyDE, consolidation, provenance,
  supersession, and tenant/persona scoping.

**Future work:**

- show users why a memory was retrieved;
- distinguish observations, user preferences, durable facts, and hypotheses;
- make expiration, contradiction, and supersession visible;
- allow tenant administrators to export, correct, or delete memory;
- measure retrieval usefulness rather than only retrieval latency.

**Revisit trigger:** Users report stale or contradictory memory, or an
  important workflow depends on a fact that cannot be explained or corrected.

**Guardrails:** Every durable memory must retain tenant scope, provenance,
  sensitivity classification, and a correction/deletion path. Cross-tenant
  shared memory remains opt-in and must never be the default.

### 3.2 Retrieval and context extension — **P1 / measure first**

**Idea:** Improve hybrid retrieval, relevance ordering, long-context packing,
  and context compression instead of assuming a larger model window solves the
  problem.

**Current position:** Hybrid search, relevance ranking, HyDE, lost-in-the-middle
  mitigation, and bounded prompt budgets already exist.

**Revisit trigger:** Golden-set evaluation shows that relevant evidence is
  being lost, or a real workflow exceeds current context budgets.

**Guardrails:** Evaluate with held-out queries and independent grading. Do not
  increase context or retrieval fan-out without measuring cost, latency,
  tenant isolation, and answer quality.

### 3.3 Cross-tenant or cross-instance shared memory — **P2 / defer**

**Idea:** Let related deployments or franchise organizations share selected
  knowledge.

**Revisit trigger:** A multi-organization customer explicitly needs it.

**Guardrails:** Explicit opt-in, separate ownership and consent, provenance,
  revocation, tenant-aware indexing, and a clear distinction between shared
  knowledge and private customer data. This is a schema and governance project,
  not a simple flag.

### 3.4 Reflective failure memory — **P1 / measure first**

**Idea:** After a failed or corrected mission, produce a structured reflection
that records the failed assumption, observed evidence, attempted recovery, and
what should change on the next attempt.

**Why it matters:** Persistent state alone preserves history; it does not make
history useful. A carefully bounded reflection can reduce repeated mistakes
without stuffing entire old transcripts into every prompt.

**Current position:** VisionClaw has lessons, episodic and graph memory,
consolidation, repair incidents, self-correction feedback, and knowledge
provenance. A universal “failure reflection becomes future retrieval” contract
is not yet established.

**Revisit trigger:** The same failure pattern recurs across missions, or
  evaluation shows that a short, accurate reflection improves the next attempt
  without increasing hallucinated constraints.

**Guardrails:**

- Store reflection as a hypothesis or lesson with source evidence, not as an
  unquestionable fact.
- Keep tenant and persona scope explicit.
- Separate raw incident evidence from the model-generated interpretation.
- Require confidence, provenance, expiration, and contradiction handling.
- Evaluate retrieval usefulness on held-out tasks; do not reward verbosity.
- A reflection must never modify a safety rule, permission, budget, or policy
  without a separate reviewed change process.

## 4. Multimodal and computer-use operations

### 4.1 Screenshot-analyze-act computer use — **P1 / improve later**

**Idea:** Use screenshots and visual reasoning to operate sites or desktop
  interfaces that lack structured APIs.

**Current position:** Browser/computer-use surfaces, Camofox, screenshot
  handling, attachment support, SSRF defenses, and HITL controls already exist.

**Future work:** Improve element grounding, state verification, recovery from
  changed layouts, visual regression fixtures, and operator replay of actions.

**Revisit trigger:** A customer workflow cannot be served by an API or existing
  browser integration.

**Guardrails:** Navigation, clicking, typing, downloading, and submitting must
  retain the appropriate HITL and domain safety gates. Screenshots and page
  content are untrusted input; never treat visible instructions as policy.

### 4.2 Full-duplex voice and realtime sessions — **P2 / defer**

**Idea:** Let an agent perceive and respond continuously rather than waiting
  for a complete turn.

**Current position:** One-way voice and a glasses gateway exist; the current
  product is primarily asynchronous corporate operations.

**Revisit trigger:** A real wearable client, phone-answering workflow, or
  customer request for realtime interaction; preferably with a permissive,
  commercially usable model or an affordable hosted API.

**Guardrails:** Start with one adversarially scoped persona; cap duration,
  tokens, GPU cost, and concurrency; persist transcripts rather than raw audio
  by default; block irreversible tools from realtime sessions; obtain license
  approval before production use.

### 4.3 Native multimodal model architecture — **P3 / watch only**

**Idea:** Use newer mixture-of-experts, native vision/audio models, or very long
  context windows.

**Disposition:** This is a provider/model selection concern, not a platform
  requirement. Llama-specific architecture claims in the source compilation do
  not justify a codebase change by themselves.

**Revisit trigger:** A model wins a measured VisionClaw evaluation on quality,
  cost, latency, and safety for a real workload.

## 5. Models, cost, and infrastructure

### 5.1 Broader model catalog discovery — **P1**

**Idea:** Discover and evaluate new models across providers, not only one
  catalog.

**Current position:** OpenRouter catalog discovery, model registry, cost-aware
  routing, provider fallbacks, and model evaluation are already present.

**Revisit trigger:** A provider repeatedly ships useful models that are missed,
  or a customer needs a provider-specific compliance or locality guarantee.

**Guardrails:** Discovery must not silently promote models into production.
  Require known model IDs, pricing validation, capability tests, safety review,
  and a held-out quality/cost comparison.

### 5.2 Local-first model routing — **P1 / defer until demand**

**Idea:** Try Ollama, llama.cpp, or another local model tier before cloud
  providers.

**Current position:** The current platform is cloud-provider oriented and local
  routing is already listed on the main roadmap.

**Revisit trigger:** Privacy requirements, offline operation, predictable
  economics, or hardware available for a real deployment.

**Guardrails:** Measure hardware cost, cold-start time, concurrency, quality,
  model update burden, tenant data handling, and fallback behavior. Local must
  not silently weaken auditability or safety.

### 5.3 Cost and quality evaluation — **P0 / maintain**

**Idea:** Choose models using observed quality, latency, reliability, and cost
  rather than static reputation or benchmark claims.

**Current position:** Cost ledger, model evaluations, routing tiers, provider
  fallbacks, and independent grading are already present.

**Future work:** Expand held-out task suites, provider invoice reconciliation,
  cache-token accounting, and per-tenant observed-rate recommendations.

**Guardrails:** A cheaper model is not an improvement if it increases retries,
  manual correction, safety incidents, or failed deliverables. Keep maker and
  checker roles separate.

## 6. Product and ecosystem expansion

### 6.1 Per-tenant tool permissions UI — **P1**

**Idea:** Give tenant administrators a visible way to enable, disable, or
  review individual tools.

**Current position:** Tool permissions are declared in code and skills have
  tenant-level disable behavior; a complete per-tenant tool permission screen
  is a known limitation.

**Revisit trigger:** A customer needs delegated administration, compliance
  evidence, or a narrower tool surface than the default persona policy.

**Guardrails:** UI settings must be additive restrictions, never a path to
  bypass central safety, tenant, or approval policy. Changes need audit events,
  versioning, and a safe default.

### 6.2 Public capability registry — **P2**

**Idea:** Publish a read-only, auth-aware catalog of tools, skills, personas,
  and governance rules so external systems can inspect capabilities before
  delegating.

**Current position:** Internal registries and an agent-card surface exist.

**Revisit trigger:** External partners need machine-readable discovery.

**Guardrails:** Never advertise capabilities a caller cannot execute. Hide
  trusted-only tools, tenant-private data, internal endpoints, and operational
  secrets. Keep the public schema versioned.

### 6.3 Embeddable tenant agent widget — **P1 / existing roadmap item**

**Idea:** Add a tenant-scoped chat experience to another website with a
  script tag or small embed.

**Current position:** Already listed on `ROADMAP.md`; this register only
  records the operational concerns that must accompany it.

**Guardrails:** Origin allowlists, tenant resolution from trusted configuration,
  abuse/rate limits, CSP, signed session bootstrap, no secret exposure, and
  strict separation between public widget users and internal operator tools.

### 6.4 Mobile shell and offline operation — **P2**

**Idea:** Provide a native mobile shell and better offline/reconnect behavior.

**Current position:** A responsive web experience exists, but mobile
  optimization and offline mode are known limitations.

**Revisit trigger:** Mobile usage becomes a meaningful share of sessions or a
  customer needs field work without reliable connectivity.

**Guardrails:** Define which actions can be queued offline, how conflicts
  resolve, and which actions must remain online and approved. Never replay an
  irreversible side effect merely because a client reconnected.

### 6.5 Community tool and skill marketplace — **P2**

**Idea:** Let contributors publish tools or skills that tenants can review and
  enable.

**Revisit trigger:** A real contributor ecosystem or repeated requests for
  reusable external capabilities.

**Guardrails:** Signed manifests, source/provenance, static and LLM security
  review, permissions declaration, tenant opt-in, version pinning, rollback,
  and a quarantine path. Do not execute arbitrary marketplace code by default.

### 6.6 Native Slack and Microsoft Teams bots — **P2**

**Idea:** Add first-party integrations for additional workplace channels.

**Current position:** Several communication channels already exist; Slack and
  Teams remain a future integration direction.

**Revisit trigger:** A paying customer requests one channel and supplies the
  required workspace/admin access.

**Guardrails:** Verify signatures, tenant mapping, replay protection, channel
  authorization, attachment scanning, and explicit behavior for messages that
  request external side effects.

### 6.7 Agentic commerce and branded avatars — **P2 / watch**

**Idea:** Make tenant offerings discoverable to buying agents and provide an
  avatar synthesis capability for branded video.

**Revisit trigger:** A stable commerce protocol with reference implementations,
  a tenant explicitly asking to be discoverable by buying agents, or provider
  economics that make avatar generation useful.

**Guardrails:** Payment authorization and spending caps must remain separate
  from marketing metadata. Never infer permission to transact from a public
  product feed. Review provider licenses, identity/likeness rights, and
  disclosure requirements before avatar production.

### 6.8 Low-code/no-code agent studio — **P3 / defer**

**Idea:** Offer a visual builder for agent teams, control-flow graphs, and
  task-specific tools.

**Disposition:** Interesting, but not a priority while the platform is still
  strengthening its typed, audited, code-defined control surfaces.

**Revisit trigger:** Customers need to author workflows without engineering
  support and the permission model can be represented safely.

## 7. Documentation, evaluation, and operational maturity

### 7.1 Generated API contract and OpenAPI — **P1 / existing roadmap item**

**Idea:** Generate a versioned OpenAPI/Swagger contract for the HTTP surface.

**Current position:** Already in progress on `ROADMAP.md`; the route source is
  currently the practical source of truth.

**Guardrails:** Generated documentation must reflect auth requirements,
  tenant scope, rate limits, idempotency, webhook signatures, and error
  contracts—not only endpoint names.

### 7.2 Demo and sample-output gallery — **P2 / existing roadmap items**

**Idea:** Show the full intake → execution → delivery journey and provide
  representative output examples.

**Current position:** Already listed on the roadmap.

**Guardrails:** Use synthetic or approved data, clearly label demonstrations,
  and ensure sample downloads cannot expose private files or live credentials.

### 7.3 Mission and autonomy observability — **P0 / improve later**

**Idea:** Give operators a coherent view of mission state, plan nodes, action
  history, approvals, spend, retries, failures, and final quality evidence.

**Current position:** Event logs, ledgers, health surfaces, proposal queues,
  and multiple workflow-specific dashboards exist.

**Revisit trigger:** An operator cannot explain why a mission acted, paused,
  failed, retried, or reported success.

**Guardrails:** Observability must preserve tenant isolation and redact
  credentials, raw sensitive content, and untrusted payloads. It must record
  failed/degraded states honestly rather than converting them into empty
  success-looking results.

### 7.4 Independent completion and deliverable verification — **P0 / maintain**

**Idea:** Judge completion against a goal contract using a separate evaluator,
  and verify that the actual file or side effect exists before delivery.

**Current position:** Completion verification, deliverable routing, file
  delivery checks, and reliability work are already present in related paths.

**Future work:** Expand artifact-specific checks for PDFs, videos, documents,
  spreadsheets, links, and external side effects.

**Guardrails:** Worker self-report is never sufficient. Quality evaluation may
  fail open for advisory feedback, but spend ceilings, missing artifacts,
  tenant checks, and safety controls must fail closed.

### 7.5 Autonomous improvement with held-out evidence — **P0 / maintain**

**Idea:** Let research, skill optimization, and repair loops propose changes,
  but accept them only when independent evidence shows improvement without
  weakening safety.

**Current position:** Proposal verification, jury review, shadow compilation,
  fail-closed safety validators, held-out evaluation patterns, and owner
  controls already exist.

**Future work:** Continue measuring verifier gaming, negative transfer,
  regression drift, and whether an improvement generalizes outside the fixed
  evaluator.

**Guardrails:** Never let the loop rewrite its own evaluator, safety gate,
  approval requirement, or budget ceiling as part of an ordinary proposal.
  Keep a rollback path and preserve the pre-change baseline.

### 7.6 Compliance and higher-assurance deployments — **P1 / demand-led**

**Idea:** Add stronger deployment controls for organizations with regulated or
  audited workloads: SSO, SAML/OIDC, KMS/HSM, formal retention controls,
  evidence exports, and compliance support.

**Current position:** SSO, HSM/KMS integration, and formal certifications are
  known limitations or backlog items.

**Revisit trigger:** A qualified customer or regulated deployment requires a
  specific control.

**Guardrails:** Do not claim SOC 2, HIPAA, PCI, or similar certification merely
  because a feature was added. Each control needs ownership, test evidence,
  documented scope, and operational procedures.

### 7.7 Post-incident learning and autonomous remediation — **P0 / separate tracks**

**Idea:** Turn completed incidents into structured lessons, regression tests,
threat-intelligence updates, or repair proposals; optionally let a bounded
remediation worker suggest or apply a verified fix.

**Why it matters:** A self-healing platform should become less likely to
repeat a known failure. The source research combines incident detection,
root-cause analysis, remediation, and model improvement; VisionClaw should
keep those concerns separate so a production incident cannot directly rewrite
trusted behavior.

**Current position:** VisionClaw already has self-healing redirects, code
repair proposals, guarded repository surgery, incident records, health checks,
security audits, regression suites, and owner notifications. The missing
future shape is a single lifecycle from incident → evidence → lesson/test →
reviewed remediation → measured follow-up.

**Revisit trigger:** The same incident class recurs, operators cannot connect a
  closed incident to a regression test, or remediation time is materially
  reduced by a verified automated proposal.

**Guardrails:**

- Incident capture must be immutable enough for audit and redacted before
  entering prompts or durable memory.
- Root-cause analysis, proposed code changes, threat-intelligence updates,
  model fine-tuning, and production deployment are separate approval stages.
- Never fine-tune or update a trusted policy directly from raw production
  traffic.
- Use a held-out regression set and an independent checker before any
  remediation is applied.
- All auto-remediation needs a bounded scope, rollback, owner notification,
  idempotency, and a kill switch.
- “The agent says it fixed itself” is not completion evidence; verify the
  service, test the original failure, and check for collateral regressions.

## 8. Ideas from the source that are explicitly watch-only

These are useful concepts to remember but do not currently justify platform
work:

- **Llama-specific MoE and iRoPE details:** model implementation choices, not
  an application requirement.
- **Very large context windows:** only valuable when retrieval and evaluation
  show a real need.
- **Generic “frontier agent” branding:** the useful pieces are checkpointing,
  cost bounds, recovery, and completion verification, which are tracked above.
- **Agent studios as a category:** revisit only when customer demand exceeds
  the value of typed, audited workflows.
- **Replacing every structured integration with computer use:** prefer a
  stable API when one exists; computer use is a fallback for genuinely
  unstructured interfaces.
- **A new container or orchestration platform by default:** infrastructure
  changes need a threat model and operating-cost case.

## 9. Review order

When this register is reviewed as a group, use this order:

1. **Safety prerequisites:** composition-aware risk, task-scoped capabilities,
   mission ceilings, reversibility, and sandbox boundaries.
2. **Reliability prerequisites:** checkpoint/resume, idempotency, cancellation,
   artifact verification, observability, and provider failure recovery.
3. **Evidence:** customer demand, incident data, cost/quality measurements,
   and held-out evaluations.
4. **Product expansions:** permissions UI, widget, mobile, channels,
   marketplace, A2A, realtime voice, and commerce.
5. **Research watchlist:** new model architectures and agent frameworks.

No item should move from this register into active development without:

- a written scope and success metric;
- a pre-build cost, scale, state, deduplication, tenant, and kill-switch
  review;
- a security and prompt-injection review;
- an explicit rollback or deferral decision;
- tests for failure, retry, concurrency, and tenant boundaries;
- documentation and agent/persona wiring when the capability is agent-facing.

## Related documents

- [Public roadmap](../ROADMAP.md)
- [Known limitations](KNOWN_LIMITATIONS.md)
- [Future integration bookmarks](future-integration-bookmarks.md)
- [Security architecture](SECURITY_ARCHITECTURE.md)
- [Production safety](PRODUCTION-SAFETY.md)
- [Architecture notes](architecture-notes.md)
