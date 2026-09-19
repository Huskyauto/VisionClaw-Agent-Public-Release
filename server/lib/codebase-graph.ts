import { promises as fs } from "fs";
import { logSilentCatch } from "./silent-catch";
import path from "path";
import { spawnSync } from "child_process";

export type GraphNode = {
  id: string;
  path: string;
  layer: string;
  exports: string[];
  importsCount: number;
  lineCount: number;
  bytes: number;
};
export type GraphEdge = { from: string; to: string };
export type CodebaseGraph = {
  schemaVersion: number;
  generatedAt: string;
  rootsScanned: string[];
  fileCount: number;
  edgeCount: number;
  layerCounts: Record<string, number>;
  hubs: { id: string; fanIn: number }[];
  topExternalDeps: { pkg: string; count: number }[];
  nodes: GraphNode[];
  edges: GraphEdge[];
};

const GRAPH_PATH = path.join(process.cwd(), "data", "codebase-graph.json");
let cache: { graph: CodebaseGraph; mtimeMs: number; reverseAdj: Map<string, string[]>; forwardAdj: Map<string, string[]> } | null = null;

export async function loadGraph(): Promise<CodebaseGraph | null> {
  let st: any;
  try { st = await fs.lstat(GRAPH_PATH); } catch { return null; }
  if (st.isSymbolicLink()) {
    try { console.warn(`[codebase-graph] refusing to follow symlink at ${GRAPH_PATH}`); } catch (_silentErr) { logSilentCatch("server/lib/codebase-graph.ts", _silentErr); }
    return null;
  }
  if (!st.isFile()) return null;
  if (cache && cache.mtimeMs === st.mtimeMs) return cache.graph;
  try {
    const body = await fs.readFile(GRAPH_PATH, "utf8");
    const graph = JSON.parse(body) as CodebaseGraph;
    const reverseAdj = new Map<string, string[]>();
    const forwardAdj = new Map<string, string[]>();
    for (const e of graph.edges) {
      if (!forwardAdj.has(e.from)) forwardAdj.set(e.from, []);
      forwardAdj.get(e.from)!.push(e.to);
      if (!reverseAdj.has(e.to)) reverseAdj.set(e.to, []);
      reverseAdj.get(e.to)!.push(e.from);
    }
    cache = { graph, mtimeMs: st.mtimeMs, reverseAdj, forwardAdj };
    return graph;
  } catch (e) {
    return null;
  }
}

export async function queryGraph(opts: { file?: string; exportName?: string; layer?: string; limit?: number }): Promise<any> {
  const graph = await loadGraph();
  if (!graph) return { error: "Codebase graph not built. Run `npx tsx scripts/build-codebase-graph.ts`." };
  const limit = Math.min(opts.limit || 30, 200);
  let matches = graph.nodes;
  if (opts.layer) {
    const want = opts.layer.toLowerCase();
    matches = matches.filter((n) => n.layer.toLowerCase() === want);
  }
  if (opts.file) {
    const needle = opts.file.toLowerCase();
    matches = matches.filter((n) => n.path.toLowerCase().includes(needle));
  }
  if (opts.exportName) {
    const needle = opts.exportName.toLowerCase();
    matches = matches.filter((n) => n.exports.some((x) => x.toLowerCase().includes(needle)));
  }
  matches = matches.slice(0, limit);
  const fwd = cache!.forwardAdj;
  const rev = cache!.reverseAdj;
  const enriched = matches.map((n) => ({
    path: n.path,
    layer: n.layer,
    exports: n.exports,
    lineCount: n.lineCount,
    importsCount: n.importsCount,
    dependsOn: (fwd.get(n.id) || []).slice(0, 50),
    dependedOnBy: (rev.get(n.id) || []).slice(0, 50),
  }));
  return {
    graphGeneratedAt: graph.generatedAt,
    fileCount: graph.fileCount,
    edgeCount: graph.edgeCount,
    matchCount: enriched.length,
    matches: enriched,
  };
}

