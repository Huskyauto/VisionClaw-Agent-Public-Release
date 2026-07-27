/**
 * Process Reward Model (R125+14 — Manus agentic gap #3b).
 *
 * Scores INTERMEDIATE plan steps, not just the final deliverable. The existing
 * deliverable-grader/critique-agent judge final output; this judges the reasoning
 * path step-by-step so the orchestrator can (a) detect a degrading trajectory
 * early and (b) feed the weakest step into continuous-replanning.
 *
 * Default scorer is DETERMINISTIC and LLM-FREE so it is cheap enough to run on
 * every step of every plan. It rewards real progress (concrete output toward the
 * objective) and penalises hollow success (success=true with no payload), failure,
 * and timeouts — the failure modes that silently degrade multi-step plans.
 */
import { db } from "../db";
import { sql } from "drizzle-orm";
import { logSilentCatch } from "../lib/silent-catch";

export interface StepRewardInput {
  tenantId: number;
  stepIndex: number;
  success: boolean;
  planId?: number | null;
  runId?: number | null;
  conversationId?: number | null;
  agent?: string | null;
  task?: string | null;
  summary?: string;
  output?: any;
  error?: string;
  durationMs?: number;
}

export interface StepRewardResult {
  score: number; // 0..100
  rationale: string;
  signals: Record<string, any>;
}

export function heuristicStepScore(i: StepRewardInput): StepRewardResult {
  let score = 50;
  const signals: Record<string, any> = {};

  if (i.success === false) {
    score -= 35;
    signals.failed = true;
  } else {
    score += 20;
  }

  const outLen = i.output == null ? 0 : (typeof i.output === "string" ? i.output.length : JSON.stringify(i.output).length);
  signals.outputLen = outLen;
  if (i.success !== false && outLen < 20) {
    score -= 20; // claims success but produced essentially nothing
    signals.hollowSuccess = true;
  } else if (outLen > 80) {
    score += 10;
  }

  if (i.summary && i.summary.trim().length > 10) score += 5;
  if (i.error) signals.error = String(i.error).slice(0, 160);
  if (typeof i.durationMs === "number") {
    signals.durationMs = i.durationMs;
    if (i.durationMs > 55_000) { score -= 5; signals.slow = true; }
  }

  score = Math.max(0, Math.min(100, score));
  const rationale =
    i.success === false ? `Step failed: ${String(i.error || i.summary || "unknown").slice(0, 140)}`
    : signals.hollowSuccess ? "Reported success but produced negligible output for the next step"
    : "Step produced concrete output advancing the objective";
  return { score, rationale, signals };
}

/**
 * Live degrading-trajectory detector (R125+ — Sol review #6: "the dashboard can
 * notice the car drifting toward the ditch, but the steering wheel does not
 * react until it hits the ditch").
 *
 * Pure + sync so the plan executor can steer DURING execution without a DB
 * read-back. A SUCCESSFUL step scores ≥45 at minimum; the only way a successful
 * step lands ≤50 is the hollow-success penalty (claimed success, negligible
 * output). Two of those in a row means downstream steps are about to build on
 * nothing — replan-worthy even though no step has technically failed.
 */
export const DEGRADING_STEP_SCORE_MAX = 50;

export function isDegradingTrajectory(recentScores: number[]): boolean {
  if (recentScores.length < 2) return false;
  const a = recentScores[recentScores.length - 2];
  const b = recentScores[recentScores.length - 1];
  return a <= DEGRADING_STEP_SCORE_MAX && b <= DEGRADING_STEP_SCORE_MAX;
}

/**
 * Pure trigger decision for the Sol #6 degrading-trajectory replan branch in
 * plan-executor. Extracted so the EXACT branch condition (bounds + detector +
 * pivot selection + issue wording) is unit-testable without importing the
 * executor (which transitively pulls db + server/tools.ts — untestable).
 * The executor calls this and acts on the result verbatim.
 */
export interface DegradingReplanDecision {
  trigger: boolean;
  /** Step number of the weaker of the last two scored steps (the replan pivot). */
  pivotN?: number;
  /** Human-readable issue string passed to the replanner. */
  issue?: string;
}

export function decideDegradingReplan(
  trail: Array<{ n: number; score: number; rationale: string }>,
  opts: { pendingCount: number; degradingReplanUsed: boolean; replanCount: number; maxReplans: number },
): DegradingReplanDecision {
  if (opts.pendingCount <= 0) return { trigger: false };
  if (opts.degradingReplanUsed) return { trigger: false };
  if (opts.replanCount >= opts.maxReplans) return { trigger: false };
  if (!isDegradingTrajectory(trail.map(s => s.score))) return { trigger: false };
  const lastTwo = trail.slice(-2);
  const weakest = lastTwo[0].score <= lastTwo[1].score ? lastTwo[0] : lastTwo[1];
  const other = lastTwo[0] === weakest ? lastTwo[1] : lastTwo[0];
  return {
    trigger: true,
    pivotN: weakest.n,
    issue: `${weakest.rationale} (score ${weakest.score}/100; previous step scored ${other.score}/100)`,
  };
}

export async function recordStepReward(i: StepRewardInput): Promise<StepRewardResult> {
  const result = heuristicStepScore(i);
  try {
    await db.execute(sql`
      INSERT INTO step_rewards
        (tenant_id, plan_id, run_id, conversation_id, step_index, agent, score, rationale, signals, model)
      VALUES
        (${i.tenantId}, ${i.planId ?? null}, ${i.runId ?? null}, ${i.conversationId ?? null},
         ${i.stepIndex}, ${i.agent ?? null}, ${result.score}, ${result.rationale},
         ${JSON.stringify(result.signals)}::jsonb, ${"heuristic-prm"})
    `);
  } catch (e) { logSilentCatch("server/agentic/step-reward.ts", e); }
  return result;
}

export async function getPlanStepRewards(tenantId: number, planId: number): Promise<any[]> {
  const r: any = await db.execute(sql`
    SELECT * FROM step_rewards WHERE tenant_id = ${tenantId} AND plan_id = ${planId} ORDER BY step_index ASC
  `);
  return (r.rows ?? r) as any[];
}

export interface PlanRewardSummary {
  count: number;
  avg: number;
  min: number;
  weakestStepIndex: number | null;
  weakestRationale: string | null;
  trajectory: "improving" | "degrading" | "flat" | "n/a";
}

export async function getPlanRewardSummary(tenantId: number, planId: number): Promise<PlanRewardSummary> {
  const rows = await getPlanStepRewards(tenantId, planId);
  if (rows.length === 0) {
    return { count: 0, avg: 0, min: 0, weakestStepIndex: null, weakestRationale: null, trajectory: "n/a" };
  }
  const scores = rows.map(r => r.score as number);
  const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
  let weakest = rows[0];
  for (const r of rows) if (r.score < weakest.score) weakest = r;
  let trajectory: PlanRewardSummary["trajectory"] = "flat";
  if (scores.length >= 2) {
    const firstHalf = scores.slice(0, Math.floor(scores.length / 2));
    const secondHalf = scores.slice(Math.floor(scores.length / 2));
    const a = firstHalf.reduce((x, y) => x + y, 0) / firstHalf.length;
    const b = secondHalf.reduce((x, y) => x + y, 0) / secondHalf.length;
    trajectory = b - a > 8 ? "improving" : a - b > 8 ? "degrading" : "flat";
  }
  return {
    count: rows.length, avg: Math.round(avg), min: Math.min(...scores),
    weakestStepIndex: weakest.step_index, weakestRationale: weakest.rationale, trajectory,
  };
}
