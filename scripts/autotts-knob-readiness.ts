/**
 * AutoTTS knob-readiness registry.
 * Paper: "LLMs Improving LLMs: Agentic Discovery for Test-Time Scaling"
 *        (Zheng et al. 2026, arXiv:2605.08083v2).
 *
 * The paper's discovery method only works when the offline replay environment
 * actually contains (a) VARIATION in the knob's feature and (b) an independent
 * OUTCOME label. That precondition — not the search — is the hard part.
 *
 * This script is the operational gate: it probes every VisionClaw allocation knob
 * we might want to discover and reports which ones are discoverable from current
 * traces vs. blocked (and why). Run it periodically; as traces accrue, knobs flip
 * from BLOCKED → DISCOVERABLE and become candidates for the discovery sweep.
 *
 * Block reasons are honestly derived: data-derived blocks (constant feature, too
 * few positives, empty corpus) come from the corpus itself via assessReadiness;
 * STRUCTURAL blocks (the trace schema has no usable feature/label at all) are
 * declared on the probe and reported as such — never faked by ignoring a query.
 *
 * It mutates nothing, queries read-only, and is $0. Exit 0 always (status report);
 * exit 3 only on its own runtime error.
 *
 * ENV
 *   AUTOTTS_MIN_POS   min positive labels to call a knob discoverable (def 10)
 *   AUTOTTS_OUT       report path (def data/autotts-spike/readiness-<date>.md)
 */

import * as fs from "fs";
import * as path from "path";
import { execFileSync } from "child_process";
import { pathToFileURL } from "node:url";
import { assessReadiness, type KnobRow, type KnobReadiness } from "./lib/autotts-discovery";

const MIN_POS = numEnv("AUTOTTS_MIN_POS", 10);
const OUT_DIR = path.resolve(process.cwd(), "data", "autotts-spike");
const OUT_FILE =
  process.env.AUTOTTS_OUT ||
  path.join(OUT_DIR, `readiness-${new Date().toISOString().slice(0, 10)}.md`);

function numEnv(key: string, def: number): number {
  const raw = process.env[key];
  if (!raw) return def;
  const n = Number(raw);
  return Number.isFinite(n) ? n : def;
}

interface KnobProbe {
  id: string;
  title: string;
  /** Which test-time-scaling allocation decision from the paper this maps to. */
  paperKnob: string;
  featureName: string;
  labelName: string;
  /**
   * Static structural block: the trace schema cannot yield feature+label rows at
   * all (no outcome column logged), so the knob is un-discoverable regardless of
   * how many rows accrue. When set, `load` is not called.
   */
  structuralBlock?: string;
  /** Returns replay rows, or null if the corpus is inaccessible (≠ empty). */
  load?: () => KnobRow[] | null;
}

