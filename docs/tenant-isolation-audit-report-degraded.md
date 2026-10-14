# Tenant-Isolation Audit Report

_Generated 2026-10-14T07:36:15.791Z by `scripts/tenant-isolation-audit.ts` using `gpt-5.4`._

**READ-ONLY audit** — findings below are surfaced for human review. No code was changed.

> ⚠️ **DEGRADED RUN — INCOMPLETE COVERAGE.** 585 file(s) were NOT audited this run (chunk cap in effect). Findings below are PARTIAL — do not read "few findings" as "all clear."

- Coverage: **188/773** file(s) audited · chunks 20/68 OK (0 failed, 48 pending)
- Findings: **70** (CRITICAL 10 · HIGH 54 · MEDIUM 6 · LOW 0)
- Severe dispositions: **64 kept** · 0 precision false-positive · 0 allowlist false-positive · 0 deferred real risk

### CRITICAL (10)

- **server/agentic-features.ts:842** — INSERT into tenant-scoped table `outreach_sequence_steps` does not set tenant_id. The invariant requires every INSERT into tenant-scoped tables to pass tenantId explicitly.
  - _Fix:_ Add `tenant_id` to the insert columns and values, using the trusted caller tenantId: `INSERT INTO outreach_sequence_steps (tenant_id, sequence_id, ...) VALUES (${params.tenantId}, ${sequenceId}, ...)`.
- **server/api-v1-dispatch.ts:45** — Persona lookup by caller-supplied personaId uses storage.getPersona(personaId) with no tenant ownership verification before using the persona in a tenant-scoped conversation. This can let a caller reference another tenant's persona.
  - _Fix:_ Load the persona with a tenant-scoped query (e.g. WHERE id = personaId AND tenant_id = tenantId) or verify the returned persona.tenantId matches the caller's tenant before use.
- **server/api-v1-dispatch.ts:49** — Agent lookup by caller-supplied agent name selects from personas without any tenant_id filter. A caller can resolve and use a persona from another tenant with the same name.
  - _Fix:_ Constrain the personas query with tenant_id = tenantId in addition to the name filter, or otherwise verify the matched persona belongs to the caller's tenant before assigning personaId.
- **server/deep-interview.ts:337** — INSERT into tenant-scoped table project_notes does not set tenant_id. The row is created by selecting a project owned by the tenant, but tenant isolation here depends on explicit tenant_id on every insert per the schema invariant.
  - _Fix:_ Include tenant_id in the INSERT column list and values/select, e.g. `INSERT INTO project_notes (project_id, tenant_id, content, created_at) SELECT p.id, p.tenant_id, ... WHERE ... AND p.tenant_id = ${state.tenantId}`.
- **server/embeddings.ts:809** — UPDATE against tenant-scoped table memory_entries omits tenant_id entirely in the fallback branch of `storeEmbeddingVec`: `UPDATE ${sql.raw(table)} ... WHERE id = ${id}`. A caller providing a cross-tenant id can modify another tenant's memory row.
  - _Fix:_ Require a validated tenantId for all tenant-scoped tables in `storeEmbeddingVec` and include `AND tenant_id = ${tenantId}` in every UPDATE path. Remove the no-tenant fallback for `memory_entries` entirely.
- **server/embeddings.ts:855** — UPDATE against tenant-scoped table memory_entries in `backfillEmbeddingVecs` uses only id: `UPDATE memory_entries SET embedding_vec = ... WHERE id = ${row.id}`. This writes to a tenant-scoped table with no tenant_id constraint.
  - _Fix:_ Select tenant_id with each row and update with `WHERE id = ${row.id} AND tenant_id = ${row.tenant_id}`; preferably backfill in a per-tenant job so every read/write stays tenant-scoped.
- **server/embeddings.ts:872** — UPDATE against tenant-scoped table agent_knowledge in `backfillEmbeddingVecs` uses only id: `UPDATE agent_knowledge SET embedding_vec = ... WHERE id = ${row.id}`. This updates tenant-scoped data without a tenant_id predicate.
  - _Fix:_ Select tenant_id alongside each row and update with `WHERE id = ${row.id} AND tenant_id = ${row.tenant_id}`; ideally execute backfills per tenant.
