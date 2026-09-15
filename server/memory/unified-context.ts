/**
 * R122 — Unified Memory Context aggregator.
 *
 * Single read surface across the 11 memory-adjacent tables a tenant accumulates
 * over time, so an agent (or Bob) never has to chase down "where did I put
 * that?" again. Read-only. Tenant-isolated via `withTenantTx` (R120 RLS).
 *
 * Surfaces unified (each contributes a row count + normalized items):
 *   memory_entries        — Memory V2 fact store (primary)
 *   agent_knowledge       — Vector knowledge library
 *   conversation_facts    — Per-conversation extracted facts
 *   mind_tickets          — Queued reasoning items per mind
 *   procedure_edits       — Governance-tracked procedure changes (R114)
 *   agent_runs            — Run-level state
 *   agent_trace_spans     — OTel-style reasoning spans
 *   graph_memory          — Per-persona path-keyed graph memory
 *   knowledge_triples     — Subject/predicate/object triples
 *   mind_events           — Per-mind event log
 *   conversations         — Chat conversation index
 *
 * NOT in scope (intentionally): messages (volume too high, use /chat for that),
 * minds (parents of mind_tickets/mind_events — surfaced indirectly), graph_memory_links
 * (relational, not facts), memory_links (relational), memory_categories (taxonomy),
 * conversation_templates (config), knowledge_communities / knowledge_diversity_snapshots
 * (derived analytics), memory_geometry_audits (derived analytics), knowledge_nudges
 * (one-shot suggestions), project_conversations (join table).
 */

import { db } from "../db";
import { sql } from "drizzle-orm";

export type UnifiedSource =
  | "memory_entries"
  | "agent_knowledge"
  | "conversation_facts"
  | "mind_tickets"
  | "procedure_edits"
  | "agent_runs"
  | "agent_trace_spans"
  | "graph_memory"
  | "knowledge_triples"
  | "mind_events"
  | "conversations";

export const ALL_UNIFIED_SOURCES: UnifiedSource[] = [
  "memory_entries",
  "agent_knowledge",
  "conversation_facts",
  "mind_tickets",
  "procedure_edits",
  "agent_runs",
  "agent_trace_spans",
  "graph_memory",
  "knowledge_triples",
  "mind_events",
  "conversations",
];

export interface UnifiedMemoryItem {
  source: UnifiedSource;
  id: number;
  tenantId: number;
  ts: string; // ISO timestamp
  title: string;
  body: string;
  category?: string | null;
  status?: string | null;
  personaId?: number | null;
  link?: string; // deep link to canonical surface
}

export interface UnifiedMemoryResponse {
  tenantId: number;
  query: string | null;
  sources: UnifiedSource[];
  sinceDays: number;
  limit: number;
  totals: Record<UnifiedSource, number>;   // per-source total rows for tenant (no filter)
  counts: Record<UnifiedSource, number>;   // per-source rows after filter
  items: UnifiedMemoryItem[];              // merged + sorted desc by ts, capped to limit
  truncated: boolean;
}

interface AggParams {
  tenantId: number;
  query?: string;
  sources?: UnifiedSource[];
  sinceDays?: number; // default 90
  limit?: number;     // default 100, max 500
}

function safeLimit(n: number | undefined, def: number, max: number): number {
  const v = Number(n);
  if (!Number.isFinite(v) || v <= 0) return def;
  return Math.min(Math.floor(v), max);
}

function escLike(s: string): string {
  // Escape PostgreSQL LIKE special chars (% _ \) before wrapping
  return s.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
}

/**
 * Per-source fetcher returns up to PER_SOURCE_CAP items already normalized.
 * Each fetcher must:
 *  - Use the passed `tx` (so RLS context applies)
 *  - Filter by tenant_id AND optional sinceDays (on its canonical ts column)
 *  - Apply ILIKE filter on its primary text columns when query is provided
 *  - Order by ts DESC LIMIT PER_SOURCE_CAP
 *  - Return both filtered items AND total tenant count for the source
 */
const PER_SOURCE_CAP = 50;

