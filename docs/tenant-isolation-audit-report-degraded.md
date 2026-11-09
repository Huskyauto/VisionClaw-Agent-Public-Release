# Tenant-Isolation Audit Report

_Generated 2026-11-09T00:29:46.526Z by `scripts/tenant-isolation-audit.ts` using `claude-sonnet-5` pinned to `profundo`._

**READ-ONLY audit** — findings below are surfaced for human review. No code was changed.

> ⚠️ **DEGRADED RUN — INCOMPLETE COVERAGE.** 779 file(s) were NOT audited this run (chunk cap in effect). Findings below are PARTIAL — do not read "few findings" as "all clear."

- Coverage: **67/846** file(s) audited · chunks 24/327 OK (0 failed, 303 pending)
- Findings: **51** (CRITICAL 0 · HIGH 34 · MEDIUM 14 · LOW 3)
- Severe dispositions: **34 kept** · 0 precision false-positive · 0 allowlist false-positive · 0 deferred real risk

### HIGH (34)

- **server/ab-optimizer.ts:110** — SELECT against the tenant-scoped 'experiments' table lacks a tenant_id constraint in its WHERE clause.
  - _Fix:_ Constrain the query to a specific tenant_id (e.g., by passing tenantId to the heartbeat function and adding AND tenant_id = ${tenantId}), or if this is an intentional cross-tenant background job, it violates the strict tenant isolation invariant and must be redesigned to process per-tenant.
- **server/agent-activity.ts:61** — SELECT against the personas table lacks a tenant_id constraint, allowing cross-tenant data leakage of persona details via IDOR.
  - _Fix:_ Update getPersonality to accept tenantId and add eq(personas.tenantId, tenantId) to the WHERE clause.
- **server/agent-desk.ts:297** — SELECT from personas is performed without any tenant_id constraint. If personas is a tenant-scoped table, this allows cross-tenant reads when building the desk overview.
  - _Fix:_ Constrain the query by tenant ownership, e.g. SELECT id, name FROM personas WHERE tenant_id = ${tenantId}, or verify personas is truly global/shared before leaving it unscoped.
- **server/agent-desk.ts:399** — INSERT into agent_desks omits required tenant-scoped JSONB columns and relies on implicit defaults. Per the stated invariant, every INSERT into a tenant-scoped table must explicitly set required tenant-scoped columns, and columns have no defaults.
  - _Fix:_ Explicitly provide all required non-null columns in the INSERT, as done in getDesk(), or align the schema/call pattern so tenant-scoped inserts always set every required column explicitly.
- **server/agent-eval.ts:181** — runEval reads a persona by caller-supplied personaId via storage.getPersona(personaId) without first verifying the persona belongs to the caller's tenant. This allows cross-tenant use of a foreign personaId and then writes tenant-scoped eval rows using the caller's tenantId.
  - _Fix:_ Fetch the persona with both personaId and tenantId (for example, add/get a storage method that enforces WHERE id = ? AND tenant_id = ?) and abort if no matching row exists before creating conversations or inserting agent_evals.
- **server/agent-eval.ts:260** — getEvalReport filters agent_evals by tenant_id but also accepts a caller-supplied personaId and uses it directly without validating that the persona belongs to the caller's tenant. This violates foreign-id ownership verification and can expose whether another tenant's persona has eval rows under this tenant context or produce misleading scoped reports.
  - _Fix:_ Before running the report query, verify the referenced persona with WHERE id = personaId AND tenant_id = tenantId (or equivalent storage method), and reject if the persona is not owned by the caller's tenant.
- **server/agentic-engines.ts:820** — SELECT from personas has no tenant_id constraint. If personas is tenant-scoped, this reads active personas across all tenants and mixes them into the current tenant's analysis.
  - _Fix:_ Constrain the query by tenant ownership, e.g. `SELECT name, role FROM personas WHERE tenant_id = ${tenantId} AND is_active = true LIMIT 14`, or the Drizzle equivalent with `.where(eq(personas.tenantId, tenantId))`.