- **server/episode-playbooks.ts:68** — Request-derived vector literal is interpolated directly into SQL: `... ${embeddingLiteral}::vector ...` in `distillEpisode`. Although generated from embeddings, this is still raw string interpolation into SQL rather than parameterization, creating injection/isolation risk if the value shape is ever compromised.
  - _Fix:_ Validate the embedding runtime shape and use a safe helper like `sql.raw` only on a validated literal builder, or better, bind via a typed parameter/cast pattern used consistently elsewhere. Avoid direct `${embeddingLiteral}` SQL interpolation.
- **server/episode-playbooks.ts:92** — INSERT into tenant-scoped table episode_playbooks uses direct SQL interpolation for `goal_embedding`: `${embeddingLiteral}::vector`. This is raw string SQL construction with derived content and bypasses safe parameterization.
  - _Fix:_ Use a validated vector-literal helper and a safe parameterization strategy instead of directly interpolating `embeddingLiteral` into SQL text.
- **server/episode-playbooks.ts:120** — Request-derived vector literal is interpolated directly into SQL in `retrieveEpisodePlaybooks`: `1 - (goal_embedding <=> ${embeddingLiteral}::vector)`. This is unsafe raw interpolation and can become an injection/isolation vector if the content is ever malformed or attacker-influenced.
  - _Fix:_ Replace direct interpolation with a validated vector helper or parameterized cast approach. Do not embed raw derived strings into SQL text.

### HIGH (54)

- **server/ab-optimizer.ts:112** — SELECT from tenant-scoped table `experiments` in `runDueAbExperiments()` has no tenant_id constraint. This reads running experiments across all tenants based only on category/status.
  - _Fix:_ Scope the query by tenant_id for the intended tenant, or explicitly iterate tenants and query `WHERE tenant_id = <tenant>` for each tenant-scoped batch.
- **server/agent-activity.ts:61** — Lookup of `personas` by `id` in `getPersonality()` has no tenant_id constraint. If `personas` is tenant-scoped, a caller-controlled or mixed-tenant personaId can read another tenant's persona metadata.
  - _Fix:_ Pass tenantId into `getPersonality()` and query with both `id` and `tenant_id`, e.g. `.where(and(eq(personas.id, personaId), eq(personas.tenantId, tenantId)))`.
- **server/agent-activity.ts:122** — UPDATE against tenant-scoped table `agentActivity` in `completeActivity()` uses only `id` with no tenant_id constraint. A known activityId could update another tenant's row.
  - _Fix:_ Require tenantId in `completeActivity()` and constrain the update with both `id` and `tenant_id`.
- **server/agent-desk.ts:297** — SELECT from `personas` in `getDesksOverview()` has no tenant_id filter. This can expose persona names across tenants when building a tenant-specific desks overview.
  - _Fix:_ Filter personas by the caller tenant, e.g. `SELECT id, name FROM personas WHERE tenant_id = ${tenantId}` (or equivalent Drizzle query).
- **server/agentic-engines.ts:816** — SELECT from `personas` in `runDecisionEngine()` has no tenant_id constraint. This reads active personas across all tenants and mixes them into one tenant's analysis.
  - _Fix:_ Restrict the query to the caller tenant, e.g. `WHERE tenant_id = ${tenantId} AND is_active = true`.
- **server/agentic-features.ts:862** — SELECT from tenant-scoped table `outreach_enrollments` checks existing enrollment by `sequence_id` and `contact_email` but does not constrain by tenant_id or verify ownership of the foreign `sequenceId` beyond the sequence lookup. This can read cross-tenant enrollments if IDs overlap or if table isolation relies solely on app filters.
  - _Fix:_ Add `tenant_id = ${params.tenantId}` to the existing-enrollment query, and keep all enrollment lookups/writes tenant-scoped.
- **server/agentic-features.ts:916** — SELECT from `outreach_sequence_steps` in `advanceSequence()` uses only `sequence_id` and `step_number` with no tenant_id constraint and no prior ownership verification of the step row. If sequence steps are tenant-scoped, this can read another tenant's step content.
  - _Fix:_ Store and filter `tenant_id` on `outreach_sequence_steps`, and query with `WHERE tenant_id = ${params.tenantId} AND sequence_id = ... AND step_number = ...`.
- **server/agentic-features.ts:1023** — UPDATE against tenant-scoped table `outreach_enrollments` in `classifyReply()` uses only `id` with no tenant_id constraint. Although the row was selected tenant-scoped earlier, the write itself is not constrained, violating the required per-write tenant filter.
  - _Fix:_ Add `AND tenant_id = ${params.tenantId}` to the UPDATE WHERE clause.