async function totalForSource(
  tx: any,
  table: UnifiedSource,
  tenantId: number,
): Promise<number> {
  // Defense in depth: every source is mapped to its own typed SELECT below.
  // No sql.raw, no template-interpolated identifiers, no template-interpolated
  // tenantId — parameterized via Drizzle ${} binding. The source enum is
  // hardcoded and not user-controlled, but we route via switch anyway so that
  // any future "string snuck through" can't escape into a SQL surface.
  let r: any;
  switch (table) {
    case "memory_entries":
      r = await tx.execute(sql`SELECT COUNT(*)::int AS c FROM memory_entries WHERE tenant_id = ${tenantId}`);
      break;
    case "agent_knowledge":
      r = await tx.execute(sql`SELECT COUNT(*)::int AS c FROM agent_knowledge WHERE tenant_id = ${tenantId}`);
      break;
    case "conversation_facts":
      r = await tx.execute(sql`SELECT COUNT(*)::int AS c FROM conversation_facts WHERE tenant_id = ${tenantId}`);
      break;
    case "mind_tickets":
      r = await tx.execute(sql`SELECT COUNT(*)::int AS c FROM mind_tickets WHERE tenant_id = ${tenantId}`);
      break;
    case "procedure_edits":
      r = await tx.execute(sql`SELECT COUNT(*)::int AS c FROM procedure_edits WHERE tenant_id = ${tenantId}`);
      break;
    case "agent_runs":
      r = await tx.execute(sql`SELECT COUNT(*)::int AS c FROM agent_runs WHERE tenant_id = ${tenantId}`);
      break;
    case "agent_trace_spans":
      r = await tx.execute(sql`SELECT COUNT(*)::int AS c FROM agent_trace_spans WHERE tenant_id = ${tenantId}`);
      break;
    case "graph_memory":
      r = await tx.execute(sql`SELECT COUNT(*)::int AS c FROM graph_memory WHERE tenant_id = ${tenantId}`);
      break;
    case "knowledge_triples":
      r = await tx.execute(sql`SELECT COUNT(*)::int AS c FROM knowledge_triples WHERE tenant_id = ${tenantId}`);
      break;
    case "mind_events":
      r = await tx.execute(sql`SELECT COUNT(*)::int AS c FROM mind_events WHERE tenant_id = ${tenantId}`);
      break;
    case "conversations":
      r = await tx.execute(sql`SELECT COUNT(*)::int AS c FROM conversations WHERE tenant_id = ${tenantId}`);
      break;
    default: {
      const _exhaustive: never = table;
      return 0;
    }
  }
  const rows = (r as any).rows || r;
  return Number(rows?.[0]?.c ?? 0);
}

async function fetchMemoryEntries(
  tx: any,
  tenantId: number,
  query: string | undefined,
  since: Date,
): Promise<UnifiedMemoryItem[]> {
  const q = query ? `%${escLike(query)}%` : null;
  const r: any = q
    ? await tx.execute(sql`
        SELECT id, fact, category, status, persona_id, last_accessed
        FROM memory_entries
        WHERE tenant_id = ${tenantId}
          AND deleted_at IS NULL
          AND last_accessed >= ${since.toISOString()}
          AND fact ILIKE ${q}
        ORDER BY last_accessed DESC LIMIT ${PER_SOURCE_CAP}
      `)
    : await tx.execute(sql`
        SELECT id, fact, category, status, persona_id, last_accessed
        FROM memory_entries
        WHERE tenant_id = ${tenantId}
          AND deleted_at IS NULL
          AND last_accessed >= ${since.toISOString()}
        ORDER BY last_accessed DESC LIMIT ${PER_SOURCE_CAP}
      `);
  const rows = (r as any).rows || r;
  return rows.map((x: any) => ({
    source: "memory_entries" as const,
    id: Number(x.id),
    tenantId,
    ts: new Date(x.last_accessed).toISOString(),
    title: String(x.category || "memory"),
    body: String(x.fact || ""),
    category: x.category,
    status: x.status,
    personaId: x.persona_id ?? null,
    link: `/memory#entry-${x.id}`,
  }));
}

