/**
 * AutoTTS reusable offline-discovery core.
 * Paper: "LLMs Improving LLMs: Agentic Discovery for Test-Time Scaling"
 *        (Zheng et al. 2026, arXiv:2605.08083v2).
 *
 * The paper's real contribution is a *repeatable* method for discovering a
 * compute-allocation policy from a cheap offline replay of traces we already log
 * — not a one-off tuned for a single knob. This module is that method, factored
 * out so any VisionClaw allocation knob (κ-escalation threshold, sample/branch
 * count, plan-replay similarity cutoff, retry depth) becomes a thin `KnobSpec`
 * caller instead of a new script.
 *
 * It deliberately covers ONLY the single-feature, single-threshold decision shape
 * (the paper's β-parameterized 1-D sweep). Higher-dimensional joint allocation and
 * the iterative LLM explorer loop are intentionally NOT here — for a 1-D knob an
 * exhaustive grid IS the global optimum, so an LLM explorer adds cost without
 * signal. See docs/autotts-spike-notes.md for that rationale.
 */

/** One replayed decision: a continuous feature and an independent binary outcome. */
export interface KnobRow {
  feature: number; // continuous signal the threshold acts on (e.g. κ)
  label: boolean; // positive = the action would have been "valuable" (e.g. real dissent)
}

export interface DiscoveryConfig {
  /** Fire (escalate / branch / verify) when feature is below or above the threshold. */
  fireWhen: "below" | "above";
  /** The hand-set value we're testing against. */
  currentDefault: number;
  /** reward = recall − gamma·fireRate. Higher gamma = penalize compute/HITL load harder. */
  gamma: number;
  /** Operational ceiling on fire-rate; the recommendation must stay under it. */
  maxFireRate: number;
  /** Minimum positives to trust the signal. */
  minPos: number;
  /** Minimum AUC to call the feature a useful predictor. */
  minAuc: number;
  /** β-sweep resolution. */
  steps?: number;
}

export interface BetaPoint {
  beta: number;
  threshold: number;
  fireRate: number;
  recall: number;
  precision: number;
  f1: number;
  reward: number;
  tp: number;
  fp: number;
  fn: number;
}

export interface DiscoveryResult {
  nRows: number;
  nPos: number;
  featMin: number;
  featMean: number;
  featMax: number;
  auc: number | null;
  points: BetaPoint[];
  front: BetaPoint[];
  best: BetaPoint;
  current: Omit<BetaPoint, "beta">;
  sufficient: boolean;
  /** Default essentially never fires on the observed distribution → miscalibrated. */
  defaultIsDead: boolean;
  beatsDefault: boolean;
  /** A point stayed under maxFireRate (so `best` is operationally realistic). */
  recommendationCapped: boolean;
}

export interface KnobReadiness {
  nRows: number;
  nPos: number;
  posRate: number;
  featureRange: number;
  /** Feature actually varies enough to learn a threshold over. */
  hasFeatureVariation: boolean;
  /** Both classes present (otherwise AUC/recall are undefined). */
  hasLabelVariation: boolean;
  discoverable: boolean;
  blockReason: string | null;
}

/** Does the row's feature trigger the action at this threshold? */
function fires(feature: number, threshold: number, fireWhen: "below" | "above"): boolean {
  return fireWhen === "below" ? feature < threshold : feature > threshold;
}

/**
 * ROC-AUC of the feature predicting the positive label, via the rank-pair
 * definition. For fireWhen="below" a LOW feature should mean positive, so the
 * score is −feature; for "above" it is +feature.
 */
export function auc(rows: KnobRow[], fireWhen: "below" | "above"): number | null {
  const pos = rows.filter((r) => r.label);
  const neg = rows.filter((r) => !r.label);
  if (!pos.length || !neg.length) return null;
  const score = (f: number) => (fireWhen === "below" ? -f : f);
  let c = 0;
  for (const p of pos) {
    for (const q of neg) {
      if (score(p.feature) > score(q.feature)) c += 1;
      else if (p.feature === q.feature) c += 0.5;
    }
  }
  return c / (pos.length * neg.length);
}

