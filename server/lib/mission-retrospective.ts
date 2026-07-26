// ─────────────────────────────────────────────────────────────────────────────
// Verified Revenue Missions S6a — post-mission scored retrospective.
// Feature contract: data/feature-contracts/revenue-missions.
//
// When a mission reaches a TERMINAL stage (killed | scale_ready), a scored
// retrospective is computed deterministically from the evidence-derived rollup
// counters (never LLM output) and persisted onto the mission row
// (retrospective jsonb + retrospective_at). It is RECORD-ONLY: writing it can
// never block or alter the stage transition (record-only ledger, never a gate).
//
// The retrospective closes the loop Grok's review flagged: one-off experiments
// become a continuous portfolio — every terminal mission emits ROI, CAC-signal
// numbers, lessons, and next-mission guidance the owner + Felix/Cassandra read
// via revenue_mission_status / mission_portfolio_review. Proposing the next
// mission stays HITL: this module writes ADVICE, it never creates missions.
// ─────────────────────────────────────────────────────────────────────────────
import { db } from "../db";
import { sql } from "drizzle-orm";
import { assessMission, type MissionAssessment } from "./mission-capital-allocator";

function rows(res: unknown): any[] {
  return ((res as any)?.rows || res || []) as any[];
}

function assertTenant(tenantId: number): void {
  if (!Number.isInteger(tenantId) || tenantId <= 0) {
    throw new Error(`mission-retrospective: invalid tenantId ${tenantId} (fail closed)`);
  }
}

/** Stages that trigger a retrospective write. */
export const RETROSPECTIVE_TERMINAL_STAGES = ["killed", "scale_ready"] as const;

export interface MissionRetrospective {
  version: 1;
  generatedAt: string;
  terminalStage: string;
  /** 0–100 deterministic outcome score (see scoreMission). */
  score: number;
  verdict: MissionAssessment["verdict"];
  realizedMarginUsdCents: number;
  /** revenue−refunds−spend over spend; null when spend is 0 (undefined ROI). */
  roiPct: number | null;
  /** Spend per positive reply (CAC signal); null when no positive replies. */
  costPerPositiveReplyUsdCents: number | null;
  /** Positive replies over contacts; null when nothing was contacted. */
  replyConversionPct: number | null;
  detail: MissionAssessment["detail"];
  lessons: string[];
  nextActions: string[];
}

/**
 * 0–100 outcome score. Deterministic, evidence-only:
 *  - up to 40 pts for demand signal (reply conversion vs a 10% reference),
 *  - up to 40 pts for realized margin (vs the mission's cash-at-risk budget),
 *  - up to 20 pts for reaching revenue at all.
 * Pure — exported for query-free tests.
 */
export function scoreMission(a: MissionAssessment): number {
  const { contacted, positiveReplies, revenueUsdCents, budgetUsd } = a.detail;
  const demand = contacted > 0 ? Math.min(1, (positiveReplies / contacted) / 0.1) : 0;
  const budgetCents = Math.max(1, budgetUsd * 100);
  const margin = a.realizedMarginUsdCents > 0
    ? Math.min(1, a.realizedMarginUsdCents / budgetCents)
    : 0;
  const revenue = revenueUsdCents > 0 ? 1 : 0;
  return Math.round(demand * 40 + margin * 40 + revenue * 20);
}

/** Build the full retrospective from a mission row. Pure — exported for tests. */
export function buildRetrospective(mission: any, terminalStage: string): MissionRetrospective {
  const a = assessMission(mission);
  const { contacted, positiveReplies, spendUsdCents } = a.detail;
  const roiPct = spendUsdCents > 0
    ? Math.round((a.realizedMarginUsdCents / spendUsdCents) * 100)
    : null;
  const costPerPositiveReplyUsdCents = positiveReplies > 0
    ? Math.round(spendUsdCents / positiveReplies)
    : null;
  const replyConversionPct = contacted > 0
    ? Math.round((positiveReplies / contacted) * 100)
    : null;

  const lessons: string[] = [];
  const nextActions: string[] = [];
  if (contacted === 0) {
    lessons.push("Mission ended before any outreach — hypothesis was never demand-tested.");
  } else if (positiveReplies === 0) {
    lessons.push(`${contacted} contacts, zero positive replies — the ICP/offer pairing produced no demand signal.`);
  } else if (a.detail.revenueUsdCents === 0) {
    lessons.push(`Interest without conversion: ${positiveReplies}/${contacted} positive replies but no payment — offer/pricing is the weak link, not the ICP.`);
  } else if (a.realizedMarginUsdCents > 0) {
    lessons.push(`First-dollar proven with positive realized margin (${(a.realizedMarginUsdCents / 100).toFixed(2)} USD) — the pattern (ICP + offer + channel) is worth capturing as a reusable skill.`);
  } else {
    lessons.push("Revenue recorded but margin not positive — unit economics need work before scaling.");
  }

  if (terminalStage === "scale_ready") {
    nextActions.push("Scale candidate: owner may raise the autonomy level / caps in the admin UI (reinvestment only from realized margin).");
    nextActions.push("Propose a follow-on mission reusing the proven ICP + offer pattern (owner approval required, as always).");
  } else {
    nextActions.push("Killed: fold the lesson into the next mission packet — change exactly ONE variable (ICP, offer, price, or channel) so the failure is informative.");
    if (positiveReplies > 0 && a.detail.revenueUsdCents === 0) {
      nextActions.push("Demand existed — a re-run with a cheaper/smaller offer to the same ICP is the highest-information next experiment.");
    }
  }

  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    terminalStage,
    score: scoreMission(a),
    verdict: a.verdict,
    realizedMarginUsdCents: a.realizedMarginUsdCents,
    roiPct,
    costPerPositiveReplyUsdCents,
    replyConversionPct,
    detail: a.detail,
    lessons,
    nextActions,
  };
}

/**
 * Compute + persist the retrospective for one mission. Idempotent: an existing
 * retrospective is never overwritten (first terminal transition wins).
 * Callers treat this as best-effort — failures log, never propagate.
 */
export async function recordRetrospective(tenantId: number, missionId: number, terminalStage: string): Promise<MissionRetrospective | null> {
  assertTenant(tenantId);
  const res = await db.execute(sql`
    SELECT * FROM revenue_missions
    WHERE tenant_id = ${tenantId} AND id = ${missionId} LIMIT 1
  `);
  const mission = rows(res)[0];
  if (!mission) return null;
  if (mission.retrospective) return mission.retrospective as MissionRetrospective; // idempotent
  const retro = buildRetrospective(mission, terminalStage);
  await db.execute(sql`
    UPDATE revenue_missions
    SET retrospective = ${JSON.stringify(retro)}::jsonb,
        retrospective_at = CURRENT_TIMESTAMP,
        updated_at = CURRENT_TIMESTAMP
    WHERE tenant_id = ${tenantId} AND id = ${missionId} AND retrospective IS NULL
  `);
  return retro;
}
