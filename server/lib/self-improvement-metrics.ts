// Self-improvement loop health (Anthropic Institute, "When AI builds itself",
// 2026 — recursive self-improvement). The essay's most concrete internal metric
// is a catch-rate: an automated reviewer "would have caught ~1/3 of the bugs
// behind past production incidents", and the human correction/takeover rate
// trends DOWN as the loop matures. VisionClaw already runs that loop (Agentic
// CI Self-Healer + architect review + jury-decides-and-ships); every incident it
// sees is recorded in `repair_incidents`. This turns "our self-repair loop is
// useful" from a vibe into a measured number, the same way orchestration-
// efficiency made the felt-vs-real time gap measurable.
//
// Catch-rate = resolved / total: of all incidents the loop saw, how many it
// auto-closed (verified all-green, left in tree) vs escalated to the owner vs
// held by a fail-closed safety guard. A LOW auto-resolve rate (with enough
// sample) means the loop isn't closing — that is the breach. Safety holds are
// CORRECT (fail-closed), so they are reported separately, not as failures.
//
// Read-only, tenant-scoped, never throws — same contract as
// summarizeOrchestrationEfficiency.

import { db } from "../db";
import { logSilentCatch } from "./silent-catch";
import { sql } from "drizzle-orm";

export interface SelfImprovementClassStat {
  classification: string;
  total: number;
  resolved: number;
  resolveRate: number;
}

export interface SelfImprovementSummary {
  sampleSize: number;
  autoResolved: number;
  escalated: number;
  /** incidents a fail-closed safety invariant forced away from auto-fix (correct, not a failure). */
  safetyHeld: number;
  /** resolved / sampleSize — the essay's "catch-rate". */
  autoResolveRate: number;
  /** escalated / sampleSize — the human takeover rate (essay wants this trending down). */
  escalationRate: number;
  byClassification: SelfImprovementClassStat[];
  /** resolve rate over the last 30 days. */
  recentResolveRate: number;
  /** resolve rate over the 30–60-days-ago window (trend baseline). */
  priorResolveRate: number;
  /** recentResolveRate − priorResolveRate (positive = loop improving). */
  trendDelta: number;
  /** essay-anchored catch-rate floor (the "caught ~1/3 of incidents" benchmark). */
  threshold: number;
  breached: boolean;
}

const RESOLVE_FLOOR = 0.33; // Anthropic Institute benchmark: automated review caught ~1/3 of past incident bugs
const WINDOW = 500;

export function emptySelfImprovementSummary(): SelfImprovementSummary {
  return {
    sampleSize: 0,
    autoResolved: 0,
    escalated: 0,
    safetyHeld: 0,
    autoResolveRate: 0,
    escalationRate: 0,
    byClassification: [],
    recentResolveRate: 0,
    priorResolveRate: 0,
    trendDelta: 0,
    threshold: RESOLVE_FLOOR,
    breached: false,
  };
}

/**
 * Dashboard summary of the self-repair loop's catch-rate, escalation rate, and
 * per-classification blind spots, plus a 30d-vs-prior-30d trend. Read-only.
 */
