// R116 — agentmemory N6. Active contradiction resolution.
//
// When two memory entries (or two MoA proposer answers) disagree, propose
// which is more likely correct based on three signals — source recency,
// source authority class, and supporting-observation count. Default-correct,
// human override.
//
// Used in two places today:
//   1. server/moa.ts — when κ < CONCORDANCE_ESCALATE_THRESHOLD, run the
//      resolver FIRST and only flip shouldEscalate=true if the resolver's
//      own confidence stays below RESOLVER_CONFIDENCE_FLOOR.
//   2. Direct retrieval — when memory_links has a 'contradicts' edge and
//      both endpoints are 'active', call resolve() on the pair to decide
//      which to phantom-supersede.

export interface ContradictionCandidate {
  id?: number | string;
  text: string;
  /** When was the supporting source last confirmed? Higher = newer. */
  lastReinforcedAt?: Date | string | number | null;
  /** 'user'|'manual'|'paper'|'docs'|'tool'|'auto_capture'|'conversation'|'unknown' */
  sourceAuthority?: string | null;
  /** Independent supporting observations / sources. */
  supportingObservations?: number;
  /** Optional pre-existing confidence (0..1) — folded in multiplicatively. */
  confidence?: number;
}

export interface ContradictionResolution {
  winner: ContradictionCandidate | null;
  loser: ContradictionCandidate | null;
  /** 0..1; below RESOLVER_CONFIDENCE_FLOOR ⇒ escalate to HITL. */
  resolverConfidence: number;
  scores: Array<{ id: ContradictionCandidate["id"]; score: number; parts: Record<string, number> }>;
  reason: string;
}

// Authority classes, highest → lowest. Tuned so explicit-user evidence beats
// auto-capture by ~2× and beats raw conversation extraction by ~3×.
const AUTHORITY_WEIGHTS: Record<string, number> = {
  user: 1.0,
  manual: 1.0,
  explicit: 1.0,
  paper: 0.9,
  docs: 0.85,
  api: 0.8,
  tool: 0.7,
  extractor: 0.55,
  conversation: 0.5,
  auto_capture: 0.45,
  heuristic: 0.4,
  unknown: 0.4,
};

const DAY_MS = 86400000;

export const RESOLVER_CONFIDENCE_FLOOR = (() => {
  const v = Number(process.env.CONTRADICTION_RESOLVER_FLOOR);
  return Number.isFinite(v) && v >= 0 && v <= 1 ? v : 0.55;
})();

function authorityWeight(src: string | null | undefined): number {
  const k = String(src || "unknown").toLowerCase();
  return AUTHORITY_WEIGHTS[k] ?? AUTHORITY_WEIGHTS.unknown;
}

function recencyWeight(ts: Date | string | number | null | undefined): number {
  if (!ts) return 0.3; // unknown recency → mid-low
  const t = ts instanceof Date ? ts.getTime() : new Date(ts).getTime();
  if (!Number.isFinite(t)) return 0.3;
  const ageDays = Math.max(0, (Date.now() - t) / DAY_MS);
  // Exponential decay with 14d half-life: 1d → 0.95, 14d → 0.5, 90d → 0.012
  return Math.exp(-ageDays / 20);
}

function supportWeight(n: number | undefined): number {
  const c = typeof n === "number" && Number.isFinite(n) ? Math.max(0, n) : 1;
  // log-normalised: 1→0.27, 3→0.5, 10→0.83, 25→1.0(capped)
  return Math.min(1, Math.log(c + 1) / Math.log(26));
}

export function resolveContradiction(
  candidates: ContradictionCandidate[],
): ContradictionResolution {
  if (!Array.isArray(candidates) || candidates.length < 2) {
    return {
      winner: candidates?.[0] ?? null,
      loser: null,
      resolverConfidence: 0,
      scores: [],
      reason: "insufficient_candidates",
    };
  }

  // Weights tuned so a 14-day-old explicit-user fact (recency 0.5 × authority 1.0 × support 0.27 × conf 1.0 = 0.135 base * conf)
  // still beats a fresh auto-capture (recency ~1 × authority 0.45 × support 0.27 × conf 0.85 = 0.103)
  // — recency alone shouldn't override an authoritative source.
  const W_AUTH = 0.45;
  const W_RECENCY = 0.30;
  const W_SUPPORT = 0.25;

  const scored = candidates.map((c) => {
    const auth = authorityWeight(c.sourceAuthority);
    const rec = recencyWeight(c.lastReinforcedAt);
    const sup = supportWeight(c.supportingObservations);
    const conf = Number.isFinite(c.confidence) ? Math.max(0, Math.min(1, c.confidence as number)) : 1.0;
    const base = W_AUTH * auth + W_RECENCY * rec + W_SUPPORT * sup;
    // Multiplicatively fold confidence so a low-confidence claim cannot win
    // on recency alone — matches the multiplicative pattern in memory-ranking.
    const score = base * conf;
    return {
      id: c.id,
      score,
      parts: { auth, recency: rec, support: sup, conf, base },
      _ref: c,
    };
  });

  scored.sort((a, b) => b.score - a.score);
  const winner = scored[0];
  const runnerUp = scored[1];

  // Resolver confidence = how much the winner separates from the runner-up,
  // normalised by the winner's own score. Identical-score pair → confidence 0
  // (we have NO basis to prefer one).
  const margin = winner.score - runnerUp.score;
  const resolverConfidence = winner.score > 0
    ? Math.max(0, Math.min(1, margin / winner.score))
    : 0;

  let reason: string;
  if (resolverConfidence < RESOLVER_CONFIDENCE_FLOOR) {
    reason = `low_margin (winner=${winner.score.toFixed(3)} runner=${runnerUp.score.toFixed(3)}, margin=${margin.toFixed(3)}) — escalate`;
  } else {
    const top = winner.parts;
    const dominant = (Object.entries(top) as [string, number][])
      .filter(([k]) => k !== "base" && k !== "conf")
      .sort((a, b) => b[1] - a[1])[0]?.[0] ?? "blend";
    reason = `winner via ${dominant} (auth=${top.auth.toFixed(2)} rec=${top.recency.toFixed(2)} sup=${top.support.toFixed(2)} conf=${top.conf.toFixed(2)})`;
  }

  return {
    winner: winner._ref,
    loser: runnerUp._ref,
    resolverConfidence,
    scores: scored.map(({ id, score, parts }) => ({ id, score, parts })),
    reason,
  };
}

/** Helper: should MoA escalate this κ-low jury to HITL, given a resolver pass? */
export function shouldEscalateAfterResolver(resolution: ContradictionResolution): boolean {
  return resolution.resolverConfidence < RESOLVER_CONFIDENCE_FLOOR;
}