- **server/agentic/approvals.ts:135** — Bulk UPDATE against tenant-scoped table agentApprovals in expireStaleApprovals() has no tenant_id constraint. This updates pending approvals across all tenants.
  - _Fix:_ If this sweep is intended per-tenant, add a tenant filter in the WHERE clause. If it is intentionally global maintenance, document/segregate it clearly and ensure all downstream handling preserves per-row tenant isolation.
- **server/auto-transcript.ts:46** — SELECT from tenant-scoped messages reads all messages for a conversation_id without a tenant_id filter. Although conversation ownership is checked earlier, the invariant requires every read against a tenant-scoped table to include tenant_id = caller tenant in the query itself.
  - _Fix:_ Add an explicit tenant filter to the messages query, e.g. `WHERE conversation_id = ${conversationId} AND tenant_id = ${tenantId}`.
- **server/auto-transcript.ts:165** — UPDATE on tenant-scoped conversations uses a foreign project_id/conversation_id pair from a prior cross-table query but does not constrain the UPDATE by tenant_id. This violates the per-query tenant filter invariant.
  - _Fix:_ Add `AND tenant_id = ${c.tenant_id}` to the UPDATE predicate, or otherwise include an explicit tenant ownership condition in the UPDATE itself.
- **server/auto-tuner.ts:568** — Scheduled snapshot lookup hard-codes tenant_id = 1 when reading evaluator_snapshots. This bypasses caller/tenant scoping and reads one tenant's tenant-scoped data without constraining to the active tenant context.
  - _Fix:_ Pass the intended tenantId into runScheduledTuningCycle and constrain the query with that tenantId instead of the hard-coded 1. If this is truly single-tenant admin behavior, move it to a clearly global/shared path and ensure it cannot be reused for tenant-scoped reads.
- **server/browser-tool.ts:943** — listTabs() falls back to browser.pages() when tenantId is absent, exposing tabs across all contexts/sessions without tenant isolation. This reads tenant-associated browser state without constraining to a caller tenant.
  - _Fix:_ Require a tenantId for listing tabs, or restrict the function to the caller's BrowserContext via getTenantSession(tenantId,...). Remove or separately guard the global browser.pages() path for admin-only internal use.
- **server/browser-tool.ts:953** — listTabs() global branch uses browser.pages() with no tenant constraint, allowing access to pages outside the caller's tenant context.
  - _Fix:_ Eliminate the global browser.pages() branch or protect it behind explicit admin-only authorization. For tenant-scoped usage, only enumerate pages from the tenant's own context.
- **server/browser-tool.ts:978** — openTab() allows a branch with no tenantId that creates a page on the shared browser via browser.newPage(), bypassing tenant session isolation and creating/using browser state not bound to a tenant.
  - _Fix:_ Require tenantId and create tabs only inside the tenant's BrowserContext obtained from getTenantSession(). If a global/admin mode is needed, isolate it in a separate admin-only API.
- **server/browser-tool.ts:1000** — focusTab() has a no-tenant branch that reads and manipulates browser.pages() across the shared browser without tenant ownership checks.
  - _Fix:_ Require tenantId and only focus tabs inside the tenant's own BrowserContext. Remove or strictly admin-gate the shared-browser branch.
- **server/browser-tool.ts:1024** — closeTab() has a no-tenant branch that reads and closes tabs from browser.pages() on the shared browser without tenant isolation.
  - _Fix:_ Require tenantId and only close tabs in the caller's BrowserContext. If shared-browser operations are necessary, place them behind explicit admin authorization and a separate code path.
- **server/browser-tool.ts:1042** — getPageSnapshot() no-tenant branch reads from browser.pages() on the shared browser with no tenant constraint, allowing access to page content outside the caller's tenant.
  - _Fix:_ Require tenantId for snapshots and resolve pages only from the tenant's BrowserContext. Remove or admin-gate the shared-browser branch.
- **server/browser-tool.ts:1138** — takeScreenshot() contains a no-tenant branch that reads pages from browser.pages() on the shared browser, capturing screenshots outside any tenant-bound context.
  - _Fix:_ Require tenantId and only operate on pages in the caller's BrowserContext. Separate any admin/global screenshot feature into an explicitly privileged path.
