#!/usr/bin/env npx tsx
/**
 * preflight-any-budget — the ratchet gate for `any` sprawl.
 *
 * WHY THIS EXISTS: the Kimi-K3 external review (2026-07-17) flagged thousands of
 * `: any` / `as any` usages. A one-shot cleanup is a multi-week campaign; the
 * cheap, durable move (same shape as preflight-file-girth) is a BUDGET that can
 * only ever ratchet DOWN: today's count becomes the ceiling, any net increase
 * fails CI, and every cleanup locks in a lower ceiling automatically.
 *
 * SEMANTICS:
 *   - Counts occurrences of the configured patterns (`: any`, `as any`) across
 *     the scan dirs (comment/string false positives are counted consistently on
 *     both sides of the ratchet, so drift is still measured honestly).
 *   - Baseline lives in data/preflight-any-budget.json. If the current count is
 *     LOWER, the baseline is rewritten down (progress locked in). If HIGHER,
 *     exit 1 with the top offending files so the author knows where the new
 *     `any`s landed.
 *   - Small slack (`allowedSlack`, default 0) can absorb deliberate one-offs;
 *     keep it 0 unless a round consciously accepts new `any`s.
 *
 * FAIL-CLOSED on violation; exit 2 on internal error. Zero deps, no LLM, no DB, $0.
 *
 * Usage:
 *   npx tsx scripts/preflight-any-budget.ts             # check + auto-ratchet-down
 *   npx tsx scripts/preflight-any-budget.ts --no-write  # check only, never rewrite config
 *   npx tsx scripts/preflight-any-budget.ts --baseline  # stamp current count as the baseline
 *   npx tsx scripts/preflight-any-budget.ts --json      # machine-readable summary
 *
 * Exit codes: 0 = clean (possibly ratcheted down); 1 = over budget; 2 = internal error.
 */

import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, relative, sep } from "node:path";

const ROOT = process.cwd();
const CONFIG_PATH = join(ROOT, "data", "preflight-any-budget.json");

interface AnyBudgetConfig {
  /** Total allowed occurrences across the scan set. Ratchets DOWN only. */
  baseline: number;
  /** Extra headroom over baseline before failing (keep at 0). */
  allowedSlack: number;
  scan: string[];
  exts: string[];
  ignore: string[];
  /** Regex source strings counted per line (global). */
  patterns: string[];
  stampedAt?: string;
}

const DEFAULT_CONFIG: AnyBudgetConfig = {
  baseline: 0,
  allowedSlack: 0,
  scan: ["server", "client/src", "shared", "scripts"],
  exts: [".ts", ".tsx"],
  // The gate script itself is excluded: it necessarily contains the `any`
  // pattern literals + docs, which would otherwise self-inflate the count.
  ignore: ["\\.d\\.ts$", "\\bnode_modules\\b", "\\bdist\\b", "\\bpublic-mirror\\b", "scripts/preflight-any-budget\\.ts$"],
  patterns: [":\\s*any\\b", "\\bas any\\b"],
};

function loadConfig(): AnyBudgetConfig {
  if (!existsSync(CONFIG_PATH)) return { ...DEFAULT_CONFIG };
  try {
    const raw = JSON.parse(readFileSync(CONFIG_PATH, "utf8"));
    // Strict-ish: a mangled config must not silently become a permissive one.
    if (typeof raw.baseline !== "number" || !Array.isArray(raw.patterns) || raw.patterns.length === 0) {
      console.error(`[any-budget] FATAL: ${CONFIG_PATH} malformed (baseline/patterns) — refusing to run permissively`);
      process.exit(2);
    }
    return { ...DEFAULT_CONFIG, ...raw };
  } catch (e: any) {
    console.error(`[any-budget] FATAL: cannot parse ${CONFIG_PATH}: ${e?.message ?? e}`);
    process.exit(2);
  }
}

function writeConfig(cfg: AnyBudgetConfig): void {
  writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2) + "\n");
}

// Fail-closed scan accounting: any unreadable dir/file during traversal or
// counting is recorded here and forces exit 2 — a partial scan must never
// produce a false-green ratchet pass (architect finding, 2026-07-17).
const scanErrors: string[] = [];