export function evalThreshold(
  rows: KnobRow[],
  threshold: number,
  cfg: Pick<DiscoveryConfig, "fireWhen" | "gamma">,
): Omit<BetaPoint, "beta"> {
  let tp = 0,
    fp = 0,
    fn = 0,
    fired = 0;
  for (const r of rows) {
    if (fires(r.feature, threshold, cfg.fireWhen)) {
      fired++;
      if (r.label) tp++;
      else fp++;
    } else if (r.label) {
      fn++;
    }
  }
  const recall = tp + fn > 0 ? tp / (tp + fn) : 0;
  const precision = tp + fp > 0 ? tp / (tp + fp) : 0;
  const f1 = precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0;
  const fireRate = rows.length ? fired / rows.length : 0;
  const reward = recall - cfg.gamma * fireRate;
  return { threshold, fireRate, recall, precision, f1, reward, tp, fp, fn };
}

/** Non-dominated points: maximize recall, minimize fireRate. */
export function paretoFront(points: BetaPoint[]): BetaPoint[] {
  return points
    .filter(
      (p) =>
        !points.some(
          (q) =>
            q !== p &&
            q.recall >= p.recall &&
            q.fireRate <= p.fireRate &&
            (q.recall > p.recall || q.fireRate < p.fireRate),
        ),
    )
    .sort((a, b) => a.fireRate - b.fireRate);
}

/** Cheap pre-flight: can this knob be discovered from the supplied rows at all? */
export function assessReadiness(rows: KnobRow[], cfg: Pick<DiscoveryConfig, "minPos">): KnobReadiness {
  const nRows = rows.length;
  const nPos = rows.filter((r) => r.label).length;
  const posRate = nRows ? nPos / nRows : 0;
  const feats = rows.map((r) => r.feature);
  const featureRange = nRows ? Math.max(...feats) - Math.min(...feats) : 0;
  const hasFeatureVariation = featureRange > 1e-9;
  const hasLabelVariation = nPos > 0 && nPos < nRows;
  let blockReason: string | null = null;
  if (nRows === 0) blockReason = "empty corpus — no traces logged yet";
  else if (!hasFeatureVariation) blockReason = `feature is constant (range ${featureRange}) — nothing to threshold over`;
  else if (!hasLabelVariation) blockReason = nPos === 0 ? "no positive labels — outcome never varies" : "no negative labels — outcome never varies";
  else if (nPos < cfg.minPos) blockReason = `only ${nPos} positives (need ≥ ${cfg.minPos})`;
  return {
    nRows,
    nPos,
    posRate,
    featureRange,
    hasFeatureVariation,
    hasLabelVariation,
    discoverable: blockReason === null,
    blockReason,
  };
}

/** Run the full β-parameterized 1-D discovery sweep. */
export function discover(rows: KnobRow[], cfg: DiscoveryConfig): DiscoveryResult {
  const steps = cfg.steps ?? 51;
  const feats = rows.map((r) => r.feature);
  const featMin = Math.min(...feats);
  const featMax = Math.max(...feats);
  const featMean = feats.reduce((s, f) => s + f, 0) / rows.length;
  const nPos = rows.filter((r) => r.label).length;
  const aucVal = auc(rows, cfg.fireWhen);

  const span = featMax - featMin;
  const points: BetaPoint[] = [];
  for (let i = 0; i < steps; i++) {
    const beta = i / (steps - 1);
    // β is a normalized "fire budget": higher β ⇒ MORE firing, for BOTH directions.
    //   below: fire when feature < threshold ⇒ higher β ⇒ higher threshold.
    //   above: fire when feature > threshold ⇒ higher β ⇒ lower threshold.
    // (For fireWhen="below" this is identical to featMin + β·span, so existing
    //  below-direction callers like the κ spike are byte-identical.)
    const threshold = cfg.fireWhen === "below" ? featMin + beta * span : featMax - beta * span;
    points.push({ beta, ...evalThreshold(rows, threshold, cfg) });
  }

  const feasible = points.filter((p) => p.fireRate <= cfg.maxFireRate);
  const pool = feasible.length ? feasible : points;
  const best = pool.reduce((a, b) => (b.reward > a.reward ? b : a));
  const front = paretoFront(points);
  const current = evalThreshold(rows, cfg.currentDefault, cfg);

  const sufficient = nPos >= cfg.minPos && aucVal !== null && aucVal >= cfg.minAuc;
  const defaultIsDead = current.fireRate < 0.01;
  const beatsDefault = best.reward > current.reward;

  return {
    nRows: rows.length,
    nPos,
    featMin,
    featMean,
    featMax,
    auc: aucVal,
    points,
    front,
    best,
    current,
    sufficient,
    defaultIsDead,
    beatsDefault,
    recommendationCapped: feasible.length > 0,
  };
}