- **server/browser-tool.ts:1572** — pdf action writes generated PDFs under a 'global' directory when tenantId is absent, and the no-tenant branch reads from shared browser pages without tenant isolation.
  - _Fix:_ Require tenantId for PDF generation and store outputs in tenant-specific locations only. Remove the global branch or restrict it to explicitly authorized admin use.
- **server/business-tools.ts:96** — INSERT into invoice_items does not set tenant_id. Per the invariant, every INSERT into a tenant-scoped table must explicitly pass tenant_id; relying only on invoice_id linkage is insufficient without DB-enforced isolation.
  - _Fix:_ Add tenant_id to the invoice_items INSERT and populate it from the caller tenant (e.g. INSERT INTO invoice_items (tenant_id, invoice_id, ...) VALUES (${tid}, ${newId}, ...)).
- **server/business-tools.ts:301** — INSERT into customer_interactions sets tenant_id correctly, but the subsequent customer UPDATE is separate and fine; however this handler accepts created_by from params and writes an interaction row after only checking customer ownership. If customer_interactions is tenant-scoped, this is okay; no finding here. The actual issue is elsewhere: createInvoice inserts invoice_items without tenant_id.
  - _Fix:_ No change needed for this line; ensure all child-table inserts like invoice_items explicitly include tenant_id.
- **server/ceo-orchestrator.ts:661** — SELECT against tenant-scoped table `personas` is unconstrained: `db.select().from(personasTable)` loads all personas with no `tenant_id` filter, allowing cross-tenant persona data to be read and used during orchestration.
  - _Fix:_ Restrict the query to the caller tenant (or explicitly allowed global/admin records), e.g. `.where(eq(personasTable.tenantId, plan.tenantId))` or an equivalent validated scope.
- **server/ceo-orchestrator.ts:1584** — `getActivePlan(planId)` returns an in-memory plan by ID with no tenant ownership check. If exposed through a handler using caller-supplied planId, a tenant could read another tenant's active orchestration state.
  - _Fix:_ Require `tenantId` as an argument and enforce ownership before returning, e.g. only return the plan when `plan?.tenantId === callerTenantId`.
- **server/ceo-orchestrator.ts:1588** — `getActivePlansForConversation(conversationId)` filters only by `conversationId` and not by tenant. If a caller supplies a foreign conversation ID, this can disclose active plans from another tenant.
  - _Fix:_ Require `tenantId` and filter by both conversation and tenant, or first verify the conversation belongs to the caller tenant before returning plans.
- **server/chat-engine/project-context.ts:159** — SELECT from tenant-scoped table project_files is filtered only by project_id with no tenant_id constraint in the WHERE clause. The code relies on prior ownership checks of the project, but the invariant requires every read against a tenant-scoped table to include tenant_id = caller tenant.
  - _Fix:_ Add an explicit tenant filter to the query, e.g. `... FROM project_files WHERE project_id = ${projectId} AND tenant_id = ${tenantId} ...`.
- **server/chat-engine/project-context.ts:171** — SELECT from tenant-scoped table project_notes is filtered only by project_id with no tenant_id constraint in the WHERE clause. This violates the requirement that every tenant-scoped read include tenant_id scoping.
  - _Fix:_ Add `AND tenant_id = ${tenantId}` to the project_notes query.
- **server/commitment-drafter.ts:234** — Tenant-scoped table update on commitments reverts a claimed row by id without a tenant_id constraint. If a bad row object were ever present, this could modify another tenant's commitment with the same id assumption.
  - _Fix:_ Add tenant_id to the WHERE clause when unclaiming: `WHERE id = ${row.id} AND tenant_id = ${tenantId}` or otherwise use the claimed row's validated tenant before any update.
- **server/data-protection.ts:359** — SELECT from tenant-scoped table project_notes filters only by project_id with no tenant_id constraint. Even though projects were loaded for the caller tenant, this query can read cross-tenant notes if a foreign-key anomaly or mismatched row exists.
  - _Fix:_ Add tenant scoping to the child query, e.g. `... FROM project_notes WHERE project_id = ${proj.id} AND tenant_id = ${tenantId} ORDER BY created_at ASC`, and ensure project_notes inserts always set tenant_id.
- **server/data-protection.ts:371** — SELECT from tenant-scoped table project_files filters only by project_id with no tenant_id constraint. This relies on application assumptions instead of enforcing tenant isolation on the query itself.
  - _Fix:_ Scope the query by tenant_id as well: `... FROM project_files WHERE project_id = ${proj.id} AND tenant_id = ${tenantId} ORDER BY created_at ASC`.
