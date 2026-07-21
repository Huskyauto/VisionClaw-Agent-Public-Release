#!/usr/bin/env npx tsx
/**
 * preflight-file-girth — the "smoke alarm" for god-files.
 *
 * WHY THIS EXISTS: `server/tools.ts` silently grew to 20,903 lines before anyone
 * noticed, and unwinding it (the tools-layer-split strangler-fig) cost weeks of
 * agent time + real money. There was no automatic mechanism to catch a file
 * growing toward god-file status while a split was still cheap. This gate is that
 * mechanism. It fails CI when a source file crosses a per-file line ceiling, so
 * the NEXT tools.ts gets caught at ~2,000 lines (a 10-minute split) instead of at
 * 20,000 (a multi-week campaign).
 *
 * RATCHET SEMANTICS (the important part):
 *   - Files already over `defaultMaxLines` are GRANDFATHERED in
 *     data/preflight-file-girth.json at their CURRENT size (run --grandfather).
 *   - A grandfathered ceiling can only ever go DOWN. On every normal run, if a
 *     tracked file has SHRUNK, its ceiling is lowered to the new size and the
 *     config is rewritten. So progress is locked in: tools.ts can shrink toward
 *     zero but can NEVER bounce back up, and no other big file can regrow.
 *   - Any file (tracked or not) that EXCEEDS its ceiling → VIOLATION → exit 1.
 *   - Any UNTRACKED file over `defaultMaxLines` → VIOLATION (a new god-file is
 *     forming). Fix by splitting it, or accept it deliberately via --grandfather
 *     (which stamps its current size and reminds you to leave a justification).
 *
 * FAIL-CLOSED on real violations (that is the whole point); exit non-zero with a
 * clear stderr message on internal error. Zero deps, no LLM, no DB, $0.
 *
 * Usage:
 *   npx tsx scripts/preflight-file-girth.ts              # check + auto-ratchet-down
 *   npx tsx scripts/preflight-file-girth.ts --no-write   # check only, never rewrite config
 *   npx tsx scripts/preflight-file-girth.ts --grandfather # stamp all current over-cap files
 *   npx tsx scripts/preflight-file-girth.ts --json       # machine-readable summary
 *
 * Exit codes: 0 = clean (green, possibly ratcheted down); 1 = violation(s); 2 = internal error.
 */

import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, relative, sep } from "node:path";

const ROOT = process.cwd();
const CONFIG_PATH = join(ROOT, "data", "preflight-file-girth.json");

interface GirthConfig {
  defaultMaxLines: number;
  warnAtLines: number;
  scan: string[];
  exts: string[];
  ignore: string[];
  /** Per-file line ceilings (grandfathered; ratchet DOWN only). */
  ceilings: Record<string, number>;
}

const DEFAULT_CONFIG: GirthConfig = {
  defaultMaxLines: 2000,
  warnAtLines: 1500,
  scan: ["server", "client/src", "shared", "scripts"],
  exts: [".ts", ".tsx"],
  ignore: ["\\.test\\.ts$", "\\.d\\.ts$", "\\bnode_modules\\b", "\\bdist\\b"],
  ceilings: {},
};

function loadConfig(): GirthConfig {
  if (!existsSync(CONFIG_PATH)) return { ...DEFAULT_CONFIG };
  try {
    const raw = JSON.parse(readFileSync(CONFIG_PATH, "utf8"));
    return { ...DEFAULT_CONFIG, ...raw, ceilings: raw.ceilings ?? {} };
  } catch (e: any) {
    console.error(`[girth] FATAL: cannot parse ${CONFIG_PATH}: ${e?.message ?? e}`);
    process.exit(2);
  }
}

function writeConfig(cfg: GirthConfig): void {
  // Stable key order so diffs are minimal.
  const ordered: Record<string, number> = {};
  for (const k of Object.keys(cfg.ceilings).sort()) ordered[k] = cfg.ceilings[k];
  const out = { ...cfg, ceilings: ordered };
  writeFileSync(CONFIG_PATH, JSON.stringify(out, null, 2) + "\n");
}

function countLines(abs: string): number {
  // Line count = number of newline-separated records (matches `wc -l` + trailing).
  const buf = readFileSync(abs);
  let n = 0;
  for (let i = 0; i < buf.length; i++) if (buf[i] === 0x0a) n++;
  // Count a final non-empty line with no trailing newline.
  if (buf.length > 0 && buf[buf.length - 1] !== 0x0a) n++;
  return n;
}

function walk(dirRel: string, ignoreRes: RegExp[], exts: string[], out: string[]): void {
  const abs = join(ROOT, dirRel);
  if (!existsSync(abs)) return;
  let entries: string[];
  try {
    entries = readdirSync(abs);
  } catch {
    return;
  }
  for (const name of entries) {
    const childAbs = join(abs, name);
    const rel = relative(ROOT, childAbs).split(sep).join("/");
    if (ignoreRes.some((re) => re.test(rel))) continue;
    let st;
    try {
      st = statSync(childAbs);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      walk(rel, ignoreRes, exts, out);
    } else if (exts.some((e) => rel.endsWith(e))) {
      out.push(rel);
    }
  }
}

