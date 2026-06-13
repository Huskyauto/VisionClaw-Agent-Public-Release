# Tenant-Isolation Audit Report

_Generated 2026-06-13T00:48:37.551Z by `scripts/tenant-isolation-audit.ts` using `gemini-3.5-flash`._

**READ-ONLY audit** — findings below are surfaced for human review. No code was changed.

> ⚠️ **DEGRADED RUN — INCOMPLETE COVERAGE.** 253 file(s) were NOT audited this run (22/38 chunk(s) failed to run or parse). Findings below are PARTIAL — do not read "few findings" as "all clear."
> - chunk 1: unparseable-output
> - chunk 3: unparseable-output
> - chunk 4: unparseable-output
> - chunk 5: unparseable-output
> - chunk 8: unparseable-output
> - chunk 9: unparseable-output
> - chunk 10: unparseable-output
> - chunk 11: unparseable-output
> - chunk 12: unparseable-output
> - chunk 14: unparseable-output
> - chunk 15: unparseable-output
> - chunk 16: unparseable-output
> - chunk 17: unparseable-output
> - chunk 18: unparseable-output
> - chunk 21: unparseable-output
> - chunk 23: unparseable-output
> - chunk 24: unparseable-output
> - chunk 25: unparseable-output
> - chunk 26: unparseable-output
> - chunk 27: unparseable-output
> - chunk 32: unparseable-output
> - chunk 36: unparseable-output

- Coverage: **137/390** file(s) audited · chunks 16/38 OK (22 failed)
- Findings: **44** (CRITICAL 10 · HIGH 32 · MEDIUM 2 · LOW 0)

### CRITICAL (10)

- **server/chat-engine.ts:694** — The query against the fileStorage table in buildWorkspaceContext does not filter by tenantId, allowing any tenant to view uploaded files of other tenants.
  - _Fix:_ Add a .where(eq(fileStorage.tenantId, tenantId)) clause to the query.
- **server/chat-engine.ts:815** — The query against the projects table in buildWorkspaceContext does not filter by tenant_id, allowing any tenant to view active projects of other tenants.
  - _Fix:_ Add AND p.tenant_id = ${tenantId} to the SQL query.
- **server/replit_integrations/chat/storage.ts:21** — getAllConversations performs a SELECT against the tenant-scoped conversations table without any tenantId filter, returning all conversations across all tenants.
  - _Fix:_ Add a tenantId parameter to getAllConversations and filter the query using .where(eq(conversations.tenantId, tenantId)).
- **server/replit_integrations/chat/storage.ts:16** — getConversation retrieves a conversation by ID without constraining the query to the caller's tenant, allowing cross-tenant data access.
  - _Fix:_ Add a tenantId parameter and filter the query using and(eq(conversations.id, id), eq(conversations.tenantId, tenantId)).
- **server/replit_integrations/chat/storage.ts:25** — createConversation hardcodes tenantId: 1 when inserting a new conversation, rather than using the caller's actual tenant ID.
  - _Fix:_ Pass the caller's tenantId as a parameter and use it in the insert values.
- **server/replit_integrations/chat/storage.ts:30** — deleteConversation deletes messages and conversations by ID without verifying tenant ownership, allowing any user to delete any conversation.
  - _Fix:_ Pass tenantId and filter both delete queries by tenantId.
- **server/replit_integrations/chat/storage.ts:35** — getMessagesByConversation retrieves messages for a conversation without verifying that the conversation belongs to the caller's tenant.
  - _Fix:_ Pass tenantId and join with conversations or verify ownership of the conversationId first.
- **server/replit_integrations/chat/routes.ts:12** — The /api/conversations GET handler retrieves all conversations without resolving or enforcing the caller's tenant ID.
  - _Fix:_ Resolve the caller's tenantId from the request (e.g., using getTenantFromRequest or req.user) and pass it to chatStorage.getAllConversations(tenantId).
- **server/replit_integrations/chat/routes.ts:23** — The /api/conversations/:id GET handler retrieves a conversation and its messages by ID without verifying that the caller's tenant owns the conversation.
  - _Fix:_ Resolve the caller's tenantId and verify ownership before returning the conversation and messages.
- **server/self-improvement.ts:243** — SELECT query against the tenant-scoped 'experiments' table lacks a tenantId filter, allowing cross-tenant data leakage during the self-improvement cycle.
  - _Fix:_ Add eq(experiments.tenantId, tenantId) to the .where() clause of the query.

### HIGH (32)

- **server/agentic/harness-adaptation.ts:71** — The SELECT query against the tenant-scoped 'agent_trace_spans' table lacks a 'tenant_id' constraint, allowing cross-tenant trace data to be read during the nightly harness adaptation process.
  - _Fix:_ Add a 'tenant_id' filter to the WHERE clause of the query to restrict trace span mining to the appropriate tenant context.
