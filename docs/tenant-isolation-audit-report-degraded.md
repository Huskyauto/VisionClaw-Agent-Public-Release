# Tenant-Isolation Audit Report

_Generated 2026-11-05T02:52:35.125Z by `scripts/tenant-isolation-audit.ts` using `claude-sonnet-5` pinned to `profundo`._

**READ-ONLY audit** — findings below are surfaced for human review. No code was changed.

> ⚠️ **DEGRADED RUN — INCOMPLETE COVERAGE.** 765 file(s) were NOT audited this run (chunk cap in effect). Findings below are PARTIAL — do not read "few findings" as "all clear."

- Coverage: **81/846** file(s) audited · chunks 32/327 OK (0 failed, 295 pending)
- Findings: **77** (CRITICAL 5 · HIGH 58 · MEDIUM 8 · LOW 6)
- Severe dispositions: **63 kept** · 0 precision false-positive · 0 allowlist false-positive · 0 deferred real risk

### CRITICAL (5)

- **server/agent-activity.ts:122** — UPDATE against tenant-scoped table agentActivity constrains only by activity id and does not include tenant_id. Any caller able to supply another tenant's activityId could modify that row across tenants.
  - _Fix:_ Require tenantId in completeActivity and update with a tenant-scoped predicate, e.g. .where(and(eq(agentActivity.id, activityId), eq(agentActivity.tenantId, tenantId))).
- **server/agentic-features.ts:916** — SELECT from tenant-scoped table outreach_sequence_steps uses foreign key sequence_id from enrollment without first verifying the caller's tenant owns the step row, and the query has no tenant_id filter. This can read steps belonging to another tenant if sequence_id is mismatched or reused.
  - _Fix:_ Store tenant_id on outreach_sequence_steps and query with WHERE sequence_id = ${enrollment.sequence_id} AND step_number = ${enrollment.current_step} AND tenant_id = ${params.tenantId}. Also ensure steps are inserted with tenant_id.
- **server/backup.ts:91** — getAllDataForExport() exports data across tenant boundaries without applying a caller tenant_id constraint, and the resulting full dataset is uploaded to Google Drive.
  - _Fix:_ Require an explicitly validated tenantId and constrain every export query to that tenant; if a system-wide backup is required, execute it through an audited privileged path that enumerates tenants and performs separately scoped exports rather than issuing an unscoped export.
- **server/backup.ts:118** — getAllMemoriesForBackup() retrieves memory records without a tenant constraint and includes all tenants' memory content in the backup.
  - _Fix:_ Pass a validated tenantId into the storage method and enforce tenant_id filtering for the memory query; create separate, explicitly authorized per-tenant backups for administrative system-wide backups.
- **server/business-tools.ts:55** — tenantGuard trusts params.tenant_id based only on a truthiness check. Because all tenant-scoped operations derive their tenant scope from this request/tool-controlled value, a caller could supply another tenant's ID and access or modify that tenant's data.
  - _Fix:_ Derive the tenant ID exclusively from authenticated server-side request context or session state, and reject or ignore any caller-supplied tenant_id unless it is verified to match that context.

### HIGH (58)

- **server/agent-activity.ts:61** — SELECT from tenant-scoped table personas filters only by persona id and does not constrain tenant_id. A personaId collision or cross-tenant reference could expose another tenant's persona emoji/catchphrase via the cache.
  - _Fix:_ Change getPersonality to require tenantId and query with both persona id and tenant id, e.g. .where(and(eq(personas.id, personaId), eq(personas.tenantId, tenantId))). Also key the cache by tenantId+personaId to avoid cross-tenant mixing.
- **server/agent-desk.ts:297** — SELECT against the personas table has no tenant_id constraint. If personas is tenant-scoped, this leaks persona names across tenants when building desk overviews.
  - _Fix:_ Constrain the query by tenant ownership, e.g. SELECT id, name FROM personas WHERE tenant_id = ${tenantId}, or first verify each referenced persona belongs to the caller's tenant before using it.
