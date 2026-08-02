/**
 * Tools-layer-split S7 — memory-domain migrated handlers.
 *
 * Selection per plan.md smallest-safe-batch precedent (S3): the 6 PURE
 * memory tools migrate — `search_memory`, `create_memory`,
 * `remember_for_this_session`, `update_memory`, `recall_context`,
 * `graph_memory`. Their trust needs fit the existing ToolContext exactly
 * (tenantId / conversationId / personaId). Mixed-category memory-adjacent
 * tools (compress_context, workspace_*, query_communities/causal,
 * record/recall_failure_patterns, record/recall_strategic_wins,
 * auto_memorize_now, recall_references) stay in the legacy switch for
 * later slices. Tools-layer-split S25f added get_unified_memory_context
 * and memory_geometry_scan to this domain.
 *
 * The module-scope helpers `searchMemory`, `createMemory`, and
 * `updateMemory` moved here with their handlers — the legacy switch arms
 * were their ONLY call sites (census-verified; helper-census.md "Memory"
 * group). Handler bodies are MECHANICAL moves of the legacy switch arms
 * (standing rules: no renames, no behavior change). App-module imports are
 * DYNAMIC (call-time), mirroring the legacy arms and preserving the package
 * acyclic static import graph.
 *
 * Contract: data/feature-contracts/tools-layer-split/spec.md
 */

import { defineTool } from "../../define-tool";
import type { RegisteredTool, ToolContext, ToolResult } from "../../types";
import {
  searchMemoryDefinition,
  createMemoryDefinition,
  rememberForThisSessionDefinition,
  updateMemoryDefinition,
  recallContextDefinition,
  graphMemoryDefinition,
  getUnifiedMemoryContextDefinition,
  memoryGeometryScanDefinition,
} from "./definitions";

// ---------------------------------------------------------------------------
// Module-scope helpers moved from server/tools.ts (legacy switch was the only
// caller). Bodies verbatim except: storage/embeddings/silent-catch imports are
// call-time dynamic (package acyclicity).
// ---------------------------------------------------------------------------

async function searchMemory(query: string, wing: string | undefined, room: string | undefined, tenantId: number) {
  const { storage } = await import("../../../storage");
  const persona = await storage.getActivePersona();
  // R125+3.8 — upgraded to true hybrid (vector + BM25 RRF fusion). Pure cosine
  // missed literal-token queries (SKUs, error codes, person names) because
  // they don't co-locate in embedding space; the prior substring-fallback only
  // fired when vector returned ZERO hits, so weak-but-nonempty vector results
  // silently shadowed the literal match. hybridSearchMemory mirrors the proven
  // hybridSearchKnowledge pattern (R98.27) and closes the abmind three-tier-
  // search gap. Falls back to vector-only or substring-keyword if BM25 errors.
  try {
    const { hybridSearchMemory } = await import("../../../embeddings");
    const results = await hybridSearchMemory(query, { personaId: persona?.id, tenantId, topK: 20, wing, room });
    if (results.length > 0) {
      return { count: results.length, searchType: "hybrid", wing: wing || undefined, room: room || undefined, results: results.map((m) => ({ id: m.id, fact: m.fact, category: m.category, wing: m.wing, room: m.room, similarity: m.similarity, retrieval: m.retrieval })) };
    }
  } catch (_silentErr) { const { logSilentCatch } = await import("../../../lib/silent-catch"); logSilentCatch("server/tools.ts", _silentErr); }
  const memResult = await storage.getMemoryEntries(persona?.id, 500, 0, tenantId);
  const q = query.toLowerCase();
  const matches = memResult.data
    .filter((m: any) => {
      if (m.status !== "active") return false;
      if (wing && m.wing !== wing) return false;
      if (room && m.room !== room) return false;
      return m.fact.toLowerCase().includes(q) || m.category.toLowerCase().includes(q);
    })
    .slice(0, 20);
  return { count: matches.length, searchType: "keyword", total: memResult.total, wing: wing || undefined, room: room || undefined, results: matches.map((m: any) => ({ id: m.id, fact: m.fact, category: m.category, wing: m.wing, room: m.room, lastAccessed: m.lastAccessed })) };
}


