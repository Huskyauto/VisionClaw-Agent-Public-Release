# Tenant-Isolation Audit Report

_Generated 2026-11-09T01:00:44.929Z by `scripts/tenant-isolation-audit.ts` using `claude-sonnet-5` pinned to `profundo`._

**READ-ONLY audit** — findings below are surfaced for human review. No code was changed.

> ⚠️ **DEGRADED RUN — INCOMPLETE COVERAGE.** 804 file(s) were NOT audited this run (chunk cap in effect). Findings below are PARTIAL — do not read "few findings" as "all clear."

- Coverage: **42/846** file(s) audited · chunks 16/327 OK (0 failed, 311 pending)
- Findings: **27** (CRITICAL 0 · HIGH 23 · MEDIUM 4 · LOW 0)
- Severe dispositions: **23 kept** · 0 precision false-positive · 0 allowlist false-positive · 0 deferred real risk

### HIGH (23)

- **server/ab-optimizer.ts:112** — The heartbeat SELECT reads running tenant-scoped experiments across all tenants without a tenant_id constraint: `FROM experiments WHERE category = 'ab_test' AND status = 'running'`. This allows a single execution context to access every tenant's experiment metadata and process records without an explicit tenant boundary.
  - _Fix:_ Run the heartbeat separately for an authorized tenant and add `AND tenant_id = ${tenantId}` to the SELECT, or otherwise enumerate tenants through an explicitly authorized system-level mechanism that applies a tenant filter to each query.
- **server/adaptive-execution.ts:165** — getRelevantLessons accepts an optional tenantId and falls back to 0, so the memory read is not guaranteed to be constrained to the caller's tenant. Depending on storage behavior, this can read another tenant's lessons or unscoped data.
  - _Fix:_ Require a validated caller tenantId, reject missing or invalid values, and pass that value directly to the tenant_id filter without a 0 fallback.
- **server/adaptive-execution.ts:149** — saveLessonLearned inserts a tenant-scoped memory entry using a tenantId supplied as a function argument and only checks that it is a positive integer; it does not verify that the value belongs to the authenticated caller. A caller or derived untrusted value could write into another tenant.
  - _Fix:_ Obtain the tenant ID from trusted authenticated request context or validate ownership before inserting, and keep tenantId required rather than accepting arbitrary function input.
- **server/agent-activity.ts:60** — The persona lookup is constrained only by personas.id and omits the caller's tenant_id. A persona ID supplied from another tenant can therefore be read, and the personality cache is also keyed only by persona ID rather than tenant and persona.
  - _Fix:_ Pass tenantId into getPersonality, add eq(personas.tenantId, tenantId) to the WHERE clause, and key both the personality cache and in-flight map by tenantId plus personaId.
- **server/agent-channels.ts:141** — The SELECT joins the tenant-scoped personas table using only p.id, without constraining p.tenant_id to cm.tenant_id. The same issue occurs in the query at line 154 and can expose a persona record from another tenant if IDs overlap or are otherwise attacker-controlled.
  - _Fix:_ Add a tenant predicate to each personas join, e.g. `LEFT JOIN personas p ON p.id = cm.from_persona_id AND p.tenant_id = cm.tenant_id`.
- **server/agent-channels.ts:105** — postMessage accepts fromPersonaId and writes it into channel_messages without verifying that the persona belongs to params.tenantId, allowing cross-tenant foreign-key references.
  - _Fix:_ Before inserting, query personas with `WHERE id = ${params.fromPersonaId} AND tenant_id = ${params.tenantId}` and reject the request if no row is found.
- **server/agent-channels.ts:250** — subscribeToChannel validates channel ownership but does not validate that the caller-supplied personaId belongs to the same tenant before inserting the tenant-scoped subscription.
  - _Fix:_ Verify the persona with `SELECT id FROM personas WHERE id = ${personaId} AND tenant_id = ${tenantId}` before inserting the subscription.
- **server/agent-desk.ts:297** — The SELECT from the tenant-scoped personas table is not constrained by tenant_id, allowing getDesksOverview to read persona names across tenants.
  - _Fix:_ Add a tenant predicate, for example `SELECT id, name FROM personas WHERE tenant_id = ${tenantId}`, and ensure personaId inputs are validated as belonging to the caller's tenant before use.