export async function computeDiffImpact(opts: { baseRef?: string; depth?: number; changedFiles?: string[] }): Promise<any> {
  const graph = await loadGraph();
  if (!graph) return { error: "Codebase graph not built. Run `npx tsx scripts/build-codebase-graph.ts`." };
  const depth = Math.min(Math.max(opts.depth ?? 3, 1), 6);

  let changed: string[] = [];
  if (opts.changedFiles && opts.changedFiles.length) {
    changed = opts.changedFiles.map((f) => f.replace(/^\.\//, "").replace(/\\/g, "/"));
  } else {
    const baseRef = opts.baseRef || "HEAD~1";
    if (!/^[A-Za-z0-9._/^~@-]+$/.test(baseRef) || baseRef.startsWith("-") || baseRef.length > 200) {
      return { error: `invalid baseRef: must match [A-Za-z0-9._/^~@-]{1,200} and not start with '-'` };
    }
    const r = spawnSync("git", ["diff", "--name-only", `${baseRef}...HEAD`, "--"], { encoding: "utf8" });
    if (r.status !== 0) {
      const r2 = spawnSync("git", ["diff", "--name-only", baseRef, "--"], { encoding: "utf8" });
      if (r2.status !== 0) return { error: `git diff failed: ${r.stderr || r2.stderr}` };
      changed = r2.stdout.trim().split("\n").filter(Boolean);
    } else {
      changed = r.stdout.trim().split("\n").filter(Boolean);
    }
  }

  const nodeSet = new Set(graph.nodes.map((n) => n.id));
  const inGraph = changed.filter((f) => nodeSet.has(f));
  const outOfGraph = changed.filter((f) => !nodeSet.has(f));

  const rev = cache!.reverseAdj;
  const layerByFile = new Map(graph.nodes.map((n) => [n.id, n.layer] as const));
  const MAX_VISITED = 2000;
  const visited = new Map<string, number>();
  for (const f of inGraph) visited.set(f, 0);
  let frontier = [...inGraph];
  let visitCapHit = false;
  outer: for (let d = 1; d <= depth; d++) {
    const next: string[] = [];
    for (const f of frontier) {
      for (const caller of rev.get(f) || []) {
        if (!visited.has(caller)) {
          visited.set(caller, d);
          next.push(caller);
          if (visited.size >= MAX_VISITED) { visitCapHit = true; break outer; }
        }
      }
    }
    if (!next.length) break;
    frontier = next;
  }

  const directCallers: string[] = [];
  const transitiveCallers: { file: string; depth: number; layer: string }[] = [];
  for (const [f, d] of visited.entries()) {
    if (inGraph.includes(f)) continue;
    if (d === 1) directCallers.push(f);
    transitiveCallers.push({ file: f, depth: d, layer: layerByFile.get(f) || "Unknown" });
  }
  transitiveCallers.sort((a, b) => a.depth - b.depth || a.file.localeCompare(b.file));

  const layerHits: Record<string, number> = {};
  for (const f of [...inGraph, ...transitiveCallers.map((t) => t.file)]) {
    const L = layerByFile.get(f) || "Unknown";
    layerHits[L] = (layerHits[L] || 0) + 1;
  }

  const SENSITIVE_LAYERS = new Set(["Data", "Tools", "Safety", "API", "Personas", "Orchestration", "Delivery"]);
  const sensitiveTouched = Object.keys(layerHits).filter((L) => SENSITIVE_LAYERS.has(L));
  const riskNotes: string[] = [];
  if (sensitiveTouched.length) riskNotes.push(`Sensitive layers in blast radius: ${sensitiveTouched.join(", ")} — review tenant-isolation, AHB safety, TOOL_POLICIES, deliverable-contract impact.`);
  if (transitiveCallers.length > 50) riskNotes.push(`Wide blast radius (${transitiveCallers.length} dependent files at depth ≤${depth}). Consider narrower change scope or run full e2e test.`);
  if (outOfGraph.length) riskNotes.push(`${outOfGraph.length} changed file(s) not in graph (configs/docs/scripts/non-TS) — no callers traced for these.`);
  if (visitCapHit) riskNotes.push(`Visit cap (${MAX_VISITED}) reached during BFS — blast radius is at least this large; results truncated. Narrow the change scope or lower depth.`);

  return {
    graphGeneratedAt: graph.generatedAt,
    depth,
    changedFiles: changed,
    changedInGraph: inGraph,
    changedOutOfGraph: outOfGraph,
    directCallers: directCallers.sort(),
    directCallerCount: directCallers.length,
    transitiveCallers: transitiveCallers.slice(0, 200),
    transitiveCallerCount: transitiveCallers.length,
    layersAffected: layerHits,
    riskNotes,
  };
}
