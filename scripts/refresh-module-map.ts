#!/usr/bin/env tsx
/**
 * scripts/refresh-module-map.ts — regenerates docs/MODULE_MAP.md, an
 * auto-generated linked module map of the source tree.
 *
 * Why this exists (Graft verdict, 2026-08-09): the one borrowable idea from
 * the Graft codebase-map tool was AUTO-GENERATION — a map derived from the
 * tree that cannot drift, complementing the curated docs (replit.md,
 * docs/architecture-notes.md). Agents and external reviewers read this to
 * orient in one file read instead of a directory crawl.
 *
 * What it computes (no DB, no network, read-only except the target doc):
 *   - per-directory module tables: file | lines | purpose (first header
 *     comment line, sanitized)
 *   - hub modules: the most-imported internal modules (fan-in), i.e. the
 *     files whose changes ripple widest
 *   - top-level directory summary with file/line totals
 *
 * Usage:
 *   npx tsx scripts/refresh-module-map.ts               # rewrite docs/MODULE_MAP.md
 *   npx tsx scripts/refresh-module-map.ts --check       # exit 1 if doc would change
 *   npx tsx scripts/refresh-module-map.ts --root <dir>  # scan + write inside <dir>
 *                                                       # (mirror build: run on the
 *                                                       # SANITIZED tree, never the
 *                                                       # private one — architect
 *                                                       # finding 2026-08-09)
 *
 * Exit 0 ok, 1 check-dirty, 2 hard failure.
 */
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join, dirname, resolve, relative, sep } from "node:path";

const DOC_PATH = "docs/MODULE_MAP.md";
const CHECK = process.argv.includes("--check");
const rootIdx = process.argv.indexOf("--root");
if (rootIdx !== -1) {
  const root = process.argv[rootIdx + 1];
  if (!root || !existsSync(root)) {
    console.error(`[module-map] --root ${root ?? "(missing)"} does not exist`);
    process.exit(2);
  }
  process.chdir(root);
}
const ROOTS = ["server", "client/src", "shared", "scripts"];
const MAX_FILES_PER_DIR = 40;
const HUB_COUNT = 25;

interface Mod {
  path: string;      // repo-relative, forward slashes
  dir: string;
  lines: number;
  purpose: string;
  imports: string[]; // resolved repo-relative internal import targets
}

function walk(dir: string, out: string[] = []): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const e of entries) {
    if (e === "node_modules" || e.startsWith(".")) continue;
    const p = join(dir, e);
    let st;
    try {
      st = statSync(p);
    } catch {
      continue;
    }
    if (st.isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(e) && !/\.d\.ts$/.test(e)) out.push(p);
  }
  return out;
}

/** First meaningful comment line near the top of the file, sanitized for a table cell. */
function extractPurpose(src: string, filePath: string): string {
  const head = src.split("\n").slice(0, 20);
  for (const raw of head) {
    const line = raw.trim();
    if (line.startsWith("#!")) continue;
    let text = "";
    if (line.startsWith("//")) text = line.replace(/^\/\/+\s?/, "");
    else if (line.startsWith("/*")) text = line.replace(/^\/\*+\s?/, "").replace(/\*+\/\s*$/, "");
    else if (line.startsWith("*") && !line.startsWith("*/")) text = line.replace(/^\*+\s?/, "");
    else if (text === "" && line !== "" && !line.startsWith("import") && !line.startsWith("export")) continue;
    text = text.trim();
    if (!text) continue;
    // Skip pure filename echoes like "scripts/foo.ts —" prefix but keep the tail.
    const base = filePath.replace(/\\/g, "/");
    if (text.startsWith(base)) text = text.slice(base.length).replace(/^\s*[—:-]\s*/, "");
    if (!text) continue;
    // Sanitize for markdown table.
    text = text.replace(/\|/g, "\\|").replace(/\s+/g, " ");
    if (text.length > 140) text = text.slice(0, 137) + "...";
    return text;
  }
  return "";
}