- **server/data-protection.ts:404** — SELECT against tenant-scoped table messages uses only conversation_id with no tenant_id filter. This becomes a cross-tenant read/oracle if a mismatched conversation_id exists or data integrity is imperfect.
  - _Fix:_ Add `AND tenant_id = ${tenantId}` to the messages count query.
- **server/debate-engine.ts:126** — runDebate accepts a tenantId but calls `storage.getPersonas()` without showing any tenant ownership check or tenant-scoped filter. If personas are tenant-scoped, this can pull personas across tenants before using them in the debate.
  - _Fix:_ Use a tenant-scoped persona lookup such as `storage.getPersonasByTenant(tenantId)` or ensure `getPersonas()` internally enforces `WHERE tenant_id = tenantId` for tenant-scoped personas.
- **server/doc-collections.ts:165** — DELETE against tenant-scoped table doc_chunks filters only by doc_path and collection_id, with no tenant_id constraint. If collection IDs/doc paths are guessed or reused across tenants, this can delete another tenant's chunks.
  - _Fix:_ Add tenant scoping to the DELETE, e.g. `DELETE FROM doc_chunks WHERE doc_path = ${docPath} AND collection_id = ${collectionId} AND tenant_id = ${tenantId}`.
- **server/doc-collections.ts:294** — UPDATE against tenant-scoped table doc_chunks sets embedding by row id only, without a tenant_id constraint. A row id obtained from prior logic could update another tenant's chunk embedding.
  - _Fix:_ Scope the UPDATE by tenant as well, e.g. `UPDATE doc_chunks SET embedding = ... WHERE id = ${row.id} AND tenant_id = ${tenantId}`.
- **server/email.ts:374** — SELECT against tenant-scoped table inbox_messages checks only message_id with no tenant_id constraint: `SELECT id FROM inbox_messages WHERE message_id = ${msgId}`. This can treat another tenant's row as the dedupe match and skip storing the current tenant's message, breaking tenant isolation assumptions on a shared table.
  - _Fix:_ Include the resolved tenant in the dedupe lookup, e.g. `WHERE tenant_id = ${tenantId} AND message_id = ${msgId}`. If tenant must be derived later, derive/validate tenant ownership before querying or enforce uniqueness on `(tenant_id, message_id)` and query by both columns.
- **server/email.ts:419** — SELECT against tenant-scoped table inbox_messages has no tenant_id filter: `SELECT id, message_id FROM inbox_messages WHERE (body_text IS NULL OR body_text = '') AND (body_html IS NULL OR body_html = '')`. This reads rows across all tenants without tenant scoping.
  - _Fix:_ Restrict the backfill job by tenant_id for each tenant being processed, or document/use a genuinely global admin-only path with explicit ownership semantics. For strict isolation, query `WHERE tenant_id = ${tenantId}` in a per-tenant loop.
- **server/email.ts:433** — UPDATE against tenant-scoped table inbox_messages uses only row id: `UPDATE inbox_messages SET ... WHERE id = ${row.id}`. Without `tenant_id` in the WHERE clause, a wrong/cross-tenant id from the prior unscoped select can update another tenant's email row.
  - _Fix:_ Add tenant scoping to the update, e.g. `WHERE id = ${row.id} AND tenant_id = ${tenantId}` after making the source SELECT tenant-scoped.
- **server/embeddings.ts:814** — SELECT against tenant-scoped table agent_knowledge in `backfillMissingKnowledgeEmbeddings` has no tenant_id constraint: `SELECT id, tenant_id, title, content FROM agent_knowledge ... LIMIT 50`. This reads records across tenants via an application-level query without tenant scoping.
  - _Fix:_ Process backfills per tenant with `WHERE tenant_id = ${tenantId}`, or otherwise explicitly iterate tenants and scope each query. Do not read tenant-scoped rows in a cross-tenant batch query if isolation relies solely on SQL filters.
- **server/embeddings.ts:845** — SELECT against tenant-scoped table memory_entries in `backfillEmbeddingVecs` lacks tenant_id filtering: `SELECT id, embedding FROM memory_entries ... LIMIT 200`. This scans rows across tenants without tenant isolation.
  - _Fix:_ Run the backfill per tenant and add `tenant_id = ${tenantId}` to the query, or otherwise redesign so tenant-scoped tables are never queried without tenant predicates.
