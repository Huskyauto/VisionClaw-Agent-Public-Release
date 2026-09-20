/**
 * Climb Tracker — self-improvement OUTPUT over time.
 *
 * The Orchestration Efficiency and Delivery Funnel cards measure whether the
 * platform's *work* is honest (predicted-vs-actual cost; produce→ship→adopt).
 * This card measures whether the platform is actually *climbing* — i.e. whether
 * its self-improvement loop is still shipping output week over week, or has
 * quietly stalled. Two solidly-timestamped streams make up the weekly output:
 *
 *   · proposals shipped  — code_proposals that reached `applied` or `ready`
 *                          (a research finding that became a real, verified diff)
 *   · findings closed     — repair_incidents resolved (a defect the self-repair
 *                          loop actually fixed, not just escalated)
 *
 * (Skill upgrades would be a third stream but the `skills` table carries no
 * created/updated timestamp, so a weekly count isn't derivable — folding it in
 * would be a fabricated signal, which this card deliberately avoids.)
 *
 * Honesty-first, mirroring delivery-funnel: `breached` fires ONLY when there was
 * prior output but the recent window produced essentially none (a stalled climb)
 * — zero-everywhere is "no data", never a breach. `degraded` flags a failed
 * query so the card shows an honest "telemetry unavailable" instead of healthy
 * zeros. `summarizeClimbTracker` NEVER throws.
 */
import { db } from "./db";
import { sql } from "drizzle-orm";

export interface ClimbWeek {
  weekStart: string;
  proposalsShipped: number;
  findingsClosed: number;
  total: number;
}

export interface ClimbTrackerSummary {
  windowWeeks: number;
  weekly: ClimbWeek[];
  thisWeekTotal: number;
  priorAvgTotal: number;
  trendDelta: number;
  totalOutput: number;
  recentWeeks: number;
  threshold: number;
  breached: boolean;
  degraded: boolean;
}

const WINDOW_WEEKS = 8;
const RECENT_WEEKS = 2;
const STALL_THRESHOLD = 1; // < this many outputs across the recent window (with prior activity) = stalled climb

export function emptyClimbTracker(degraded = false): ClimbTrackerSummary {
  return {
    windowWeeks: WINDOW_WEEKS,
    weekly: [],
    thisWeekTotal: 0,
    priorAvgTotal: 0,
    trendDelta: 0,
    totalOutput: 0,
    recentWeeks: RECENT_WEEKS,
    threshold: STALL_THRESHOLD,
    breached: false,
    degraded,
  };
}

/**
 * Pure metric computation over an ordered (oldest→newest) list of weekly output.
 * No DB / IO — unit-testable in isolation.
 */
export function computeClimbMetrics(
  weekly: ClimbWeek[],
): Pick<
  ClimbTrackerSummary,
  "thisWeekTotal" | "priorAvgTotal" | "trendDelta" | "totalOutput" | "recentWeeks" | "threshold" | "breached"
> {
  const totalOutput = weekly.reduce((s, w) => s + w.total, 0);
  const thisWeekTotal = weekly.length ? weekly[weekly.length - 1].total : 0;

  const prior = weekly.slice(0, -1);
  const priorAvgTotal = prior.length
    ? prior.reduce((s, w) => s + w.total, 0) / prior.length
    : 0;

  const recent = weekly.slice(-RECENT_WEEKS);
  const recentOutput = recent.reduce((s, w) => s + w.total, 0);
  const priorOutput = totalOutput - recentOutput;

  // Stalled climb: there WAS self-improvement output earlier in the window, but
  // the recent window produced (essentially) none. A platform that has never
  // produced anything is "no data", not a regression — so require priorOutput>0.
  const breached = priorOutput > 0 && recentOutput < STALL_THRESHOLD;

  return {
    thisWeekTotal,
    priorAvgTotal: Math.round(priorAvgTotal * 100) / 100,
    trendDelta: Math.round((thisWeekTotal - priorAvgTotal) * 100) / 100,
    totalOutput,
    recentWeeks: RECENT_WEEKS,
    threshold: STALL_THRESHOLD,
    breached,
  };
}

export async function summarizeClimbTracker(tenantId: number): Promise<ClimbTrackerSummary> {
  if (!tenantId || !Number.isInteger(tenantId) || tenantId <= 0) {
    return emptyClimbTracker(false);
  }

  try {
    const res = await db.execute(sql`
      WITH weeks AS (
        SELECT generate_series(
          date_trunc('week', NOW()) - make_interval(weeks => ${WINDOW_WEEKS - 1}),
          date_trunc('week', NOW()),
          interval '1 week'
        )::date AS wk
      ),
      props AS (
        SELECT date_trunc('week', created_at)::date AS wk,
               COUNT(*) FILTER (WHERE status IN ('applied', 'ready'))::int AS n
        FROM code_proposals
        WHERE tenant_id = ${tenantId}
          AND created_at >= date_trunc('week', NOW()) - make_interval(weeks => ${WINDOW_WEEKS - 1})
        GROUP BY 1
      ),
      finds AS (
        -- Bucket a closed defect into the week it was RESOLVED, not created — an
        -- incident opened weeks ago but fixed this week is this week's output.
        SELECT date_trunc('week', resolved_at)::date AS wk,
               COUNT(*)::int AS n
        FROM repair_incidents
        WHERE tenant_id = ${tenantId}
          AND resolved = true
          AND resolved_at IS NOT NULL
          AND resolved_at >= date_trunc('week', NOW()) - make_interval(weeks => ${WINDOW_WEEKS - 1})
        GROUP BY 1
      )
      SELECT w.wk,
             COALESCE(p.n, 0)::int AS proposals,
             COALESCE(f.n, 0)::int AS findings
      FROM weeks w
      LEFT JOIN props p ON p.wk = w.wk
      LEFT JOIN finds f ON f.wk = w.wk
      ORDER BY w.wk
    `);

    const rows = ((res as any).rows || res) as Array<{ wk: string; proposals: number; findings: number }>;
    const weekly: ClimbWeek[] = rows.map((r) => {
      const proposalsShipped = Number(r.proposals) || 0;
      const findingsClosed = Number(r.findings) || 0;
      return {
        weekStart: String(r.wk),
        proposalsShipped,
        findingsClosed,
        total: proposalsShipped + findingsClosed,
      };
    });

    return {
      windowWeeks: WINDOW_WEEKS,
      weekly,
      degraded: false,
      ...computeClimbMetrics(weekly),
    };
  } catch (err) {
    console.error(`[climb-tracker] summarize failed: ${(err as Error)?.message || err}`);
    return emptyClimbTracker(true);
  }
}
