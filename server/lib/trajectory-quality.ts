/**
 * Trajectory / Process-Quality scoring — "evaluation beyond final task success".
 *
 * The standing gap surfaced repeatedly by external surveys + the Roitman
 * "Hitchhiker's Guide to Agentic AI" textbook (arXiv:2606.24937, ch.20 +
 * ch.29.2.6 "Evaluation Beyond Benchmarks" / cost-quality frontiers): VisionClaw
 * already measures OUTCOMES well (delivery funnel, orchestration efficiency,
 * self-improvement catch-rate) but grades HOW WELL a run executed — the
 * trajectory quality — only thinly. Two orchestrations can both "succeed" while
 * one wasted half its steps on redundant tool calls and failed-then-retried work.
 *
 * This module is the cheap, deterministic, NO-LLM process-quality grader. It
 * turns a finished orchestration's trajectory into a 0..1 composite plus the
 * sub-signals that produced it, so the felt-vs-real "it worked" can be checked
 * against the real execution path. Pure functions only — unit-testable,
 * sub-millisecond, never touches the DB or an LLM.
 */

export interface TrajectoryInput {
  /** total discrete steps / actions in the run. */
  steps: number;
  /** steps that finished successfully. */
  completed: number;
  /** steps that ended in failure (distinct from merely pending). */
  failed: number;
  /** total retry / rework attempts across the run (optional). */
  retries?: number;
  /** steps that duplicated an earlier step's work (optional; see countRedundantToolChains). */
  redundantSteps?: number;
}

export interface TrajectoryScore {
  /** composite 0..1 — higher is a cleaner, more efficient execution path. */
  processQuality: number;
  /** completed / steps. */
  completionRate: number;
  /** failed / steps. */
  failureRate: number;
  /** redundantSteps / steps. */
  redundancyRate: number;
  /** retries / steps. */
  reworkRate: number;
  /** human-readable explanation of what dragged the score. */
  signals: string[];
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// Penalty weights — chosen so that a fully-completed, zero-waste run scores 1.0,
// and each quality defect chips away proportionally. Failures cost more than
// mere incompletion (a failed step burned budget); redundancy is the next worst
// (pure waste); rework (retries) is the mildest (often legitimate resilience).
const W_FAILURE = 0.25;
const W_REDUNDANCY = 0.3;
const W_REWORK = 0.2;

/**
 * Score a finished orchestration trajectory. Pure + deterministic.
 *
 * Guard: a run with no steps is "unknown", scored 0 with an explicit signal so a
 * caller never mistakes empty telemetry for a perfect run.
 */
export function scoreTrajectory(input: TrajectoryInput): TrajectoryScore {
  const steps = Math.max(0, Math.floor(input.steps || 0));
  if (steps <= 0) {
    return {
      processQuality: 0,
      completionRate: 0,
      failureRate: 0,
      redundancyRate: 0,
      reworkRate: 0,
      signals: ["no steps recorded"],
    };
  }

  const completed = Math.max(0, Math.min(steps, Math.floor(input.completed || 0)));
  const failed = Math.max(0, Math.min(steps, Math.floor(input.failed || 0)));
  // redundant / retries are NOT bounded by steps (a single step can be retried
  // several times) but the *rate* is clamped to 1 so one pathological step can't
  // drive the composite negative beyond the weight.
  const redundantSteps = Math.max(0, Math.floor(input.redundantSteps || 0));
  const retries = Math.max(0, Math.floor(input.retries || 0));

  const completionRate = clamp01(completed / steps);
  const failureRate = clamp01(failed / steps);
  const redundancyRate = clamp01(redundantSteps / steps);
  const reworkRate = clamp01(retries / steps);

  const processQuality = clamp01(
    completionRate
      - W_FAILURE * failureRate
      - W_REDUNDANCY * redundancyRate
      - W_REWORK * reworkRate,
  );

  const signals: string[] = [];
  if (completionRate < 1) {
    signals.push(`${completed}/${steps} steps completed`);
  }
  if (failed > 0) signals.push(`${failed} failed`);
  if (redundantSteps > 0) signals.push(`${redundantSteps} redundant`);
  if (retries > 0) signals.push(`${retries} retr${retries === 1 ? "y" : "ies"}`);
  if (signals.length === 0) signals.push("clean run");

  return {
    processQuality: round2(processQuality),
    completionRate: round2(completionRate),
    failureRate: round2(failureRate),
    redundancyRate: round2(redundancyRate),
    reworkRate: round2(reworkRate),
    signals,
  };
}

/**
 * Count steps whose tool-chain signature exactly repeats an earlier step's — a
 * cheap, deterministic redundancy proxy. The FIRST occurrence of any signature
 * is legitimate work; every later identical chain counts as redundant.
 *
 * Empty chains are ignored (a step with no tools isn't "redundant work").
 */
export function countRedundantToolChains(chains: Array<string[] | undefined>): number {
  const seen = new Set<string>();
  let redundant = 0;
  for (const chain of chains) {
    if (!Array.isArray(chain) || chain.length === 0) continue;
    // order-independent signature so [a,b] and [b,a] count as the same work.
    const sig = [...chain].map(t => String(t)).sort().join("|");
    if (seen.has(sig)) {
      redundant++;
    } else {
      seen.add(sig);
    }
  }
  return redundant;
}
