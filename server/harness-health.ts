/**
 * Harness Health — "Code as Agent Harness" (Ning et al., UIUC / Meta / Stanford,
 * arXiv:2605.18747, May 2026).
 *
 * The survey's one genuinely open challenge for a platform that already runs the
 * harness/execute/verify loop is "evaluation beyond final task success": don't
 * just measure whether a task eventually shipped, measure the QUALITY of the
 * process the harness burned to get there — how many verify-and-repair
 * iterations, how often the first attempt was right, how often the verifier had
 * to roll a change back.
 *
 * VisionClaw's clearest instance of the code-as-harness execute-verify-repair
 * loop is the repo-surgeon kernel: it diagnoses an incident, proposes a code
 * fix, runs the typecheck/test gate, and either LANDS the change or ROLLS IT
 * BACK. Every iteration is one row in `repo_surgeon_attempts` (attempt grain),
 * so process quality is computable from data we already persist — no new
 * write-path instrumentation.
 *
 * This is deliberately distinct from the Self-Improvement card, which measures
 * the INCIDENT grain (resolved vs escalated from `repair_incidents`). Harness
 * Health is the ATTEMPT grain: of the fixes the harness actually proposed and
 * tested, how efficiently did the execute-verify loop converge.
 *
 * Metrics:
 *  - landRate        — landed / (landed + rolled_back): the verifier-pass rate.
 *                      Of fixes the harness proposed AND tested, how many passed
 *                      the gate and stuck. This is the breach signal.
 *  - firstPassYield  — of incidents that eventually landed, how many landed on
 *                      attempt #1 (got it right with zero rework).
 *  - avgReworkDepth  — mean attempts per landed incident (the iteration cost to
 *                      converge; 1.0 is ideal).
 *  - noFix / blocked — surfaced honestly but EXCLUDED from the quality math:
 *                      `no_fix_proposed` = the harness couldn't even generate a
 *                      candidate; `rate_limited` / `awaiting_hitl` = external or
 *                      human-in-the-loop stalls, not a harness-quality failure.
 *
 * Read-only, tenant-scoped, never throws — same contract as
 * summarizeOrchestrationEfficiency / summarizeSelfImprovement.
 */

import { db } from "./db";
import { logSilentCatch } from "./lib/silent-catch";
import { sql } from "drizzle-orm";

/** Land-rate floor: when the harness proposes and tests a fix, it should pass
 *  the verifier and stick more than half the time. Below this (with enough
 *  sample) the execute-verify loop is thrashing. */
const LAND_RATE_FLOOR = 0.5;
/** Minimum proposed-and-tested attempts before landRate can breach (avoids a
 *  false alarm on a handful of early attempts). */
const MIN_RAN_SAMPLE = 10;
const WINDOW_DAYS = 90;

export interface HarnessHealthSummary {
  windowDays: number;
  /** total repair attempts in the window (all outcomes). */
  attempts: number;
  /** distinct incidents the harness attempted. */
  incidents: number;
  landed: number;
  rolledBack: number;
  /** harness couldn't propose a fix at all (capability gap, not loop quality). */
  noFix: number;
  /** external / HITL stalls (rate_limited, awaiting_hitl) — excluded from quality math. */
  blocked: number;
  /** landed + rolledBack: attempts that actually proposed AND tested a fix. */
  ranAttempts: number;
  /** landed / ranAttempts — the verifier-pass rate (0 when nothing ran). */
  landRate: number;
  /** of incidents that eventually landed, fraction that landed on attempt #1. */
  firstPassYield: number;
  /** mean attempts per landed incident (rework cost to converge; 1.0 ideal). */
  avgReworkDepth: number;
  threshold: number;
  breached: boolean;
  degraded: boolean;
}

export interface HarnessHealthCounts {
  attempts: number;
  incidents: number;
  landed: number;
  rolledBack: number;
  noFix: number;
  blocked: number;
  /** distinct incidents with at least one landed attempt. */
  landedIncidents: number;
  /** distinct incidents whose attempt #1 landed. */
  firstTryLandedIncidents: number;
  /** sum of MAX(attempt_number) over landed incidents. */
  sumDepthLandedIncidents: number;
}

export function emptyHarnessHealthSummary(): HarnessHealthSummary {
  return {
    windowDays: WINDOW_DAYS,
    attempts: 0,
    incidents: 0,
    landed: 0,
    rolledBack: 0,
    noFix: 0,
    blocked: 0,
    ranAttempts: 0,
    landRate: 0,
    firstPassYield: 0,
    avgReworkDepth: 0,
    threshold: LAND_RATE_FLOOR,
    breached: false,
    degraded: false,
  };
}

/**
 * Pure, DB-free reduction of raw counts into the dashboard summary. Unit-tested
 * directly (keeps the test query-free so it can't hold the pg pool open).
 */
