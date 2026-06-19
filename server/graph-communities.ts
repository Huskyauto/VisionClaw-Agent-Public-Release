// R75 — GraphRAG Five: community detection + LLM summarization.
// Builds an undirected graph from graph_memory + graph_memory_links + recent
// knowledge_triples for one tenant, runs Louvain (the JS-mature equivalent
// of Leiden), and writes one summary row per community to
// knowledge_communities. Designed to be called from the dreaming scheduler
// during the Deep phase, gated on graph size + cooldown.

import Graph from "graphology";
import louvain from "graphology-communities-louvain";
import { db } from "./db";
import { sql } from "drizzle-orm";
import { knowledgeCommunities } from "@shared/schema";
import { logSilentCatch } from "./lib/silent-catch";

export interface CommunityResult {
  tenantId: number;
  nodes: number;
  edges: number;
  communities: number;
  written: number;
  skippedReason?: string;
  topLabels?: string[];
}

const MIN_NODES = 6;
const MIN_COMMUNITY_SIZE = 3;
const MAX_COMMUNITIES_PER_TENANT = 12;
const MIN_HOURS_BETWEEN_RUNS = 6;
const RECENT_TRIPLE_LIMIT = 200;

// Lightweight local model reach so we don't pull the full multi-router.
async function summarizeCluster(
  label: string,
  members: string[],
  triples: Array<{ subject: string; predicate: string; object: string }>,
): Promise<{ label: string; summary: string; keyEntities: string[] }> {
  const memberPreview = members.slice(0, 30).join(", ");
  const triplesPreview = triples
    .slice(0, 25)
    .map(t => `(${t.subject}) -[${t.predicate}]-> (${t.object})`)
    .join("\n");

  // Try OpenAI gpt-5-mini first; gracefully fall back to a deterministic label
  // so dreaming never crashes when API keys are missing or rate-limited.
  try {
    const { default: OpenAI } = await import("openai");
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) throw new Error("no-openai-key");
    const client = new OpenAI({ apiKey });
    const resp = await client.chat.completions.create({
      model: "gpt-5-mini",
      messages: [
        {
          role: "system",
          content:
            "You name and summarize knowledge-graph communities. Output STRICT JSON only with keys: label (≤6 words), summary (1-3 sentences), keyEntities (3-7 short strings). Be concrete; no hedging; no preamble.",
        },
        {
          role: "user",
          content: `Members (paths/entities):\n${memberPreview}\n\nRelations:\n${triplesPreview}\n\nRespond with JSON only.`,
        },
      ],
    });
    const raw = resp.choices?.[0]?.message?.content?.trim() || "{}";
    const cleaned = raw.replace(/^```json\s*|\s*```$/g, "");
    const parsed = JSON.parse(cleaned);
    return {
      label: String(parsed.label || label).slice(0, 80),
      summary: String(parsed.summary || "").slice(0, 600),
      keyEntities: Array.isArray(parsed.keyEntities)
        ? parsed.keyEntities.slice(0, 7).map((e: any) => String(e).slice(0, 60))
        : [],
    };
  } catch (err) {
    logSilentCatch("server/graph-communities.ts", err);
    return {
      label: label.slice(0, 80),
      summary: `Cluster of ${members.length} related items (auto-labelled, no LLM).`,
      keyEntities: members.slice(0, 5),
    };
  }
}