- **server/agentic-features.ts:850** — INSERT into tenant-scoped table outreach_sequence_steps does not set tenant_id. In this codebase tenant isolation relies on explicit tenant_id on every write, and this child row is only linked by sequence_id without persisting tenant ownership.
  - _Fix:_ Add tenant_id to outreach_sequence_steps inserts, e.g. INSERT INTO outreach_sequence_steps (tenant_id, sequence_id, ...) VALUES (${params.tenantId}, ${sequenceId}, ...), and ensure the table/query paths consistently filter by tenant_id.
- **server/agentic-features.ts:924** — SELECT from tenant-scoped table outreach_sequence_steps uses only sequence_id and step_number with no tenant_id constraint. Because tenant isolation is application-enforced, this read must explicitly constrain outreach_sequence_steps by the caller tenant.
  - _Fix:_ Add tenant filtering to the query, e.g. WHERE sequence_id = ${enrollment.sequence_id} AND step_number = ${enrollment.current_step} AND tenant_id = ${params.tenantId}.
- **server/agentic-features.ts:1053** — Subquery counting outreach_sequence_steps in listSequences reads a tenant-scoped table without any tenant_id filter, relying only on sequence_id linkage.
  - _Fix:_ Constrain the subquery by tenant_id as well, e.g. (SELECT COUNT(*) FROM outreach_sequence_steps WHERE sequence_id = s.id AND tenant_id = ${params.tenantId}) as step_count.
- **server/agentic-features.ts:925** — SELECT from tenant-scoped table outreach_sequence_steps filters only by sequence_id and step_number, with no tenant_id constraint. If sequence IDs are not globally secret/unique across tenants, this can read another tenant's step content.
  - _Fix:_ Constrain the query by tenant ownership, e.g. `SELECT * FROM outreach_sequence_steps WHERE tenant_id = ${params.tenantId} AND sequence_id = ${enrollment.sequence_id} AND step_number = ${enrollment.current_step}` or join through a tenant-scoped parent with verified ownership.
- **server/agentic/aggregate-ai-spend-budget.ts:171** — SELECT against tenant-scoped table aggregate_ai_spend_reservations sums rows for a UTC day without any tenant_id filter, causing cross-tenant data access and enforcing a global spend cap across all tenants.
  - _Fix:_ Constrain the query by tenant_id, e.g. pass tenantId into sumForUtcDay and add `AND tenant_id = ${tenantId}` to the WHERE clause, or make the table explicitly global if that is the intended design.
- **server/agentic/department-budgets.ts:143** — The sweep selects tenant-scoped department_budgets rows without a tenant_id constraint, allowing the operation to enumerate data across all tenants rather than restricting the query to the caller's tenant.
  - _Fix:_ Run enforcement within an explicitly authorized per-tenant context and add a tenant_id predicate to this query, or obtain tenant IDs from a genuinely global tenant registry before issuing separately tenant-scoped queries.
- **server/agentic/harness-injection.ts:29** — The tenant-scoped model_harness_deltas table is read using the hardcoded ADMIN_TENANT_ID rather than the caller's tenant. The resulting addenda are cached globally and can be applied to requests from other tenants without verifying ownership.
  - _Fix:_ Pass the caller's tenantId into getModelHarnessSuffix/loadActiveByModel, constrain the query with tenant_id = tenantId, and key the cache by tenantId and modelId. If these deltas are intended to be global, move them to a genuinely global table rather than using a tenant-scoped table.
- **server/agentic/resume-worker.ts:107** — The candidate SELECT reads tenant-scoped agent_runs and agent_approvals across all tenants, but its WHERE clause has no tenant_id constraint. This exposes cross-tenant run/approval data to the worker and may trigger processing for another tenant.
  - _Fix:_ Run the sweep within an authenticated tenant context and add a condition such as r.tenant_id = <caller tenant>; ensure the joined approval remains constrained to the same validated tenant. If a global worker is required, iterate over explicitly authorized tenant IDs and apply the tenant predicate to each query.
- **server/agentic/self-heal.ts:293** — The caller-supplied runId is inserted into selfHealAttempts without verifying that the referenced run belongs to tenantId. A tenant could associate self-heal records with another tenant's run if this function is invoked with an untrusted runId.
  - _Fix:_ Before inserting, query the runs table with both runId and tenantId and reject the operation unless the row exists; use the validated run identity for the insert.