- **server/chat-engine.ts:4269** — The extractMemory function calls storage.createMemoryEntry to insert a new memory entry without passing or setting the tenantId, violating tenant isolation.
  - _Fix:_ Accept tenantId as a parameter in extractMemory and pass it to storage.createMemoryEntry.
- **server/heartbeat.ts:2755** — The UPDATE query against the tenant-scoped table 'heartbeat_tasks' does not include a tenant_id constraint in its WHERE clause, risking cross-tenant data modification if newTask.id is manipulated or incorrect.
  - _Fix:_ Add a tenant_id constraint to the WHERE clause: UPDATE heartbeat_tasks SET approval_status = 'pending' WHERE id = ${newTask.id} AND tenant_id = ${tenantId}
- **server/health-audit.ts:369** — The UPDATE query against the tenant-scoped table 'heartbeat_tasks' does not restrict the operation to a specific tenant_id, allowing system-wide modification of tasks across all tenants without isolation enforcement.
  - _Fix:_ Ensure the query filters by tenant_id or performs the update within a validated tenant context.
- **server/orchestrator-ledger.ts:452** — The UPDATE query against the tenant-scoped 'memory_entries' table does not include a tenant_id constraint in its WHERE clause, relying solely on the row ID. This violates the tenant isolation invariant.
  - _Fix:_ Modify the query to include the tenant_id constraint: WHERE id = ${row.id} AND tenant_id = ${tenantId}
- **server/reference-learner.ts:283** — The UPDATE query against memory_entries does not constrain the update to the caller's tenant, relying only on id = ${storedId}.
  - _Fix:_ Add AND tenant_id = ${input.tenantId} to the WHERE clause of the UPDATE query.
- **server/recurring-messages.ts:294** — The UPDATE query against agent_knowledge does not constrain the update to the tenant, relying only on id = ${r.id}.
  - _Fix:_ Add AND tenant_id = ${r.tenant_id} to the WHERE clause of the UPDATE query.
- **server/safety/transactional-snapshot.ts:407** — The UPDATE query against the tenant-scoped action_snapshots table does not include a tenant_id constraint in its WHERE clause, which could allow cross-tenant updates if the row ID is manipulated.
  - _Fix:_ Add 'AND tenant_id = $2' to the WHERE clause and pass ctx.tenantId as the second parameter.
- **server/sculptor.ts:93** — The UPDATE query against the tenant-scoped sculptor_sessions table does not include a tenant_id constraint in its WHERE clause.
  - _Fix:_ Add 'AND tenant_id = ${session.tenantId}' to the WHERE clause.
- **server/sculptor.ts:100** — The UPDATE query against the tenant-scoped sculptor_sessions table does not include a tenant_id constraint in its WHERE clause.
  - _Fix:_ Add 'AND tenant_id = ${session.tenantId}' to the WHERE clause.
- **server/sculptor.ts:155** — The UPDATE query against the tenant-scoped sculptor_sessions table in monitorSession does not include a tenant_id constraint in its WHERE clause.
  - _Fix:_ Add 'AND tenant_id = ${tenantId}' to the WHERE clause.
- **server/sculptor.ts:346** — The UPDATE query against the tenant-scoped sculptor_sessions table in reviewSessionWork does not include a tenant_id constraint in its WHERE clause.
  - _Fix:_ Add 'AND tenant_id = ${tenantId}' to the WHERE clause.
- **server/seed.ts:2854** — The SELECT query against the tenant-scoped table 'research_programs' lacks a tenant_id constraint, which could lead to cross-tenant data exposure or modification.
  - _Fix:_ Add a 'tenant_id' filter to the WHERE clause of the query.
- **server/seed.ts:3204** — The SELECT query against the tenant-scoped table 'conversations' lacks a tenant_id constraint, potentially exposing conversations across different tenants.
  - _Fix:_ Add a 'tenant_id' filter to the WHERE clause of the query.
- **server/seed.ts:4030** — The query 'db.select().from(heartbeatTasks)' reads from the tenant-scoped 'heartbeat_tasks' table without constraining the query to a specific tenant_id.
  - _Fix:_ Add a .where(eq(heartbeatTasks.tenantId, tenantId)) constraint to the query.
- **server/seed.ts:4374** — The DELETE query against the tenant-scoped table 'heartbeat_tasks' lacks a tenant_id constraint, which could result in deleting tasks across all tenants.
  - _Fix:_ Add a 'tenant_id' filter to the WHERE clause of the DELETE query.
- **server/self-improvement.ts:521** — The getExperimentHistory function queries the tenant-scoped 'experiments' table without a tenantId constraint when tenantId is not provided or in the fallback path.
  - _Fix:_ Make tenantId a required parameter and always filter the query by tenantId.
- **server/skill-seeker.ts:754** — The listGaps function queries the tenant-scoped 'capability_gaps' table without a tenantId constraint when tenantId is omitted, leaking gaps across tenants.
  - _Fix:_ Make tenantId a required parameter and ensure all query branches filter by tenant_id.
