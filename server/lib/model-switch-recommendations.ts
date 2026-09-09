// =============================================================================
// Task 130 — Model-switch savings recommendations (ADVISORY ONLY, read-only)
//
// Pure computation: given (a) per-workflow-per-model REAL spend rows from
// agent_cost_ledger and (b) observed per-model quality from step_rewards,
// surface the top "switch workflow W from model X → cheaper model Y saves N%
// at similar quality" opportunities.
//
// Pricing basis is AUTHORITATIVE, not a static price sheet: a candidate
// model's rate is its OBSERVED blended $/token derived from the tenant's own
// ledger rows (SUM(cost_usd) / SUM(tokens)) over the same window. That means:
//   - cache read/write economics are already baked into the recorded costs;
//   - a model whose real price cannot be verified from recorded spend
//     (insufficient token volume in the ledger) is simply NOT a candidate —
//     unknown never masquerades as cheap (fail closed);
//   - free lanes show up as an observed $0 rate because that is what the
//     ledger actually recorded.
// The blended rate folds input+output mix together; that is stated in the
// panel as an estimate. Directionally it is anchored on real recorded spend,
// never on a hand-maintained approximate price table.
//
// Conservative rules:
//   - Candidates are ONLY models observed in this tenant's own window with
//     BOTH sufficient recorded token volume AND sufficient graded quality
//     steps. Every suggestion carries a REAL observed quality delta.
//   - Advisory only. Nothing here applies, routes, or mutates anything.
//
// No db import — unit-testable without a pg pool. The DB driver lives in
// server/lib/model-switch-data.ts.
// =============================================================================

export interface WorkflowModelUsage {
  /** Recurring-workflow grain: tool_name from agent_cost_ledger. */
  workflow: string;
  model: string;
  calls: number;
  tokensIn: number;
  tokensOut: number;
  /** Real recorded spend for this (workflow, model) group over the window. */
  totalCostUsd: number;
}

export interface ModelQuality {
  model: string;
  /** Average step_rewards score (0–100) for steps executed on this model. */
  avgScore: number;
  gradedSteps: number;
}

export interface SwitchRecommendation {
  workflow: string;
  fromModel: string;
  toModel: string;
  calls: number;
  currentCostUsd: number;
  projectedCostUsd: number;
  estSavingsUsd: number;
  estSavingsPct: number;
  /** Candidate's observed blended $/1M tokens from the tenant's own ledger. */
  toObservedRatePerMTokens: number;
  fromAvgQuality: number;
  toAvgQuality: number;
  /** toAvgQuality − fromAvgQuality (negative = slightly worse, bounded by tolerance). */
  qualityDelta: number;
  fromGradedSteps: number;
  toGradedSteps: number;
}

export interface RecommendationOptions {
  /** Ignore (workflow, model) groups that spent less than this. Default $0.01. */
  minGroupSpendUsd?: number;
  /** Both sides need at least this many graded steps. Default 3. */
  minGradedSteps?: number;
  /** Candidate needs at least this many recorded ledger tokens. Default 50k. */
  minCandidateTokens?: number;
  /** Max allowed quality drop (points on the 0–100 scale). Default 10. */
  maxQualityDrop?: number;
  /** Minimum savings percentage to be worth surfacing. Default 20. */
  minSavingsPct?: number;
  /** How many suggestions to return. Default 5. */
  limit?: number;
}

export function computeModelSwitchRecommendations(
  usage: WorkflowModelUsage[],
  quality: ModelQuality[],
  opts: RecommendationOptions = {},
): SwitchRecommendation[] {
  const minGroupSpendUsd = opts.minGroupSpendUsd ?? 0.01;
  const minGradedSteps = opts.minGradedSteps ?? 3;
  const minCandidateTokens = opts.minCandidateTokens ?? 50_000;
  const maxQualityDrop = opts.maxQualityDrop ?? 10;
  const minSavingsPct = opts.minSavingsPct ?? 20;
  const limit = Math.max(1, Math.min(10, opts.limit ?? 5));

  const qualityByModel = new Map<string, ModelQuality>();
  for (const q of quality) {
    if (q && q.model && Number.isFinite(q.avgScore) && q.gradedSteps > 0) {
      qualityByModel.set(q.model, q);
    }
  }

  // Per-model observed totals across ALL workflows → observed blended rate.
  const totalsByModel = new Map<string, { tokens: number; costUsd: number }>();
  for (const u of usage) {
    if (!u || !u.model) continue;
    const tokens = Math.max(0, Number(u.tokensIn) || 0) + Math.max(0, Number(u.tokensOut) || 0);
    const cost = Number(u.totalCostUsd);
    if (!Number.isFinite(cost) || cost < 0) continue; // corrupt row — never a pricing basis
    const t = totalsByModel.get(u.model) || { tokens: 0, costUsd: 0 };
    t.tokens += tokens;
    t.costUsd += cost;
    totalsByModel.set(u.model, t);
  }

  // Candidate universe: observed models with a VERIFIABLE observed rate
  // (enough recorded tokens) AND sufficient observed quality.
  const candidates: Array<{ model: string; ratePerToken: number; quality: ModelQuality }> = [];
  for (const [model, t] of totalsByModel) {
    if (t.tokens < minCandidateTokens) continue;
    const q = qualityByModel.get(model);
    if (!q || q.gradedSteps < minGradedSteps) continue;
    candidates.push({ model, ratePerToken: t.costUsd / t.tokens, quality: q });
  }

  const out: SwitchRecommendation[] = [];
  for (const group of usage) {
    if (!group || !group.model || !group.workflow) continue;
    const cost = Number(group.totalCostUsd) || 0;
    if (cost < minGroupSpendUsd) continue;
    const fromQuality = qualityByModel.get(group.model);
    if (!fromQuality || fromQuality.gradedSteps < minGradedSteps) continue;

    const groupTokens =
      Math.max(0, Number(group.tokensIn) || 0) + Math.max(0, Number(group.tokensOut) || 0);
    if (groupTokens <= 0) continue; // can't re-price without tokens

    let best: SwitchRecommendation | null = null;
    for (const cand of candidates) {
      if (cand.model === group.model) continue;
      // Quality gate: candidate must be within tolerance of the CURRENT model.
      const qualityDelta = cand.quality.avgScore - fromQuality.avgScore;
      if (qualityDelta < -maxQualityDrop) continue;

      const projected = groupTokens * cand.ratePerToken;
      const savings = cost - projected;
      if (savings <= 0) continue;
      const savingsPct = (savings / cost) * 100;
      if (savingsPct < minSavingsPct) continue;

      const rec: SwitchRecommendation = {
        workflow: group.workflow,
        fromModel: group.model,
        toModel: cand.model,
        calls: Number(group.calls) || 0,
        currentCostUsd: +cost.toFixed(4),
        projectedCostUsd: +projected.toFixed(4),
        estSavingsUsd: +savings.toFixed(4),
        estSavingsPct: +savingsPct.toFixed(1),
        toObservedRatePerMTokens: +(cand.ratePerToken * 1_000_000).toFixed(4),
        fromAvgQuality: +fromQuality.avgScore.toFixed(1),
        toAvgQuality: +cand.quality.avgScore.toFixed(1),
        qualityDelta: +qualityDelta.toFixed(1),
        fromGradedSteps: fromQuality.gradedSteps,
        toGradedSteps: cand.quality.gradedSteps,
      };
      if (!best || rec.estSavingsUsd > best.estSavingsUsd) best = rec;
    }
    if (best) out.push(best);
  }

  out.sort((a, b) => b.estSavingsUsd - a.estSavingsUsd);
  return out.slice(0, limit);
}