- **server/agentic/self-heal.ts:301** — The caller-supplied runId is passed to appendStep without a visible ownership check confirming that the run belongs to tenantId. This can permit cross-tenant writes through the referenced run.
  - _Fix:_ Validate the run with a tenant-constrained lookup such as where(and(eq(runs.id, runId), eq(runs.tenantId, tenantId))) before calling appendStep, or make appendStep enforce that check internally.
- **server/agentic/self-heal.ts:244** — The caller-supplied runId is passed to createApproval without first verifying that the referenced run belongs to tenantId. This may create an approval attached to another tenant's run.
  - _Fix:_ Perform a tenant-constrained run lookup before createApproval, or require createApproval to validate run ownership using both runId and tenantId.
- **server/agentic/self-heal.ts:445** — The caller-supplied runId is passed to createApproval without first verifying that the referenced run belongs to tenantId. This may create an approval attached to another tenant's run.
  - _Fix:_ Perform a tenant-constrained run lookup before createApproval, or require createApproval to validate run ownership using both runId and tenantId.
- **server/agentic/task-forces.ts:46** — Caller-supplied personaIds are inserted into the tenant-scoped task_forces row without verifying that each referenced persona belongs to p.tenantId. This permits cross-tenant persona references and violates foreign-id ownership checks.
  - _Fix:_ Before inserting, query the persona records with WHERE id IN (...) AND tenant_id = p.tenantId, and reject the request unless every supplied persona ID is owned by that tenant; alternatively store only validated IDs.
- **server/agentic/wake-scheduler.ts:163** — The stale-claim recovery query reads from tenant-scoped agent_wake_schedules without constraining the rows to a caller tenant. It can inspect and update schedules belonging to every tenant.
  - _Fix:_ Run recovery in a tenant-scoped context and add WHERE tenant_id = <caller tenant> to the stale selection and update, or explicitly route one tenant at a time through a trusted tenant-scoped scheduler API.
- **server/agentic/wake-scheduler.ts:185** — The due-wake query selects and locks rows from tenant-scoped agent_wake_schedules without a tenant_id predicate, then inserts corresponding tenant events and marks those schedules fired across all tenants.
  - _Fix:_ Process wakes within an explicitly authorized tenant context and add tenant_id = <caller tenant> to the due CTE and subsequent update, or invoke the scheduler separately for each trusted tenant.
- **server/agentic/wake-scheduler.ts:82** — The tenant-scoped agent_wake_schedules insert accepts persona_id from the caller but never verifies that the referenced persona belongs to p.tenantId. A caller can associate a persona from another tenant with a wake schedule.
  - _Fix:_ Before inserting, query the persona by id with tenant_id = p.tenantId and reject it if absent; alternatively resolve personaId from a tenant-scoped trusted context rather than accepting an unchecked foreign id.
- **server/api-v1-dispatch.ts:45** — The caller-supplied personaId is passed to storage.getPersona without verifying that the persona belongs to tenantId. A user can select a persona from another tenant.
  - _Fix:_ Use a tenant-scoped lookup such as getPersona(personaId, tenantId), enforcing WHERE personas.tenant_id = tenantId before using the persona.
- **server/api-v1-dispatch.ts:49** — The agent-name lookup queries personas without a tenant_id constraint, allowing a request to resolve a persona belonging to another tenant.
  - _Fix:_ Add a tenant_id = tenantId predicate to the personas query, or use a tenant-scoped storage method that validates ownership.
- **server/api-v1-dispatch.ts:57** — getActivePersona is called without tenantId, so the active persona selection is not constrained to the caller's tenant if personas are tenant-scoped.
  - _Fix:_ Pass tenantId to getActivePersona and enforce the tenant_id predicate in its query.
- **server/auth-monitor.ts:133** — Provider keys are loaded through storage.getProviderKeys() without a caller tenant identifier or visible tenant ownership constraint. The module also stores results in a process-global cache keyed only by provider, which can expose one tenant's provider health to another tenant.
  - _Fix:_ Require tenantId in getProviderHealth and storage.getProviderKeys, constrain the underlying provider-key query with tenant_id = tenantId, and key healthCache by tenantId and provider (or remove the shared cache).