- **server/skill-synthesizer.ts:136** — The listSkillCandidates function queries the tenant-scoped 'agent_knowledge' table without filtering by tenant_id, exposing skill candidates across tenants.
  - _Fix:_ Add tenantId to the options and append a tenant_id filter to the SQL query.
- **server/skill-synthesizer.ts:163** — The promoteSkillCandidate function reads and updates the tenant-scoped 'agent_knowledge' table by ID without verifying tenant ownership.
  - _Fix:_ Require tenantId in promoteSkillCandidate and add a tenant_id constraint to both the SELECT and UPDATE queries.
- **server/skill-synthesizer.ts:182** — The rejectSkillCandidate function updates the tenant-scoped 'agent_knowledge' table by ID without verifying tenant ownership.
  - _Fix:_ Require tenantId in rejectSkillCandidate and add a tenant_id constraint to the UPDATE query.
- **server/skill-synthesizer.ts:219** — The getApprovedSkillsForPersona function queries the tenant-scoped 'agent_knowledge' table without filtering by tenant_id, leaking approved skills across tenants.
  - _Fix:_ Require tenantId in getApprovedSkillsForPersona and add a tenant_id filter to the query.
- **server/storage.ts:529** — The touchMemoryEntries method updates the tenant-scoped memoryEntries table using only an inArray filter on IDs, without constraining the query to the caller's tenant_id. This allows cross-tenant memory modification if untrusted IDs are passed.
  - _Fix:_ Add a tenantId parameter to touchMemoryEntries and include eq(memoryEntries.tenantId, tenantId) in the where clause.
- **server/storage.ts:862** — The getHeartbeatTask method retrieves a row from the tenant-scoped heartbeatTasks table using only the task ID, without constraining the query to the caller's tenant_id. This allows cross-tenant data exposure.
  - _Fix:_ Add a tenantId parameter to getHeartbeatTask and include eq(heartbeatTasks.tenantId, tenantId) in the where clause.
- **server/surprise-scorer.ts:139** — The scoreProposalSurprise function updates the tenant-scoped felix_proposals table using only the proposalId in the WHERE clause, omitting the tenant_id constraint. This allows cross-tenant modification of proposal outcomes.
  - _Fix:_ Modify the SQL query to include AND tenant_id = ${tenantId} in the WHERE clause.
- **server/tool-learning.ts:129** — SELECT against tenant-scoped table 'customTools' with no tenantId constraint in its WHERE clause.
  - _Fix:_ Add 'eq(customTools.tenantId, tenantId)' to the .where() clause.
- **server/tool-learning.ts:155** — SELECT against tenant-scoped table 'customTools' with no tenantId constraint in its WHERE clause.
  - _Fix:_ Add 'eq(customTools.tenantId, tenantId)' to the .where() clause.
- **server/tool-learning.ts:283** — UPDATE against tenant-scoped table 'customTools' with no tenantId constraint in its WHERE clause.
  - _Fix:_ Add 'eq(customTools.tenantId, tenantId)' to the .where() clause.
- **server/tool-learning.ts:300** — DELETE against tenant-scoped table 'customTools' with no tenantId constraint in its WHERE clause.
  - _Fix:_ Add 'eq(customTools.tenantId, tenantId)' to the .where() clause.
- **server/tool-learning.ts:350** — UPDATE against tenant-scoped table 'customTools' with no tenantId constraint in its WHERE clause.
  - _Fix:_ Add 'eq(customTools.tenantId, tenantId)' to the .where() clause.
- **server/twilio.ts:87** — SELECT against tenant-scoped table 'agent_knowledge' without a tenant_id constraint. Inbound webhook queries agent_knowledge globally to find a pairing.
  - _Fix:_ Store messaging pairings in a dedicated global table, or if using 'agent_knowledge', ensure the query is constrained by tenant_id if the tenant can be resolved from another trusted source.
- **server/twilio.ts:102** — SELECT against tenant-scoped table 'conversations' without a tenant_id constraint. It queries conversations globally to verify ownership.
  - _Fix:_ Change the query to 'SELECT 1 FROM conversations WHERE id = ${info.conversationId} AND tenant_id = ${info.tenantId} LIMIT 1' to ensure the read is constrained to the tenant.

### MEDIUM (2)

- **server/tenant-fork.ts:225** — UPDATE against a tenant-scoped table with no tenantId constraint in its WHERE clause during self-referential ID reparenting.
  - _Fix:_ Add 'eq(entry.table.tenantId, newTenantId)' to the .where() clause.
- **server/video-job-runner.ts:204** — SELECT against tenant-scoped table 'videoJobs' in 'isCancelRequested' without a tenant_id constraint.
  - _Fix:_ Pass tenantId to 'isCancelRequested' and add 'eq(videoJobs.tenantId, tenantId)' to the query's where clause.