- **server/agent-desk.ts:399** — INSERT into tenant-scoped table agent_desks does not provide values for required tenant-scoped payload columns used elsewhere (active_tasks, blocked_items, waiting_for, queue, recent_completions). Given the invariant states tenant-scoped inserts must pass required columns explicitly and columns have no defaults, this insert is inconsistent and may rely on implicit defaults/schema behavior.
  - _Fix:_ Insert all required non-null columns explicitly, including tenant_id and initialized JSONB fields, e.g. active_tasks, blocked_items, waiting_for, queue, and recent_completions with empty arrays.
- **server/agent-eval.ts:181** — runEval reads a persona by caller-supplied personaId via storage.getPersona(personaId) without first verifying the persona belongs to the caller's tenant. This can allow cross-tenant access/use of another tenant's persona and then writes eval rows for it under the caller's tenant.
  - _Fix:_ Load the persona with both personaId and tenantId, e.g. query with WHERE id = <personaId> AND tenant_id = <tenantId>, or add a storage.getPersonaForTenant(personaId, tenantId) helper and reject if no row is found.
- **server/agent-eval.ts:260** — getEvalReport filters agent_evals by tenant_id but, when personaId is provided, it uses the foreign id directly without first verifying that the referenced persona belongs to the caller's tenant. This violates the requirement to validate ownership of caller-supplied foreign ids before using them.
  - _Fix:_ Before running the report, verify the persona exists under the caller's tenant with a query like WHERE id = <personaId> AND tenant_id = <tenantId>; if not, reject the request.
- **server/agent-manager.ts:202** — Creates messages for a new tenant-scoped conversation without explicitly setting tenant_id. The invariant requires every INSERT into a tenant-scoped table to pass tenantId explicitly; relying on storage.createMessage to infer tenant ownership from conversationId is insufficient here.
  - _Fix:_ Pass tenantId explicitly when creating each copied message, and ensure storage.createMessage inserts tenant_id = tenantId for the messages table.
- **server/agentic-engines.ts:500** — SELECT from tenant-scoped table ai_insights lacks any tenant_id filter. The durability sweep reads pending insights across all tenants without constraining by caller tenant.
  - _Fix:_ Require an explicit tenantId scope for this query, e.g. add `AND tenant_id = ${tenantId}` (or equivalent Drizzle `.where(eq(aiInsights.tenantId, tenantId))`) and thread a validated tenantId into the function/caller.
- **server/agentic-engines.ts:500** — SELECT from tenant-scoped table ai_insights fetches pending applied insights across all tenants without a tenant_id constraint in the WHERE clause.
  - _Fix:_ Add a tenant_id filter to the query, or iterate per tenant and query WHERE tenant_id = <tenant>. For example: WHERE status = 'applied' AND priority = 'high' AND action_taken = ... AND tenant_id = ${tenantId}.
- **server/agentic-engines.ts:688** — UPDATE on tenant-scoped table ai_insights can run without any tenant_id constraint when tenantId is undefined, modifying rows across all tenants.
  - _Fix:_ Require a tenantId for this write path, or refactor to update one tenant at a time with WHERE tenant_id = ${tenantId}. If a global sweep is needed, first enumerate tenants and execute a tenant-scoped UPDATE per tenant.
- **server/agentic-engines.ts:816** — SELECT from personas lacks a tenant_id filter. If personas is tenant-scoped, this reads active personas across all tenants and includes them in tenant-specific analysis output.
  - _Fix:_ Constrain the query with tenant ownership, e.g. `SELECT name, role FROM personas WHERE tenant_id = ${tenantId} AND is_active = true LIMIT 14`, or use the equivalent Drizzle `.where(eq(personas.tenantId, tenantId))`.
- **server/agentic-features.ts:280** — queryProjectRelationships accepts a projectId and queries tenant-scoped research_evidence by that projectId without first verifying that the referenced project belongs to the caller's tenant. Filtering research_evidence by tenant_id and project_id does not satisfy the required ownership check on the foreign project id itself.
  - _Fix:_ Before using params.projectId, load the project row with a tenant-scoped query such as SELECT/Drizzle where id = projectId AND tenant_id = params.tenantId, and return an error if not found. Only then query research_evidence for that project.
