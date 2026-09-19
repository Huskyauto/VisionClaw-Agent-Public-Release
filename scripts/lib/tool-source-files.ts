/**
 * Tool source-file union — the ONE place that knows where tool definitions
 * and handlers live on disk during (and after) the tools-layer split.
 *
 * Contract: data/feature-contracts/tools-layer-split/ (slice S1).
 *
 * Every script that statically parses `server/tools.ts` as TEXT (smoke-test,
 * wiring audit schema-pairs, public-docs generator, pre-deploy check, policy
 * backfill) MUST source its text through this helper so that definitions
 * migrated into `server/tools/domains/**` remain visible to the parsers.
 *
 * Rules:
 *  - `server/tools.ts` is always FIRST in the list (legacy monolith / facade).
 *  - `server/tools/domains/** /*.ts` are included recursively, sorted, so
 *    output is deterministic.
 *  - `server/tools/example-tool.ts` (template, not live) and any non-domain
 *    files under server/tools/ are deliberately NOT included — only the
 *    domains/ tree carries live definitions.
 */
import * as fs from "node:fs";
import * as path from "node:path";

const ROOT = process.cwd();
const LEGACY = path.join(ROOT, "server", "tools.ts");
const DOMAINS_DIR = path.join(ROOT, "server", "tools", "domains");

/** Recursively collect .ts files under a dir (sorted, deterministic). */
function collectTs(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...collectTs(full));
    else if (entry.isFile() && entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts")) out.push(full);
  }
  return out;
}

/**
 * Absolute paths of every file that may carry tool definitions/handlers.
 * `server/tools.ts` first, then sorted `server/tools/domains/**` files.
 */
export function getToolSourceFiles(): string[] {
  const files: string[] = [];
  if (fs.existsSync(LEGACY)) files.push(LEGACY);
  files.push(...collectTs(DOMAINS_DIR));
  return files;
}

/**
 * All tool-source text concatenated (with file markers) — drop-in replacement
 * for `fs.readFileSync("server/tools.ts")` in regex-based consumers.
 */
export function readToolSourcesConcatenated(): string {
  return getToolSourceFiles()
    .map((f) => `// ===== FILE: ${path.relative(ROOT, f)} =====\n${fs.readFileSync(f, "utf8")}`)
    .join("\n");
}

/**
 * Statically extract tool names from the OpenAI function-calling envelope
 * (`function: { name: "..." }`) across the whole source union. Also reports
 * names defined in MORE THAN ONE file — a duplicate means a definition was
 * copied into a domain file without being removed from the monolith
 * (a half-finished migration slice) and must fail the parity test.
 */
export function extractToolNamesStatic(): { names: string[]; duplicates: string[]; byFile: Map<string, string[]> } {
  const re = /function:\s*\{\s*name:\s*"([a-z][a-z0-9_]*)"/g;
  const firstSeenIn = new Map<string, string>();
  const duplicates = new Set<string>();
  const byFile = new Map<string, string[]>();
  for (const file of getToolSourceFiles()) {
    const rel = path.relative(ROOT, file);
    const src = fs.readFileSync(file, "utf8");
    const names: string[] = [];
    let m: RegExpExecArray | null;
    re.lastIndex = 0;
    while ((m = re.exec(src))) {
      const name = m[1];
      names.push(name);
      const prev = firstSeenIn.get(name);
      if (prev && prev !== rel) duplicates.add(name);
      else if (prev === rel) duplicates.add(name); // dup within one file is also a defect
      else firstSeenIn.set(name, rel);
    }
    byFile.set(rel, names);
  }
  return { names: [...firstSeenIn.keys()].sort(), duplicates: [...duplicates].sort(), byFile };
}