const IMPORT_RE = /(?:^|\n)\s*(?:import|export)\s[^;'"]*from\s+['"]([^'"]+)['"]|(?:^|\n)\s*import\s+['"]([^'"]+)['"]|await\s+import\(\s*['"]([^'"]+)['"]\s*\)/g;

function resolveImport(spec: string, fromFile: string, known: Set<string>): string | null {
  let target: string | null = null;
  if (spec.startsWith(".")) {
    target = relative(process.cwd(), resolve(dirname(fromFile), spec)).split(sep).join("/");
  } else if (spec.startsWith("@shared/")) {
    target = "shared/" + spec.slice("@shared/".length);
  } else if (spec.startsWith("@/")) {
    target = "client/src/" + spec.slice(2);
  } else {
    return null; // external package
  }
  for (const cand of [target, `${target}.ts`, `${target}.tsx`, `${target}/index.ts`, `${target}/index.tsx`]) {
    if (known.has(cand)) return cand;
  }
  return null;
}

function main() {
  const files = ROOTS.filter(existsSync).flatMap((r) => walk(r)).map((p) => p.split(sep).join("/")).sort();
  if (files.length === 0) {
    console.error("[module-map] found 0 source files — refusing to write an empty map");
    process.exit(2);
  }
  const known = new Set(files);
  const mods: Mod[] = [];
  for (const path of files) {
    let src = "";
    try {
      src = readFileSync(path, "utf8");
    } catch {
      continue;
    }
    const imports: string[] = [];
    for (const m of src.matchAll(IMPORT_RE)) {
      const spec = m[1] || m[2] || m[3];
      if (!spec) continue;
      const resolved = resolveImport(spec, path, known);
      if (resolved && resolved !== path) imports.push(resolved);
    }
    mods.push({
      path,
      dir: path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : ".",
      lines: src.split("\n").length,
      purpose: extractPurpose(src, path),
      imports,
    });
  }

  // Fan-in (how many distinct modules import each file).
  const fanIn = new Map<string, number>();
  for (const m of mods) {
    for (const t of new Set(m.imports)) fanIn.set(t, (fanIn.get(t) || 0) + 1);
  }
  const hubs = [...fanIn.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, HUB_COUNT);

  // Group by directory.
  const byDir = new Map<string, Mod[]>();
  for (const m of mods) {
    if (!byDir.has(m.dir)) byDir.set(m.dir, []);
    byDir.get(m.dir)!.push(m);
  }
  const dirs = [...byDir.keys()].sort();

  // Top-level summary.
  const topLevel = new Map<string, { files: number; lines: number }>();
  for (const m of mods) {
    const top = m.path.startsWith("client/src") ? "client/src" : m.path.split("/")[0];
    const cur = topLevel.get(top) || { files: 0, lines: 0 };
    cur.files += 1;
    cur.lines += m.lines;
    topLevel.set(top, cur);
  }

  const date = new Date().toISOString().slice(0, 10);
  const out: string[] = [];
  out.push(`<!-- AUTO-GENERATED by scripts/refresh-module-map.ts. Do NOT hand-edit — changes will be overwritten at every mirror build. -->`);
  out.push(`# Module Map`);
  out.push("");
  out.push(`> Auto-generated map of the source tree (last regenerated **${date}**; ${mods.length} modules). Read this first to orient — it cannot drift from the code because it IS derived from the code. Curated architecture intent lives in [\`docs/architecture-notes.md\`](architecture-notes.md); authoritative counts in [\`docs/CURRENT_PLATFORM_TOTALS.md\`](CURRENT_PLATFORM_TOTALS.md).`);
  out.push("");
  out.push(`## Top-level layout`);
  out.push("");
  out.push(`| Area | Modules | Lines |`);
  out.push(`| :--- | ---: | ---: |`);
  for (const [top, s] of [...topLevel.entries()].sort((a, b) => b[1].lines - a[1].lines)) {
    out.push(`| \`${top}/\` | ${s.files} | ${s.lines.toLocaleString()} |`);
  }
  out.push("");
  out.push(`## Hub modules (highest fan-in)`);
  out.push("");
  out.push(`Changes to these ripple widest — check importers before editing.`);
  out.push("");
  out.push(`| Module | Imported by |`);
  out.push(`| :--- | ---: |`);
  for (const [path, n] of hubs) out.push(`| [\`${path}\`](../${path}) | ${n} |`);
  out.push("");
  out.push(`## Directory index`);
  for (const dir of dirs) {
    const list = byDir.get(dir)!.sort((a, b) => b.lines - a.lines);
    const total = list.reduce((s, m) => s + m.lines, 0);
    out.push("");
    out.push(`### \`${dir}/\` — ${list.length} module(s), ${total.toLocaleString()} lines`);
    out.push("");
    out.push(`| Module | Lines | Purpose |`);
    out.push(`| :--- | ---: | :--- |`);
    for (const m of list.slice(0, MAX_FILES_PER_DIR)) {
      const name = m.path.slice(dir.length + 1);
      out.push(`| [\`${name}\`](../${m.path}) | ${m.lines.toLocaleString()} | ${m.purpose || "—"} |`);
    }
    if (list.length > MAX_FILES_PER_DIR) {
      out.push(`| _…and ${list.length - MAX_FILES_PER_DIR} more (smaller modules)_ | | |`);
    }
  }
  out.push("");
  const next = out.join("\n");

  const current = existsSync(DOC_PATH) ? readFileSync(DOC_PATH, "utf8") : "";
  // Normalize ONLY the generated regeneration-date field — a date appearing in
  // a purpose comment is real content and must fail --check when stale.
  const normalize = (s: string) => s.replace(/last regenerated \*\*\d{4}-\d{2}-\d{2}\*\*/g, "last regenerated **DATE**");
  if (CHECK) {
    if (normalize(current) !== normalize(next)) {
      console.error("[module-map] docs/MODULE_MAP.md is stale");
      process.exit(1);
    }
    console.log("[module-map] up to date");
    return;
  }
  writeFileSync(DOC_PATH, next);
  console.log(`[module-map] wrote ${DOC_PATH} (${mods.length} modules, ${dirs.length} dirs, top hub: ${hubs[0]?.[0]} ×${hubs[0]?.[1]})`);
}

main();