- **server/agent-eval.ts:181** — runEval accepts personaId independently of tenantId and calls storage.getPersona(personaId) without verifying that the persona belongs to the caller's tenant. A cross-tenant persona can then be used to create the evaluation conversation and agent_evals row.
  - _Fix:_ Fetch the persona with an explicit tenant filter, such as getPersona(personaId, tenantId), or issue a query constrained by both persona_id and tenant_id and reject the request when no tenant-owned persona is found.
- **server/agent-manager.ts:303** — The heartbeat_logs subquery reads a tenant-scoped table without constraining it by tenant_id. The query only filters the parent heartbeat_tasks row by tenant, which does not satisfy the required application-level tenant filter for every read against a tenant-scoped table.
  - _Fix:_ Add an explicit tenant predicate to the heartbeat_logs subquery, for example: WHERE hl.task_id = ht.id AND hl.tenant_id = ${tenantId}. Apply the same tenant_id condition to the created_at subquery on line 304.
- **server/agentic-engines.ts:819** — The SELECT from the tenant-scoped personas table filters only on is_active and has no tenant_id constraint, allowing the decision engine to read personas belonging to other tenants.
  - _Fix:_ Add a tenant predicate, such as `AND tenant_id = ${tenantId}`, to the personas query; ensure any related joins and writes are similarly tenant-scoped.
- **server/agentic-engines.ts:820** — The SELECT from the tenant-scoped personas table filters only by is_active and has no tenant_id constraint, allowing one tenant's active personas to be included in another tenant's analysis.
  - _Fix:_ Add a tenant predicate, e.g. WHERE tenant_id = ${tenantId} AND is_active = true, and ensure the personas table is consistently queried through tenant-scoped filters.
- **server/agentic-features.ts:851** — INSERT into tenant-scoped outreach_sequence_steps does not set tenant_id explicitly. Tenant isolation therefore relies only on sequence_id and the table insert does not satisfy the required tenant assignment invariant.
  - _Fix:_ Include tenant_id in the INSERT column list and bind params.tenantId explicitly; also ensure the referenced sequence belongs to params.tenantId before inserting.
- **server/agentic-features.ts:925** — SELECT from tenant-scoped outreach_sequence_steps is constrained only by sequence_id and step_number, with no tenant_id predicate. A cross-tenant sequence/step row could be read if identifiers are manipulated or relationships are inconsistent.
  - _Fix:_ Add AND tenant_id = params.tenantId to the WHERE clause, and verify the step belongs to a sequence owned by that tenant.
- **server/agentic-features.ts:1053** — The correlated COUNT(*) over outreach_sequence_steps is missing a tenant_id constraint. It counts rows solely by sequence_id rather than enforcing the caller's tenant on the tenant-scoped table.
  - _Fix:_ Add AND tenant_id = ${params.tenantId} to the outreach_sequence_steps subquery, and ensure the sequence-step rows are written with the tenant ID.
- **server/agentic-features.ts:925** — Reads outreach_sequence_steps using only sequence_id and step_number, without constraining the tenant or verifying that the referenced sequence belongs to the caller's tenant. A tenant-scoped sequence step could therefore be read across tenants.
  - _Fix:_ Add a tenant_id predicate if outreach_sequence_steps is tenant-scoped, or join outreach_sequences and require s.tenant_id = ${params.tenantId} while matching the sequence and step.
- **server/agentic-features.ts:1053** — The correlated step_count query reads outreach_sequence_steps using only sequence_id and has no tenant constraint. This violates tenant isolation and can count or expose data from another tenant if sequence identifiers are not globally ownership-validated.
  - _Fix:_ Constrain the subquery by tenant_id, or join the tenant-owned outreach_sequences row and require the joined sequence tenant_id to equal ${params.tenantId}.