- **server/agentic-features.ts:599** — competitorBriefing joins tenant-scoped competitor_changes to competitor_registry on competitor_id but constrains only cc.tenant_id. Without also constraining cr.tenant_id = params.tenantId, the join can pull competitor_registry data from another tenant if competitor_id references a row outside the caller's tenant.
  - _Fix:_ Add an explicit tenant filter on the joined table, e.g. JOIN competitor_registry cr ON cr.id = cc.competitor_id AND cr.tenant_id = ${params.tenantId}, or add WHERE cr.tenant_id = ${params.tenantId} in addition to the existing cc filter.
- **server/agentic-features.ts:842** — INSERT into tenant-scoped table outreach_sequence_steps does not set tenant_id. In this codebase tenant isolation relies on explicit tenant_id on every tenant-scoped write, and no DB default/RLS exists.
  - _Fix:_ Include tenant_id in the INSERT for outreach_sequence_steps, e.g. INSERT INTO outreach_sequence_steps (tenant_id, sequence_id, step_number, ...) VALUES (${params.tenantId}, ${sequenceId}, ...).
- **server/agentic-features.ts:862** — SELECT from tenant-scoped table outreach_enrollments checks sequence_id and contact_email but omits tenant_id. This can read another tenant's enrollment and incorrectly block enrollment creation.
  - _Fix:_ Add tenant scoping to the WHERE clause, e.g. WHERE tenant_id = ${params.tenantId} AND sequence_id = ${params.sequenceId} AND contact_email = ${params.contactEmail} AND status = 'active'.
- **server/agentic-features.ts:882** — Query joins outreach_enrollments to outreach_sequences but only constrains e.tenant_id; the joined tenant-scoped table outreach_sequences is not independently filtered by tenant_id. Because there is no DB-enforced tenant isolation, every tenant-scoped table access must be explicitly scoped.
  - _Fix:_ Add an explicit constraint for the joined sequence row, e.g. JOIN outreach_sequences s ON s.id = e.sequence_id AND s.tenant_id = ${params.tenantId}, or add s.tenant_id = ${params.tenantId} in WHERE.
- **server/agentic-features.ts:1021** — UPDATE on tenant-scoped table outreach_enrollments uses only id in WHERE and omits tenant_id. Although the row was previously selected with tenant scope, the invariant requires each write to tenant-scoped tables to be explicitly constrained by tenant_id.
  - _Fix:_ Change the UPDATE to WHERE id = ${row.id} AND tenant_id = ${params.tenantId}.
- **server/agentic-features.ts:1044** — Correlated subquery reads tenant-scoped table outreach_sequence_steps by sequence_id only, without tenant_id constraint. In this system every read against a tenant-scoped table must include tenant_id filtering.
  - _Fix:_ Add tenant_id scoping inside the subquery, e.g. (SELECT COUNT(*) FROM outreach_sequence_steps WHERE sequence_id = s.id AND tenant_id = ${params.tenantId}).
- **server/agentic-features.ts:1045** — Correlated subquery reads tenant-scoped table outreach_enrollments by sequence_id/status only, without tenant_id constraint. This can count rows across tenants if IDs are not globally safe for isolation assumptions.
  - _Fix:_ Add tenant_id scoping inside the subquery, e.g. (SELECT COUNT(*) FROM outreach_enrollments WHERE sequence_id = s.id AND tenant_id = ${params.tenantId} AND status = 'active').
- **server/agentic-features.ts:1046** — Correlated subquery reads tenant-scoped table outreach_enrollments by sequence_id/status only, without tenant_id constraint.
  - _Fix:_ Add tenant_id = ${params.tenantId} to the subquery WHERE clause.
- **server/agentic-features.ts:1047** — Correlated subquery reads tenant-scoped table outreach_enrollments by sequence_id only, without tenant_id constraint.
  - _Fix:_ Add tenant_id = ${params.tenantId} to the subquery WHERE clause.
- **server/agentic/aggregate-ai-spend-budget.ts:171** — SELECT from tenant-scoped table aggregate_ai_spend_reservations computes the daily total using only utc_day and omits any tenant_id filter, allowing cross-tenant data to affect budget enforcement and violating tenant isolation.
  - _Fix:_ Constrain the query by tenant_id, e.g. add a tenantId parameter to sumForUtcDay and use WHERE tenant_id = ${tenantId} AND utc_day = ${day}::date; update callers accordingly.