async function createMemory(fact: string, category: string, tenantId: number, wing?: string, room?: string, confidence?: number) {
  const { storage } = await import("../../../storage");
  const persona = await storage.getActivePersona();
  const personaId = persona?.id ?? null;
  // R98.19: clamp confidence to [0,1]; default 1.0 for explicit tool records.
  const conf = typeof confidence === "number" && Number.isFinite(confidence)
    ? Math.max(0, Math.min(1, confidence))
    : 1.0;
  const confidenceSource = typeof confidence === "number" ? "agent_self_reported" : "default_explicit";

  try {
    const { findAndResolveContradictions } = await import("../../../memory-intelligence");
    const resolution = await findAndResolveContradictions(fact, category, personaId, tenantId);

    if (resolution.action === "skip") {
      return { skipped: true, fact, category, wing, room, message: resolution.reason || "Duplicate memory detected" };
    }
    if (resolution.action === "update" && resolution.existingId) {
      // Create the replacement first, then record the explicit successor link
      // (succeeded_by_id + valid_until) on the stale row rather than a bare flip.
      const entry = await storage.createMemoryEntry({ fact, category, source: "tool", status: "active", personaId, tenantId, wing: wing || null, room: room || null, confidence: conf, confidenceSource });
      const superseded = await storage.updateMemoryEntry(resolution.existingId, { status: "superseded", succeededById: entry.id, validUntil: new Date() }, tenantId);
      if (!superseded) {
        console.error(`[createMemory] supersede no-op: existing #${resolution.existingId} not updated (tenant ${tenantId}); new #${entry.id} left active.`);
      }
      const { generateEmbedding } = await import("../../../embeddings");
      generateEmbedding(fact).then(emb => { if (emb) storage.updateMemoryEmbedding(entry.id, emb).catch(() => {}); }).catch(() => {});
      return { updated: true, id: entry.id, fact, category, wing, room, confidence: conf, superseded: resolution.existingId, message: resolution.reason };
    }
  } catch (_silentErr) { const { logSilentCatch } = await import("../../../lib/silent-catch"); logSilentCatch("server/tools.ts", _silentErr); }

  const entry = await storage.createMemoryEntry({ fact, category, source: "tool", status: "active", personaId, tenantId, wing: wing || null, room: room || null, confidence: conf, confidenceSource });
  const { generateEmbedding } = await import("../../../embeddings");
  generateEmbedding(fact).then(emb => { if (emb) storage.updateMemoryEmbedding(entry.id, emb).catch(() => {}); }).catch(() => {});
  return { created: true, id: entry.id, fact: entry.fact, category: entry.category, wing, room, confidence: conf };
}


async function updateMemory(id: number, tenantId: number, fact?: string, category?: string, status?: string) {
  const { storage } = await import("../../../storage");
  const { generateEmbedding } = await import("../../../embeddings");
  // R74.13c — H1 fix. Scope the lookup to the calling tenant. Without this,
  // a memory id from another tenant would resolve and be writable.
  const persona = await storage.getActivePersona();
  const memResult = await storage.getMemoryEntries(persona?.id, 100, 0, tenantId);
  const target = memResult.data.find((m) => m.id === id);
  if (!target) {
    return { updated: false, error: `Memory entry ${id} not found or does not belong to your tenant/persona` };
  }
  // Defense in depth: even if the row leaked through (e.g., persona is null
  // and the storage layer regresses on tenant scoping), refuse to mutate.
  if ((target as any).tenantId && (target as any).tenantId !== tenantId) {
    return { updated: false, error: `Memory entry ${id} belongs to a different tenant` };
  }

  const updates: Record<string, any> = {};
  if (fact) updates.fact = fact;
  if (category) updates.category = category;
  if (status) updates.status = status;

  if (Object.keys(updates).length === 0) {
    return { updated: false, error: "No fields to update" };
  }

  await storage.updateMemoryEntry(id, updates, tenantId);

  if (fact) {
    generateEmbedding(fact).then((emb) => {
      if (emb) storage.updateMemoryEmbedding(id, emb).catch(() => {});
    }).catch(() => {});
  }

  return { updated: true, id, changes: Object.keys(updates) };
}


