/**
 * Agent Perspective Debugger — R110.13 (Barry Zhang seminar §5.4 + §7.4).
 *
 * Reconstructs and prints "what the agent actually saw" at any point in a
 * past trace. Implements Barry's debug ritual: load the transcript, find
 * the inflection point, ignore your privileged knowledge, decide what YOU
 * would have done with only that information.
 *
 * Source of truth: `agent_trace_spans` table (R101 unified telemetry).
 *
 * Usage:
 *   npx tsx scripts/agent-perspective.ts <traceId>
 *   npx tsx scripts/agent-perspective.ts <traceId> --tenant 1
 *   npx tsx scripts/agent-perspective.ts <traceId> --upto <spanId>
 *
 * Exit codes:
 *   0  trace printed
 *   1  trace not found
 *   2  bad CLI args
 *   5  DB error
 */
import { db } from "../server/db";
import { sql } from "drizzle-orm";

interface SpanRow {
  id: number;
  tenant_id: number;
  trace_id: string;
  span_id: string;
  parent_span_id: string | null;
  kind: string;
  agent_name: string | null;
  tool_name: string | null;
  started_at: string;
  ended_at: string | null;
  status: string | null;
  summary: string | null;
  metadata: any;
}

function parseArgs(argv: string[]): { traceId: string | null; tenantId: number | null; uptoSpanId: string | null } {
  const args = argv.slice(2);
  let traceId: string | null = null;
  let tenantId: number | null = null;
  let uptoSpanId: string | null = null;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--tenant") {
      tenantId = Number(args[++i]);
    } else if (a === "--upto") {
      uptoSpanId = args[++i];
    } else if (!a.startsWith("--") && !traceId) {
      traceId = a;
    }
  }
  return { traceId, tenantId, uptoSpanId };
}

function durationMs(s: SpanRow): number | null {
  if (!s.ended_at) return null;
  const a = new Date(s.started_at).getTime();
  const b = new Date(s.ended_at).getTime();
  return Number.isFinite(a) && Number.isFinite(b) ? b - a : null;
}

function statusIcon(status: string | null, ended: string | null): string {
  if (!ended) return "…";
  if (status === "ok") return "✓";
  if (status === "error") return "✗";
  if (status === "declined") return "⊘";
  return "?";
}

function formatSpan(s: SpanRow, depth: number, isLast: boolean[], visibleTokens: number | null): string[] {
  const indent = isLast.slice(0, -1).map((l) => (l ? "    " : "│   ")).join("");
  const branch = depth === 0 ? "" : isLast[isLast.length - 1] ? "└── " : "├── ";
  const dur = durationMs(s);
  const durStr = dur === null ? "" : ` (${dur}ms)`;
  const label =
    s.kind === "tool"
      ? `tool:${s.tool_name ?? "?"}`
      : s.kind === "llm"
        ? `llm${s.agent_name ? `:${s.agent_name}` : ""}`
        : s.kind === "delegate" || s.kind === "subagent"
          ? `${s.kind}:${s.agent_name ?? "?"}`
          : s.kind;
  const tokInfo = visibleTokens !== null ? ` [≈${visibleTokens} tok visible]` : "";
  const head = `${indent}${branch}${statusIcon(s.status, s.ended_at)} ${label}${durStr}${tokInfo}`;
  const lines = [head];
  if (s.summary) {
    const summaryLines = s.summary.split("\n").slice(0, 6);
    for (const line of summaryLines) lines.push(`${indent}${isLast[isLast.length - 1] ? "    " : "│   "}  ${line}`);
    if (s.summary.split("\n").length > 6) lines.push(`${indent}${isLast[isLast.length - 1] ? "    " : "│   "}  …(truncated)`);
  }
  if (s.status === "error" && s.metadata?.error) {
    lines.push(`${indent}${isLast[isLast.length - 1] ? "    " : "│   "}  ↯ error: ${String(s.metadata.error).slice(0, 200)}`);
  }
  return lines;
}

function approxTokens(s: SpanRow): number {
  // Coarse approximation — only used for the "what could the agent see" hint.
  let chars = 0;
  if (s.summary) chars += s.summary.length;
  if (s.metadata) {
    try { chars += JSON.stringify(s.metadata).length; } catch { /* ignore */ }
  }
  return Math.ceil(chars / 4);
}

function buildTree(spans: SpanRow[]): { roots: SpanRow[]; childrenOf: Map<string, SpanRow[]> } {
  const childrenOf = new Map<string, SpanRow[]>();
  const roots: SpanRow[] = [];
  for (const s of spans) {
    if (s.parent_span_id) {
      if (!childrenOf.has(s.parent_span_id)) childrenOf.set(s.parent_span_id, []);
      childrenOf.get(s.parent_span_id)!.push(s);
    } else {
      roots.push(s);
    }
  }
  const sortByStart = (a: SpanRow, b: SpanRow) => new Date(a.started_at).getTime() - new Date(b.started_at).getTime();
  roots.sort(sortByStart);
  for (const arr of childrenOf.values()) arr.sort(sortByStart);
  return { roots, childrenOf };
}