export async function summarizeSelfImprovement(
  tenantId: number,
  opts?: { throwOnError?: boolean },
): Promise<SelfImprovementSummary> {
  const empty = emptySelfImprovementSummary();
  if (!tenantId || !Number.isInteger(tenantId) || tenantId <= 0) return empty;

  try {
    const res = await db.execute(sql`
      WITH recent AS (
        SELECT resolved, escalated, safety_blocked_autofix, created_at
        FROM repair_incidents
        WHERE tenant_id = ${tenantId}
        ORDER BY id DESC
        LIMIT ${WINDOW}
      )
      SELECT
        COUNT(*)::int AS sample,
        COALESCE(SUM(CASE WHEN resolved THEN 1 ELSE 0 END), 0)::int AS resolved,
        COALESCE(SUM(CASE WHEN escalated THEN 1 ELSE 0 END), 0)::int AS escalated,
        COALESCE(SUM(CASE WHEN safety_blocked_autofix THEN 1 ELSE 0 END), 0)::int AS safety_held,
        COALESCE(SUM(CASE WHEN resolved AND created_at >= NOW() - INTERVAL '30 days' THEN 1 ELSE 0 END), 0)::int AS recent_resolved,
        COALESCE(SUM(CASE WHEN created_at >= NOW() - INTERVAL '30 days' THEN 1 ELSE 0 END), 0)::int AS recent_total,
        COALESCE(SUM(CASE WHEN resolved AND created_at >= NOW() - INTERVAL '60 days' AND created_at < NOW() - INTERVAL '30 days' THEN 1 ELSE 0 END), 0)::int AS prior_resolved,
        COALESCE(SUM(CASE WHEN created_at >= NOW() - INTERVAL '60 days' AND created_at < NOW() - INTERVAL '30 days' THEN 1 ELSE 0 END), 0)::int AS prior_total
      FROM recent
    `);
    const row = (((res as any).rows || res) as any[])[0] || {};
    const sample = Number(row.sample) || 0;
    const resolved = Number(row.resolved) || 0;
    const escalated = Number(row.escalated) || 0;
    const safetyHeld = Number(row.safety_held) || 0;
    const recentTotal = Number(row.recent_total) || 0;
    const recentResolved = Number(row.recent_resolved) || 0;
    const priorTotal = Number(row.prior_total) || 0;
    const priorResolved = Number(row.prior_resolved) || 0;

    const clsRes = await db.execute(sql`
      WITH recent AS (
        SELECT resolved, classification
        FROM repair_incidents
        WHERE tenant_id = ${tenantId}
        ORDER BY id DESC
        LIMIT ${WINDOW}
      )
      SELECT classification,
             COUNT(*)::int AS total,
             COALESCE(SUM(CASE WHEN resolved THEN 1 ELSE 0 END), 0)::int AS resolved
      FROM recent
      GROUP BY classification
      ORDER BY total DESC
    `);
    const clsRows = (((clsRes as any).rows || clsRes) as any[]) || [];
    const byClassification: SelfImprovementClassStat[] = clsRows.map((r) => {
      const total = Number(r.total) || 0;
      const cResolved = Number(r.resolved) || 0;
      return {
        classification: String(r.classification || "unknown"),
        total,
        resolved: cResolved,
        resolveRate: total > 0 ? Math.round((cResolved / total) * 100) / 100 : 0,
      };
    });

    const autoResolveRate = sample > 0 ? resolved / sample : 0;
    const escalationRate = sample > 0 ? escalated / sample : 0;
    const recentResolveRate = recentTotal > 0 ? recentResolved / recentTotal : 0;
    const priorResolveRate = priorTotal > 0 ? priorResolved / priorTotal : 0;

    return {
      sampleSize: sample,
      autoResolved: resolved,
      escalated,
      safetyHeld,
      autoResolveRate: Math.round(autoResolveRate * 100) / 100,
      escalationRate: Math.round(escalationRate * 100) / 100,
      byClassification,
      recentResolveRate: Math.round(recentResolveRate * 100) / 100,
      priorResolveRate: Math.round(priorResolveRate * 100) / 100,
      trendDelta: Math.round((recentResolveRate - priorResolveRate) * 100) / 100,
      threshold: RESOLVE_FLOOR,
      breached: sample >= 10 && autoResolveRate < RESOLVE_FLOOR,
    };
  } catch (_silentErr) {
    // Dashboard callers want never-throw (return empty + log). The operator CLI
    // passes throwOnError so a DB outage surfaces as a non-zero exit instead of
    // being misreported as "no incidents recorded" (a false-green signal).
    if (opts?.throwOnError) throw _silentErr;
    logSilentCatch("server/lib/self-improvement-metrics.ts", _silentErr);
    return empty;
  }
}
