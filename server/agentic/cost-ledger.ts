import { db } from "../db";
import { agentCostLedger } from "@shared/schema";
import { eq, and, gte, sql } from "drizzle-orm";

import { logSilentCatch } from "../lib/silent-catch";
const MODEL_COST_PER_1K: Record<string, { in: number; out: number }> = {
  "gpt-5.1": { in: 0.005, out: 0.015 },
  "gpt-5.4": { in: 0.01, out: 0.03 },
  "gpt-4.1": { in: 0.003, out: 0.012 },
  "claude-sonnet-4-20250514": { in: 0.003, out: 0.015 },
  "claude-opus-4-6": { in: 0.015, out: 0.075 },
  "claude-opus-4-7": { in: 0.005, out: 0.025 },
  "claude-opus-4-8": { in: 0.005, out: 0.025 },
  "claude-fable-5": { in: 0.005, out: 0.025 },
  // R125+3.7+sec — pricing aligned with server/resource-predictor.ts after architect MEDIUM
  // finding flagged 2x drift (cost-ledger had $2.50/$10 per 1M, predictor had $1.25/$5 per 1M
  // which matches Google's published Gemini Pro / 3.5-Flash rates). Single source of truth
  // for AI-model unit cost across the platform; planner forecasts + ledger now agree.
  "gemini-3.1-pro-preview": { in: 0.00125, out: 0.005 },
  "gemini-3.5-flash": { in: 0.00125, out: 0.005 },
  "gemini-3-flash-preview": { in: 0.0003, out: 0.0012 },
  "perplexity-sonar": { in: 0.001, out: 0.001 },
  "perplexity-sonar-pro": { in: 0.003, out: 0.015 },
  "firecrawl-search": { in: 0, out: 0.003 },
  "firecrawl-scrape": { in: 0, out: 0.002 },
  "elevenlabs-tts": { in: 0, out: 0.3 },
  // Round 35 — metered factory for embeddings + audio in providers.ts
  // text-embedding-3-small/large: in = $/1K tokens
  // gpt-4o-mini-tts: chars are billed in the tokensOut column, $0.0006/1K chars
  // whisper-1: duration-based; logged as op marker only ($0)
  "text-embedding-3-small": { in: 0.00002, out: 0 },
  "text-embedding-3-large": { in: 0.00013, out: 0 },
  "gpt-4o-mini-tts": { in: 0, out: 0.0006 },
  "tts-1": { in: 0, out: 0.015 },
  "tts-1-hd": { in: 0, out: 0.030 },
  "whisper-1": { in: 0, out: 0 },
};

// Prompt-cache billing multipliers vs the standard input rate, by provider family.
// readFactor = what a cache-READ token costs (discount); writeFactor = what a
// cache-WRITE/creation token costs (surcharge). cachedTokensIn + cacheWriteTokens
// are SUBSETS of tokensIn (normalized in providers.ts::extractUsageTokens).
//   OpenAI cached input ≈ 25% of input · Anthropic read ≈ 10%, write ≈ 125% ·
//   Gemini cached ≈ 25%. Unknown families fall back to a conservative 50% read.
function cacheFactors(model: string): { read: number; write: number } {
  const m = (model || "").toLowerCase();
  if (m.startsWith("claude")) return { read: 0.1, write: 1.25 };
  if (m.startsWith("gpt-") || m.startsWith("o1") || m.startsWith("o3") || m.startsWith("o4")) return { read: 0.25, write: 1.0 };
  if (m.startsWith("gemini")) return { read: 0.25, write: 1.0 };
  return { read: 0.5, write: 1.0 };
}