- **server/agentic/department-budgets.ts:144** — The enforcement sweep selects tenant-scoped department_budgets rows across all tenants without a tenant_id predicate, violating the requirement that every tenant-scoped read be constrained to the caller's tenant.
  - _Fix:_ Make the sweep tenant-scoped by accepting a validated tenantId and adding WHERE tenant_id = ${tenantId}; invoke it separately for each authorized tenant rather than querying all tenants in one operation.
- **server/agentic/harness-injection.ts:29** — The query reads from the tenant-scoped model_harness_deltas table using the hardcoded ADMIN_TENANT_ID rather than the caller's tenant ID. This causes every caller to read the admin tenant's rows and does not enforce per-caller tenant isolation.
  - _Fix:_ Pass the authenticated caller's tenantId into getModelHarnessSuffix/loadActiveByModel and constrain the query with that value, e.g. WHERE tenant_id = ${tenantId}. If these deltas are intentionally shared, store them in a genuinely global table instead of a tenant-scoped one.
- **server/agentic/resume-worker.ts:111** — The candidate SELECT reads from tenant-scoped agent_runs without a tenant_id predicate; it scans running and paused runs across all tenants. The tenant_id equality on the agent_approvals join does not constrain the agent_runs read itself.
  - _Fix:_ Run the sweep separately for an explicitly authorized tenant and add `r.tenant_id = ${tenantId}` to the WHERE clause, or iterate over trusted tenant IDs and execute the query once per tenant.
- **server/agentic/runs.ts:51** — createRun inserts a caller-supplied parentRunId without verifying that the referenced agent run belongs to params.tenantId, allowing a run in one tenant to reference a run from another tenant.
  - _Fix:_ Before inserting, if parentRunId is non-null, query agentRuns with both eq(agentRuns.id, parentRunId) and eq(agentRuns.tenantId, params.tenantId); reject the operation when no tenant-owned parent run exists.
- **server/agentic/self-heal.ts:302** — The runId supplied to attemptSelfHeal is used to append a step without first verifying that the referenced run belongs to tenantId. A caller that can provide another tenant's run ID could cause cross-tenant modification or metadata leakage depending on appendStep's implementation.
  - _Fix:_ Before calling appendStep, perform a tenant-scoped lookup of the run (for example, WHERE runs.id = runId AND runs.tenant_id = tenantId) and reject the operation if no matching row exists. Ensure appendStep itself also enforces this predicate.
- **server/agentic/self-heal.ts:445** — The caller-provided runId is used to create an approval without an explicit ownership check that the referenced run belongs to tenantId. This can associate tenant-scoped approval data with another tenant's run if createApproval does not enforce the relationship internally.
  - _Fix:_ Validate runId with a tenant-constrained query before creating the approval, using WHERE runs.id = runId AND runs.tenant_id = tenantId; also enforce the same check inside createApproval.
- **server/agentic/task-forces.ts:45** — createTaskForce accepts projectId and personaIds from the caller and inserts them into a tenant-scoped task force without verifying that the referenced project and personas belong to p.tenantId. This permits cross-tenant foreign-key associations and can expose or mutate data through later task-force processing.
  - _Fix:_ Before inserting, query each referenced project and persona using a tenant_id = p.tenantId predicate, reject the request if any reference is missing or belongs to another tenant, and only then perform the INSERT.
- **server/agentic/wake-scheduler.ts:142** — The due-wake claim updates agent_wake_schedules across all tenants. The outer UPDATE is constrained only by ids returned from a subquery that filters status and wake_at, but neither the UPDATE nor the subquery applies a tenant_id predicate.
  - _Fix:_ Run the claim per authenticated tenant and add tenant_id = <caller tenant> to both the UPDATE and its row-locking subquery. If this is a global heartbeat, iterate through authorized tenant IDs and execute a tenant-scoped claim for each rather than performing one cross-tenant update.