interface FileRow {
  rel: string;
  lines: number;
  ceiling: number; // effective allowed max
  tracked: boolean;
}

function main(): void {
  const args = new Set(process.argv.slice(2));
  const jsonOut = args.has("--json");
  const grandfather = args.has("--grandfather");
  const noWrite = args.has("--no-write");

  const cfg = loadConfig();
  const ignoreRes = cfg.ignore.map((p) => new RegExp(p));

  const files: string[] = [];
  for (const dir of cfg.scan) walk(dir, ignoreRes, cfg.exts, files);
  // Always evaluate any explicitly-tracked file even if outside scan dirs.
  for (const rel of Object.keys(cfg.ceilings)) if (!files.includes(rel)) files.push(rel);

  const rows: FileRow[] = [];
  for (const rel of files) {
    const abs = join(ROOT, rel);
    if (!existsSync(abs)) continue; // a tracked file was deleted — drop it silently on ratchet
    const lines = countLines(abs);
    const tracked = Object.prototype.hasOwnProperty.call(cfg.ceilings, rel);
    const ceiling = tracked ? cfg.ceilings[rel] : cfg.defaultMaxLines;
    rows.push({ rel, lines, ceiling, tracked });
  }

  const violations: string[] = [];
  const warnings: string[] = [];
  const tightened: string[] = [];
  const grandfathered: string[] = [];

  for (const r of rows) {
    if (grandfather && !r.tracked && r.lines > cfg.defaultMaxLines) {
      cfg.ceilings[r.rel] = r.lines;
      grandfathered.push(`${r.rel} @ ${r.lines}`);
      continue;
    }
    if (r.lines > r.ceiling) {
      if (r.tracked) {
        violations.push(
          `${r.rel}: ${r.lines} lines > grandfathered ceiling ${r.ceiling} — this file GREW. Split it back down (strangler-fig); ceilings only ratchet DOWN.`,
        );
      } else {
        violations.push(
          `${r.rel}: ${r.lines} lines > default cap ${cfg.defaultMaxLines} — a NEW god-file is forming. Split it now (cheap today) or accept deliberately via --grandfather + a justification comment.`,
        );
      }
      continue;
    }
    // Ratchet DOWN: a tracked file that shrank locks in the smaller size.
    if (r.tracked && r.lines < r.ceiling) {
      cfg.ceilings[r.rel] = r.lines;
      tightened.push(`${r.rel}: ${r.ceiling} → ${r.lines}`);
    }
    // Approaching-cap warning (untracked files nearing the default).
    if (!r.tracked && r.lines >= cfg.warnAtLines) {
      warnings.push(`${r.rel}: ${r.lines} lines (approaching ${cfg.defaultMaxLines}-line cap)`);
    }
  }

  const changed = tightened.length > 0 || grandfathered.length > 0;
  if (changed && !noWrite) writeConfig(cfg);

  if (jsonOut) {
    console.log(
      JSON.stringify(
        {
          ok: violations.length === 0,
          scanned: rows.length,
          defaultMaxLines: cfg.defaultMaxLines,
          violations,
          warnings,
          tightened,
          grandfathered,
          top: [...rows].sort((a, b) => b.lines - a.lines).slice(0, 10).map((r) => ({ rel: r.rel, lines: r.lines, ceiling: r.ceiling })),
        },
        null,
        2,
      ),
    );
  } else {
    if (grandfathered.length) {
      console.log(`[girth] grandfathered ${grandfathered.length} file(s) at current size:`);
      for (const g of grandfathered) console.log(`   + ${g}`);
    }
    if (tightened.length) {
      console.log(`[girth] ratcheted DOWN ${tightened.length} ceiling(s) (locked-in progress):`);
      for (const t of tightened) console.log(`   ↓ ${t}`);
    }
    if (warnings.length) {
      console.log(`[girth] ⚠ ${warnings.length} untracked file(s) approaching the ${cfg.defaultMaxLines}-line cap:`);
      for (const w of warnings) console.log(`   ~ ${w}`);
    }
    if (violations.length) {
      console.error(`[girth] ✗ ${violations.length} VIOLATION(S):`);
      for (const v of violations) console.error(`   ✗ ${v}`);
      console.error(`[girth] See .agents/skills/module-girth-guard/SKILL.md for the safe-split playbook.`);
    } else {
      console.log(`[girth] ✓ CLEAN — ${rows.length} files scanned, no file over its ceiling.`);
    }
  }

  process.exit(violations.length > 0 ? 1 : 0);
}

try {
  main();
} catch (e: any) {
  console.error(`[girth] FATAL: ${e?.stack ?? e}`);
  process.exit(2);
}
