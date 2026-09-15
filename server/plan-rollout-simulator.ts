// R74.13z-quint Nugget 3: Imagined Plan Rollout (LeWM-inspired).
//
// LeWorldModel (Maes et al. arXiv:2603.19312v1) trains a latent predictor so
// agents can roll out hypothetical action sequences in milliseconds and only
// execute the best one in reality. We adapt that to text/agent work where the
// "world" is the felix_proposals trace: every step has (kind, target,
// target_args) → (status, execution_result, surprise_score). For each
// candidate plan step, we kNN-look-up similar historical steps, average their
// success rate / cost / surprise, and chain the results into a plan-level
// prediction Felix can read BEFORE committing real $ and time.
//
// Output is intentionally one tiny object: { predicted_success, estimated_cost
// _cents, weak_links, detail }. Personas don't need to understand embeddings
// — they just need to read the score, the cost, and the names of any weak
// links.

import { db } from "./db";
import { sql } from "drizzle-orm";
import { generateEmbedding } from "./embeddings";
import { logSilentCatch } from "./lib/silent-catch";

// Spec: kNN over completed felix_proposals same kind, up to 200 neighbors.
const KNN_NEIGHBORS = 200;
const MIN_NEIGHBORS_FOR_PREDICTION = 3;
const WEAK_LINK_SUCCESS_THRESHOLD = 0.5;
// Laplace (add-α) smoothing for success rate: (successes + α) / (neighbors + 2α).
// α=1 = classic Laplace; pulls tiny-N rates toward 0.5 instead of letting one
// stale neighbor swing predictions wildly.
const LAPLACE_ALPHA = 1.0;
// Recommendation thresholds (Bob's spec): approve >70%, review 35–70%, rework <35%.
const APPROVE_THRESHOLD = 0.70;
const REVIEW_THRESHOLD = 0.35;
// Autocorrelation penalty: repeated identical kinds compound risk (if step 3
// of a plan is "research_topic" and steps 1+2 were also "research_topic", the
// real success rate of the chain is lower than the naive product because
// failure modes are correlated, not independent). 5% penalty per prior repeat,
// capped at 25%.
const AUTOCORR_PER_REPEAT = 0.05;
const AUTOCORR_MAX_PENALTY = 0.25;

export interface PlanStepInput {
  kind: string;
  target?: string | null;
  target_args?: any;
  summary?: string;
}

export interface PerStepPrediction {
  index: number;
  kind: string;
  target: string | null;
  neighbors_used: number;
  success_rate: number;       // 0..1
  avg_cost_cents: number;     // estimated
  avg_surprise_score: number; // 0..2 (cosine distance band metric)
  is_weak_link: boolean;
  detail: string;
}

export interface PlanPrediction {
  simulationId: number | null;
  predicted_success: number;     // chained probability (product of per-step rates)
  estimated_cost_cents: number;  // sum of per-step cost estimates
  weak_links: { index: number; kind: string; success_rate: number; reason: string }[];
  per_step: PerStepPrediction[];
  detail: string;
  recommendation: "approve" | "review" | "rework";
}

function toPgVector(arr: number[]): string {
  return `[${arr.join(",")}]`;
}

function buildArgsBlob(p: PlanStepInput): string {
  const args = (() => {
    try {
      const j = typeof p.target_args === "string" ? p.target_args : JSON.stringify(p.target_args ?? {});
      return j.slice(0, 500);
    } catch {
      return "";
    }
  })();
  const parts = [
    `kind=${p.kind}`,
    p.target ? `target=${p.target.slice(0, 120)}` : "",
    `args=${args}`,
    p.summary ? `summary=${p.summary.slice(0, 200)}` : "",
  ].filter(Boolean);
  return parts.join(" | ");
}

function classifySuccess(status: string | null, surprise_band: string | null): boolean {
  if (status === "executed") {
    // Executed but high-surprise still counts as soft-failure for prediction.
    if (surprise_band === "red") return false;
    return true;
  }
  return false;
}