export function computeHarnessHealth(c: HarnessHealthCounts, windowDays = WINDOW_DAYS): HarnessHealthSummary {
  const landed = Math.max(0, c.landed | 0);
  const rolledBack = Math.max(0, c.rolledBack | 0);
  const ranAttempts = landed + rolledBack;
  const landRate = ranAttempts > 0 ? landed / ranAttempts : 0;
  const landedIncidents = Math.max(0, c.landedIncidents | 0);
  const firstPassYield = landedIncidents > 0 ? c.firstTryLandedIncidents / landedIncidents : 0;
  const avgReworkDepth = landedIncidents > 0 ? c.sumDepthLandedIncidents / landedIncidents : 0;
  return {
    windowDays,
    attempts: Math.max(0, c.attempts | 0),
    incidents: Math.max(0, c.incidents | 0),
    landed,
    rolledBack,
    noFix: Math.max(0, c.noFix | 0),
    blocked: Math.max(0, c.blocked | 0),
    ranAttempts,
    landRate: Math.round(landRate * 100) / 100,
    firstPassYield: Math.round(firstPassYield * 100) / 100,
    avgReworkDepth: Math.round(avgReworkDepth * 100) / 100,
    threshold: LAND_RATE_FLOOR,
    breached: ranAttempts >= MIN_RAN_SAMPLE && landRate < LAND_RATE_FLOOR,
    degraded: false,
  };
}

/**
 * Dashboard summary: process quality of the code-as-harness execute-verify-repair
 * loop. Read-only, tenant-scoped, never throws.
 */
export async function summarizeHarnessHealth(tenantId: number): Promise<HarnessHealthSummary> {
  if (!tenantId || !Number.isInteger(tenantId) || tenantId <= 0) {
    return emptyHarnessHealthSummary();
  }
  try {
    // Attempt grain: outcome distribution across the window.
    const aRes = await db.execute(sql`
      SELECT
        COUNT(*)::int AS attempts,
        COUNT(DISTINCT incident_id)::int AS incidents,
        COALESCE(SUM(CASE WHEN outcome = 'landed' THEN 1 ELSE 0 END), 0)::int AS landed,
        COALESCE(SUM(CASE WHEN outcome = 'rolled_back' THEN 1 ELSE 0 END), 0)::int AS rolled_back,
        COALESCE(SUM(CASE WHEN outcome = 'no_fix_proposed' THEN 1 ELSE 0 END), 0)::int AS no_fix,
        COALESCE(SUM(CASE WHEN outcome IN ('rate_limited', 'awaiting_hitl') THEN 1 ELSE 0 END), 0)::int AS blocked
      FROM repo_surgeon_attempts
      WHERE tenant_id = ${tenantId}
        AND created_at >= NOW() - make_interval(days => ${WINDOW_DAYS})
    `);
    const a = (((aRes as any).rows || aRes) as any[])[0] || {};

    // Incident grain: first-pass yield + rework depth, computed only over
    // incidents that eventually landed (an incident that never lands has no
    // meaningful convergence depth).
    const iRes = await db.execute(sql`
      WITH per_incident AS (
        SELECT
          incident_id,
          BOOL_OR(outcome = 'landed' AND attempt_number = 1) AS first_try,
          MAX(attempt_number) AS depth
        FROM repo_surgeon_attempts
        WHERE tenant_id = ${tenantId}
          AND incident_id IS NOT NULL
          AND created_at >= NOW() - make_interval(days => ${WINDOW_DAYS})
          AND incident_id IN (
            SELECT incident_id FROM repo_surgeon_attempts
            WHERE tenant_id = ${tenantId}
              AND outcome = 'landed'
              AND created_at >= NOW() - make_interval(days => ${WINDOW_DAYS})
          )
        GROUP BY incident_id
      )
      SELECT
        COUNT(*)::int AS landed_incidents,
        COALESCE(SUM(CASE WHEN first_try THEN 1 ELSE 0 END), 0)::int AS first_try_landed,
        COALESCE(SUM(depth), 0)::int AS sum_depth
      FROM per_incident
    `);
    const i = (((iRes as any).rows || iRes) as any[])[0] || {};

    return computeHarnessHealth({
      attempts: Number(a.attempts) || 0,
      incidents: Number(a.incidents) || 0,
      landed: Number(a.landed) || 0,
      rolledBack: Number(a.rolled_back) || 0,
      noFix: Number(a.no_fix) || 0,
      blocked: Number(a.blocked) || 0,
      landedIncidents: Number(i.landed_incidents) || 0,
      firstTryLandedIncidents: Number(i.first_try_landed) || 0,
      sumDepthLandedIncidents: Number(i.sum_depth) || 0,
    });
  } catch (_silentErr) {
    logSilentCatch("server/harness-health.ts", _silentErr);
    return { ...emptyHarnessHealthSummary(), degraded: true };
  }
}