- **server/embeddings.ts:861** — SELECT against tenant-scoped table agent_knowledge in `backfillEmbeddingVecs` lacks tenant_id filtering: `SELECT id, embedding FROM agent_knowledge ... LIMIT 200`. This reads across tenants without tenant constraints.
  - _Fix:_ Run knowledge backfills per tenant and add `tenant_id = ${tenantId}` to the SELECT.
- **server/episode-playbooks.ts:135** — UPDATE query builds an SQL array literal by string interpolation: `id = ANY(${`{${ids.join(",")}}`}::int[])`. Even though ids come from prior query results, this is raw SQL construction and violates the no string-interpolated SQL rule for request-influenced/derived values.
  - _Fix:_ Use parameterized `IN`/`ANY` construction, e.g. `id IN (${sql.join(ids.map(id => sql`${id}`), sql`, `)})` together with the existing tenant_id filter.
- **server/felix-brain.ts:23** — Boot-time rehydration reads from tenant-scoped table `agent_runs` without any tenant_id constraint. This loads running/pending rows for all tenants into process memory, violating tenant isolation.
  - _Fix:_ Constrain the query by tenant_id, or if cross-tenant boot recovery is truly required, move it behind a trusted admin-only path and ensure the loaded state is never exposed across tenants. For normal reads, use `WHERE tenant_id = <caller tenant>`.
- **server/firecrawl.ts:252** — UPDATE on tenant-scoped table scrapedPages is constrained only by id after a prior SELECT. Tenant isolation relies on the earlier lookup and is not enforced in the UPDATE WHERE clause.
  - _Fix:_ Add tenant scoping directly to the UPDATE, e.g. .where(and(eq(scrapedPages.id, existing[0].id), eq(scrapedPages.tenantId, tenantId))) ).
- **server/firecrawl.ts:384** — UPDATE on tenant-scoped table scrapedPages is constrained only by id after a prior SELECT. The write itself lacks tenant_id enforcement in its WHERE clause.
  - _Fix:_ Constrain the UPDATE with tenantId as well, e.g. .where(and(eq(scrapedPages.id, existing[0].id), eq(scrapedPages.tenantId, tenantId))) ).
- **server/google-drive.ts:896** — SELECT against tenant-scoped table `projects` filters only by `projects.id` and then checks `project.tenantId` in application code afterward. Under the stated invariant, every read against a tenant-scoped table must include a tenant_id constraint in the SQL WHERE clause.
  - _Fix:_ Change the query to include tenant scoping in SQL, e.g. `.where(and(eq(projects.id, projectId), eq(projects.tenantId, tenantId)))`, and treat no row as not found/unauthorized.
- **server/google-drive.ts:909** — UPDATE against tenant-scoped table `projects` uses `WHERE projects.id = projectId` without `tenant_id` constraint. Even though ownership was checked earlier, the invariant requires the write itself to be tenant-scoped in SQL.
  - _Fix:_ Constrain the UPDATE with both project id and tenant id, e.g. `.where(and(eq(projects.id, projectId), eq(projects.tenantId, tenantId)))`.
- **server/google-drive.ts:1754** — INSERT into tenant-scoped table `project_files` does not set `tenant_id`. The invariant states every INSERT into a tenant-scoped table must explicitly pass tenantId.
  - _Fix:_ Include `tenant_id` in the INSERT values using the validated tenant context, e.g. `INSERT INTO project_files (tenant_id, project_id, ...) VALUES (${resolvedTenantId}, ${params.projectId}, ...)`.
- **server/heartbeat-context.ts:163** — buildTaskContext reads settings via storage.getSettings() with no tenantId, which can pull tenant-scoped settings without constraining to the caller's tenant.
  - _Fix:_ Change the storage API and call site to require tenantId for getSettings(), and enforce WHERE tenant_id = tenantId in the underlying query.
- **server/heartbeat-context.ts:168** — buildTaskContext reads the active persona via storage.getActivePersona() with no tenant ownership check or tenantId constraint, which can leak another tenant's active persona into this tenant's heartbeat context.
  - _Fix:_ Add a tenant-scoped storage method such as getActivePersona(tenantId) and ensure the underlying query filters by tenant_id = tenantId.
- **server/heartbeat-context.ts:182** — buildTaskContext reads all personas via storage.getPersonas() with no tenantId constraint. Personas are tenant-scoped in multi-tenant systems, so this can leak other tenants' agents into the prompt.
  - _Fix:_ Use a tenant-scoped personas read, e.g. storage.getPersonas(tenantId), backed by WHERE tenant_id = tenantId.