- **server/agentic/aggregate-ai-spend-budget.ts:171** — The SELECT aggregates rows from the tenant-scoped aggregate_ai_spend_reservations table by utc_day without a tenant_id constraint, allowing one tenant's budget admission decision to read and depend on other tenants' reservations.
  - _Fix:_ Add a validated caller tenant_id parameter and constrain the query with AND tenant_id = ${tenantId}, or move the platform-wide aggregate accounting to a genuinely global table that is not tenant-scoped.
- **server/agentic/approvals.ts:135** — The bulk UPDATE of tenant-scoped agentApprovals in expireStaleApprovals() filters only by status and expiration time, with no tenant_id constraint. It can modify approval rows across all tenants without an application-level tenant boundary.
  - _Fix:_ Run expiry per tenant and add eq(agentApprovals.tenantId, tenantId) to the WHERE clause, or otherwise obtain and enforce an explicit authorized tenant scope for each update.
- **server/agentic/department-budgets.ts:143** — The runBudgetEnforcement sweep selects tenant_id and department from the tenant-scoped department_budgets table without a tenant_id constraint, allowing an unscoped read across all tenants.
  - _Fix:_ Require an authorized tenant scope for the sweep and constrain the query with that tenant_id; if a system-wide sweep is necessary, execute an explicitly privileged per-tenant query rather than performing an unscoped tenant-table read.
- **server/agentic/executor.ts:31** — runParallel accepts parentRunId from its caller and passes it to createRun without first verifying that the referenced parent run belongs to params.tenantId. A cross-tenant parent run could therefore be associated with the new tenant-scoped run if createRun does not enforce ownership internally.
  - _Fix:_ Before creating the child run, query the parent run with both its ID and tenant_id = params.tenantId, reject missing or foreign-tenant parents, and only then pass the verified ID to createRun. Apply the same ownership validation to parentRunId in runSupervisor at line 173.
- **server/agentic/harness-injection.ts:29** — The query reads the tenant-scoped model_harness_deltas table using the hardcoded ADMIN_TENANT_ID rather than the caller's tenant ID. Because the result is cached globally and served to all callers, tenant-specific harness data can be applied across tenants or the caller's tenant isolation can be bypassed.
  - _Fix:_ Pass the authenticated caller's tenantId into loadActiveByModel/getModelHarnessSuffix, constrain the query with that tenantId, and key the cache by tenantId and model ID. If these records are intended to be global, move them to a genuinely global table rather than relying on an admin tenant row.
- **server/agentic/resume-worker.ts:111** — The candidate SELECT reads from tenant-scoped agent_runs without any tenant_id constraint; WHERE only filters run status. This scans and loads pending approvals and run state across all tenants.
  - _Fix:_ Execute the sweep within an authorized tenant scope and add a predicate such as `r.tenant_id = <tenantId>` (or enumerate authorized tenant IDs and run separately scoped queries).

### MEDIUM (4)

- **server/agent-channels.ts:155** — readMessages accepts a caller-supplied channelId and queries messages for it without first verifying that the channel belongs to the caller's tenant. The same missing ownership check applies to the unread query at line 142.
  - _Fix:_ Resolve and validate channelId with `agent_channels WHERE id = ${channelId} AND tenant_id = ${params.tenantId}` before querying messages.
- **server/agent-channels.ts:233** — getChannelSubscribers accepts channelId and reads subscription rows without first verifying that the referenced channel belongs to tenantId.
  - _Fix:_ Validate the channel with `agent_channels WHERE id = ${channelId} AND tenant_id = ${tenantId}` before reading subscriptions.
- **server/agent-channels.ts:262** — unsubscribeFromChannel accepts channelId and updates subscriptions without first verifying that the referenced channel belongs to tenantId.
  - _Fix:_ Validate channel ownership with a tenant-constrained agent_channels lookup before performing the update.
- **server/agentic-features.ts:305** — queryProjectRelationships accepts a caller-supplied projectId and queries project-associated tenant-scoped research_evidence without first verifying that the project itself belongs to the caller's tenant. Although the evidence query includes tenant_id, the foreign project reference is not explicitly ownership-validated.
  - _Fix:_ Before querying research_evidence, select the project with WHERE id = params.projectId AND tenant_id = params.tenantId and return a not-found error if absent; alternatively enforce ownership through an explicit tenant-constrained join to projects.
