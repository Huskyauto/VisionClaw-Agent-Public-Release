/**
 * Feedback-Loop Accountability — "don't generate artifacts for the graveyard."
 *
 * Borrowed behavior from the Hermes SOUL.md operating charter (triaged
 * 2026-06-07, docs/external-repo-triage-log.md): proactive output is the
 * baseline, but it is not enough — if the work the agent SURFACES is never
 * acted on, the feedback loop is broken. Either the output isn't hitting the
 * mark, or it's good and being ignored. Both failure modes should be visible,
 * not silent.
 *
 * This is the measurement half (the "make it measurable" move, same shape as
 * the Orchestration Efficiency card / arXiv:2605.22687). It answers: of the
 * work the platform has surfaced to the owner — capability gaps it detected and
 * follow-ups it scheduled — how much got acted on, and how much is rotting in
 * the graveyard (open + stale)?
 *
 *   surfaced   ← capability_gaps (all) + agent_wake_schedules kind='follow_up' (all)
 *   acted-on   ← capability_gaps status='resolved' + follow-ups status='completed'
 *   graveyard  ← gaps open > 14 days + follow-ups pending past their wake_at
 *
 * Read-only. Pure telemetry. Never throws into a caller.
 */

import { db } from "./db";
import { logSilentCatch } from "./lib/silent-catch";
import { sql } from "drizzle-orm";

export interface FeedbackLoopSummary {
  /** total items the platform surfaced to the owner (gaps + follow-ups). */
  surfaced: number;
  /** of those, how many reached a terminal acted-on state. */
  actedOn: number;
  /** actedOn / surfaced (1.0 when nothing has been surfaced yet). */
  actedRatio: number;
  /** items sitting unactioned past their staleness window — the "graveyard". */
  staleCount: number;
  /** age in days of the oldest stale item (0 if none). */
  oldestStaleDays: number;
  gaps: { open: number; resolved: number; stale: number };
  followups: { pending: number; completed: number; overdue: number };
  /** acted-ratio floor below which the loop is considered broken. */
  threshold: number;
  breached: boolean;
  /** true when the summary could not be computed (DB error) — lets consumers
   * distinguish a real failure from a genuinely clean zero state. */
  unavailable?: boolean;
}

// A capability gap open longer than this is no longer "in progress" — it's
// being ignored. Tunable.
const GAP_STALE_DAYS = 14;
// Acted-on floor: if <50% of a meaningful sample was ever acted on, the loop
// is leaking work into the graveyard.
const ACTED_RATIO_THRESHOLD = 0.5;
// Hard pile-up alarm: this many genuinely-stale items breaches regardless of
// ratio (a small new tenant shouldn't hide a real backlog behind a clean ratio).
const STALE_BREACH_COUNT = 5;
// Below this sample size the ratio is statistically meaningless — only the hard
// stale-count alarm applies.
const MIN_SAMPLE = 10;

/**
 * Pure breach decision — extracted so the boundary conditions can be unit-tested
 * without a DB round-trip. Breached when EITHER the acted-on ratio is below the
 * floor on a meaningful sample, OR there's a hard pile-up of stale items.
 */
export function evaluateFeedbackLoopBreach(surfaced: number, actedRatio: number, staleCount: number): boolean {
  const ratioBreached = surfaced >= MIN_SAMPLE && actedRatio < ACTED_RATIO_THRESHOLD;
  const pileupBreached = staleCount >= STALE_BREACH_COUNT;
  return ratioBreached || pileupBreached;
}

const EMPTY: FeedbackLoopSummary = {
  surfaced: 0,
  actedOn: 0,
  actedRatio: 1,
  staleCount: 0,
  oldestStaleDays: 0,
  gaps: { open: 0, resolved: 0, stale: 0 },
  followups: { pending: 0, completed: 0, overdue: 0 },
  threshold: ACTED_RATIO_THRESHOLD,
  breached: false,
};

/**
 * Dashboard summary: surfaced-vs-acted-on accountability for owner-facing work.
 * Read-only; returns a clean zero state on any error.
 */
export async function summarizeFeedbackLoop(tenantId: number): Promise<FeedbackLoopSummary> {
  if (!tenantId || !Number.isInteger(tenantId) || tenantId <= 0) return { ...EMPTY };

  try {
    // Capability gaps the platform surfaced.
    const gapRes = await db.execute(sql`
      SELECT
        COUNT(*)::int AS total,
        COALESCE(SUM(CASE WHEN status = 'resolved' THEN 1 ELSE 0 END), 0)::int AS resolved,
        COALESCE(SUM(CASE WHEN status <> 'resolved' THEN 1 ELSE 0 END), 0)::int AS open,
        COALESCE(SUM(CASE WHEN status <> 'resolved'
                          AND created_at < NOW() - (${GAP_STALE_DAYS} || ' days')::interval
                     THEN 1 ELSE 0 END), 0)::int AS stale,
        COALESCE(EXTRACT(EPOCH FROM (NOW() - MIN(
          CASE WHEN status <> 'resolved' THEN created_at END))) / 86400.0, 0) AS oldest_open_days
      FROM capability_gaps
      WHERE tenant_id = ${tenantId}
    `);
    const g = (((gapRes as any).rows || gapRes) as any[])[0] || {};

    // Follow-ups the platform scheduled for itself on the owner's behalf.
    const fuRes = await db.execute(sql`
      SELECT
        COUNT(*)::int AS total,
        COALESCE(SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END), 0)::int AS completed,
        COALESCE(SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END), 0)::int AS pending,
        COALESCE(SUM(CASE WHEN status = 'pending' AND wake_at < NOW() THEN 1 ELSE 0 END), 0)::int AS overdue,
        COALESCE(EXTRACT(EPOCH FROM (NOW() - MIN(
          CASE WHEN status = 'pending' AND wake_at < NOW() THEN wake_at END))) / 86400.0, 0) AS oldest_overdue_days
      FROM agent_wake_schedules
      WHERE tenant_id = ${tenantId} AND kind = 'follow_up'
    `);
    const f = (((fuRes as any).rows || fuRes) as any[])[0] || {};

    const gaps = {
      open: Number(g.open) || 0,
      resolved: Number(g.resolved) || 0,
      stale: Number(g.stale) || 0,
    };
    const followups = {
      pending: Number(f.pending) || 0,
      completed: Number(f.completed) || 0,
      overdue: Number(f.overdue) || 0,
    };

    const surfaced = (Number(g.total) || 0) + (Number(f.total) || 0);
    const actedOn = gaps.resolved + followups.completed;
    const actedRatio = surfaced > 0 ? actedOn / surfaced : 1;

    const staleCount = gaps.stale + followups.overdue;
    const oldestStaleDays = Math.max(
      gaps.stale > 0 ? Number(g.oldest_open_days) || 0 : 0,
      followups.overdue > 0 ? Number(f.oldest_overdue_days) || 0 : 0,
    );

    return {
      surfaced,
      actedOn,
      actedRatio: Math.round(actedRatio * 100) / 100,
      staleCount,
      oldestStaleDays: Math.round(oldestStaleDays * 10) / 10,
      gaps,
      followups,
      threshold: ACTED_RATIO_THRESHOLD,
      breached: evaluateFeedbackLoopBreach(surfaced, actedRatio, staleCount),
    };
  } catch (_silentErr) {
    logSilentCatch("server/feedback-loop-accountability.ts", _silentErr);
    // Flag the failure so a dashboard/governance check can tell a DB error
    // apart from a real clean zero state (the EMPTY shape looks healthy).
    return { ...EMPTY, unavailable: true };
  }
}