async function fetchAgentKnowledge(
  tx: any,
  tenantId: number,
  query: string | undefined,
  since: Date,
): Promise<UnifiedMemoryItem[]> {
  const q = query ? `%${escLike(query)}%` : null;
  const r: any = q
    ? await tx.execute(sql`
        SELECT id, title, content, category, persona_id, updated_at
        FROM agent_knowledge
        WHERE tenant_id = ${tenantId}
          AND updated_at >= ${since.toISOString()}
          AND (title ILIKE ${q} OR content ILIKE ${q})
        ORDER BY updated_at DESC LIMIT ${PER_SOURCE_CAP}
      `)
    : await tx.execute(sql`
        SELECT id, title, content, category, persona_id, updated_at
        FROM agent_knowledge
        WHERE tenant_id = ${tenantId}
          AND updated_at >= ${since.toISOString()}
        ORDER BY updated_at DESC LIMIT ${PER_SOURCE_CAP}
      `);
  const rows = (r as any).rows || r;
  return rows.map((x: any) => ({
    source: "agent_knowledge" as const,
    id: Number(x.id),
    tenantId,
    ts: new Date(x.updated_at).toISOString(),
    title: String(x.title || "knowledge"),
    body: String(x.content || "").slice(0, 800),
    category: x.category,
    personaId: x.persona_id ?? null,
    link: `/knowledge#entry-${x.id}`,
  }));
}

async function fetchConversationFacts(
  tx: any,
  tenantId: number,
  query: string | undefined,
  since: Date,
): Promise<UnifiedMemoryItem[]> {
  const q = query ? `%${escLike(query)}%` : null;
  const r: any = q
    ? await tx.execute(sql`
        SELECT id, fact_text, fact_kind, status, persona_id, conversation_id, last_referenced_at
        FROM conversation_facts
        WHERE tenant_id = ${tenantId}
          AND last_referenced_at >= ${since.toISOString()}
          AND fact_text ILIKE ${q}
        ORDER BY last_referenced_at DESC LIMIT ${PER_SOURCE_CAP}
      `)
    : await tx.execute(sql`
        SELECT id, fact_text, fact_kind, status, persona_id, conversation_id, last_referenced_at
        FROM conversation_facts
        WHERE tenant_id = ${tenantId}
          AND last_referenced_at >= ${since.toISOString()}
        ORDER BY last_referenced_at DESC LIMIT ${PER_SOURCE_CAP}
      `);
  const rows = (r as any).rows || r;
  return rows.map((x: any) => ({
    source: "conversation_facts" as const,
    id: Number(x.id),
    tenantId,
    ts: new Date(x.last_referenced_at).toISOString(),
    title: String(x.fact_kind || "fact"),
    body: String(x.fact_text || ""),
    category: x.fact_kind,
    status: x.status,
    personaId: x.persona_id ?? null,
    link: x.conversation_id ? `/chat/${x.conversation_id}` : undefined,
  }));
}

async function fetchMindTickets(
  tx: any,
  tenantId: number,
  query: string | undefined,
  since: Date,
): Promise<UnifiedMemoryItem[]> {
  const q = query ? `%${escLike(query)}%` : null;
  const r: any = q
    ? await tx.execute(sql`
        SELECT id, title, description, ticket_type, status, mind_id, updated_at
        FROM mind_tickets
        WHERE tenant_id = ${tenantId}
          AND updated_at >= ${since.toISOString()}
          AND (title ILIKE ${q} OR description ILIKE ${q})
        ORDER BY updated_at DESC LIMIT ${PER_SOURCE_CAP}
      `)
    : await tx.execute(sql`
        SELECT id, title, description, ticket_type, status, mind_id, updated_at
        FROM mind_tickets
        WHERE tenant_id = ${tenantId}
          AND updated_at >= ${since.toISOString()}
        ORDER BY updated_at DESC LIMIT ${PER_SOURCE_CAP}
      `);
  const rows = (r as any).rows || r;
  return rows.map((x: any) => ({
    source: "mind_tickets" as const,
    id: Number(x.id),
    tenantId,
    ts: new Date(x.updated_at).toISOString(),
    title: String(x.title || "ticket"),
    body: String(x.description || ""),
    category: x.ticket_type,
    status: x.status,
    link: `/jobs?mindTicket=${x.id}`,
  }));
}