- **server/agentic/wake-scheduler.ts:46** — scheduleWake inserts caller-supplied personaId, conversationId, and projectId alongside the supplied tenantId without verifying that each referenced row belongs to that tenant. This permits cross-tenant foreign references and violates tenant ownership checks for foreign IDs.
  - _Fix:_ Before inserting, query each non-null referenced ID with a tenant_id = p.tenantId predicate and reject the request if any row is missing or belongs to another tenant; alternatively accept only server-resolved, tenant-validated entity objects.
- **server/api-v1-dispatch.ts:45** — The caller-supplied personaId is resolved with storage.getPersona(personaId) without passing or verifying tenantId ownership. A persona ID from another tenant could be selected and then associated with the new tenant's conversation.
  - _Fix:_ Use a tenant-scoped lookup such as getPersona(personaId, tenantId), or explicitly query personas with WHERE id = personaId AND tenant_id = tenantId before using the record.
- **server/api-v1-dispatch.ts:49** — The agent-name lookup queries personas without a tenant_id predicate, allowing the request to select a persona belonging to another tenant when names overlap or are otherwise discoverable.
  - _Fix:_ Add a parameterized tenant_id = tenantId condition to the personas query, and ensure the selected persona is owned by that tenant.
- **server/api-v1-dispatch.ts:57** — The active-persona lookup does not receive tenantId or otherwise demonstrate tenant scoping, so it may read an active persona from another tenant.
  - _Fix:_ Use a tenant-scoped getActivePersona(tenantId) implementation that constrains the personas query by tenant_id.
- **server/api-v1-dispatch.ts:62** — Settings are loaded without tenantId in a tenant-aware dispatch path. If settings are tenant-scoped, this can read another tenant's configuration and default model.
  - _Fix:_ Load settings with tenantId and ensure the underlying query includes WHERE tenant_id = tenantId; use a separate explicitly global settings method only if the table is genuinely shared.
- **server/auth-monitor.ts:133** — getProviderHealth() reads provider keys through storage.getProviderKeys() without accepting or supplying the caller's tenant ID, so the underlying tenant-scoped provider-key query cannot be verified as tenant-constrained. Additionally, the module-level healthCache is keyed only by provider, allowing one tenant's health data to be reused by another tenant.
  - _Fix:_ Require tenantId in getProviderHealth() and storage.getProviderKeys(tenantId), enforce tenant_id filtering in the storage query, and scope the health cache by tenantId plus provider (or remove the shared cache).
- **server/auth.ts:199** — The API-key lookup reads the tenant-scoped apiKeys table using only key_hash and is_revoked, without constraining the query to the caller's tenant. This permits credential resolution outside an established tenant context.
  - _Fix:_ Require an authenticated tenant context before querying apiKeys and add eq(apiKeys.tenantId, tenantId) to the WHERE clause; if API-key authentication must bootstrap the tenant, use a separately designed global credential lookup table rather than querying the tenant-scoped table.
- **server/auth.ts:209** — The last-used timestamp update on the tenant-scoped apiKeys table is constrained only by apiKeys.id and omits tenant_id.
  - _Fix:_ Update with and(eq(apiKeys.id, key.id), eq(apiKeys.tenantId, key.tenantId)) or the caller tenant ID.
- **server/auth.ts:298** — The auth_sessions DELETE is constrained only by token and has no tenant_id predicate.
  - _Fix:_ Include the authenticated session tenant_id in the DELETE predicate, e.g. and(eq(authSessions.token, tokenHash), eq(authSessions.tenantId, tenantId)).
- **server/auth.ts:310** — The auth_sessions SELECT is constrained only by token and has no tenant_id predicate, allowing session lookup across tenant rows.
  - _Fix:_ Resolve and validate the caller tenant first and add tenant_id to the WHERE clause; otherwise store session credentials in a global authentication table specifically intended for cross-tenant credential lookup.
- **server/auth.ts:318** — The expired-session DELETE uses only the session token and omits tenant_id.
  - _Fix:_ Add the session tenant_id to the DELETE predicate, or delete using a previously tenant-constrained session row.
