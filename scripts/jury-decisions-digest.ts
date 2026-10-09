#!/usr/bin/env tsx
/**
 * jury-decisions-digest — read-only CLI that rolls up data/jury-decisions/queue.json
 * into a single review-friendly markdown digest at data/jury-decisions/DIGEST.md.
 *
 * Pure read on queue.json + the per-decision *.md files (timing + escalation pulled
 * from the markdown headers since queue.json doesn't carry latency). Writes one file.
 * No DB, no network, no env vars required.
 *
 * Usage:
 *   npx tsx scripts/jury-decisions-digest.ts
 *   npx tsx scripts/jury-decisions-digest.ts --since=2026-05-20
 *   npx tsx scripts/jury-decisions-digest.ts --verdict=FIX
 *   npx tsx scripts/jury-decisions-digest.ts --source=docs/architecture-notes
 *   npx tsx scripts/jury-decisions-digest.ts --out=/tmp/custom-digest.md
 *
 * Exit codes:
 *   0 — digest written
 *   1 — queue.json missing
 *   2 — queue.json parse error
 *   3 — write failure
 */
import * as fs from "fs";
import * as path from "path";

interface Vote {
  model: string;
  verdict: string;
  rationale: string;
}
interface QueueEntry {
  triagedAt: string;
  source: string;
  issueSlug: string;
  verdict: "FIX" | "ACCEPT" | "REJECT" | "ESCALATE" | string;
  majority: number;
  concordance: number;
  shouldEscalate: boolean;
  votes?: Vote[];
  fixProposal?: string;
}

const ARGS = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const m = a.match(/^--([^=]+)=(.*)$/);
    return m ? [m[1], m[2]] : [a.replace(/^--/, ""), "true"];
  }),
) as Record<string, string>;

const ROOT = path.join(process.cwd(), "data", "jury-decisions");
const QUEUE_PATH = path.join(ROOT, "queue.json");
const OUT_PATH = ARGS.out || path.join(ROOT, "DIGEST.md");

if (!fs.existsSync(QUEUE_PATH)) {
  console.error(`[digest] ERROR: ${QUEUE_PATH} not found — no jury decisions to digest`);
  process.exit(1);
}

let entries: QueueEntry[];
try {
  entries = JSON.parse(fs.readFileSync(QUEUE_PATH, "utf8"));
  if (!Array.isArray(entries)) throw new Error("queue.json is not an array");
} catch (e: any) {
  console.error(`[digest] ERROR: failed to parse queue.json: ${e?.message || e}`);
  process.exit(2);
}

if (ARGS.since) entries = entries.filter((e) => e.triagedAt >= ARGS.since);
if (ARGS.verdict) entries = entries.filter((e) => e.verdict === ARGS.verdict.toUpperCase());
if (ARGS.source) {
  // R125+3.7+sec — guard against malformed/expensive regex (architect LOW finding closure).
  // User-supplied --source pattern was compiled directly; a bad pattern crashed the CLI,
  // and a pathological one could hang it (ReDoS). Wrap compile in try/catch + graceful exit.
  let re: RegExp;
  try {
    re = new RegExp(ARGS.source, "i");
  } catch (err: any) {
    console.error(`[digest] --source regex failed to compile: ${err?.message || err}`);
    process.exit(2);
  }
  entries = entries.filter((e) => re.test(e.source || ""));
}

entries.sort((a, b) => (b.triagedAt || "").localeCompare(a.triagedAt || ""));

const total = entries.length;
const byVerdict: Record<string, number> = {};
const bySource: Record<string, number> = {};
const modelAgree: Record<string, { agreeWithMajority: number; total: number }> = {};
let escalateCount = 0;
let kappaSum = 0;
let kappaN = 0;

