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
  "gemini-3.1-pro-preview": { in: 0.0025, out: 0.01 },
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

export function estimateCostUsd(model: string, tokensIn = 0, tokensOut = 0): number {
  const pricing = MODEL_COST_PER_1K[model];
  if (!pricing) {
    if (model.startsWith("gpt-")) return (tokensIn + tokensOut) * 0.005 / 1000;
    if (model.startsWith("claude")) return (tokensIn + tokensOut) * 0.005 / 1000;
    return 0;
  }
  return (tokensIn * pricing.in + tokensOut * pricing.out) / 1000;
}

export async function recordCost(params: {
  tenantId: number;
  toolName: string;
  model?: string;
  costUsd?: number;
  tokensIn?: number;
  tokensOut?: number;
  operation?: string;
  runId?: number | null;
}) {
  try {
    const cost = params.costUsd ?? estimateCostUsd(params.model ?? "", params.tokensIn ?? 0, params.tokensOut ?? 0);
    await db.insert(agentCostLedger).values({
      tenantId: params.tenantId,
      toolName: params.toolName,
      model: params.model ?? null,
      costUsd: cost.toFixed(6),
      tokensIn: params.tokensIn ?? 0,
      tokensOut: params.tokensOut ?? 0,
      operation: params.operation ?? null,
      runId: params.runId ?? null,
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
  }).from(agentCostLedger)
    .where(and(eq(agentCostLedger.tenantId, tenantId), gte(agentCostLedger.createdAt, since)))
    .groupBy(agentCostLedger.toolName, agentCostLedger.model);

  const total = rows.reduce((s, r) => s + parseFloat(r.totalCost || "0"), 0);
  return {
    periodDays: days,
    totalCostUsd: total,
    byTool: rows.map(r => ({
      tool: r.toolName,
      model: r.model,
      calls: r.count,
      costUsd: parseFloat(r.totalCost || "0"),
      tokensIn: r.tokensIn,
      tokensOut: r.tokensOut,
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