- **server/auto-asset-capture.ts:147** — INSERT into tenant-scoped project_files does not set tenant_id, leaving the row without explicit tenant ownership.
  - _Fix:_ Include tenant_id in the INSERT column list and bind the validated tenantId argument as its value.
- **server/auto-asset-capture.ts:166** — INSERT into tenant-scoped project_notes does not set tenant_id, leaving the row without explicit tenant ownership.
  - _Fix:_ Include tenant_id in the INSERT column list and bind the validated tenantId associated with projectId.
- **server/auto-asset-capture.ts:185** — Backfill SELECT reads tenant-scoped conversations across all tenants without a tenant_id constraint.
  - _Fix:_ Require a tenant scope for backfill and add c.tenant_id = tenantId to the query, or otherwise run the operation in separately validated per-tenant scopes.
- **server/auto-asset-capture.ts:189** — The correlated messages COUNT query reads tenant-scoped messages without constraining messages.tenant_id.
  - _Fix:_ Add messages.tenant_id = the owning conversation tenant, and ensure the outer conversation query is tenant-scoped.
- **server/auto-project.ts:125** — The SELECT reads from tenant-scoped project_conversations without constraining the table itself by tenant_id. Although the joined project and previously loaded conversation are tenant-validated, the join table query does not enforce the required tenant filter.
  - _Fix:_ Add a tenant_id predicate for project_conversations, or otherwise explicitly validate the join row's tenant ownership before using it.
- **server/auto-project.ts:171** — The INSERT into tenant-scoped project_conversations does not set tenant_id. Tenant identity is omitted from the inserted row, relying only on project and conversation relationships for isolation.
  - _Fix:_ Include tenant_id in the INSERT columns and values, using the validated tenantId passed to the function.
- **server/auto-project.ts:175** — The INSERT into tenant-scoped project_notes does not set tenant_id, so the new note is not explicitly assigned to the caller's tenant.
  - _Fix:_ Include tenant_id in the project_notes INSERT and set it to the validated tenantId.

### MEDIUM (14)

- **server/agent-channels.ts:141** — Tenant-scoped table personas is joined on p.id = cm.from_persona_id without a tenant_id constraint. This can attach persona data from another tenant if IDs collide or are guessed.
  - _Fix:_ Constrain the join by tenant as well, e.g. LEFT JOIN personas p ON p.id = cm.from_persona_id AND p.tenant_id = cm.tenant_id.
- **server/agent-channels.ts:154** — Tenant-scoped table personas is joined on p.id = cm.from_persona_id without a tenant_id constraint. This read is not fully scoped to the caller tenant for the joined table.
  - _Fix:_ Add a tenant ownership predicate to the join, e.g. LEFT JOIN personas p ON p.id = cm.from_persona_id AND p.tenant_id = cm.tenant_id.
- **server/agentic-engines.ts:819** — SELECT against personas has no tenant_id constraint. If personas is tenant-scoped, this reads active personas across all tenants and includes them in tenant-specific AI analysis.
  - _Fix:_ If personas is tenant-scoped, add a tenant filter, e.g. WHERE tenant_id = ${tenantId} AND is_active = true. If personas is intentionally global/shared, document that clearly and keep it out of tenant-scoped assumptions.
- **server/agentic-features.ts:1053** — Subquery counting outreach_sequence_steps uses only `sequence_id = s.id` and omits tenant_id. This can cross-count steps from another tenant if sequence_id is not uniquely isolated by tenant.
  - _Fix:_ Add tenant scoping to the subquery, e.g. `SELECT COUNT(*) FROM outreach_sequence_steps WHERE tenant_id = ${params.tenantId} AND sequence_id = s.id`.
- **server/agentic/self-initiative.ts:100** — The SELECT reads from tenant-scoped heartbeat_logs without a direct tenant_id predicate. It relies only on task_id membership in heartbeat_tasks, which does not enforce heartbeat_logs tenant ownership under the application's required tenant-filter invariant and could expose orphaned or incorrectly associated log rows.
  - _Fix:_ Add an explicit heartbeat_logs tenant_id = ${tenantId} predicate (and retain the heartbeat_tasks ownership check if needed), or use the schema/Drizzle query path that applies the tenant filter directly to heartbeat_logs.