- **server/heartbeat-schedules.ts:60** — Cross-tenant SELECT on tenant-scoped table research_schedules without a tenant_id constraint. This reads all due schedules across all tenants directly from the table.
  - _Fix:_ If this is intentional scheduler-owned cross-tenant work, move it behind a dedicated cross-tenant scheduler storage boundary and document it as such; otherwise add tenant scoping with WHERE tenant_id = <caller tenant>. Avoid exposing this pattern to request-driven code.
- **server/heartbeat-task-scheduler-storage.ts:11** — Cross-tenant SELECT on tenant-scoped table heartbeat_tasks without a tenant_id constraint. This returns due tasks from all tenants.
  - _Fix:_ If this function is strictly an internal scheduler cross-tenant boundary, keep it isolated and inaccessible to request handlers; otherwise require a tenantId parameter and add WHERE tenant_id = tenantId.
- **server/heartbeat-task-scheduler-storage.ts:43** — UPDATE on tenant-scoped table heartbeat_tasks without a tenant_id constraint. Claiming by id alone can update a row across tenants if an unexpected id is supplied or boundaries are later reused incorrectly.
  - _Fix:_ Include tenant_id in the WHERE clause when claiming tasks, e.g. WHERE id = ? AND tenant_id = ?, and pass the trusted tenantId alongside each claimed task.
- **server/heartbeat.ts:261** — Cross-tenant SELECT on tenant-scoped table event_log without a tenant_id constraint. This reads pending events for all tenants directly from the table.
  - _Fix:_ If this is intentional platform-worker cross-tenant processing, isolate it behind a dedicated scheduler-only storage boundary; otherwise scope reads with WHERE tenant_id = <caller tenant>.

### MEDIUM (6)

- **server/agent-summary.ts:17** — `getClientForModel(SUMMARY_MODEL)` is called without tenant context in `generateStatusSummary()`. If provider/model resolution is tenant-scoped, this can use the wrong tenant's configuration or credentials.
  - _Fix:_ Thread tenantId through `generateStatusSummary()` and call `getClientForModel(SUMMARY_MODEL, tenantId)`.
- **server/chat-engine.ts:1644** — buildMemorySection defaults tenantId to 1 (`tenantId: number = 1`). If any caller omits tenantId, downstream tenant-scoped memory retrieval/telemetry could execute under tenant 1, violating fail-closed tenant isolation.
  - _Fix:_ Remove the default value and require a validated tenantId parameter. Add a runtime guard that throws if tenantId is missing or non-positive before any tenant-scoped work.
- **server/context-budget.ts:143** — SELECT against governance_rules has no tenant_id constraint. If governance_rules is tenant-scoped, this aggregates rules across all tenants and breaks isolation.
  - _Fix:_ Constrain the query with the caller tenant, e.g. `FROM governance_rules WHERE tenant_id = ${tenantId}`. If this table is intentionally global, document/enforce that in schema and storage APIs.
- **server/delegation-events.ts:20** — In-memory event store is keyed only by conversationId, and `getRecentEvents` returns all events for that conversation when tenantId is omitted. A caller with a foreign conversationId could read another tenant's delegation events without prior ownership verification.
  - _Fix:_ Require tenantId for reads, key storage by `(tenantId, conversationId)`, and refuse to return events unless the requested tenant matches the event tenant.
- **server/google-workspace.ts:2029** — Raw SQL reads from the tenant-scoped tenants table using a hard-coded id (= 1) instead of constraining by the caller's tenantId. This bypasses the application-level tenant isolation invariant and can read another tenant's email during slide-sharing fallback.
  - _Fix:_ Avoid direct SQL here, or query the tenants row with WHERE id = ${tenantId} after validating this flow is intended for that tenant. If this must target an admin/global tenant, move that data to a genuinely global config table or explicitly document/enforce that this path is only callable for the admin tenant.
- **server/heartbeat.ts:1589** — SELECT on tenant-scoped table heartbeat_logs without a tenant_id constraint. The query checks the last successful Dream Memory Consolidation run globally, so one tenant's log can suppress another tenant's task execution.
  - _Fix:_ Add tenant scoping to the query, e.g. WHERE tenant_id = ${tenantId} AND task_name = ... AND status = 'success', or otherwise use task_id plus tenant_id to ensure per-tenant cooldowns.