export function estimateCostUsd(
  model: string,
  tokensIn = 0,
  tokensOut = 0,
  cachedTokensIn = 0,
  cacheWriteTokens = 0,
): number {
  const { read, write } = cacheFactors(model);
  // Split tokensIn into full-rate, cache-read (discounted) and cache-write (surcharge).
  const cachedRead = Math.max(0, Math.min(cachedTokensIn, tokensIn));
  const cacheWrite = Math.max(0, Math.min(cacheWriteTokens, tokensIn - cachedRead));
  const fullIn = Math.max(0, tokensIn - cachedRead - cacheWrite);
  const inUnits = fullIn + cachedRead * read + cacheWrite * write;

  const pricing = MODEL_COST_PER_1K[model];
  if (!pricing) {
    if (model.startsWith("gpt-")) return (inUnits * 0.005 + tokensOut * 0.005) / 1000;
    if (model.startsWith("claude")) return (inUnits * 0.005 + tokensOut * 0.005) / 1000;
    return 0;
  }
  return (inUnits * pricing.in + tokensOut * pricing.out) / 1000;
}

// ── Metered-Anthropic daily circuit breaker (Bob 2026-06-12) ──────────────
// Opus/Claude is JURY-ONLY now. A runaway loop on 2026-06-12 fired 752 raw
// chat.completions to claude-opus-4-8 in 8 minutes (~$440) by bypassing the
// reservation-based autonomous-budget gate. This is the hard backstop: an
// in-memory running total of TODAY's METERED (cost>0) Claude spend. The
// flat-rate Claude Runner records ~$0 so it never inflates this counter;
// normal jury metered spend is cents/day. Resets on process boot (a runaway
// happens within one process lifetime, which is exactly what this catches).
// Tune via ANTHROPIC_DAILY_CEILING_USD (default $25).
const ANTHROPIC_DAILY_CEILING_USD = Number(process.env.ANTHROPIC_DAILY_CEILING_USD || "25");
let _anthropicSpendDayKey = "";
let _anthropicSpendUsdToday = 0;
function _dayKeyUTC(): string { return new Date().toISOString().slice(0, 10); }
function _rollDay(): void {
  const k = _dayKeyUTC();
  if (k !== _anthropicSpendDayKey) { _anthropicSpendDayKey = k; _anthropicSpendUsdToday = 0; }
}
// Lanes EXEMPT from the metered-Anthropic daily breaker + spend tally. Two
// owner-blessed high-value Opus uses are allowed to bypass the cap so a runaway
// elsewhere can never starve them:
//   • ":jury"     — the MoA multi-model decision vote (never block the vote).
//   • ":flagship" — the once-weekly Built With Bob recap (bounded ≤3 Opus calls
//                   per run; must never be killed mid-render). See providers.ts
//                   getClientForModel provLabel + scripts/build-bwb-weekly.ts.
// Centralized here so the breaker (providers.ts) and the tally below stay in sync.
export function isCostExemptLane(label?: string): boolean {
  if (!label) return false;
  return label.includes(":jury") || label.includes(":flagship");
}
export function noteModelSpend(model: string | undefined, costUsd: number, toolName?: string, costExempt?: boolean): void {
  // Count only METERED, cost-CAPPED-lane Claude spend. The flat-rate Claude
  // Runner records ~$0 (excluded by costUsd>0). Cost-exempt lanes (jury +
  // flagship recap) are skipped — they are the allowed high-value Opus uses and
  // must never trip the shared breaker. `costExempt` lets a caller (e.g. MoA,
  // whose ledger toolName is the bare "ensemble_query" so shouldThrottlePremium
  // can still see the 5x cost) mark the spend exempt WITHOUT mutating toolName.
  if (!model || !/^claude/i.test(model) || !(costUsd > 0)) return;
  if (costExempt || isCostExemptLane(toolName)) return;
  _rollDay();
  _anthropicSpendUsdToday += costUsd;
}
// Test-only: reset today's metered-Anthropic running total. Lets the breaker
// regression suite drive noteModelSpend deterministically without a DB.
export function __resetAnthropicDailySpendForTest(): void {
  _anthropicSpendDayKey = _dayKeyUTC();
  _anthropicSpendUsdToday = 0;
}
export function meteredAnthropicCeiling(): { exceeded: boolean; spent: number; ceiling: number } {
  _rollDay();
  return {
    exceeded: _anthropicSpendUsdToday >= ANTHROPIC_DAILY_CEILING_USD,
    spent: _anthropicSpendUsdToday,
    ceiling: ANTHROPIC_DAILY_CEILING_USD,
  };
}

