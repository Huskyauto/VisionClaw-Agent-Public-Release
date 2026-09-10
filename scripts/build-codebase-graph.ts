#!/usr/bin/env tsx
import { promises as fs } from "fs";
import path from "path";

const ROOT = process.cwd();
const ROOTS = ["server", "client/src", "shared", "scripts"];
const SKIP_DIRS = new Set(["node_modules", "dist", "build", ".local", ".git", "attached_assets", "project-assets", "project-transcripts", "data", "uploads", "compaction-archives"]);
const EXTS = [".ts", ".tsx"];

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
  let entries: any[];
  try { entries = await fs.readdir(dir, { withFileTypes: true }); } catch { return; }
  for (const ent of entries) {
    if (SKIP_DIRS.has(ent.name) || ent.name.startsWith(".")) continue;
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) await walk(full, out);
    else if (ent.isFile() && EXTS.some((e) => ent.name.endsWith(e)) && !ent.name.endsWith(".d.ts")) out.push(full);
  }
}

const IMPORT_RE = /(?:^|\n)\s*(?:import\s+(?:[^'"]*?\s+from\s+)?|export\s+(?:\*|\{[^}]*\})\s+from\s+|import\s*\(\s*)\s*['"]([^'"]+)['"]/g;
const EXPORT_RE = /(?:^|\n)export\s+(?:default\s+)?(?:async\s+)?(?:function|class|const|let|var|interface|type|enum)\s+([A-Za-z_$][\w$]*)/g;
const EXPORT_DEFAULT_RE = /(?:^|\n)export\s+default\s+(?:async\s+function\s+([A-Za-z_$][\w$]*)|class\s+([A-Za-z_$][\w$]*))/g;

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

async function existsAsFile(p: string): Promise<string | null> {
  for (const ext of ["", ".ts", ".tsx", "/index.ts", "/index.tsx"]) {
    const candidate = p + ext;
    try {
      const st = await fs.stat(candidate);
      if (st.isFile()) return candidate;
    } catch {}
  }
  return null;
}

async function buildGraph() {
  const allFiles: string[] = [];
  for (const r of ROOTS) await walk(path.join(ROOT, r), allFiles);

  const fileToId = new Map<string, string>();
  const nodes: Node[] = [];
  const filesContent = new Map<string, string>();
  const layerCounts: Record<string, number> = {};

  for (const abs of allFiles) {
    const rel = path.relative(ROOT, abs).replace(/\\/g, "/");
    let body = "";
    try { body = await fs.readFile(abs, "utf8"); } catch { continue; }
    filesContent.set(abs, body);
    const exportsSet = new Set<string>();
    let m: RegExpExecArray | null;
    EXPORT_RE.lastIndex = 0;
    while ((m = EXPORT_RE.exec(body))) exportsSet.add(m[1]);
    EXPORT_DEFAULT_RE.lastIndex = 0;
    while ((m = EXPORT_DEFAULT_RE.exec(body))) exportsSet.add(m[1] || m[2] || "default");
    if (/(?:^|\n)export\s+default\s+/.test(body) && exportsSet.size === 0) exportsSet.add("default");
    const layer = classifyLayer(rel);
    layerCounts[layer] = (layerCounts[layer] || 0) + 1;
    const node: Node = {
      id: rel,
      path: rel,
      layer,
      exports: [...exportsSet].sort(),
      importsCount: 0,
      lineCount: body.split("\n").length,
      bytes: Buffer.byteLength(body, "utf8"),
    };
    nodes.push(node);
    fileToId.set(abs, rel);
  }

  const edges: Edge[] = [];
  const seen = new Set<string>();
  const externalImports = new Map<string, number>();

  for (const abs of allFiles) {
    const body = filesContent.get(abs) || "";
    const rel = path.relative(ROOT, abs).replace(/\\/g, "/");
    const node = nodes.find((n) => n.id === rel)!;
    let m: RegExpExecArray | null;
    IMPORT_RE.lastIndex = 0;
    while ((m = IMPORT_RE.exec(body))) {
      const spec = m[1];
      node.importsCount++;
      const candidate = resolveSpecifier(spec, abs);
      if (!candidate) {
        const pkg = spec.split("/")[0].startsWith("@") ? spec.split("/").slice(0, 2).join("/") : spec.split("/")[0];
        externalImports.set(pkg, (externalImports.get(pkg) || 0) + 1);
        continue;
      }
      const resolved = await existsAsFile(candidate);
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
  await fs.mkdir(path.join(ROOT, "data"), { recursive: true });
  const outPath = path.join(ROOT, "data", "codebase-graph.json");
  await fs.writeFile(outPath, JSON.stringify(out, null, 2));
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