function walk(dirRel: string, ignoreRes: RegExp[], exts: string[], out: string[]): void {
  const abs = join(ROOT, dirRel);
  if (!existsSync(abs)) return;
  let entries: string[];
  try {
    entries = readdirSync(abs);
  } catch (e: any) {
    scanErrors.push(`readdir ${dirRel}: ${e?.message ?? e}`);
    return;
  }
  for (const name of entries) {
    const childAbs = join(abs, name);
    const rel = relative(ROOT, childAbs).split(sep).join("/");
    if (ignoreRes.some((re) => re.test(rel))) continue;
    let st;
    try {
      st = statSync(childAbs);
    } catch (e: any) {
      scanErrors.push(`stat ${rel}: ${e?.message ?? e}`);
      continue;
    }
    if (st.isDirectory()) walk(rel, ignoreRes, exts, out);
    else if (exts.some((e) => rel.endsWith(e))) out.push(rel);
  }
}

function countInFile(abs: string, patterns: RegExp[]): number {
  let text: string;
  try {
    text = readFileSync(abs, "utf8");
  } catch (e: any) {
    scanErrors.push(`read ${relative(ROOT, abs)}: ${e?.message ?? e}`);
    return 0;
  }
  let n = 0;
  for (const re of patterns) {
    const m = text.match(re);
    if (m) n += m.length;
  }
  return n;
}

function main(): void {
  const args = new Set(process.argv.slice(2));
  const jsonOut = args.has("--json");
  const stampBaseline = args.has("--baseline");
  const noWrite = args.has("--no-write");

  const cfg = loadConfig();
  const ignoreRes = cfg.ignore.map((p) => new RegExp(p));
  const patterns = cfg.patterns.map((p) => new RegExp(p, "g"));

  const files: string[] = [];
  for (const dir of cfg.scan) walk(dir, ignoreRes, cfg.exts, files);

  const perFile: { rel: string; count: number }[] = [];
  let total = 0;
  for (const rel of files) {
    const c = countInFile(join(ROOT, rel), patterns);
    if (c > 0) perFile.push({ rel, count: c });
    total += c;
  }
  perFile.sort((a, b) => b.count - a.count);

  if (scanErrors.length > 0) {
    console.error(`[any-budget] ✗ FATAL: ${scanErrors.length} scan error(s) — partial scan cannot certify the budget (fail-closed):`);
    for (const err of scanErrors.slice(0, 20)) console.error(`   ✗ ${err}`);
    if (jsonOut) console.log(JSON.stringify({ ok: false, fatal: "scan-errors", scanErrors: scanErrors.slice(0, 20), total }, null, 2));
    process.exit(2);
  }

  if (stampBaseline) {
    cfg.baseline = total;
    cfg.stampedAt = new Date().toISOString().slice(0, 10);
    if (!noWrite) writeConfig(cfg);
    console.log(`[any-budget] baseline stamped at ${total} occurrence(s) across ${files.length} files`);
    process.exit(0);
  }

  const budget = cfg.baseline + cfg.allowedSlack;
  const over = total > budget;
  const prevBaseline = cfg.baseline;
  // `ratcheted` = below baseline (progress). Only persist the lower baseline
  // when writing is allowed; in --no-write mode leave cfg.baseline UNTOUCHED so
  // consumers (weekly-maintenance Pass 14) can still see total < baseline.
  const ratcheted = !over && total < prevBaseline;
  if (ratcheted && !noWrite) {
    cfg.baseline = total;
    cfg.stampedAt = new Date().toISOString().slice(0, 10);
    writeConfig(cfg);
  }

  if (jsonOut) {
    console.log(
      JSON.stringify(
        {
          ok: !over,
          total,
          baseline: prevBaseline,
          nextBaseline: ratcheted ? total : prevBaseline,
          allowedSlack: cfg.allowedSlack,
          ratcheted,
          top: perFile.slice(0, 15),
        },
        null,
        2,
      ),
    );
  } else {
    if (ratcheted) console.log(`[any-budget] ${noWrite ? "below baseline (would ratchet)" : "ratcheted DOWN"}: baseline ${prevBaseline} → ${total}`);
    if (over) {
      console.error(`[any-budget] ✗ OVER BUDGET: ${total} occurrence(s) > budget ${budget} (baseline ${cfg.baseline} + slack ${cfg.allowedSlack})`);
      console.error(`[any-budget] top offenders:`);
      for (const f of perFile.slice(0, 15)) console.error(`   ✗ ${f.rel}: ${f.count}`);
      console.error(`[any-budget] Fix: type the new code properly (preferred) or, for a deliberate accept, re-stamp with --baseline + justify in the round log.`);
    } else {
      console.log(`[any-budget] ✓ CLEAN — ${total} occurrence(s) ≤ budget ${budget} (${files.length} files scanned)`);
    }
  }

  process.exit(over ? 1 : 0);
}

try {
  main();
} catch (e: any) {
  console.error(`[any-budget] FATAL: ${e?.stack ?? e}`);
  process.exit(2);
}
