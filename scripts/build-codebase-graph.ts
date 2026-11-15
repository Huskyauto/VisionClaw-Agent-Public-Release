#!/usr/bin/env tsx
import { promises as fs } from "fs";
import { constants } from "node:fs";
import { randomUUID } from "node:crypto";
import path from "path";
import { analyzeSource } from "./lib/codebase-source-parser";

const ROOT = process.cwd();
const ROOTS = ["server", "client/src", "shared", "scripts"];
const SKIP_DIRS = new Set(["node_modules", "dist", "build", ".local", ".git", "attached_assets", "project-assets", "project-transcripts", "data", "uploads", "compaction-archives"]);
const EXTS = [".ts", ".tsx"];
const MAX_FILES = 20_000;
const MAX_SOURCE_BYTES = 4 * 1024 * 1024;
const MAX_TOTAL_BYTES = 256 * 1024 * 1024;

const ALIAS: Record<string, string> = {
  "@/": "client/src/",
  "@shared/": "shared/",
  "@assets/": "attached_assets/",
};

type Node = {
  id: string;
  path: string;
  layer: string;
  exports: string[];
  importsCount: number;
  lineCount: number;
  bytes: number;
};
type Edge = { from: string; to: string };

function classifyLayer(rel: string): string {
  const p = rel.replace(/\\/g, "/");
  if (p === "shared/schema.ts" || p === "server/storage.ts" || p === "server/db.ts" || p.startsWith("shared/models/")) return "Data";
  if (p === "server/tools.ts" || p.startsWith("server/tools/") || p === "server/tool-registry.ts" || p.startsWith("server/tool-curator")) return "Tools";
  if (p.startsWith("server/safety/")) return "Safety";
  if (p.startsWith("server/routes/") || p === "server/routes.ts") return "API";
  if (p.startsWith("server/lib/") || p.startsWith("server/services/")) return "Lib";
  if (p === "server/seed-persona-prompts.ts" || p === "server/persona-sync.ts" || p.startsWith("server/personas/")) return "Personas";
  if (p === "server/chat-engine.ts" || p === "server/orchestrator.ts" || p.startsWith("server/orchestrat")) return "Orchestration";
  if (p === "server/delivery-pipeline.ts" || p === "server/deliverable-contracts.ts" || p.startsWith("server/delivery")) return "Delivery";
  if (p.startsWith("server/heartbeat") || p === "server/heartbeat.ts") return "Heartbeat";
  if (p.startsWith("server/")) return "Server-Other";
  if (p.startsWith("client/src/components/ui/")) return "UI-Shadcn";
  if (p.startsWith("client/src/components/")) return "UI-Component";
  if (p.startsWith("client/src/pages/")) return "UI-Page";
  if (p.startsWith("client/src/hooks/")) return "UI-Hook";
  if (p.startsWith("client/src/lib/")) return "UI-Lib";
  if (p.startsWith("client/src/")) return "UI-Other";
  if (p.startsWith("shared/")) return "Shared";
  if (p.startsWith("scripts/")) return "Script";
  return "Other";
}

async function walk(dir: string, out: string[]): Promise<void> {
  if (await fs.realpath(dir) !== dir) throw new Error("Source directory must not be a symlink");
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const ent of entries) {
    if (SKIP_DIRS.has(ent.name) || ent.name.startsWith(".")) continue;
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) await walk(full, out);
    else if (ent.isFile() && EXTS.some((e) => ent.name.endsWith(e)) && !ent.name.endsWith(".d.ts")) {
      if (out.length >= MAX_FILES) throw new Error("Codebase graph file limit exceeded");
      out.push(full);
    }
  }
}

function resolveSpecifier(spec: string, fromFile: string): string | null {
  if (!spec || spec.startsWith("node:")) return null;
  let candidate: string | null = null;
  for (const [a, t] of Object.entries(ALIAS)) {
    if (spec.startsWith(a)) { candidate = path.join(ROOT, t + spec.slice(a.length)); break; }
  }
  if (!candidate) {
    if (spec.startsWith(".")) candidate = path.resolve(path.dirname(fromFile), spec);
    else return null;
  }
  return candidate;
}

function resolveInInventory(candidate: string, files: Map<string, string>): string | undefined {
  const base = candidate.replace(/\.jsx?$/, "");
  return [candidate, base + ".ts", base + ".tsx", candidate + "/index.ts", candidate + "/index.tsx"]
    .find(file => files.has(file));
}