- **server/auth.ts:341** — deleteSession deletes from tenant-scoped auth_sessions using only the token hash and does not constrain the operation by tenant_id.
  - _Fix:_ Pass the session tenant ID to deleteSession and use both token and tenant_id in the WHERE clause.
- **server/auto-asset-capture.ts:145** — INSERT into tenant-scoped project_files does not set tenant_id explicitly, allowing a write without an application-level tenant association.
  - _Fix:_ Add tenant_id to the column list and bind the validated tenantId value in VALUES.
- **server/auto-asset-capture.ts:164** — INSERT into tenant-scoped project_notes does not set tenant_id explicitly.
  - _Fix:_ Add tenant_id to the column list and bind the validated tenantId value in VALUES.
- **server/auto-asset-capture.ts:184** — The backfill SELECT reads conversations across all tenants without a tenant_id constraint; its correlated messages count also reads messages without constraining them to the conversation's tenant.
  - _Fix:_ Process tenants explicitly and add tenant_id predicates to the conversations query and correlated messages count, or use a trusted per-tenant backfill context.
- **server/auto-asset-capture.ts:207** — The messages SELECT is constrained only by conversation_id and role, with no tenant_id predicate. This is a tenant-scoped read performed using a foreign conversation identifier without an ownership filter.
  - _Fix:_ Add tenant_id = the conversation's validated tenant_id to the WHERE clause, or join conversations on both conversation_id and tenant_id.
- **server/auto-consolidation.ts:203** — UPDATE against tenant-scoped memory_entries does not constrain the outer UPDATE by tenant_id; tenant scoping exists only inside the id-subquery.
  - _Fix:_ Add `AND tenant_id = ${tenantId}` to the outer UPDATE WHERE clause, in addition to the existing tenant-scoped subquery.
- **server/auto-consolidation.ts:366** — SELECT enumerates tenant-scoped memory_entries across all tenants with no tenant_id constraint, retrieving every active tenant ID.
  - _Fix:_ Run the scheduler with an explicitly authorized tenant list or perform tenant-scoped queries per authorized tenant; do not enumerate tenant IDs directly from the tenant-scoped table without an appropriate isolation boundary.
- **server/auto-project.ts:125** — The SELECT reads from tenant-scoped project_conversations without constraining pc.tenant_id to the caller tenant. Filtering only the joined projects table does not enforce isolation for the association rows themselves.
  - _Fix:_ Add an explicit tenant predicate, such as WHERE pc.tenant_id = ${tenantId} AND pc.conversation_id = ${conversationId}, and retain the project ownership check.
- **server/auto-project.ts:171** — The INSERT into tenant-scoped project_conversations omits tenant_id, so the association is not explicitly assigned to the caller's tenant.
  - _Fix:_ Include tenant_id in the column list and insert ${tenantId}; also verify that both the project and conversation belong to that tenant.
- **server/auto-project.ts:176** — The INSERT into tenant-scoped project_notes omits tenant_id, so the note is not explicitly assigned to the caller's tenant.
  - _Fix:_ Include tenant_id in the column list and select ${tenantId} for the inserted note, while retaining the project ownership constraint.
- **server/auto-transcript.ts:26** — The conversation query joins the tenant-scoped personas table only by persona_id. A conversation's persona_id is a foreign reference and the query does not require p.tenant_id = tenantId, so a cross-tenant persona can be read and its name included in the transcript.
  - _Fix:_ Add a tenant ownership predicate to the join, such as LEFT JOIN personas p ON p.id = c.persona_id AND p.tenant_id = ${tenantId}, or verify the persona belongs to the tenant before reading it.
- **server/auto-transcript.ts:165** — This UPDATE writes the tenant-scoped conversations table with only id and project_id IS NULL predicates; it has no tenant_id constraint in the UPDATE WHERE clause.
  - _Fix:_ Include the validated tenant in the predicate, e.g. AND tenant_id = ${c.tenant_id}, and retain the existing project ownership validation.
