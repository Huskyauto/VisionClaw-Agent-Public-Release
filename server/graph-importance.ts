// R75 — GraphRAG Five: PageRank importance scorer.
// Builds a directed graph from graph_memory + graph_memory_links for one
// tenant, runs PageRank (alpha=0.85), and writes the score back to
// graph_memory.importance. Designed to be called from the dreaming
// scheduler (cheap, every cycle).

import Graph from "graphology";
import pagerank from "graphology-pagerank";
import { db } from "./db";
import { sql } from "drizzle-orm";

export interface ImportanceResult {
  tenantId: number;
  nodes: number;
  edges: number;
  updated: number;
  topPaths: Array<{ path: string; score: number }>;
  skippedReason?: string;
}

const MIN_NODES_FOR_PAGERANK = 3;

export async function scoreImportanceForTenant(
  tenantId: number,
): Promise<ImportanceResult> {
  if (!Number.isInteger(tenantId) || tenantId <= 0) {
    return { tenantId, nodes: 0, edges: 0, updated: 0, topPaths: [], skippedReason: "invalid-tenant" };
  }

  const nodeRows = await db.execute<{ path: string }>(sql`
    SELECT path FROM graph_memory WHERE tenant_id = ${tenantId}
  `);
  const nodes = nodeRows.rows.map((r: any) => r.path).filter((p: any) => typeof p === "string" && p.length > 0);

  if (nodes.length < MIN_NODES_FOR_PAGERANK) {
    return { tenantId, nodes: nodes.length, edges: 0, updated: 0, topPaths: [], skippedReason: "too-few-nodes" };
  }

  const edgeRows = await db.execute<{ source_path: string; target_path: string }>(sql`
    SELECT source_path, target_path FROM graph_memory_links WHERE tenant_id = ${tenantId}
  `);

  const g = new Graph({ type: "directed", multi: false, allowSelfLoops: false });
  const nodeSet = new Set(nodes);
  for (const n of nodes) g.addNode(n);

  let edgeCount = 0;
  for (const e of edgeRows.rows as any[]) {
    const s = e.source_path;
    const t = e.target_path;
    if (!s || !t || s === t) continue;
    if (!nodeSet.has(s) || !nodeSet.has(t)) continue;
    if (g.hasEdge(s, t)) continue;
    g.addEdge(s, t);
    edgeCount++;
  }

  // Floating-point edge case: if no edges, PageRank degenerates to uniform.
  // We still want to run it so all nodes get a baseline of 1/N — useful as
  // a tie-breaker when we sort by importance later.
  const ranks = pagerank(g, { alpha: 0.85, tolerance: 1e-6, maxIterations: 100 });

  // Persist back to graph_memory.importance. We batch by ranking bucket so
  // we don't need 1 UPDATE per node.
  const ranked = Object.entries(ranks)
    .map(([path, score]) => ({ path, score: Number(score) }))
    .filter(r => Number.isFinite(r.score));

  let updated = 0;
  if (ranked.length > 0) {
    // Drive the bulk update via a JSON aggregate to avoid driver array-typing
    // quirks. Each row maps {path, score} → graph_memory.importance.
    const payload = JSON.stringify(ranked);
    const res = await db.execute(sql`
      UPDATE graph_memory AS gm
      SET importance = (u.elem->>'score')::real
      FROM jsonb_array_elements(${payload}::jsonb) AS u(elem)
      WHERE gm.tenant_id = ${tenantId}
        AND gm.path = (u.elem->>'path')
    `);
    updated = (res as any).rowCount ?? ranked.length;
  }

  const topPaths = ranked
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);

  return { tenantId, nodes: nodes.length, edges: edgeCount, updated, topPaths };
}