export async function recordCost(params: {
  tenantId: number;
  toolName: string;
  model?: string;
  costUsd?: number;
  tokensIn?: number;
  tokensOut?: number;
  // Prompt-cache subsets of tokensIn (see providers.ts::extractUsageTokens).
  cachedTokensIn?: number;
  cacheWriteTokens?: number;
  operation?: string;
  runId?: number | null;
  // R125+14 — optional budget attribution. department is derived from personaId
  // when not given. Both nullable so existing call-sites are unaffected.
  personaId?: number | null;
  department?: string | null;
  // Marks the spend exempt from the metered-Anthropic breaker tally without
  // changing the persisted toolName (used by cost-exempt lanes like the MoA jury).
  costExempt?: boolean;
}) {
  try {
    const cost = params.costUsd ?? estimateCostUsd(
      params.model ?? "",
      params.tokensIn ?? 0,
      params.tokensOut ?? 0,
      params.cachedTokensIn ?? 0,
      params.cacheWriteTokens ?? 0,
    );
    noteModelSpend(params.model, cost, params.toolName, params.costExempt);
    let department = params.department ?? null;
    if (!department && params.personaId) {
      try {
        const { personaToDepartment } = await import("./department-budgets");
        department = personaToDepartment(params.personaId);
      } catch (_silentErr) { logSilentCatch("server/agentic/cost-ledger.ts", _silentErr); }
    }
    await db.insert(agentCostLedger).values({
      tenantId: params.tenantId,
      toolName: params.toolName,
      model: params.model ?? null,
      costUsd: cost.toFixed(6),
      tokensIn: params.tokensIn ?? 0,
      tokensOut: params.tokensOut ?? 0,
      cachedTokensIn: params.cachedTokensIn ?? 0,
      cacheWriteTokens: params.cacheWriteTokens ?? 0,
      operation: params.operation ?? null,
      runId: params.runId ?? null,
      personaId: params.personaId ?? null,
      department,
    });
  } catch (err) {
    console.warn("[cost-ledger] record failed:", (err as Error)?.message);
  }
}

export async function getCostSummary(tenantId: number, days = 7) {
  const since = new Date(Date.now() - days * 24 * 3600 * 1000);
  const rows = await db.select({
    toolName: agentCostLedger.toolName,
    model: agentCostLedger.model,
    count: sql<number>`COUNT(*)::int`.as("count"),
    totalCost: sql<string>`COALESCE(SUM(${agentCostLedger.costUsd}::numeric), 0)::text`.as("totalCost"),
    tokensIn: sql<number>`COALESCE(SUM(${agentCostLedger.tokensIn}), 0)::int`.as("tokensIn"),
    tokensOut: sql<number>`COALESCE(SUM(${agentCostLedger.tokensOut}), 0)::int`.as("tokensOut"),
    cachedTokensIn: sql<number>`COALESCE(SUM(${agentCostLedger.cachedTokensIn}), 0)::int`.as("cachedTokensIn"),
    cacheWriteTokens: sql<number>`COALESCE(SUM(${agentCostLedger.cacheWriteTokens}), 0)::int`.as("cacheWriteTokens"),
  }).from(agentCostLedger)
    .where(and(eq(agentCostLedger.tenantId, tenantId), gte(agentCostLedger.createdAt, since)))
    .groupBy(agentCostLedger.toolName, agentCostLedger.model);

  const total = rows.reduce((s, r) => s + parseFloat(r.totalCost || "0"), 0);
  const totalTokensIn = rows.reduce((s, r) => s + (r.tokensIn || 0), 0);
  const totalCachedIn = rows.reduce((s, r) => s + (r.cachedTokensIn || 0), 0);
  const totalCacheWrite = rows.reduce((s, r) => s + (r.cacheWriteTokens || 0), 0);
  // Cache-hit rate = share of input tokens served from the prompt cache.
  const cacheHitRate = totalTokensIn > 0 ? totalCachedIn / totalTokensIn : 0;
  return {
    periodDays: days,
    totalCostUsd: total,
    cache: {
      tokensIn: totalTokensIn,
      cachedTokensIn: totalCachedIn,
      cacheWriteTokens: totalCacheWrite,
      hitRate: cacheHitRate,
      hitRatePct: Math.round(cacheHitRate * 1000) / 10,
    },
    byTool: rows.map(r => ({
      tool: r.toolName,
      model: r.model,
      calls: r.count,
      costUsd: parseFloat(r.totalCost || "0"),
      tokensIn: r.tokensIn,
      tokensOut: r.tokensOut,
      cachedTokensIn: r.cachedTokensIn,
      cacheWriteTokens: r.cacheWriteTokens,
      cacheHitRatePct: r.tokensIn > 0 ? Math.round((r.cachedTokensIn / r.tokensIn) * 1000) / 10 : 0,
    })).sort((a, b) => b.costUsd - a.costUsd),
  };
}