- **server/auto-tuner.ts:568** — The scheduled tuner reads the tenant-scoped evaluator_snapshots table using hardcoded tenant_id = 1, and then starts the tuning cycle for tenant 1 at line 583. This prevents other tenants from being processed and makes the scheduler operate on a fixed tenant rather than the caller/target tenant.
  - _Fix:_ Remove the hardcoded tenant ID. Enumerate authorized tenant IDs from a global tenant registry or pass an explicitly validated tenant ID into the scheduler, apply the snapshot check for that tenant, and invoke runTuningCycle with the same tenant ID.
- **server/backup.ts:119** — getMemoryStats(undefined, ALL_TENANTS) explicitly requests statistics for all tenants without caller-tenant scoping.
  - _Fix:_ Replace ALL_TENANTS with the validated caller tenantId and ensure the underlying statistics query applies tenant_id filtering; only permit an audited system-admin operation to aggregate tenants.
- **server/backup.ts:176** — getMemoryEntries(undefined, 200, 0) obtains recent memory entries without a tenant identifier, causing the backup's recentChanges data to potentially include another tenant's records.
  - _Fix:_ Pass and validate tenantId and enforce tenant_id in the underlying query; generate recent changes separately for each authorized tenant when performing an administrative backup.
- **server/browser-tool.ts:1108** — The caller-supplied parentFolderId is passed to uploadAndShare for a tenant-scoped artifact without this code verifying that the referenced folder belongs to tenantId. If uploadAndShare does not perform that ownership check, a tenant could store files in or otherwise modify another tenant's folder.
  - _Fix:_ Before passing parentFolderId to uploadAndShare, query the folder using both its ID and tenantId (or have uploadAndShare enforce that combined ownership check); reject the request when no tenant-owned folder matches.
- **server/build-video-from-brief.ts:713** — The caller-provided projectId is forwarded to the detached GitHub render process without verifying that the project belongs to input.tenantId. If the renderer uses PROJECT_ID to read or update project-scoped data, this permits cross-tenant project access or association.
  - _Fix:_ Before dispatching the render, query the projects table with both projectId and input.tenantId, reject missing or foreign projects, and propagate the verified tenant/project context to the renderer. Apply the same ownership validation to the projectId passed to startVideoJob at line 756.
- **server/business-tools.ts:96** — The INSERT into tenant-scoped invoice_items does not provide tenant_id. The row is created only with invoice_id, so it violates the requirement that every tenant-scoped insert explicitly set the caller's tenant.
  - _Fix:_ Add tenant_id to the invoice_items INSERT column list and VALUES using the validated tenant ID; also ensure any invoice_items reads or writes constrain tenant_id directly or through a tenant-verified invoice.

### MEDIUM (8)

- **server/agent-channels.ts:122** — Tenant-scoped query joins agent_channels and personas by id only, without constraining the joined tenant-scoped tables to the caller tenant. This can pull cross-tenant channel/persona metadata if ids collide or references are inconsistent.
  - _Fix:_ Add tenant filters to the joins, e.g. `LEFT JOIN agent_channels ac ON ac.id = cm.channel_id AND ac.tenant_id = ${params.tenantId}` and `LEFT JOIN personas p ON p.id = cm.from_persona_id AND p.tenant_id = ${params.tenantId}`.
- **server/agent-channels.ts:135** — Tenant-scoped query joins agent_channels and personas by id only, without constraining the joined tenant-scoped tables to the caller tenant. This can pull cross-tenant channel/persona metadata if ids collide or references are inconsistent.
  - _Fix:_ Add tenant filters to the joins, e.g. `LEFT JOIN agent_channels ac ON ac.id = cm.channel_id AND ac.tenant_id = ${params.tenantId}` and `LEFT JOIN personas p ON p.id = cm.from_persona_id AND p.tenant_id = ${params.tenantId}`.
- **server/agent-channels.ts:157** — Tenant-scoped query joins agent_channels by id only, without constraining the joined tenant-scoped table to the caller tenant. This can expose cross-tenant channel metadata if references are inconsistent.
  - _Fix:_ Constrain the join with tenant scope, e.g. `JOIN agent_channels ac ON ac.id = cm.channel_id AND ac.tenant_id = ${params.tenantId}`.