export async function buildCommunitiesForTenant(
  tenantId: number,
  opts: { force?: boolean } = {},
): Promise<CommunityResult> {
  if (!Number.isInteger(tenantId) || tenantId <= 0) {
    return { tenantId, nodes: 0, edges: 0, communities: 0, written: 0, skippedReason: "invalid-tenant" };
  }

  // Cooldown gate
  if (!opts.force) {
    const last = await db.execute<{ refreshed_at: Date | null }>(sql`
      SELECT MAX(refreshed_at) AS refreshed_at FROM knowledge_communities WHERE tenant_id = ${tenantId}
    `);
    const lastTs = last.rows?.[0]?.refreshed_at as any;
    if (lastTs) {
      const ageMs = Date.now() - new Date(lastTs).getTime();
      if (ageMs < MIN_HOURS_BETWEEN_RUNS * 3600_000) {
        return { tenantId, nodes: 0, edges: 0, communities: 0, written: 0, skippedReason: "cooldown" };
      }
    }
  }

  // Pull graph nodes (paths) + memory→memory edges.
  const gmRows = await db.execute<{ path: string; importance: number | null }>(sql`
    SELECT path, importance FROM graph_memory WHERE tenant_id = ${tenantId}
  `);
  const importanceByPath = new Map<string, number>();
  for (const r of gmRows.rows as any[]) {
    importanceByPath.set(r.path, Number(r.importance ?? 0));
  }
  const memNodes = Array.from(importanceByPath.keys()).filter(p => typeof p === "string" && p.length > 0);

  const linkRows = await db.execute<{ source_path: string; target_path: string }>(sql`
    SELECT source_path, target_path FROM graph_memory_links WHERE tenant_id = ${tenantId}
  `);

  // Pull recent triples (subject/object treated as nodes; predicate as edge label)
  const tripleRows = await db.execute<{ id: number; subject: string; predicate: string; object: string }>(sql`
    SELECT id, subject, predicate, object FROM knowledge_triples
    WHERE tenant_id = ${tenantId}
      AND (valid_until IS NULL OR valid_until > now())
    ORDER BY created_at DESC
    LIMIT ${RECENT_TRIPLE_LIMIT}
  `);

  // Build undirected graph for Louvain (Louvain assumes undirected).
  const g = new Graph({ type: "undirected", multi: false, allowSelfLoops: false });
  const tripleIdsByEntity = new Map<string, Set<number>>();
  const addNode = (label: string) => {
    if (!label) return;
    if (!g.hasNode(label)) g.addNode(label);
  };
  for (const n of memNodes) addNode(n);
  for (const t of tripleRows.rows as any[]) {
    const s = String(t.subject || "");
    const o = String(t.object || "");
    if (!s || !o || s === o) continue;
    addNode(s);
    addNode(o);
    if (!g.hasEdge(s, o)) g.addEdge(s, o, { weight: 1 });
    if (!tripleIdsByEntity.has(s)) tripleIdsByEntity.set(s, new Set());
    if (!tripleIdsByEntity.has(o)) tripleIdsByEntity.set(o, new Set());
    tripleIdsByEntity.get(s)!.add(t.id);
    tripleIdsByEntity.get(o)!.add(t.id);
  }
  let edgeCount = g.size;
  for (const e of linkRows.rows as any[]) {
    const s = e.source_path;
    const t = e.target_path;
    if (!s || !t || s === t) continue;
    addNode(s);
    addNode(t);
    if (!g.hasEdge(s, t)) {
      g.addEdge(s, t, { weight: 1 });
      edgeCount++;
    }
  }

  if (g.order < MIN_NODES) {
    return { tenantId, nodes: g.order, edges: g.size, communities: 0, written: 0, skippedReason: "too-few-nodes" };
  }

  // Run Louvain
  const partition = louvain(g) as Record<string, number>;
  const buckets = new Map<number, string[]>();
  for (const [node, cid] of Object.entries(partition)) {
    if (!buckets.has(cid)) buckets.set(cid, []);
    buckets.get(cid)!.push(node);
  }

  // Filter by min size; cap by largest first.
  const eligible = Array.from(buckets.entries())
    .filter(([_, members]) => members.length >= MIN_COMMUNITY_SIZE)
    .sort((a, b) => b[1].length - a[1].length)
    .slice(0, MAX_COMMUNITIES_PER_TENANT);

  // Idempotency: replace ALL communities for this tenant from this source.
  await db.execute(sql`DELETE FROM knowledge_communities WHERE tenant_id = ${tenantId} AND source = 'louvain'`);
  // Reset community_id pointers
  await db.execute(sql`UPDATE graph_memory SET community_id = NULL WHERE tenant_id = ${tenantId}`);

  let written = 0;
  const topLabels: string[] = [];
  for (const [cid, members] of eligible) {
    const tripleIdSet = new Set<number>();
    for (const m of members) {
      const ids = tripleIdsByEntity.get(m);
      if (ids) for (const id of ids) tripleIdSet.add(id);
    }
    const tripleSubset = (tripleRows.rows as any[]).filter(t => tripleIdSet.has(t.id));
    const importanceAvg =
      members.reduce((acc, m) => acc + (importanceByPath.get(m) ?? 0), 0) / members.length;

    const tentativeLabel = `cluster-${cid}-${members[0]?.slice(0, 24) ?? "x"}`;
    const summarized = await summarizeCluster(tentativeLabel, members, tripleSubset);

    const insertedRows = await db.insert(knowledgeCommunities).values({
      tenantId,
      label: summarized.label,
      summary: summarized.summary,
      keyEntities: summarized.keyEntities,
      memberPaths: members,
      memberTripleIds: Array.from(tripleIdSet),
      size: members.length,
      importanceAvg,
      source: "louvain",
    }).returning({ id: knowledgeCommunities.id });
    const newCommunityId = insertedRows?.[0]?.id;
    if (newCommunityId) {
      // Stamp graph_memory.community_id for member paths that are graph_memory nodes
      const memberMemNodes = members.filter(m => importanceByPath.has(m));
      if (memberMemNodes.length > 0) {
        const memJson = JSON.stringify(memberMemNodes);
        await db.execute(sql`
          UPDATE graph_memory
          SET community_id = ${newCommunityId}
          WHERE tenant_id = ${tenantId}
            AND path IN (SELECT jsonb_array_elements_text(${memJson}::jsonb))
        `);
      }
      written++;
      topLabels.push(summarized.label);
    }
  }

  return { tenantId, nodes: g.order, edges: g.size, communities: eligible.length, written, topLabels };
}

