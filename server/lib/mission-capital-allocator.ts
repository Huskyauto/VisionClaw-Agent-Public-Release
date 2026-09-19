// ─────────────────────────────────────────────────────────────────────────────
// Verified Revenue Missions S5d — Cassandra's capital allocator.
// Feature contract: data/feature-contracts/revenue-missions.
//
// Deterministic ADVISORY portfolio review — no LLM calls, no writes. It reads
// the mission table (evidence-derived rollups only) and produces
// recommendations for the OWNER (and for Cassandra/CEO via the read-only
// mission_portfolio_review tool). It never applies anything: kill, approve,
// and autonomy changes remain HITL decisions.
//
// Portfolio rules (GPT 5.6 review, adopted):
//  - Max 2 ACTIVE UNPROVEN missions at once (unproven = no verified revenue).
//  - Kill-signal detection: enough contacts with no traction ⇒ recommend kill.
//  - Reinvest only REALIZED margin (revenue − refunds − spend), never forecast.
//  - Scale recommendation only after firstDollar (margin > 0).
// ─────────────────────────────────────────────────────────────────────────────
import { db } from "../db";
import { sql } from "drizzle-orm";

function rows(res: unknown): any[] {
  return ((res as any)?.rows || res || []) as any[];
}

export const PORTFOLIO_RULES = {
  maxActiveUnproven: 2,
  // Kill signal: at least this many contacts with zero positive replies.
  killContactsNoReply: 10,
  // Kill signal: at least this many positive replies but zero revenue after
  // this many contacts (interest that never converts).
  killContactsNoRevenue: 25,
} as const;

export type MissionVerdict = "healthy" | "unproven" | "kill_recommended" | "scale_candidate" | "killed";

export interface MissionAssessment {
  missionId: number;
  name: string;
  stage: string;
  autonomyLevel: number;
  verdict: MissionVerdict;
  realizedMarginUsdCents: number;
  reasons: string[];
  detail: {
    contacted: number;
    positiveReplies: number;
    revenueUsdCents: number;
    refundsUsdCents: number;
    spendUsdCents: number;
    budgetUsd: number;
  };
}

export interface PortfolioReview {
  generatedAt: string;
  missions: MissionAssessment[];
  portfolio: {
    activeUnproven: number;
    maxActiveUnproven: number;
    overCapacity: boolean;
    totalRealizedMarginUsdCents: number;
    recommendations: string[];
  };
}

/** Pure assessment of one mission row — exported for query-free tests. */
export function assessMission(m: any): MissionAssessment {
  const contacted = Math.max(0, Number(m.leads_contacted) || 0);
  const positive = Math.max(0, Number(m.positive_replies) || 0);
  const revenue = Math.max(0, Number(m.revenue_usd_cents) || 0);
  const refunds = Math.max(0, Number(m.refunds_usd_cents) || 0);
  const spend = Math.max(0, Number(m.spend_usd_cents) || 0);
  const margin = revenue - refunds - spend;
  const reasons: string[] = [];
  let verdict: MissionVerdict;

  if (m.stage === "killed") {
    verdict = "killed";
    reasons.push(m.killed_reason ? `killed: ${m.killed_reason}` : "killed");
  } else if (contacted >= PORTFOLIO_RULES.killContactsNoReply && positive === 0) {
    verdict = "kill_recommended";
    reasons.push(`${contacted} contacts, zero positive replies — no demand signal`);
  } else if (contacted >= PORTFOLIO_RULES.killContactsNoRevenue && revenue === 0) {
    verdict = "kill_recommended";
    reasons.push(`${contacted} contacts, ${positive} positive replies, zero revenue — interest never converts`);
  } else if (margin > 0) {
    verdict = "scale_candidate";
    reasons.push(`realized margin ${(margin / 100).toFixed(2)} USD — first-dollar proven; scale decision is the owner's`);
  } else if (revenue > 0) {
    verdict = "healthy";
    reasons.push(`revenue recorded (${(revenue / 100).toFixed(2)} USD) but margin not yet positive`);
  } else {
    verdict = "unproven";
    reasons.push("no verified revenue yet — validation budget only");
  }

  return {
    missionId: Number(m.id),
    name: String(m.name ?? ""),
    stage: String(m.stage ?? ""),
    autonomyLevel: Number(m.autonomy_level) || 0,
    verdict,
    realizedMarginUsdCents: margin,
    reasons,
    detail: {
      contacted,
      positiveReplies: positive,
      revenueUsdCents: revenue,
      refundsUsdCents: refunds,
      spendUsdCents: spend,
      budgetUsd: Math.max(0, Number(m.max_cash_at_risk_usd) || 0),
    },
  };
}

/** Pure portfolio rollup over per-mission assessments — exported for tests. */
export function summarizePortfolio(assessments: MissionAssessment[]): PortfolioReview["portfolio"] {
  const active = assessments.filter((a) => a.verdict !== "killed");
  const activeUnproven = active.filter((a) => a.verdict === "unproven" || a.verdict === "kill_recommended").length;
  const totalMargin = active.reduce((s, a) => s + a.realizedMarginUsdCents, 0);
  const recommendations: string[] = [];
  const overCapacity = activeUnproven > PORTFOLIO_RULES.maxActiveUnproven;
  if (overCapacity) {
    recommendations.push(
      `Portfolio over capacity: ${activeUnproven} active unproven missions (max ${PORTFOLIO_RULES.maxActiveUnproven}). Kill or pause the weakest before starting anything new.`,
    );
  }
  for (const a of assessments) {
    if (a.verdict === "kill_recommended") {
      recommendations.push(`Mission #${a.missionId} "${a.name}": recommend KILL — ${a.reasons.join("; ")} (owner decision, admin UI).`);
    }
    if (a.verdict === "scale_candidate") {
      recommendations.push(`Mission #${a.missionId} "${a.name}": first-dollar proven — candidate for higher autonomy/scale (owner decision). Reinvestment only from realized margin.`);
    }
  }
  if (recommendations.length === 0) recommendations.push("No portfolio action needed.");
  return {
    activeUnproven,
    maxActiveUnproven: PORTFOLIO_RULES.maxActiveUnproven,
    overCapacity,
    totalRealizedMarginUsdCents: totalMargin,
    recommendations,
  };
}

export async function reviewPortfolio(tenantId: number): Promise<PortfolioReview> {
  if (!Number.isInteger(tenantId) || tenantId <= 0) {
    throw new Error(`mission-capital-allocator: invalid tenantId ${tenantId} (fail closed)`);
  }
  const res = await db.execute(sql`
    SELECT * FROM revenue_missions WHERE tenant_id = ${tenantId} ORDER BY id DESC
  `);
  const missions = rows(res).map(assessMission);
  return {
    generatedAt: new Date().toISOString(),
    missions,
    portfolio: summarizePortfolio(missions),
  };
}