- **server/agent-channels.ts:168** — Tenant-scoped query joins agent_channels by id only, without constraining the joined tenant-scoped table to the caller tenant. This can expose cross-tenant channel metadata if references are inconsistent.
  - _Fix:_ Constrain the join with tenant scope, e.g. `JOIN agent_channels ac ON ac.id = cm.channel_id AND ac.tenant_id = ${params.tenantId}`.
- **server/agent-channels.ts:178** — Tenant-scoped query joins agent_channels by id only, without constraining the joined tenant-scoped table to the caller tenant. This can expose cross-tenant channel metadata if references are inconsistent.
  - _Fix:_ Constrain the join with tenant scope, e.g. `JOIN agent_channels ac ON ac.id = cm.channel_id AND ac.tenant_id = ${params.tenantId}`.
- **server/agent-channels.ts:199** — Tenant-scoped query joins agent_channels by id only, without constraining the joined tenant-scoped table to the caller tenant. This can expose cross-tenant channel metadata if references are inconsistent.
  - _Fix:_ Constrain the join with tenant scope, e.g. `JOIN agent_channels ac ON ac.id = cm.channel_id AND ac.tenant_id = ${tenantId}`.
- **server/agent-manager.ts:300** — Raw SQL query scopes heartbeat_tasks by tenant_id, but the correlated subqueries against heartbeat_logs do not include a tenant_id constraint. If heartbeat_logs is tenant-scoped, reads must also filter hl.tenant_id = tenantId to enforce isolation at the application layer.
  - _Fix:_ Add tenant filtering inside each heartbeat_logs subquery, e.g. WHERE hl.task_id = ht.id AND hl.tenant_id = ${tenantId}, or rewrite using Drizzle with explicit eq(heartbeatLogs.tenantId, tenantId) conditions.
- **server/agentic-engines.ts:879** — JOIN reads tenant-scoped research_programs by foreign key rp.id = re.program_id without verifying tenant ownership on the joined table. The WHERE clause scopes only research_experiments; a cross-tenant program_id reference could expose another tenant's program name.
  - _Fix:_ Constrain the joined table by tenant as well, e.g. JOIN research_programs rp ON rp.id = re.program_id AND rp.tenant_id = ${tenantId}, or otherwise verify the referenced program belongs to the same tenant before use.

### LOW (6)

- **server/auth.ts:1250** — DELETE from tenant-scoped password_reset_tokens is constrained only by the token hash and omits tenant_id. Although the token is unique and capability-like, the operation does not satisfy the required tenant predicate.
  - _Fix:_ Pass the validated tenantId from getResetToken into deleteResetToken and add AND tenant_id = ${tenantId} to the DELETE condition.
- **server/auth.ts:1255** — Background cleanup deletes rows from the tenant-scoped password_reset_tokens table using only expiration time, with no tenant_id constraint.
  - _Fix:_ Run cleanup through an explicitly authorized system-maintenance path, or delete per tenant with a tenant_id predicate and an appropriate maintenance scope.
- **server/auth.ts:1361** — clearExpiredSessions deletes from the tenant-scoped auth_sessions table using only expires_at, without constraining the operation to a tenant.
  - _Fix:_ Add an explicit privileged maintenance authorization for this global cleanup, or perform the deletion with a tenant_id predicate when invoked for a tenant.
- **server/auth.ts:1454** — Startup session cleanup deletes expired rows from tenant-scoped auth_sessions without a tenant_id predicate.
  - _Fix:_ Use an explicitly authorized system-maintenance operation for global cleanup, or process the cleanup per tenant with tenant_id constraints.
- **server/auth.ts:1458** — Startup invalidates all non-v2 auth_sessions rows using only a token pattern and no tenant_id constraint, allowing a cross-tenant write to a tenant-scoped table.
  - _Fix:_ Make this an explicitly authorized global migration/maintenance operation, or invalidate rows per tenant with tenant_id constraints.
- **server/business-tools.ts:127** — Request-derived values are interpolated into SQL-looking strings (`status` and `amount_paid`) rather than parameterized. Although the updates array is currently unused, retaining this construction creates an injection risk if it is later executed or reused.
  - _Fix:_ Remove the dead updates array, or construct any executed SQL with Drizzle parameter binding and a strict column allowlist.