// ---------------------------------------------------------------------------
// Handlers (legacy switch arms, verbatim modulo ctx seam + import paths)
// ---------------------------------------------------------------------------

export async function searchMemoryHandler(
  params: Record<string, any>,
  ctx: ToolContext,
): Promise<ToolResult> {
  // R64.C — fail-closed: memory is per-tenant; never fall through to admin.
  if (!ctx.tenantId) return { error: "Tenant context required for search_memory" };
  return searchMemory(params.query || "", params.wing, params.room, ctx.tenantId);
}

export async function createMemoryHandler(
  params: Record<string, any>,
  ctx: ToolContext,
): Promise<ToolResult> {
  if (!ctx.tenantId) return { error: "Tenant context required for create_memory" };
  return createMemory(params.fact, params.category || "preference", ctx.tenantId, params.wing, params.room, params.confidence);
}

export async function rememberForThisSessionHandler(
  params: Record<string, any>,
  ctx: ToolContext,
): Promise<ToolResult> {
  // R112.15 — L2 session memory tool. Persists a fact scoped to the
  // current conversation. Tenant + conversation context come from the
  // dispatcher's injected `_tenantId` and `_conversationId` params.
  if (!ctx.tenantId) return { error: "Tenant context required for remember_for_this_session" };
  const convId = ctx.conversationId;
  if (!convId) return { error: "Conversation context required for remember_for_this_session (called outside chat?)" };
  const factText = String(params.fact || "").trim();
  if (factText.length < 5) return { error: "fact must be ≥5 chars" };
  const kindAllowed = ["entity", "preference", "constraint", "task_state", "other"];
  const kind = kindAllowed.includes(params.kind) ? params.kind : "other";
  try {
    const { storage: stg } = await import("../../../storage");
    const row = await stg.createConversationFact({
      tenantId: ctx.tenantId,
      conversationId: Number(convId),
      personaId: ctx.personaId ?? null,
      factText: factText.slice(0, 280),
      factKind: kind,
      source: "tool",
      status: "active",
      sourceMessageId: null,
      expiresAt: null,
    } as any);
    await stg.evictOldestConversationFacts(Number(convId), ctx.tenantId, 50);
    return { ok: true, fact_id: (row as any).id, message: `Pinned to session memory (kind=${kind}).` };
  } catch (e: any) {
    return { error: e?.message || "failed to pin fact" };
  }
}

export async function updateMemoryHandler(
  params: Record<string, any>,
  ctx: ToolContext,
): Promise<ToolResult> {
  // R74.13c — H1 fix. update_memory previously did NOT thread tenant
  // context, allowing one tenant to mutate another tenant's memory by
  // guessing an id. Require _tenantId at the dispatch boundary.
  if (!ctx.tenantId) return { error: "Tenant context required for update_memory" };
  return updateMemory(params.id, ctx.tenantId, params.fact, params.category, params.status);
}

