/**
 * Tool mis-pick telemetry (R125+137.64) — record-only ledger, NEVER a gate.
 *
 * A "mis-pick" = within one chat turn, tool A failed and a DIFFERENT tool B
 * later succeeded. A retry-success of the SAME tool is NOT a mis-pick (that
 * path is already covered by the adaptive lesson saver in chat-engine).
 *
 * Invariants:
 *  - Fail-open everywhere: a detection/insert failure must never affect the
 *    chat turn (callers fire-and-forget with .catch).
 *  - No LLM calls, no gating decisions — pure observation.
 *  - Every INSERT passes tenantId explicitly (no defaults, platform rule).
 */
// NOTE: db is imported LAZILY inside the async functions so that pure-logic
// tests can import detectMispicks without opening a pg pool (node:test hangs
// with exit 124 if a module-level pool is left open — known platform gotcha).

const MAX_PAIRS_PER_TURN = 5;
const MAX_ERROR_CHARS = 300;

export interface ExecutedToolRecord {
  name: string;
  input: any;
  output: any;
}

function isFailure(output: any): boolean {
  if (output == null) return false;
  if (typeof output === "object") {
    if (typeof output.error === "string" && output.error.length > 0) return true;
    if (output.success === false) return true;
  }
  return false;
}

function isSuccess(output: any): boolean {
  if (output == null) return false;
  if (typeof output === "object") {
    if (typeof output.error === "string" && output.error.length > 0) return false;
    if (output.success === false) return false;
    return true;
  }
  return true;
}

/**
 * Pure pairing logic (exported for tests). Walks the executed-tool sequence
 * in order; for each failed call, the NEXT subsequent successful call of a
 * DIFFERENT tool forms one (failedTool → succeededTool) pair — unless the
 * SAME tool succeeded first (retry-success, not a mis-pick). Each failure
 * contributes at most one pair; pairs are capped per turn.
 */
export function detectMispicks(tools: ExecutedToolRecord[]): Array<{ failedTool: string; succeededTool: string; failedError: string | null }> {
  const pairs: Array<{ failedTool: string; succeededTool: string; failedError: string | null }> = [];
  for (let i = 0; i < tools.length && pairs.length < MAX_PAIRS_PER_TURN; i++) {
    const t = tools[i];
    if (!t?.name || !isFailure(t.output)) continue;
    for (let k = i + 1; k < tools.length; k++) {
      const later = tools[k];
      if (!later?.name || !isSuccess(later.output)) continue;
      if (later.name === t.name) break; // retry-success of the same tool — not a mis-pick
      const err = typeof t.output?.error === "string" ? t.output.error.slice(0, MAX_ERROR_CHARS) : null;
      pairs.push({ failedTool: t.name, succeededTool: later.name, failedError: err });
      break;
    }
  }
  return pairs;
}

/** Detect + persist. Fail-open: swallows every error after a loud-enough log. */
export async function recordMispicks(
  tools: ExecutedToolRecord[],
  ctx: { tenantId: number; personaId?: number | null; conversationId?: number | null },
): Promise<number> {
  try {
    if (!Number.isInteger(ctx.tenantId) || ctx.tenantId <= 0) return 0; // tenant fail-closed on the WRITE, open on the turn
    if (!Array.isArray(tools) || tools.length < 2) return 0;
    const pairs = detectMispicks(tools);
    if (pairs.length === 0) return 0;
    const { db } = await import("../db");
    const { sql } = await import("drizzle-orm");
    for (const p of pairs) {
      await db.execute(sql`
        INSERT INTO tool_mispicks (tenant_id, persona_id, conversation_id, failed_tool, succeeded_tool, failed_error)
        VALUES (${ctx.tenantId}, ${ctx.personaId ?? null}, ${ctx.conversationId ?? null}, ${p.failedTool}, ${p.succeededTool}, ${p.failedError})
      `);
    }
    if (pairs.length > 0) {
      console.log(`[mispick] Recorded ${pairs.length} mis-pick pair(s) for conversation ${ctx.conversationId ?? "?"}: ${pairs.map(p => `${p.failedTool}→${p.succeededTool}`).join(", ")}`);
    }
    return pairs.length;
  } catch (err: any) {
    console.warn(`[mispick] telemetry write failed (fail-open): ${err?.message?.slice(0, 200)}`);
    return 0;
  }
}

export interface MispickSummary {
  windowDays: number;
  totalMispicks: number;
  distinctFailedTools: number;
  topPairs: Array<{ failedTool: string; succeededTool: string; count: number; lastAt: string | null }>;
  degraded: boolean;
}

/** Rollup for the ecosystem-health card. Telemetry-only — never breaches. */
export async function summarizeMispicks(tenantId: number, windowDays = 30, topN = 8): Promise<MispickSummary> {
  const { db } = await import("../db");
  const { sql } = await import("drizzle-orm");
  const aggRes: any = await db.execute(sql`
    SELECT COUNT(*)::int AS total, COUNT(DISTINCT failed_tool)::int AS distinct_failed
    FROM tool_mispicks
    WHERE tenant_id = ${tenantId} AND created_at > NOW() - (${windowDays} * INTERVAL '1 day')
  `);
  const agg = ((aggRes.rows || aggRes) as any[])[0] || {};
  const pairRes: any = await db.execute(sql`
    SELECT failed_tool, succeeded_tool, COUNT(*)::int AS n, MAX(created_at) AS last_at
    FROM tool_mispicks
    WHERE tenant_id = ${tenantId} AND created_at > NOW() - (${windowDays} * INTERVAL '1 day')
    GROUP BY failed_tool, succeeded_tool
    ORDER BY n DESC, MAX(created_at) DESC
    LIMIT ${topN}
  `);
  const topPairs = ((pairRes.rows || pairRes) as any[]).map((r) => ({
    failedTool: String(r.failed_tool),
    succeededTool: String(r.succeeded_tool),
    count: Number(r.n) || 0,
    lastAt: r.last_at ? new Date(r.last_at).toISOString() : null,
  }));
  return {
    windowDays,
    totalMispicks: Number(agg.total) || 0,
    distinctFailedTools: Number(agg.distinct_failed) || 0,
    topPairs,
    degraded: false,
  };
}
