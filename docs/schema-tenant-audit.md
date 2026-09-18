# Schema Tenant-Scoping Audit (R74.13g — T001)

**Date:** 2026-04-26
**Author:** Claude (under Bob's "solid all the way down" sweep)
**Source:** `shared/schema.ts` (1569 lines)
**Status:** READ-ONLY audit. No schema changes pushed (per replit.md User Preferences line 7+13).

## Methodology

Every `pgTable(...)` definition in `shared/schema.ts` was classified into one of three buckets:

- **(A) Has tenantId** — directly scoped at the row level. Subdivided by:
  - `notNull()` — strict scoping, no fail-open at DB layer
  - `notNull().default(1)` — **soft fail-open**: missing tenantId silently lands in tenant 1
  - nullable — implicit-tenant risk (rows can exist without scoping)
- **(B) Inherits via parent FK** — no tenantId column, but linked to a parent row that has one. Cross-tenant query risk if join is forgotten.
- **(C) Global / system** — intentionally unscoped (singleton config, system registries).

## Findings

### (A.1) Tables with `tenantId notNull()` — STRICT (80 tables)

All business tables that own tenant-specific records. These are the gold standard.

**Original 44 (R74.13g first pass):** `tenants`, `tenantPersonaNames`, `conversations`, `messages`, `memoryEntries`, `memoryCategories`, `agentRuns`, `agentApprovals`, `selfHealAttempts`, `agentCostLedger`, `dailyNotes`, `agentActivity`, `agentKnowledge`, `heartbeatTasks`, `customTools`, `experiments`, `fileStorage`, `watchlistItems`, `watchlistAlerts`, `tenantProviderKeys`, `modelRegistryUpdates`, `scrapedPages`, `personalityFiles`, `trustScores`, `proactiveActions`, `expressLaneUsage`, `evaluatorSnapshots`, `sentimentEvents`, `consolidationLog`, `presenterSessions`, `inboxMessages`, `notifications`, `activityLog`, `teamMembers`, `apiKeys`, `researchEvidence`, `competitorRegistry`, `competitorSnapshots`, `competitorChanges`, `leadScoringRules`, `leadEnrichments`, `outreachSequences`, `outreachEnrollments`, `moaResponses`

**Added in R74.13g.fix1 (Furrow second pass — 36 tables previously omitted):** `actionOutcomes`, `agentChannels`, `agentDesks`, `aiInsights`, `authSessions`, `autonomyLog`, `autonomyRules`, `briefingReports`, `briefingWidgets`, `capabilities`, `channelMessages`, `channelSubscriptions`, `compactionArchives`, `crewRuns`, `crews`, `docChunks`, `docCollections`, `emailVerificationCodes`, `eventLog`, `eventSubscriptions`, `governanceActions`, `governanceFrameworks`, `governanceRules`, `orderLookupCodes`, `outcomePatterns`, `passwordResetTokens`, `projectConversations`, `projectFiles`, `projectNotes`, `projects`, `researchExperiments`, `researchPrograms`, `researchSchedules`, `researchSessions`, `usageTracking`, `whatsappAuth`

**Status:** ✅ Schema enforces presence. Storage-layer enforcement is the next gate (T002).

### (A.2) Tables with `tenantId notNull().default(1)` — SOFT FAIL-OPEN (5 tables)

Schema defaults rescue any insert that omits tenantId by assigning it to tenant 1. **This is the exact bug class Furrow flagged BLOCKING in `agentic-engines.ts`.**

| Table | Line | Risk |
|-------|------|------|
| `codeProposals` | 1427 | Auto-research code suggestions silently flow to tenant 1 if caller forgets tenantId |
| `customers` | 1467 | CRM customers — cross-tenant data corruption potential |
| `invoices` | 1492 | Billing rows — same |
| `expenses` | 1520 | Bookkeeping — same |
| `plans` | 904 | **Added R74.13g.fix1.** Agent execution plans silently land in tenant 1 if `createPlan()` callers omit tenantId — high impact since plans drive autonomous execution. |

**Recommendation:** Drop the `.default(1)` on these five tables. Application code must always supply tenantId explicitly. Migration: `ALTER TABLE … ALTER COLUMN tenant_id DROP DEFAULT;` — **not pushed in this audit** (per replit.md User Preferences L7+13). Track in follow-up.

### (A.3) Tables with NULLABLE / MISSING tenantId — IMPLICIT-TENANT RISK (3 tables)

| Table | Line | Notes |
|-------|------|-------|
| `oauthSubscriptions` | 1048 | OAuth tokens. `tenantId` nullable for legacy single-tenant tokens. Risk: a query that forgets to filter could leak tokens across tenants. **Flag for follow-up:** add a NOT NULL constraint after backfilling legacy rows. |
| `agentJobs` | 970 | **Added R74.13g.fix1.** Background jobs (`integer("tenant_id")` — no `.notNull()`). Jobs without tenantId can be inserted and silently picked up by any worker. **Recommendation:** add NOT NULL after auditing every `enqueueJob()` call site. |
| `deliveryLogs` | (no tenantId at all) | **HIGHEST RISK.** Customer file-delivery records are completely unscoped. Cannot be filtered per-tenant. Bob's #1 stated UX requirement is "surface direct Drive viewUrl inline for every file delivery" — without tenant scoping, one tenant's deliveries could surface to another. **Recommendation:** add `tenantId integer NOT NULL` column (with backfill). Track separately. |

### (B) Inherits via parent FK (4 tables)

| Table | Parent | Cross-tenant join risk |
|-------|--------|------------------------|
| `heartbeatLogs` | `heartbeatTasks.tenantId` | Heartbeat dashboards must always join through tasks. A direct `SELECT * FROM heartbeat_logs` returns rows from all tenants. |
| `memoryLinks` | `memoryEntries.tenantId` | Memory graph queries must traverse via memoryEntries. Direct link queries are unscoped. |
| `invoiceItems` | `invoices.tenantId` | Line-item exports must join through invoices. |
| `outreachSequenceSteps` | `outreachSequences.tenantId` | Step templates inherit from parent sequence. Reasonably safe (steps are template content), but a tenant-bypass query could leak template internals. |

**Recommendation:** Either (a) add denormalized tenantId to these tables for defense-in-depth, or (b) add a lint rule that flags direct queries against these tables without a parent join. Option (b) is cheaper; track as a separate item.

### (C) Global / system tables (8 tables) — INTENTIONALLY UNSCOPED

| Table | Reason |
|-------|--------|
| `personas` | Personas are platform-wide; per-tenant naming via `tenantPersonaNames`. ✓ |
| `agentSettings` | Singleton system config. ✓ |
| `skills` | Skill registry is platform-wide; `personaId` scopes which persona uses each skill. ✓ |
| `providerKeys` | Owner-level provider API keys (not tenant-level — those live in `tenantProviderKeys`). ✓ |
| `conversationTemplates` | Shared template library. Could become tenant-scoped in the future if multi-tenant template authoring lands. |
| `mcpServers` | Platform-wide MCP server registry. ✓ |
| `codeHealthFindings`, `codeHealthScans` | System-wide static-analysis output. ✓ |

## Summary

| Bucket | Count | Risk Level |
|--------|-------|------------|
| (A.1) `notNull` strict | **80** | Low (schema enforced) |
| (A.2) `notNull.default(1)` soft fail-open | **5** | **HIGH** (silent cross-tenant landing) |
| (A.3) Nullable / missing tenantId | **3** | **HIGH** (cross-tenant leak possible) |
| (B) Parent-linked | 4 | Medium (depends on query discipline) |
| (C) Global system | 8 | None (intentional) |
| **Total tables surveyed** | **100** | |

## Follow-up items (NOT shipped in this audit)

1. **(A.2) Drop `.default(1)`** on `codeProposals`, `customers`, `invoices`, `expenses`, `plans` — requires schema migration + audit of all insert call sites.
2. **(A.3) Add tenantId column** to `deliveryLogs` — requires backfill strategy.
3. **(A.3) Add NOT NULL constraint** to `oauthSubscriptions.tenantId` and `agentJobs.tenantId` — requires legacy row audit.
4. **(B) Lint rule** — flag direct queries against parent-linked tables without join through parent.

## What this audit unblocks

- **T002:** Centralized `tenantScope()` helper in storage layer can rely on the (A.1) bucket being properly enforced at schema level. The 11 truthy `if (tenantId)` checks in `server/storage.ts` (lines 154, 347, 359, 369, 375, 389, 397, 496, 892, 919, 928) all touch (A.1) tables, so a strict helper that throws on invalid input is safe.
- **T003:** `assertTenantContext()` rollout in chat-engine (12 sites) and heartbeat (5 sites) similarly touches (A.1) tables — fail-closed behavior is correct.

## Audit completeness

R74.13g.fix1 (Furrow second pass) confirmed via `rg -c "^export const \w+ = pgTable" shared/schema.ts` → **100 tables**, matching the count in this doc. Every `pgTable(...)` declaration in `shared/schema.ts` is now classified.