export async function getRevenueVsCost(tenantId: number, days = 7) {
  const since = new Date(Date.now() - days * 24 * 3600 * 1000);
  const costs = await getCostSummary(tenantId, days);

  let stripeRevenue = 0;
  let coinbaseRevenue = 0;
  try {
    const stripeResult = await db.execute(sql`
      SELECT COALESCE(SUM(amount_total), 0)::numeric / 100 AS total
      FROM stripe_checkout_sessions
      WHERE tenant_id = ${tenantId} AND status = 'complete' AND created_at >= ${since}
    `);
    stripeRevenue = parseFloat((stripeResult.rows?.[0] as any)?.total || "0");
  } catch (_silentErr) { logSilentCatch("server/agentic/cost-ledger.ts", _silentErr); }

  try {
    const coinbaseResult = await db.execute(sql`
      SELECT COALESCE(SUM(amount_usd::numeric), 0) AS total
      FROM coinbase_charges
      WHERE tenant_id = ${tenantId} AND status = 'completed' AND created_at >= ${since}
    `);
    coinbaseRevenue = parseFloat((coinbaseResult.rows?.[0] as any)?.total || "0");
  } catch (_silentErr) { logSilentCatch("server/agentic/cost-ledger.ts", _silentErr); }

  const totalRevenue = stripeRevenue + coinbaseRevenue;
  const net = totalRevenue - costs.totalCostUsd;
  const burnRatio = totalRevenue > 0 ? costs.totalCostUsd / totalRevenue : (costs.totalCostUsd > 0 ? 99 : 0);

  return {
    periodDays: days,
    revenue: { stripe: stripeRevenue, coinbase: coinbaseRevenue, total: totalRevenue },
    cost: { total: costs.totalCostUsd, breakdown: costs.byTool.slice(0, 10) },
    net,
    burnRatio,
    shouldThrottlePremium: burnRatio > 0.5,
    verdict: burnRatio > 1 ? "UNPROFITABLE" : burnRatio > 0.5 ? "WARNING" : burnRatio > 0 ? "HEALTHY" : "NO_REVENUE",
  };
}

const _throttleCache = new Map<number, { at: number; throttle: boolean }>();
export async function shouldThrottlePremium(tenantId: number): Promise<boolean> {
  const cached = _throttleCache.get(tenantId);
  if (cached && Date.now() - cached.at < 5 * 60 * 1000) return cached.throttle;
  try {
    const summary = await getRevenueVsCost(tenantId, 7);
    _throttleCache.set(tenantId, { at: Date.now(), throttle: summary.shouldThrottlePremium });
    return summary.shouldThrottlePremium;
  } catch {
    return false;
  }
}