async function fetchProcedureEdits(
  tx: any,
  tenantId: number,
  query: string | undefined,
  since: Date,
): Promise<UnifiedMemoryItem[]> {
  const q = query ? `%${escLike(query)}%` : null;
  const r: any = q
    ? await tx.execute(sql`
        SELECT id, target_kind, target_id, diff_summary, status, proposed_at
        FROM procedure_edits
        WHERE tenant_id = ${tenantId}
          AND proposed_at >= ${since.toISOString()}
          AND (target_kind ILIKE ${q} OR target_id ILIKE ${q} OR COALESCE(diff_summary,'') ILIKE ${q})
        ORDER BY proposed_at DESC LIMIT ${PER_SOURCE_CAP}
      `)
    : await tx.execute(sql`
        SELECT id, target_kind, target_id, diff_summary, status, proposed_at
        FROM procedure_edits
        WHERE tenant_id = ${tenantId}
          AND proposed_at >= ${since.toISOString()}
        ORDER BY proposed_at DESC LIMIT ${PER_SOURCE_CAP}
      `);
  const rows = (r as any).rows || r;
  return rows.map((x: any) => ({
    source: "procedure_edits" as const,
    id: Number(x.id),
    tenantId,
    ts: new Date(x.proposed_at).toISOString(),
    title: `${x.target_kind}:${x.target_id}`,
    body: String(x.diff_summary || "(before/after diff)").slice(0, 800),
    category: x.target_kind,
    status: x.status,
    link: `/code-proposals?id=${x.id}`,
  }));
}

async function fetchAgentRuns(
  tx: any,
  tenantId: number,
  query: string | undefined,
  since: Date,
): Promise<UnifiedMemoryItem[]> {
  const q = query ? `%${escLike(query)}%` : null;
  const r: any = q
    ? await tx.execute(sql`
        SELECT id, run_type, goal, status, updated_at
        FROM agent_runs
        WHERE tenant_id = ${tenantId}
          AND updated_at >= ${since.toISOString()}
          AND (goal ILIKE ${q} OR run_type ILIKE ${q})
        ORDER BY updated_at DESC LIMIT ${PER_SOURCE_CAP}
      `)
    : await tx.execute(sql`
        SELECT id, run_type, goal, status, updated_at
        FROM agent_runs
        WHERE tenant_id = ${tenantId}
          AND updated_at >= ${since.toISOString()}
        ORDER BY updated_at DESC LIMIT ${PER_SOURCE_CAP}
      `);
  const rows = (r as any).rows || r;
  return rows.map((x: any) => ({
    source: "agent_runs" as const,
    id: Number(x.id),
    tenantId,
    ts: new Date(x.updated_at).toISOString(),
    title: String(x.run_type || "run"),
    body: String(x.goal || ""),
    category: x.run_type,
    status: x.status,
    link: `/jobs?run=${x.id}`,
  }));
}

async function fetchAgentTraceSpans(
  tx: any,
  tenantId: number,
  query: string | undefined,
  since: Date,
): Promise<UnifiedMemoryItem[]> {
  const q = query ? `%${escLike(query)}%` : null;
  const r: any = q
    ? await tx.execute(sql`
        SELECT id, kind, agent_name, tool_name, summary, status, started_at
        FROM agent_trace_spans
        WHERE tenant_id = ${tenantId}
          AND started_at >= ${since.toISOString()}
          AND (COALESCE(summary,'') ILIKE ${q} OR COALESCE(agent_name,'') ILIKE ${q} OR COALESCE(tool_name,'') ILIKE ${q})
        ORDER BY started_at DESC LIMIT ${PER_SOURCE_CAP}
      `)
    : await tx.execute(sql`
        SELECT id, kind, agent_name, tool_name, summary, status, started_at
        FROM agent_trace_spans
        WHERE tenant_id = ${tenantId}
          AND started_at >= ${since.toISOString()}
        ORDER BY started_at DESC LIMIT ${PER_SOURCE_CAP}
      `);
  const rows = (r as any).rows || r;
  return rows.map((x: any) => ({
    source: "agent_trace_spans" as const,
    id: Number(x.id),
    tenantId,
    ts: new Date(x.started_at).toISOString(),
    title: String(x.tool_name || x.agent_name || x.kind || "span"),
    body: String(x.summary || ""),
    category: x.kind,
    status: x.status,
  }));
}

async function fetchGraphMemory(
  tx: any,
  tenantId: number,
  query: string | undefined,
  since: Date,
): Promise<UnifiedMemoryItem[]> {
  const q = query ? `%${escLike(query)}%` : null;
  const r: any = q
    ? await tx.execute(sql`
        SELECT id, path, content, persona_id, updated_at
        FROM graph_memory
        WHERE tenant_id = ${tenantId}
          AND updated_at >= ${since.toISOString()}
          AND (path ILIKE ${q} OR content ILIKE ${q})
        ORDER BY updated_at DESC LIMIT ${PER_SOURCE_CAP}
      `)
    : await tx.execute(sql`
        SELECT id, path, content, persona_id, updated_at
        FROM graph_memory
        WHERE tenant_id = ${tenantId}
          AND updated_at >= ${since.toISOString()}
        ORDER BY updated_at DESC LIMIT ${PER_SOURCE_CAP}
      `);
  const rows = (r as any).rows || r;
  return rows.map((x: any) => ({
    source: "graph_memory" as const,
    id: Number(x.id),
    tenantId,
    ts: new Date(x.updated_at).toISOString(),
    title: String(x.path || "graph-node"),
    body: String(x.content || "").slice(0, 800),
    category: "graph",
    personaId: x.persona_id ?? null,
    link: `/graph-explorer?path=${encodeURIComponent(x.path)}`,
  }));
}