/** Run a read-only psql query, return split rows, or null on any failure. */
function psql(sql: string): string[][] | null {
  const url = process.env.DATABASE_URL;
  if (!url) return null;
  try {
    const out = execFileSync("psql", [url, "-t", "-A", "-F", "|", "-c", sql], {
      encoding: "utf8",
      timeout: 15000,
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    if (!out) return [];
    return out.split("\n").map((line) => line.split("|"));
  } catch {
    return null;
  }
}

const PROBES: KnobProbe[] = [
  {
    id: "kappa-escalation",
    title: "ensemble_query κ escalate-to-HITL threshold",
    paperKnob: "stopping / verification trigger (when to spend a human review)",
    featureName: "κ (embedding concordance of proposer answers)",
    labelName: "non-unanimous jury vote (real dissent)",
    load: () => {
      const corpus = path.resolve(process.cwd(), "data", "jury-decisions", "queue.json");
      if (!fs.existsSync(corpus)) return [];
      let parsed: any;
      try {
        parsed = JSON.parse(fs.readFileSync(corpus, "utf8"));
      } catch {
        return null;
      }
      const arr: any[] = Array.isArray(parsed) ? parsed : [];
      const rows: KnobRow[] = [];
      for (const x of arr) {
        if (typeof x?.concordance !== "number") continue;
        if (!Array.isArray(x?.votes) || x.votes.length === 0) continue;
        const counts: Record<string, number> = {};
        for (const v of x.votes) {
          const verdict = String(v?.verdict ?? "?").toUpperCase();
          counts[verdict] = (counts[verdict] || 0) + 1;
        }
        rows.push({ feature: x.concordance, label: Math.max(...Object.values(counts)) < x.votes.length });
      }
      return rows;
    },
  },
  {
    id: "proposer-count",
    title: "ensemble_query proposer (sample/branch) count",
    paperKnob: "sample/branch budget (how many parallel generations to spend)",
    featureName: "proposer_count",
    labelName: "a proposer failed (success_count < count)",
    // Data-derived: the schema HAS both columns, so let the corpus decide. (Today
    // proposer_count is constant ⇒ assessReadiness returns a constant-feature block.)
    load: () => {
      const r = psql(
        "SELECT proposer_count, (proposer_success_count < proposer_count) FROM moa_responses WHERE concordance IS NOT NULL;",
      );
      if (r === null) return null;
      return r
        .filter((c) => c.length >= 2)
        .map((c) => ({ feature: Number(c[0]), label: c[1] === "t" }));
    },
  },
  {
    id: "plan-replay-similarity",
    title: "plan_replay_cache reuse similarity cutoff",
    paperKnob: "compute reuse (skip the planner LLM when a cached plan is close enough)",
    featureName: "objective embedding cosine similarity to nearest cached plan",
    labelName: "replayed plan succeeded",
    // Structural: plan_replay_cache logs plans + hit_count but NO per-replay
    // success/failure outcome, so no {feature,label} row can be built regardless of
    // row count. Unblocking requires schema work (log a replay outcome), not data.
    structuralBlock:
      "plan_replay_cache has no per-replay outcome column — a success/failure label must be logged before any replay is possible",
  },
];

export interface ProbeResult {
  probe: KnobProbe;
  readiness: KnobReadiness | null; // null ⇒ inaccessible (only when no structuralBlock)
  structuralBlock?: string;
}

export function statusOf(r: ProbeResult): string {
  if (r.structuralBlock) return `🔴 BLOCKED (structural) — ${r.structuralBlock}`;
  if (r.readiness === null) return "⚪ corpus inaccessible (DB unreachable)";
  return r.readiness.discoverable ? "🟢 DISCOVERABLE" : `🔴 BLOCKED — ${r.readiness.blockReason}`;
}

/**
 * Probe every registered knob and return its readiness. Pure (read-only psql +
 * file reads, no writes, no process.exit) so callers like the weekly-maintenance
 * Pass 10 can consume the results directly instead of parsing the CLI's markdown.
 */
export function runReadinessProbes(opts: { minPos?: number } = {}): ProbeResult[] {
  const minPos = opts.minPos ?? MIN_POS;
  const results: ProbeResult[] = [];
  for (const probe of PROBES) {
    if (probe.structuralBlock) {
      results.push({ probe, readiness: null, structuralBlock: probe.structuralBlock });
      continue;
    }
    let rows: KnobRow[] | null;
    try {
      rows = probe.load ? probe.load() : null;
    } catch {
      rows = null;
    }
    results.push({ probe, readiness: rows === null ? null : assessReadiness(rows, { minPos }) });
  }
  return results;
}

function main() {
  const results = runReadinessProbes();

  const lines: string[] = [];
  lines.push(`# AutoTTS knob-readiness registry`);
  lines.push("");
  lines.push(`_Generated ${new Date().toISOString()} · arXiv:2605.08083v2 · read-only, $0_`);
  lines.push("");
  lines.push(
    `The discovery method (\`scripts/autotts-kappa-discovery.ts\` + \`scripts/lib/autotts-discovery.ts\`) needs a replay corpus with **variation in the knob's feature** AND an **independent outcome label**. This table reports which knobs clear that bar today.`,
  );
  lines.push("");
  lines.push(`| Knob | Paper allocation decision | rows | positives | feature varies? | status |`);
  lines.push(`|---|---|---|---|---|---|`);
  for (const r of results) {
    const rows = r.structuralBlock || r.readiness === null ? "—" : String(r.readiness.nRows);
    const pos = r.structuralBlock || r.readiness === null ? "—" : String(r.readiness.nPos);
    const varies = r.structuralBlock || r.readiness === null ? "—" : r.readiness.hasFeatureVariation ? "yes" : "no";
    lines.push(`| ${r.probe.title} | ${r.probe.paperKnob} | ${rows} | ${pos} | ${varies} | ${statusOf(r)} |`);
  }
  lines.push("");
  lines.push(`## Per-knob detail`);
  for (const r of results) {
    lines.push("");
    lines.push(`### ${r.probe.title}`);
    lines.push(`- Feature: ${r.probe.featureName}`);
    lines.push(`- Label: ${r.probe.labelName}`);
    lines.push(`- Status: ${statusOf(r)}`);
    if (!r.structuralBlock && r.readiness?.discoverable) {
      lines.push(`  Run the discovery sweep — ${r.readiness.nPos} positives over ${r.readiness.nRows} rows.`);
    }
  }
  lines.push("");
  lines.push(
    `_Re-run as traces accrue. A data-derived block flips 🔴→🟢 only when its corpus gains both feature variation and a populated outcome label; a STRUCTURAL block needs schema work first. That is the paper's "environment design is the hard part" precondition, made measurable._`,
  );

  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(OUT_FILE, lines.join("\n") + "\n");

  // stdout summary
  for (const r of results) console.log(`[autotts-readiness] ${r.probe.id}: ${statusOf(r)}`);
  console.log(`[autotts-readiness] report → ${path.relative(process.cwd(), OUT_FILE)}`);
  process.exit(0);
}

// Only run as a CLI. Importing this module (e.g. from weekly-maintenance Pass 10)
// must NOT execute main() or call process.exit — callers use runReadinessProbes().
const isCliMain = (() => {
  try {
    return import.meta.url === pathToFileURL(process.argv[1] || "").href;
  } catch {
    return false;
  }
})();

if (isCliMain) {
  try {
    main();
  } catch (e) {
    process.stderr.write(`[autotts-readiness] FATAL: ${(e as Error).stack || String(e)}\n`);
    process.exit(3);
  }
}