export async function recallContextHandler(
  params: Record<string, any>,
  ctx: ToolContext,
): Promise<ToolResult> {
  const { db } = await import("../../../db");
  const { sql } = await import("drizzle-orm");
  const { recallCompactionArchive } = await import("../../../compaction");

  // R75 — Strict tenant fail-closed for ALL recall_context paths (local + global + causal + projectWide).
  // Trust ONLY router-injected _tenantId (chat-engine sets this from the authenticated tenant context).
  // No fallback lookups from caller-supplied conversationId — those would let a model pass any
  // numeric conversationId and inherit that tenant's data (IDOR).
  const __tid: number | null = typeof ctx.tenantId === "number" && ctx.tenantId > 0 ? ctx.tenantId : null;
  if (!__tid) {
    return { error: "tenant context required for recall_context. The router must inject _tenantId from the authenticated tenant before invoking this tool." };
  }

  // R75 — GraphRAG dual-level routing.
  // Only engages when caller passes `level`. Default (undefined) preserves
  // the original local-archive behavior for back-compat.
  const rawLevel = typeof params.level === "string" ? params.level.toLowerCase() : undefined;
  if (rawLevel && ["global", "causal", "local", "auto"].includes(rawLevel)) {
    const q = String(params.query || "").trim();
    let resolvedLevel: "global" | "causal" | "local" = rawLevel === "auto" ? "local" : (rawLevel as any);
    if (rawLevel === "auto") {
      const lq = q.toLowerCase();
      if (/(why|cause|because|led to|due to|results in|resulted in|trigger|triggered)/.test(lq)) {
        resolvedLevel = "causal";
      } else if (/(theme|summary|overview|what.*about|topics|categories|cluster|big picture|high.?level)/.test(lq)) {
        resolvedLevel = "global";
      } else {
        resolvedLevel = "local";
      }
    }
    const tid = typeof ctx.tenantId === "number" && ctx.tenantId > 0 ? ctx.tenantId : null;
    if (!tid && (resolvedLevel === "global" || resolvedLevel === "causal")) {
      return { error: "tenant context required for GraphRAG retrieval (level=global|causal). The router must inject _tenantId." };
    }
    if (resolvedLevel === "global") {
      const { queryCommunities } = await import("../../../graph-communities");
      const limit = Math.min(Math.max(parseInt(params.limit) || 3, 1), 10);
      const communities = await queryCommunities(tid!, q, limit);
      return { success: true, source: "graphrag:communities", level: "global", routedFrom: rawLevel, communities };
    }
    if (resolvedLevel === "causal") {
      const { queryCausalChain } = await import("../../../causal-extractor");
      const limit = Math.min(Math.max(parseInt(params.limit) || 5, 1), 20);
      const direction = (typeof params.direction === "string" && ["forward", "backward", "both"].includes(params.direction)) ? params.direction : "both";
      const chains = await queryCausalChain(tid!, q || "the system", direction as any, limit);
      return { success: true, source: "graphrag:causal", level: "causal", routedFrom: rawLevel, direction, chains };
    }
    // resolvedLevel === "local" — fall through to existing handler below.
  }

  const safeConvId = typeof params.conversationId === "number" ? params.conversationId : (typeof ctx.conversationId === "number" ? ctx.conversationId : null);

  if (params.projectWide && safeConvId) {
    try {
      // Tenant-scoped project lookup — must own this conversation.
      const projRes = await db.execute(sql`SELECT project_id FROM conversations WHERE id = ${safeConvId} AND tenant_id = ${__tid}`);
      const projRows = (projRes as any).rows || projRes;
      const pid = projRows?.[0]?.project_id;
      if (pid) {
        // Enumerate sibling conversations within tenant + project only.
        const convRes = await db.execute(sql`
          SELECT DISTINCT pc.conversation_id
            FROM project_conversations pc
            JOIN conversations c ON c.id = pc.conversation_id
           WHERE pc.project_id = ${pid} AND c.tenant_id = ${__tid}
          UNION
          SELECT id AS conversation_id
            FROM conversations
           WHERE project_id = ${pid} AND tenant_id = ${__tid}
        `);
        const convRows = (convRes as any).rows || convRes;
        const allArchives: any[] = [];
        for (const row of (convRows || [])) {
          if (!row.conversation_id) continue;
          const result = await recallCompactionArchive({
            conversationId: row.conversation_id,
            tenantId: __tid,
            query: params.query,
            limit: 1,
          });
          if (result.archives?.length) {
            allArchives.push(...result.archives.map((a: any) => ({ ...a, fromConversation: row.conversation_id })));
          }
        }
        if (!allArchives.length && params.query) {
          const safeLimit = Math.min(Math.max(parseInt(params.limit) || 5, 1), 20);
          const msgRes = await db.execute(sql`
            SELECT m.conversation_id, m.role, m.content, m.created_at
            FROM messages m
            JOIN conversations c ON c.id = m.conversation_id
            WHERE c.tenant_id = ${__tid}
              AND (c.project_id = ${pid} OR c.id IN (
                SELECT pc2.conversation_id FROM project_conversations pc2
                  JOIN conversations c2 ON c2.id = pc2.conversation_id
                 WHERE pc2.project_id = ${pid} AND c2.tenant_id = ${__tid}
              ))
              AND m.content ILIKE ${'%' + params.query + '%'}
            ORDER BY m.created_at DESC LIMIT ${safeLimit}
          `);
          const msgRows = (msgRes as any).rows || msgRes;
          if (Array.isArray(msgRows) && msgRows.length > 0) {
            return { success: true, source: "project_messages", results: msgRows.map((m: any) => ({ conversationId: m.conversation_id, role: m.role, content: typeof m.content === "string" ? m.content.slice(0, 1000) : JSON.stringify(m.content).slice(0, 1000), createdAt: m.created_at })) };
          }
        }
        return { success: true, archives: allArchives };
      }
    } catch (e: any) {
      console.error("[recall_context] Project-wide search error:", e.message);
    }
  }

  if (!safeConvId) {
    // R75 — Graceful tenant-wide fallback (was hard-failing 30% of calls).
    // When invoked from a scheduled job, sub-agent, or otherwise without a
    // conversationId in scope, fall back to the most recent archives across
    // the tenant — strictly tenant-filtered, optionally text-matched.
    try {
      const safeLimit = Math.min(Math.max(parseInt(params.limit) || 3, 1), 10);
      const q = typeof params.query === "string" && params.query.trim() ? params.query.trim() : null;
      const rows: any = q
        ? await db.execute(sql`
            SELECT ca.id, ca.conversation_id, ca.archived_at, ca.message_count, ca.total_messages,
                   LEFT(ca.content, 12000) AS content
              FROM compaction_archives ca
              JOIN conversations c ON c.id = ca.conversation_id
             WHERE c.tenant_id = ${__tid}
               AND ca.content ILIKE ${'%' + q + '%'}
             ORDER BY ca.archived_at DESC
             LIMIT ${safeLimit}
          `)
        : await db.execute(sql`
            SELECT ca.id, ca.conversation_id, ca.archived_at, ca.message_count, ca.total_messages,
                   LEFT(ca.content, 12000) AS content
              FROM compaction_archives ca
              JOIN conversations c ON c.id = ca.conversation_id
             WHERE c.tenant_id = ${__tid}
             ORDER BY ca.archived_at DESC
             LIMIT ${safeLimit}
          `);
      const archiveRows = (rows.rows || rows || []) as any[];
      return {
        success: true,
        source: "tenant_recent_archives",
        note: "No conversationId in scope; returned most recent tenant-wide archives.",
        archives: archiveRows.map(r => ({
          id: r.id,
          conversationId: r.conversation_id,
          archivedAt: r.archived_at,
          messageCount: r.message_count,
          totalMessages: r.total_messages,
          content: r.content,
        })),
      };
    } catch (e: any) {
      console.error("[recall_context] tenant-wide fallback error:", e?.message);
      return { success: false, error: "Recall unavailable (no conversation context and tenant-wide fallback failed)" };
    }
  }
  return recallCompactionArchive({
    conversationId: safeConvId,
    tenantId: __tid,
    query: params.query,
    limit: typeof params.limit === "number" ? params.limit : 3,
  });
}