for (const e of entries) {
  byVerdict[e.verdict] = (byVerdict[e.verdict] || 0) + 1;
  const srcRoot = (e.source || "unknown").split(/[:#/]/)[0] || "unknown";
  bySource[srcRoot] = (bySource[srcRoot] || 0) + 1;
  if (e.shouldEscalate) escalateCount++;
  if (typeof e.concordance === "number" && !isNaN(e.concordance)) {
    kappaSum += e.concordance;
    kappaN++;
  }
  for (const v of e.votes || []) {
    if (!modelAgree[v.model]) modelAgree[v.model] = { agreeWithMajority: 0, total: 0 };
    modelAgree[v.model].total++;
    if (v.verdict === e.verdict) modelAgree[v.model].agreeWithMajority++;
  }
}

const avgKappa = kappaN > 0 ? kappaSum / kappaN : NaN;

// Pull latency from the per-decision .md headers (queue.json omits it).
function readLatencyMs(slug: string, triagedAt: string): number | null {
  const dateStr = triagedAt.slice(0, 10);
  const file = path.join(ROOT, `${dateStr}-${slug}.md`);
  if (!fs.existsSync(file)) return null;
  const head = fs.readFileSync(file, "utf8").slice(0, 600);
  const m = head.match(/\*\*Latency\*\*:\s*(\d+)ms/);
  return m ? parseInt(m[1], 10) : null;
}

const latencies: number[] = [];
for (const e of entries) {
  const lat = readLatencyMs(e.issueSlug, e.triagedAt);
  if (lat !== null) latencies.push(lat);
}
const avgLatency = latencies.length > 0 ? Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length) : null;
const maxLatency = latencies.length > 0 ? Math.max(...latencies) : null;

// Group entries by YYYY-MM-DD for the body.
const byDate: Record<string, QueueEntry[]> = {};
for (const e of entries) {
  const day = (e.triagedAt || "unknown").slice(0, 10);
  if (!byDate[day]) byDate[day] = [];
  byDate[day].push(e);
}
const days = Object.keys(byDate).sort().reverse();

function fmtPct(n: number, d: number): string {
  return d === 0 ? "—" : `${((n / d) * 100).toFixed(0)}%`;
}
function verdictBadge(v: string): string {
  switch (v) {
    case "FIX": return "🔧 FIX";
    case "ACCEPT": return "✅ ACCEPT";
    case "REJECT": return "❌ REJECT";
    case "ESCALATE": return "⚠️ ESCALATE";
    default: return v;
  }
}

let md = `# Jury Decisions Digest\n\n`;
md += `_Generated ${new Date().toISOString()} from \`data/jury-decisions/queue.json\` (${total} entr${total === 1 ? "y" : "ies"} after filters)._\n\n`;

const filters: string[] = [];
if (ARGS.since) filters.push(`since=${ARGS.since}`);
if (ARGS.verdict) filters.push(`verdict=${ARGS.verdict.toUpperCase()}`);
if (ARGS.source) filters.push(`source~${ARGS.source}`);
if (filters.length) md += `**Filters applied:** ${filters.join(", ")}\n\n`;

md += `## Summary\n\n`;
md += `| Metric | Value |\n| --- | --- |\n`;
md += `| Total decisions | ${total} |\n`;
for (const v of ["FIX", "ACCEPT", "REJECT", "ESCALATE"]) {
  if (byVerdict[v]) md += `| ${verdictBadge(v)} | ${byVerdict[v]} (${fmtPct(byVerdict[v], total)}) |\n`;
}
md += `| Escalated | ${escalateCount} (${fmtPct(escalateCount, total)}) |\n`;
md += `| Avg concordance κ | ${isNaN(avgKappa) ? "—" : avgKappa.toFixed(3)} |\n`;
if (avgLatency !== null) md += `| Avg latency | ${(avgLatency / 1000).toFixed(1)}s (max ${(maxLatency! / 1000).toFixed(1)}s) |\n`;
md += `\n`;

if (Object.keys(bySource).length > 0) {
  md += `### By source\n\n`;
  md += `| Source root | Count |\n| --- | --- |\n`;
  for (const [src, n] of Object.entries(bySource).sort((a, b) => b[1] - a[1])) {
    md += `| \`${src}\` | ${n} |\n`;
  }
  md += `\n`;
}

if (Object.keys(modelAgree).length > 0) {
  md += `### Model agreement with majority verdict\n\n`;
  md += `_How often each proposer's vote matched the final 2-of-3 majority. Outliers suggest a model is consistently in the dissent — useful signal for pool rotation._\n\n`;
  md += `| Model | Agreement | Votes |\n| --- | --- | --- |\n`;
  const rows = Object.entries(modelAgree).sort((a, b) => b[1].total - a[1].total);
  for (const [m, s] of rows) {
    md += `| \`${m}\` | ${fmtPct(s.agreeWithMajority, s.total)} | ${s.agreeWithMajority}/${s.total} |\n`;
  }
  md += `\n`;
}

md += `## Decisions by day\n\n`;
if (days.length === 0) {
  md += `_No decisions match the current filters._\n\n`;
}
for (const day of days) {
  md += `### ${day}  (${byDate[day].length})\n\n`;
  for (const e of byDate[day]) {
    const time = e.triagedAt.slice(11, 19);
    md += `- \`${time}Z\` ${verdictBadge(e.verdict)} (${e.majority}/3, κ=${e.concordance?.toFixed?.(3) ?? "—"}) — **${e.issueSlug}**\n`;
    md += `  - source: \`${e.source}\`\n`;
    const dateStr = e.triagedAt.slice(0, 10);
    const mdFile = `${dateStr}-${e.issueSlug}.md`;
    if (fs.existsSync(path.join(ROOT, mdFile))) {
      md += `  - detail: [\`${mdFile}\`](./${mdFile})\n`;
    }
    if (e.shouldEscalate) md += `  - ⚠️ **escalation flagged** — needs human review\n`;
    if (e.fixProposal && e.verdict === "FIX") {
      const first = e.fixProposal.split("\n").find((l) => l.trim().length > 0) || "";
      md += `  - fix proposal preview: ${first.slice(0, 160).replace(/`/g, "\\`")}${first.length > 160 ? "…" : ""}\n`;
    }
  }
  md += `\n`;
}

md += `---\n_Regenerate: \`npx tsx scripts/jury-decisions-digest.ts\`. Filters: \`--since=YYYY-MM-DD\`, \`--verdict=FIX|ACCEPT|REJECT|ESCALATE\`, \`--source=<regex>\`, \`--out=<path>\`._\n`;

try {
  fs.writeFileSync(OUT_PATH, md, "utf8");
  console.log(`[digest] ✓ wrote ${OUT_PATH} — ${total} entr${total === 1 ? "y" : "ies"}, ${days.length} day(s)`);
  process.exit(0);
} catch (e: any) {
  console.error(`[digest] ERROR: write failed: ${e?.message || e}`);
  process.exit(3);
}