async function predictStep(step: PlanStepInput, index: number, tenantId: number): Promise<PerStepPrediction & { degraded?: boolean }> {
  const blob = buildArgsBlob(step);
  const emb = await generateEmbedding(blob);
  if (!emb || emb.length !== 1536) {
    // DEGRADED — surface explicitly so callers/UI can show a yellow chip
    // instead of silently treating an outage as "0.5 = neutral".
    return {
      index, kind: step.kind, target: step.target ?? null, neighbors_used: 0,
      success_rate: 0.5, avg_cost_cents: 0, avg_surprise_score: 0, is_weak_link: false,
      detail: "DEGRADED: embedding service unavailable; using 0.5 placeholder",
      degraded: true,
    };
  }
  const vec = toPgVector(emb);

  // kNN over historical proposals of the same kind that have an arg embedding
  // and have been resolved (not pending/executing). Up to 200 neighbors per
  // spec; we'll similarity-weight them so the closest matches dominate.
  const r: any = await db.execute(sql`
    SELECT id, status, surprise_band, surprise_score, estimated_cost_cents,
           1 - (args_embedding <=> ${vec}::vector) AS args_sim
    FROM felix_proposals
    WHERE tenant_id = ${tenantId}
      AND kind = ${step.kind}
      AND args_embedding IS NOT NULL
      AND status IN ('executed', 'verification_failed', 'rejected')
    ORDER BY args_embedding <=> ${vec}::vector
    LIMIT ${KNN_NEIGHBORS}
  `);
  const neighbors = r.rows || [];
  if (neighbors.length < MIN_NEIGHBORS_FOR_PREDICTION) {
    // DEGRADED — too little history to score; Laplace prior (α/2α = 0.5)
    // pulled toward 0.6 to slightly favor "let it run" when truly unknown.
    return {
      index, kind: step.kind, target: step.target ?? null, neighbors_used: neighbors.length,
      success_rate: 0.6, avg_cost_cents: 0, avg_surprise_score: 0, is_weak_link: false,
      detail: `DEGRADED: only ${neighbors.length} historical neighbors of kind '${step.kind}' (need ${MIN_NEIGHBORS_FOR_PREDICTION}); using 0.6 prior`,
      degraded: true,
    };
  }

  // Similarity-weighted Laplace-smoothed success rate. Closer historical
  // matches count more; one stale outlier can't dominate.
  // weight_i = max(args_sim_i, 0.05) — clamp so distant neighbors still count
  // a little but don't drive the prediction.
  let weightedSuccess = 0;
  let weightedTotal = 0;
  let weightedCost = 0;
  let weightedSurprise = 0;
  let surpriseWeightTotal = 0;
  let rawSuccessCount = 0;
  for (const n of neighbors) {
    const w = Math.max(Number(n.args_sim) || 0, 0.05);
    const succ = classifySuccess(n.status, n.surprise_band) ? 1 : 0;
    rawSuccessCount += succ;
    weightedSuccess += w * succ;
    weightedTotal += w;
    weightedCost += w * (Number(n.estimated_cost_cents) || 0);
    if (n.surprise_score !== null && n.surprise_score !== undefined) {
      weightedSurprise += w * Number(n.surprise_score);
      surpriseWeightTotal += w;
    }
  }
  // Laplace smoothing on the weighted ratio. Treat weightedTotal as the
  // effective N, weightedSuccess as the effective k.
  const successRate = (weightedSuccess + LAPLACE_ALPHA) / (weightedTotal + 2 * LAPLACE_ALPHA);
  const avgCost = weightedTotal > 0 ? weightedCost / weightedTotal : 0;
  const avgSurprise = surpriseWeightTotal > 0 ? weightedSurprise / surpriseWeightTotal : 0;

  return {
    index, kind: step.kind, target: step.target ?? null,
    neighbors_used: neighbors.length,
    success_rate: successRate,
    avg_cost_cents: Math.round(avgCost),
    avg_surprise_score: avgSurprise,
    is_weak_link: successRate < WEAK_LINK_SUCCESS_THRESHOLD,
    detail: `${rawSuccessCount}/${neighbors.length} similar historical steps succeeded (similarity-weighted Laplace-smoothed rate ${(successRate * 100).toFixed(1)}%, avg cost ${Math.round(avgCost)}¢, avg surprise ${avgSurprise.toFixed(3)})`,
  };
}