export async function graphMemoryHandler(
  params: Record<string, any>,
  ctx: ToolContext,
): Promise<ToolResult> {
  if (!ctx.tenantId) return { error: "Tenant context required for graph_memory" };
  const tenantId = ctx.tenantId;
  if (!tenantId) return { error: "Authentication required" };
  const { action } = params;
  const { db: memDb } = await import("../../../db");
  const { sql: memSql } = await import("drizzle-orm");
  const personaId = params.persona_id || null;

  try {
    switch (action) {
      case "store": {
        const { path, content, trigger_condition } = params;
        if (!path || !content) return { error: "path and content are required" };
        const parentPath = path.includes("/") ? path.substring(0, path.lastIndexOf("/")) : null;

        const existing = await memDb.execute(memSql`SELECT id, version FROM graph_memory WHERE tenant_id = ${tenantId} AND path = ${path} AND (persona_id = ${personaId} OR (persona_id IS NULL AND ${personaId} IS NULL)) ORDER BY version DESC LIMIT 1`);
        const currentVersion = (existing as any).rows?.[0]?.version || 0;
        const newVersion = currentVersion + 1;

        await memDb.execute(memSql`INSERT INTO graph_memory (tenant_id, persona_id, path, content, trigger_condition, version, parent_path, created_at, updated_at) VALUES (${tenantId}, ${personaId}, ${path}, ${content}, ${trigger_condition || null}, ${newVersion}, ${parentPath}, NOW(), NOW())`);

        return {
          success: true,
          path,
          version: newVersion,
          has_trigger: !!trigger_condition,
          parent_path: parentPath,
          message: `Memory stored at "${path}" (v${newVersion})${trigger_condition ? ` with trigger: "${trigger_condition}"` : ""}`,
          powered_by: "Nocturne Memory-inspired graph memory",
        };
      }
      case "recall": {
        const { path, query } = params;
        if (!path && !query) return { error: "path or query is required" };

        let rows: any;
        if (path) {
          rows = await memDb.execute(memSql`SELECT path, content, trigger_condition, version, parent_path, persona_id, created_at FROM graph_memory WHERE tenant_id = ${tenantId} AND path = ${path} AND (persona_id = ${personaId} OR persona_id IS NULL) ORDER BY version DESC LIMIT 1`);
        } else {
          rows = await memDb.execute(memSql`SELECT path, content, trigger_condition, version, parent_path, persona_id, created_at FROM graph_memory WHERE tenant_id = ${tenantId} AND (persona_id = ${personaId} OR persona_id IS NULL) AND (content ILIKE ${'%' + query + '%'} OR path ILIKE ${'%' + query + '%'} OR trigger_condition ILIKE ${'%' + query + '%'}) ORDER BY updated_at DESC LIMIT 10`);
        }

        const memories = (rows as any).rows || [];
        return { memories, count: memories.length, query: query || path };
      }
      case "search": {
        const { query } = params;
        if (!query) return { error: "query is required for search" };
        const rows = await memDb.execute(memSql`SELECT path, content, trigger_condition, version, persona_id, created_at FROM graph_memory WHERE tenant_id = ${tenantId} AND (persona_id = ${personaId} OR persona_id IS NULL) AND (content ILIKE ${'%' + query + '%'} OR path ILIKE ${'%' + query + '%'}) ORDER BY updated_at DESC LIMIT 20`);
        return { results: (rows as any).rows || [], query };
      }
      case "list_triggers": {
        const rows = await memDb.execute(memSql`SELECT path, trigger_condition, content, persona_id FROM graph_memory WHERE tenant_id = ${tenantId} AND trigger_condition IS NOT NULL AND trigger_condition != '' ORDER BY path`);
        return { triggers: (rows as any).rows || [] };
      }
      case "rollback": {
        const { path, version } = params;
        if (!path || !version) return { error: "path and version are required for rollback" };
        const target = await memDb.execute(memSql`SELECT * FROM graph_memory WHERE tenant_id = ${tenantId} AND path = ${path} AND version = ${version} AND (persona_id = ${personaId} OR (persona_id IS NULL AND ${personaId} IS NULL))`);
        if (!((target as any).rows || []).length) return { error: `No memory found at "${path}" version ${version}` };
        await memDb.execute(memSql`DELETE FROM graph_memory WHERE tenant_id = ${tenantId} AND path = ${path} AND version > ${version} AND (persona_id = ${personaId} OR (persona_id IS NULL AND ${personaId} IS NULL))`);
        return { success: true, message: `Rolled back "${path}" to version ${version}. Later versions deleted.` };
      }
      case "link": {
        const { path, link_to } = params;
        if (!path || !link_to) return { error: "path and link_to are required" };
        await memDb.execute(memSql`INSERT INTO graph_memory_links (source_path, target_path, tenant_id, created_at) VALUES (${path}, ${link_to}, ${tenantId}, NOW())`);
        return { success: true, message: `Linked "${path}" → "${link_to}"` };
      }
      case "tree": {
        const basePath = params.path || "";
        const rows = await memDb.execute(memSql`SELECT path, content, trigger_condition, version, persona_id FROM graph_memory WHERE tenant_id = ${tenantId} AND path LIKE ${basePath + '%'} ORDER BY path`);
        const links = await memDb.execute(memSql`SELECT source_path, target_path, link_type FROM graph_memory_links WHERE tenant_id = ${tenantId} AND (source_path LIKE ${basePath + '%'} OR target_path LIKE ${basePath + '%'})`);
        return { nodes: (rows as any).rows || [], links: (links as any).rows || [], base_path: basePath || "/" };
      }
      default:
        return { error: `Unknown action: ${action}. Use store, recall, search, list_triggers, rollback, link, or tree.` };
    }
  } catch (err: any) {
    return { error: `Graph memory failed: ${err.message}` };
  }
}