async function fetchKnowledgeTriples(
  tx: any,
  tenantId: number,
  query: string | undefined,
  since: Date,
): Promise<UnifiedMemoryItem[]> {
  const q = query ? `%${escLike(query)}%` : null;
  const r: any = q
    ? await tx.execute(sql`
        SELECT id, subject, predicate, object, persona_id, updated_at
        FROM knowledge_triples
        WHERE tenant_id = ${tenantId}
          AND updated_at >= ${since.toISOString()}
          AND (subject ILIKE ${q} OR predicate ILIKE ${q} OR object ILIKE ${q})
        ORDER BY updated_at DESC LIMIT ${PER_SOURCE_CAP}
      `)
    : await tx.execute(sql`
        SELECT id, subject, predicate, object, persona_id, updated_at
        FROM knowledge_triples
        WHERE tenant_id = ${tenantId}
          AND updated_at >= ${since.toISOString()}
        ORDER BY updated_at DESC LIMIT ${PER_SOURCE_CAP}
      `);
  const rows = (r as any).rows || r;
  return rows.map((x: any) => ({
    source: "knowledge_triples" as const,
    id: Number(x.id),
    tenantId,
    ts: new Date(x.updated_at).toISOString(),
    title: `${x.subject} ${x.predicate}`,
    body: String(x.object || ""),
    category: "triple",
    personaId: x.persona_id ?? null,
  }));
}

async function fetchMindEvents(
  tx: any,
  tenantId: number,
  query: string | undefined,
  since: Date,
): Promise<UnifiedMemoryItem[]> {
  const q = query ? `%${escLike(query)}%` : null;
  const r: any = q
    ? await tx.execute(sql`
        SELECT id, event_type, source, payload, handled, mind_id, created_at
        FROM mind_events
        WHERE tenant_id = ${tenantId}
          AND created_at >= ${since.toISOString()}
          AND (event_type ILIKE ${q} OR source ILIKE ${q} OR payload::text ILIKE ${q})
        ORDER BY created_at DESC LIMIT ${PER_SOURCE_CAP}
      `)
    : await tx.execute(sql`
        SELECT id, event_type, source, payload, handled, mind_id, created_at
        FROM mind_events
        WHERE tenant_id = ${tenantId}
          AND created_at >= ${since.toISOString()}
        ORDER BY created_at DESC LIMIT ${PER_SOURCE_CAP}
      `);
  const rows = (r as any).rows || r;
  return rows.map((x: any) => ({
    source: "mind_events" as const,
    id: Number(x.id),
    tenantId,
    ts: new Date(x.created_at).toISOString(),
    title: String(x.event_type || "event"),
    body: JSON.stringify(x.payload ?? {}).slice(0, 400),
    category: x.event_type,
    status: x.handled ? "handled" : "pending",
  }));
}

async function fetchConversations(
  tx: any,
  tenantId: number,
  query: string | undefined,
  since: Date,
): Promise<UnifiedMemoryItem[]> {
  const q = query ? `%${escLike(query)}%` : null;
  const r: any = q
    ? await tx.execute(sql`
        SELECT id, title, model, persona_id, updated_at
        FROM conversations
        WHERE tenant_id = ${tenantId}
          AND deleted_at IS NULL
          AND updated_at >= ${since.toISOString()}
          AND title ILIKE ${q}
        ORDER BY updated_at DESC LIMIT ${PER_SOURCE_CAP}
      `)
    : await tx.execute(sql`
        SELECT id, title, model, persona_id, updated_at
        FROM conversations
        WHERE tenant_id = ${tenantId}
          AND deleted_at IS NULL
          AND updated_at >= ${since.toISOString()}
        ORDER BY updated_at DESC LIMIT ${PER_SOURCE_CAP}
      `);
  const rows = (r as any).rows || r;
  return rows.map((x: any) => ({
    source: "conversations" as const,
    id: Number(x.id),
    tenantId,
    ts: new Date(x.updated_at).toISOString(),
    title: String(x.title || "conversation"),
    body: `model=${x.model}${x.persona_id ? ` persona=${x.persona_id}` : ""}`,
    category: "conversation",
    personaId: x.persona_id ?? null,
    link: `/chat/${x.id}`,
  }));
}