async function readSource(file: string): Promise<string> {
  if (await fs.realpath(file) !== file) throw new Error("Source file must not traverse symlinks");
  const handle = await fs.open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > MAX_SOURCE_BYTES) throw new Error(`Source outside graph size/type bounds: ${path.relative(ROOT, file)}`);
    // Read at most the original size plus one byte; concurrent growth cannot
    // turn a bounded stat check into an unbounded readFile allocation.
    const buffer = Buffer.alloc(stat.size + 1);
    let offset = 0;
    while (offset < buffer.length) {
      const { bytesRead } = await handle.read(buffer, offset, buffer.length - offset, offset);
      if (!bytesRead) break;
      offset += bytesRead;
    }
    if (offset !== stat.size) throw new Error("Source changed while indexing; rebuild required");
    return buffer.subarray(0, offset).toString("utf8");
  } finally { await handle.close(); }
}

async function buildGraph() {
  const allFiles: string[] = [];
  for (const r of ROOTS) {
    const dir = path.join(ROOT, r);
    try { await fs.lstat(dir); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
      throw error;
    }
    await walk(dir, allFiles);
  }
  allFiles.sort();

  const fileToId = new Map(allFiles.map(abs => [abs, path.relative(ROOT, abs).replace(/\\/g, "/")]));
  const nodes: Node[] = [];
  const layerCounts: Record<string, number> = {};
  const edges: Edge[] = [];
  const seen = new Set<string>();
  const externalImports = new Map<string, number>();
  let totalBytes = 0;

  for (const abs of allFiles) {
    const rel = path.relative(ROOT, abs).replace(/\\/g, "/");
    const body = await readSource(abs);
    totalBytes += Buffer.byteLength(body, "utf8");
    if (totalBytes > MAX_TOTAL_BYTES) throw new Error("Codebase graph total source limit exceeded");
    const analysis = analyzeSource(abs, body);
    const layer = classifyLayer(rel);
    layerCounts[layer] = (layerCounts[layer] || 0) + 1;
    const node: Node = {
      id: rel,
      path: rel,
      layer,
      exports: analysis.exports,
      importsCount: analysis.imports.length,
      lineCount: body.split("\n").length,
      bytes: Buffer.byteLength(body, "utf8"),
    };
    nodes.push(node);
    for (const spec of analysis.imports) {
      const candidate = resolveSpecifier(spec, abs);
      if (!candidate) {
        const pkg = spec.split("/")[0].startsWith("@") ? spec.split("/").slice(0, 2).join("/") : spec.split("/")[0];
        externalImports.set(pkg, (externalImports.get(pkg) || 0) + 1);
        continue;
      }
      const resolved = resolveInInventory(candidate, fileToId);
      if (!resolved) continue;
      const toRel = path.relative(ROOT, resolved).replace(/\\/g, "/");
      if (toRel === rel) continue;
      const key = rel + "→" + toRel;
      if (seen.has(key)) continue;
      seen.add(key);
      edges.push({ from: rel, to: toRel });
    }
  }

  const inDeg = new Map<string, number>();
  for (const e of edges) inDeg.set(e.to, (inDeg.get(e.to) || 0) + 1);
  const hubs = [...inDeg.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20).map(([id, n]) => ({ id, fanIn: n }));
  const topExternal = [...externalImports.entries()].sort((a, b) => b[1] - a[1]).slice(0, 30).map(([pkg, n]) => ({ pkg, count: n }));

  const out = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    rootsScanned: ROOTS,
    fileCount: nodes.length,
    edgeCount: edges.length,
    layerCounts,
    hubs,
    topExternalDeps: topExternal,
    nodes: nodes.sort((a, b) => a.id.localeCompare(b.id)),
    edges: edges.sort((a, b) => (a.from + a.to).localeCompare(b.from + b.to)),
  };
  if (out.fileCount === 0) throw new Error("No source files found; refusing to replace graph");
  await fs.mkdir(path.join(ROOT, "data"), { recursive: true });
  if (await fs.realpath(path.join(ROOT, "data")) !== path.join(ROOT, "data"))
    throw new Error("Graph output directory must not be a symlink");
  const outPath = path.join(ROOT, "data", "codebase-graph.json");
  const temporary = `${outPath}.${randomUUID()}.tmp`;
  try {
    await fs.writeFile(temporary, JSON.stringify(out, null, 2), { flag: "wx", mode: 0o600 });
    await fs.rename(temporary, outPath);
  } finally { await fs.rm(temporary, { force: true }); }
  console.log(`[codebase-graph] wrote ${outPath}`);
  console.log(`  files=${out.fileCount} edges=${out.edgeCount} layers=${Object.keys(layerCounts).length}`);
  console.log(`  layer breakdown:`, layerCounts);
  console.log(`  top hubs (fan-in):`);
  for (const h of hubs.slice(0, 10)) console.log(`    ${h.fanIn.toString().padStart(4)}  ${h.id}`);
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  buildGraph().catch((e) => { console.error("[codebase-graph] FAILED:", e); process.exit(1); });
}

export { buildGraph };