export async function getUnifiedMemoryContextHandler(
  params: Record<string, any>,
  ctx: ToolContext,
): Promise<ToolResult> {
  if (!ctx.tenantId || typeof ctx.tenantId !== "number") return { error: "Tenant context required for get_unified_memory_context" };
  try {
    const { getUnifiedMemoryContext } = await import("../../../memory/unified-context");
    const result = await getUnifiedMemoryContext({
      tenantId: ctx.tenantId,
      query: typeof params.query === "string" ? params.query : undefined,
      sources: Array.isArray(params.sources) ? params.sources : undefined,
      sinceDays: typeof params.sinceDays === "number" ? params.sinceDays : undefined,
      limit: typeof params.limit === "number" ? params.limit : undefined,
    });
    return result;
  } catch (e: any) {
    return { error: `get_unified_memory_context failed: ${e?.message || String(e)}` };
  }
}

export async function memoryGeometryScanHandler(
  params: Record<string, any>,
  ctx: ToolContext,
): Promise<ToolResult> {
  // R107 — Geometry of Consolidation audit.
  if (!ctx.tenantId || typeof ctx.tenantId !== "number") return { error: "Tenant context required for memory_geometry_scan" };
  const tenantId = ctx.tenantId;
  const theta = typeof params.theta === "number" ? Math.max(0, Math.min(1, params.theta)) : 0.85;
  const limit = Math.max(5, Math.min(500, typeof params.limit === "number" ? params.limit : 100));
  const filters: string[] = ["tenant_id = $1", "status = 'active'", "embedding IS NOT NULL"];
  const args: any[] = [tenantId];
  if (typeof params.persona_id === "number") { args.push(params.persona_id); filters.push(`persona_id = $${args.length}`); }
  if (params.wing) { args.push(String(params.wing)); filters.push(`wing = $${args.length}`); }
  if (params.category) { args.push(String(params.category)); filters.push(`category = $${args.length}`); }
  args.push(limit);
  const sqlStr = `SELECT id, fact, embedding FROM memory_entries WHERE ${filters.join(" AND ")} ORDER BY id DESC LIMIT $${args.length}`;
  try {
    const { pool } = await import("../../../db");
    const res = await pool.query(sqlStr, args);
    const rows: any[] = (res as any).rows || [];
    if (rows.length < 2) {
      return { ok: true, n: rows.length, regime: "degenerate", note: "need ≥2 embeddings to compute geometry", spread_clusters: [] };
    }
    const { computeClusterGeometry, pairRegime, coerceEmbedding } = await import("../../../lib/memory-geometry");
    const embs = rows.map(r => r.embedding);
    const geom = computeClusterGeometry(embs, theta);
    // Pair-level scan to find specific spread pairs — surface up to 10 worst.
    const spreadPairs: Array<{ a: number; b: number; aFact: string; bFact: string; dBar: number; margin: number }> = [];
    let totalPairs = 0;
    let spreadCount = 0;
    for (let i = 0; i < rows.length; i++) {
      for (let j = i + 1; j < rows.length; j++) {
        const r = pairRegime(rows[i].embedding, rows[j].embedding, theta);
        if (r.regime === "degenerate") continue;
        totalPairs++;
        // Only count "would-be merge" pairs: those above the candidate threshold.
        if (1 - r.dBar > theta && r.regime === "spread") {
          spreadCount++;
          spreadPairs.push({ a: rows[i].id, b: rows[j].id, aFact: rows[i].fact?.slice(0, 120), bFact: rows[j].fact?.slice(0, 120), dBar: r.dBar, margin: r.margin });
        }
      }
    }
    spreadPairs.sort((a, b) => a.margin - b.margin); // most negative margin = worst
    const scope = params.persona_id ? "persona" : params.wing ? "wing" : params.category ? "category" : "all";
    const scopeValue = String(params.persona_id ?? params.wing ?? params.category ?? "");
    await pool.query(
      `INSERT INTO memory_geometry_audits (tenant_id, scope, scope_value, n, d_bar, d_eff, theta_prime, regime, spread_pairs, total_pairs, notes) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [tenantId, scope, scopeValue || null, geom.n, geom.dBar, geom.dEff, geom.thetaPrime, geom.regime, spreadCount, totalPairs, spreadCount > 0 ? `${spreadCount} would-be-merge pairs in spread regime` : null]
    );
    return {
      ok: true,
      n: geom.n,
      d_bar: Math.round(geom.dBar * 1000) / 1000,
      d_eff: Math.round(geom.dEff * 100) / 100,
      theta_prime: Math.round(geom.thetaPrime * 1000) / 1000,
      regime: geom.regime,
      spread_pair_count: spreadCount,
      total_would_merge_pairs: totalPairs,
      worst_spread_pairs: spreadPairs.slice(0, 10),
      interpretation: geom.regime === "spread"
        ? `Cluster is in the SPREAD regime (d̄=${geom.dBar.toFixed(3)} ≥ θ'=${geom.thetaPrime.toFixed(3)}). Centroid-style consolidation will force identity collapse on this scope. Keep members distinct or use medoid representatives.`
        : `Cluster is TIGHT (d̄=${geom.dBar.toFixed(3)} < θ'=${geom.thetaPrime.toFixed(3)}). Centroid consolidation is safe.`,
    };
  } catch (e: any) {
    return { error: `memory_geometry_scan failed: ${e?.message || String(e)}` };
  }
}

/** Registered by ./index.ts at import time. */
export const memoryDomainTools: RegisteredTool[] = [
  defineTool(searchMemoryDefinition, searchMemoryHandler),
  defineTool(createMemoryDefinition, createMemoryHandler),
  defineTool(rememberForThisSessionDefinition, rememberForThisSessionHandler),
  defineTool(updateMemoryDefinition, updateMemoryHandler),
  defineTool(recallContextDefinition, recallContextHandler),
  defineTool(graphMemoryDefinition, graphMemoryHandler),
  defineTool(getUnifiedMemoryContextDefinition, getUnifiedMemoryContextHandler),
  defineTool(memoryGeometryScanDefinition, memoryGeometryScanHandler),
];