export async function simulatePlanRollout(
  steps: PlanStepInput[],
  options: { tenantId: number; planSummary?: string; persist?: boolean },
): Promise<PlanPrediction & { degraded: boolean }> {
  // Tenant is REQUIRED to prevent cross-tenant data access. No silent default.
  if (typeof options?.tenantId !== "number" || !Number.isFinite(options.tenantId)) {
    throw new Error("simulatePlanRollout: tenantId is required (no default to prevent cross-tenant leakage)");
  }
  const tenantId = options.tenantId;
  // Default to NON-persistent (read-only) so simulate_plan is safe to call
  // from any agent without polluting the simulations table or risking writes
  // under a missing tenant context.
  const persist = options.persist === true;

  if (!steps || steps.length === 0) {
    return {
      simulationId: null, predicted_success: 0, estimated_cost_cents: 0,
      weak_links: [], per_step: [], detail: "empty plan",
      recommendation: "rework", degraded: false,
    };
  }

  const perStep: (PerStepPrediction & { degraded?: boolean })[] = [];
  for (let i = 0; i < steps.length; i++) {
    perStep.push(await predictStep(steps[i], i, tenantId));
  }
  const anyDegraded = perStep.some(s => s.degraded === true);

  // Chained probability of the whole plan succeeding = product of per-step
  // rates × autocorrelation penalty. Repeated kinds compound risk because
  // failure modes are correlated, so we shave off AUTOCORR_PER_REPEAT for
  // each prior occurrence of the same kind, capped at AUTOCORR_MAX_PENALTY.
  const kindCounts = new Map<string, number>();
  let autocorrPenalty = 0;
  for (const s of perStep) {
    const prior = kindCounts.get(s.kind) ?? 0;
    if (prior > 0) autocorrPenalty += AUTOCORR_PER_REPEAT;
    kindCounts.set(s.kind, prior + 1);
  }
  autocorrPenalty = Math.min(autocorrPenalty, AUTOCORR_MAX_PENALTY);
  const rawChained = perStep.reduce((acc, s) => acc * Math.max(s.success_rate, 0.01), 1);
  const chained = rawChained * (1 - autocorrPenalty);

  const totalCost = perStep.reduce((acc, s) => acc + s.avg_cost_cents, 0);
  const weak = perStep
    .filter(s => s.is_weak_link)
    .map(s => ({
      index: s.index, kind: s.kind, success_rate: s.success_rate,
      reason: `${(s.success_rate * 100).toFixed(0)}% historical success rate, below ${WEAK_LINK_SUCCESS_THRESHOLD * 100}% threshold`,
    }));

  let recommendation: "approve" | "review" | "rework";
  if (chained > APPROVE_THRESHOLD && weak.length === 0) recommendation = "approve";
  else if (chained >= REVIEW_THRESHOLD) recommendation = "review";
  else recommendation = "rework";

  let simulationId: number | null = null;
  if (persist) {
    try {
      const r: any = await db.execute(sql`
        INSERT INTO plan_rollout_simulations
          (tenant_id, plan_summary, steps_json, predicted_success, estimated_cost_cents, weak_links_json)
        VALUES
          (${tenantId},
           ${options.planSummary ?? ""},
           ${sql`${JSON.stringify(steps)}::jsonb`},
           ${chained},
           ${totalCost},
           ${sql`${JSON.stringify(weak)}::jsonb`})
        RETURNING id
      `);
      simulationId = r.rows?.[0]?.id ?? null;
    } catch (e) {
      logSilentCatch("server/plan-rollout-simulator.ts:persist", e);
    }
  }

  const degradedSuffix = anyDegraded ? " [DEGRADED — at least one step lacked enough history or embedding service was down]" : "";
  const autoSuffix = autocorrPenalty > 0 ? ` (autocorrelation penalty -${(autocorrPenalty * 100).toFixed(0)}% for repeated kinds)` : "";
  const detail = `Simulated ${steps.length}-step plan: predicted success ${(chained * 100).toFixed(1)}%${autoSuffix}, est. cost ${totalCost}¢, ${weak.length} weak link(s). Recommendation: ${recommendation}.${degradedSuffix}`;
  return {
    simulationId, predicted_success: chained, estimated_cost_cents: totalCost,
    weak_links: weak, per_step: perStep, detail, recommendation,
    degraded: anyDegraded,
  };
}