const FETCHERS: Record<
  UnifiedSource,
  (tx: any, t: number, q: string | undefined, s: Date) => Promise<UnifiedMemoryItem[]>
> = {
  memory_entries: fetchMemoryEntries,
  agent_knowledge: fetchAgentKnowledge,
  conversation_facts: fetchConversationFacts,
  mind_tickets: fetchMindTickets,
  procedure_edits: fetchProcedureEdits,
  agent_runs: fetchAgentRuns,
  agent_trace_spans: fetchAgentTraceSpans,
  graph_memory: fetchGraphMemory,
  knowledge_triples: fetchKnowledgeTriples,
  mind_events: fetchMindEvents,
  conversations: fetchConversations,
};

/**
 * Main entry point. Read-only; safe to call from agent tools.
 *
 * Fails CLOSED on invalid tenantId (via withTenantTx). Per-source failures
 * fail OPEN with a console.warn so one wonky table doesn't take down the
 * whole context view — empty source surfaces as `counts[source] = 0`.
 */
export async function getUnifiedMemoryContext(
  params: AggParams,
): Promise<UnifiedMemoryResponse> {
  const tenantId = Number(params.tenantId);
  if (!Number.isInteger(tenantId) || tenantId <= 0) {
    throw new Error(`getUnifiedMemoryContext: invalid tenantId ${tenantId}`);
  }
  const query = params.query?.trim() || undefined;
  const sources =
    params.sources && params.sources.length > 0
      ? params.sources.filter((s) => ALL_UNIFIED_SOURCES.includes(s))
      : ALL_UNIFIED_SOURCES;
  const sinceDays = safeLimit(params.sinceDays, 90, 3650);
  const limit = safeLimit(params.limit, 100, 500);
  const since = new Date(Date.now() - sinceDays * 86400_000);

  // Use a single transaction so RLS context (R120) applies to every fetch.
  const { withTenantTx } = await import("../db");

  const fetched = await withTenantTx(tenantId, async (tx) => {
    const fetcherJobs = sources.map(async (src) => {
      try {
        const items = await FETCHERS[src](tx, tenantId, query, since);
        return { src, items, error: null as string | null };
      } catch (e: any) {
        console.warn(`[unified-memory] ${src} fetch failed:`, e?.message || e);
        return { src, items: [] as UnifiedMemoryItem[], error: String(e?.message || e) };
      }
    });
    const totalJobs = sources.map(async (src) => {
      try {
        return { src, total: await totalForSource(tx, src, tenantId) };
      } catch (e: any) {
        console.warn(`[unified-memory] ${src} total failed:`, e?.message || e);
        return { src, total: 0 };
      }
    });
    const [fetcherResults, totalResults] = await Promise.all([
      Promise.all(fetcherJobs),
      Promise.all(totalJobs),
    ]);
    return { fetcherResults, totalResults };
  });

  const counts = Object.fromEntries(
    ALL_UNIFIED_SOURCES.map((s) => [s, 0]),
  ) as Record<UnifiedSource, number>;
  const totals = Object.fromEntries(
    ALL_UNIFIED_SOURCES.map((s) => [s, 0]),
  ) as Record<UnifiedSource, number>;

  const allItems: UnifiedMemoryItem[] = [];
  for (const { src, items } of fetched.fetcherResults) {
    counts[src] = items.length;
    allItems.push(...items);
  }
  for (const { src, total } of fetched.totalResults) {
    totals[src] = total;
  }

  // Sort merged items DESC by ts, cap at limit
  allItems.sort((a, b) => (a.ts < b.ts ? 1 : a.ts > b.ts ? -1 : 0));
  const truncated = allItems.length > limit;
  const items = allItems.slice(0, limit);

  return {
    tenantId,
    query: query ?? null,
    sources,
    sinceDays,
    limit,
    totals,
    counts,
    items,
    truncated,
  };
}