- **server/auth.ts:199** — The API key lookup reads the tenant-scoped apiKeys table using only key_hash and is_revoked, without constraining the query by the caller's tenant_id.
  - _Fix:_ Resolve and validate the caller tenant before querying apiKeys, and include eq(apiKeys.tenantId, tenantId) in the WHERE clause. If API-key validation must bootstrap tenant identity, use a separate globally scoped credential index or explicitly document and enforce the credential-to-tenant ownership check.
- **server/auth.ts:209** — The apiKeys update writes lastUsedAt using only apiKeys.id, without a tenant_id predicate.
  - _Fix:_ Add the validated tenant constraint to the update, for example and(eq(apiKeys.id, key.id), eq(apiKeys.tenantId, key.tenantId)).
- **server/auth.ts:298** — The auth_sessions DELETE is constrained only by the session token and does not include tenant_id.
  - _Fix:_ Carry the validated session tenant_id and add eq/auth_sessions.tenantId (or tenant_id = caller tenant) to the DELETE predicate.
- **server/auth.ts:310** — The auth_sessions SELECT is constrained only by the token and does not include tenant_id.
  - _Fix:_ Require the caller tenant_id in the session lookup, or use a separate globally scoped token-to-tenant authentication index and then perform tenant-scoped session access.
- **server/auth.ts:318** — Expired auth_sessions cleanup deletes by token alone without a tenant_id constraint.
  - _Fix:_ Include the authenticated caller tenant_id in the DELETE predicate, or perform cleanup through a dedicated global session-token index.
- **server/auth.ts:341** — deleteSession deletes from the tenant-scoped auth_sessions table using only the token hash and no tenant_id predicate.
  - _Fix:_ Pass the session tenant_id to deleteSession and constrain the DELETE with both token and tenant_id.
- **server/auth.ts:1250** — DELETE from tenant-scoped password_reset_tokens is constrained only by the token hash and omits tenant_id. Although the hash is intended to be unique, this does not enforce tenant isolation at the SQL boundary for a caller-supplied reset token.
  - _Fix:_ Include the verified resetData.tenantId in the DELETE predicate, e.g. WHERE token = ${tokenHash} AND tenant_id = ${tenantId}, and pass the tenant ID from the ownership-checked lookup.
- **server/auth.ts:1458** — Startup migration deletes all auth_sessions whose token is not v2 without a tenant_id constraint, causing an unrestricted cross-tenant write to a tenant-scoped table.
  - _Fix:_ Migrate or invalidate sessions per tenant with tenant_id predicates, or gate the global invalidation behind an explicitly authorized platform-maintenance operation and document the exception.
- **server/auto-consolidation.ts:366** — The scheduler selects from the tenant-scoped memory_entries table without constraining the query to a caller tenant, using only tenant_id IS NOT NULL and therefore enumerating data across all tenants.
  - _Fix:_ Use a trusted system-level tenant enumeration mechanism, or perform the scan only for an explicitly authorized tenant. If this cross-tenant scheduler is intentional, isolate it behind an explicit privileged service boundary and ensure it cannot be invoked with caller-controlled scope.

### LOW (3)

- **server/auth.ts:1255** — Expired rows are deleted from tenant-scoped password_reset_tokens without a tenant_id predicate.
  - _Fix:_ Run cleanup separately for each tenant with tenant_id in the WHERE clause, or place this operation behind an explicitly authorized platform-maintenance path that is permitted to perform a global cleanup.
- **server/auth.ts:1361** — clearExpiredSessions deletes rows from tenant-scoped auth_sessions using only expires_at and has no tenant_id constraint.
  - _Fix:_ Scope cleanup by tenant_id when invoked for a tenant, or use an explicitly authorized global maintenance operation for cross-tenant expiration cleanup.
- **server/auth.ts:1454** — Startup session cleanup deletes expired rows from tenant-scoped auth_sessions without a tenant_id predicate.
  - _Fix:_ Perform tenant-scoped cleanup with tenant_id in the predicate, or explicitly authorize this startup maintenance operation as a controlled global cleanup.