// Cheap query helper used by recall_context level=global and the new
// query_communities tool.
export async function queryCommunities(
  tenantId: number,
  query: string,
  limit = 3,
): Promise<Array<{ id: number; label: string; summary: string; keyEntities: string[]; size: number }>> {
  const q = String(query || "").trim().slice(0, 200);
  if (!q) {
    const r = await db.execute(sql`
      SELECT id, label, summary, key_entities, size FROM knowledge_communities
      WHERE tenant_id = ${tenantId}
      ORDER BY importance_avg DESC, size DESC
      LIMIT ${limit}
    `);
    return r.rows.map((row: any) => ({
      id: row.id, label: row.label, summary: row.summary,
      keyEntities: row.key_entities ?? [], size: row.size,
    }));
  }
  // ILIKE on label/summary/keyEntities (cheap, no embeddings — those can come later)
  const pattern = `%${q.replace(/[%_]/g, ch => "\\" + ch)}%`;
  const r = await db.execute(sql`
    SELECT id, label, summary, key_entities, size FROM knowledge_communities
    WHERE tenant_id = ${tenantId}
      AND (label ILIKE ${pattern} OR summary ILIKE ${pattern}
           OR EXISTS (SELECT 1 FROM unnest(key_entities) ke WHERE ke ILIKE ${pattern}))
    ORDER BY importance_avg DESC, size DESC
    LIMIT ${limit}
  `);
  if (r.rows.length === 0) {
    // Fallback: return top-importance communities so we never empty-hand the agent
    const f = await db.execute(sql`
      SELECT id, label, summary, key_entities, size FROM knowledge_communities
      WHERE tenant_id = ${tenantId}
      ORDER BY importance_avg DESC, size DESC
      LIMIT ${limit}
    `);
    return f.rows.map((row: any) => ({
      id: row.id, label: row.label, summary: row.summary,
      keyEntities: row.key_entities ?? [], size: row.size,
    }));
  }
  return r.rows.map((row: any) => ({
    id: row.id, label: row.label, summary: row.summary,
    keyEntities: row.key_entities ?? [], size: row.size,
  }));
}