function walk(
  span: SpanRow,
  childrenOf: Map<string, SpanRow[]>,
  depth: number,
  isLast: boolean[],
  visibleByThisPoint: { v: number },
  uptoSpanId: string | null,
  out: string[],
  stop: { hit: boolean },
): void {
  if (stop.hit) return;
  visibleByThisPoint.v += approxTokens(span);
  out.push(...formatSpan(span, depth, isLast, visibleByThisPoint.v));
  if (uptoSpanId && span.span_id === uptoSpanId) {
    out.push("");
    out.push("───────── STOPPED AT --upto SPAN ─────────");
    out.push(`Span ${span.span_id} reached. Ask yourself:`);
    out.push("  With ONLY the information above, what would the right next action be?");
    out.push("  If your answer differs from what the agent did next — fix the input, not the model.");
    stop.hit = true;
    return;
  }
  const kids = childrenOf.get(span.span_id) ?? [];
  for (let i = 0; i < kids.length; i++) {
    if (stop.hit) return;
    walk(kids[i], childrenOf, depth + 1, [...isLast, i === kids.length - 1], visibleByThisPoint, uptoSpanId, out, stop);
  }
}

async function main(): Promise<void> {
  const { traceId, tenantId, uptoSpanId } = parseArgs(process.argv);
  if (!traceId) {
    console.error("usage: npx tsx scripts/agent-perspective.ts <traceId> [--tenant N] [--upto <spanId>]");
    process.exit(2);
  }

  let rows: SpanRow[] = [];
  try {
    const result: any = tenantId
      ? await db.execute(sql`
          SELECT id, tenant_id, trace_id, span_id, parent_span_id, kind, agent_name, tool_name,
                 started_at, ended_at, status, summary, metadata
          FROM agent_trace_spans
          WHERE trace_id = ${traceId} AND tenant_id = ${tenantId}
          ORDER BY started_at ASC
        `)
      : await db.execute(sql`
          SELECT id, tenant_id, trace_id, span_id, parent_span_id, kind, agent_name, tool_name,
                 started_at, ended_at, status, summary, metadata
          FROM agent_trace_spans
          WHERE trace_id = ${traceId}
          ORDER BY started_at ASC
        `);
    rows = ((result as any).rows || result) as SpanRow[];
  } catch (err: any) {
    console.error(`[agent-perspective] DB error: ${err?.message || err}`);
    process.exit(5);
  }

  if (rows.length === 0) {
    console.error(`[agent-perspective] no spans found for trace_id="${traceId}"${tenantId ? ` tenant=${tenantId}` : ""}`);
    process.exit(1);
  }

  const { roots, childrenOf } = buildTree(rows);
  const totalDur = (() => {
    const starts = rows.map((r) => new Date(r.started_at).getTime());
    const ends = rows.map((r) => (r.ended_at ? new Date(r.ended_at).getTime() : new Date(r.started_at).getTime()));
    return Math.max(...ends) - Math.min(...starts);
  })();
  const errorCount = rows.filter((r) => r.status === "error").length;
  const declinedCount = rows.filter((r) => r.status === "declined").length;
  const tenantsSeen = new Set(rows.map((r) => r.tenant_id));

  console.log("┌─────────────────────────────────────────────────────────");
  console.log(`│ Agent perspective — trace_id=${traceId}`);
  console.log(`│ ${rows.length} spans · ${roots.length} root(s) · ${totalDur}ms total`);
  console.log(`│ tenants=[${[...tenantsSeen].join(",")}] · errors=${errorCount} · declined=${declinedCount}`);
  if (uptoSpanId) console.log(`│ stopping at span_id=${uptoSpanId}`);
  console.log("├─────────────────────────────────────────────────────────");

  const out: string[] = [];
  const stop = { hit: false };
  const visibleByThisPoint = { v: 0 };
  for (let i = 0; i < roots.length; i++) {
    walk(roots[i], childrenOf, 0, [i === roots.length - 1], visibleByThisPoint, uptoSpanId, out, stop);
    if (stop.hit) break;
  }
  for (const line of out) console.log(`│ ${line}`);

  console.log("└─────────────────────────────────────────────────────────");
  if (!uptoSpanId) {
    console.log("");
    console.log("Tip: pass --upto <spanId> to freeze the view at any inflection point.");
    console.log("     Then ask: with ONLY what's printed above, what should the next action be?");
  }
  process.exit(0);
}

main().catch((err) => {
  console.error("[agent-perspective] ERRORED:", err);
  process.exit(5);
});
