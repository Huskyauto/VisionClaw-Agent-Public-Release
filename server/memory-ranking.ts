import { cosineSimilarity, keywordSimilarity } from "./embeddings";

const DAY_MS = 86400000;

export interface TemporalDecayConfig {
  enabled: boolean;
  halfLifeDays: number;
}

export const DEFAULT_TEMPORAL_DECAY: TemporalDecayConfig = {
  enabled: true,
  halfLifeDays: 30,
};

export interface MMRConfig {
  enabled: boolean;
  lambda: number;
}

export const DEFAULT_MMR_CONFIG: MMRConfig = {
  enabled: true,
  lambda: 0.7,
};

export function calculateTemporalDecay(ageInDays: number, halfLifeDays: number): number {
  if (halfLifeDays <= 0 || !Number.isFinite(ageInDays)) return 1;
  const lambda = Math.LN2 / halfLifeDays;
  return Math.exp(-lambda * Math.max(0, ageInDays));
}

export function applyTemporalDecay(
  score: number,
  lastAccessedDate: Date | string,
  config: TemporalDecayConfig = DEFAULT_TEMPORAL_DECAY
): number {
  if (!config.enabled) return score;
  const ageMs = Date.now() - new Date(lastAccessedDate).getTime();
  const ageInDays = ageMs / DAY_MS;
  return score * calculateTemporalDecay(ageInDays, config.halfLifeDays);
}

function tokenize(text: string): Set<string> {
  const tokens = text.toLowerCase().match(/[a-z0-9_]+/g) ?? [];
  return new Set(tokens);
}

function jaccardSimilarity(setA: Set<string>, setB: Set<string>): number {
  if (setA.size === 0 && setB.size === 0) return 1;
  if (setA.size === 0 || setB.size === 0) return 0;

  let intersectionSize = 0;
  const smaller = setA.size <= setB.size ? setA : setB;
  const larger = setA.size <= setB.size ? setB : setA;

  for (const token of smaller) {
    if (larger.has(token)) intersectionSize++;
  }

  const unionSize = setA.size + setB.size - intersectionSize;
  return unionSize === 0 ? 0 : intersectionSize / unionSize;
}

function textSimilarity(a: string, b: string): number {
  return jaccardSimilarity(tokenize(a), tokenize(b));
}

export interface ScoredMemory {
  id: number;
  fact: string;
  category: string;
  embedding?: number[] | null;
  lastAccessed: Date | string;
  accessCount?: number;
  _score: number;
  [key: string]: any;
}

export function mmrRerank(
  items: ScoredMemory[],
  config: MMRConfig = DEFAULT_MMR_CONFIG,
  maxResults?: number
): ScoredMemory[] {
  if (!config.enabled || items.length <= 1) return items;

  const limit = maxResults || items.length;
  const selected: ScoredMemory[] = [];
  const remaining = [...items];

  const maxScore = Math.max(...remaining.map((i) => i._score), 1);

  while (selected.length < limit && remaining.length > 0) {
    let bestIdx = 0;
    let bestMmrScore = -Infinity;

    for (let i = 0; i < remaining.length; i++) {
      const candidate = remaining[i];
      const relevance = candidate._score / maxScore;

      let maxSim = 0;
      for (const sel of selected) {
        const sim = textSimilarity(candidate.fact, sel.fact);
        if (sim > maxSim) maxSim = sim;
      }

      const mmrScore = config.lambda * relevance - (1 - config.lambda) * maxSim;
      if (mmrScore > bestMmrScore) {
        bestMmrScore = mmrScore;
        bestIdx = i;
      }
    }

    selected.push(remaining[bestIdx]);
    remaining.splice(bestIdx, 1);
  }

  return selected;
}

export interface RankingOptions {
  temporalDecay?: TemporalDecayConfig;
  mmr?: MMRConfig;
  maxResults?: number;
}

export function rankMemories(
  memories: any[],
  queryEmbedding: number[] | null,
  userMessage: string,
  options: RankingOptions = {}
): ScoredMemory[] {
  const tdConfig = options.temporalDecay || DEFAULT_TEMPORAL_DECAY;
  const mmrConfig = options.mmr || DEFAULT_MMR_CONFIG;

  const scored: ScoredMemory[] = memories.map((m) => {
    let semanticScore = 0;
    if (queryEmbedding && m.embedding) {
      semanticScore = cosineSimilarity(queryEmbedding, m.embedding as number[]);
    } else if (userMessage) {
      semanticScore = keywordSimilarity(userMessage, m.fact);
    }

    // Aligned with vectorSearchMemory hybrid weights (server/embeddings.ts):
    //   0.55 * similarity + 0.20 * importance + 0.15 * recency + 0.10 * frequency
    // R98.19: confidence is folded in MULTIPLICATIVELY (a low-confidence fact
    // should be down-ranked across the board, not just on one axis). Default
    // confidence is 1.0, so legacy rows are unaffected. confidence below
    // ~0.5 effectively halves the score and pushes the fact below near-equal
    // high-confidence neighbors.
    const importance = (m.accessCount || 0) >= 5 ? 1.0 : 0.0;
    const frequency = Math.min(Math.log((m.accessCount || 0) + 1) / Math.log(51), 1.0);
    // R116 — agentmemory N2. Use lastReinforcedAt (resets on every retrieval
    // hit) instead of lastAccessed, and pull per-category half_life_days if
    // present (from the joined memory_categories row). Falls back gracefully:
    // missing reinforcement timestamp → lastAccessed; missing half-life → 14d.
    // 14d default preserves backward compatibility with pre-R116 ranking.
    const reinforcedSrc = m.lastReinforcedAt || m.last_reinforced_at || m.lastAccessed || m.createdAt || Date.now();
    const ageMs = Date.now() - new Date(reinforcedSrc).getTime();
    const ageInSeconds = Math.max(0, ageMs / 1000);
    const halfLifeDays = (typeof m.halfLifeDays === "number" && m.halfLifeDays > 0)
      ? m.halfLifeDays
      : (typeof m.half_life_days === "number" && m.half_life_days > 0)
        ? m.half_life_days
        : 14;
    const recency = Math.exp(-ageInSeconds / (halfLifeDays * 86400));
    const additive =
        semanticScore * 0.55
      + importance    * 0.20
      + recency       * 0.15
      + frequency     * 0.10;
    const conf = typeof m.confidence === "number" && Number.isFinite(m.confidence)
      ? Math.max(0, Math.min(1, m.confidence))
      : 1.0;
    // R116 N7: fold quality_score multiplicatively alongside confidence — a
    // structurally-malformed memory that we happened to be very-confident
    // about still gets down-ranked.
    const qual = typeof m.qualityScore === "number" && Number.isFinite(m.qualityScore)
      ? Math.max(0, Math.min(1, m.qualityScore))
      : (typeof m.quality_score === "number" && Number.isFinite(m.quality_score))
        ? Math.max(0, Math.min(1, m.quality_score))
        : 1.0;
    const rawScore = additive * conf * qual;

    return { ...m, _score: rawScore };
  });

  scored.sort((a, b) => b._score - a._score);

  return mmrRerank(scored, mmrConfig, options.maxResults);
}

// ---------------------------------------------------------------------------
// System1 / System2 memory-retrieval gate (Hy-Memory-inspired).
//
// System1 = the cheap, no-LLM fast recall above (`rankMemories`: vector cosine
// + importance/recency/frequency arithmetic + MMR). System2 = the expensive
// per-turn `gpt-5-mini` anticipatory pass (`proactiveContextLoad` in
// chat-engine), which feeds ONLY the supplementary "L2 — Anticipated" block.
//
// On a long-running collaborative agent a large share of turns are bare acks
// ("yes", "do it", "thanks", "go ahead") — there is nothing to anticipate, yet
// today every one of them still fires the System2 completion. This gate decides
// whether the deep pass is worth running. It FAILS OPEN: when in any doubt it
// returns `escalate: true`, preserving the legacy always-deep behaviour, so it
// can only ever REMOVE a provably-pointless LLM call, never drop recall.
// ---------------------------------------------------------------------------

// Curated to UNAMBIGUOUS acknowledgements only. Deliberately excludes
// intent-bearing singletons ("more", "next", "go", "again", "please", "good",
// "fine") that can carry a real request in context — keeping them would risk
// skipping the deep pass on a genuine turn (recall loss), which this gate must
// never do. Every phrase here is a whole-message confirmation/reaction with no
// anticipatory content of its own.
const ACK_PHRASES = new Set<string>([
  "yes", "y", "yep", "yeah", "yup", "ya", "ok", "okay", "k", "kk", "sure",
  "thanks", "thank you", "thx", "ty", "tysm", "cheers",
  "got it", "gotcha", "understood", "noted", "makes sense",
  "perfect", "great", "nice", "cool", "awesome", "excellent", "good job",
  "well done", "love it",
  "continue", "go on", "go ahead", "proceed", "keep going", "carry on",
  "do it", "do that", "go for it", "run it", "run that", "ship it", "send it",
  "yes please", "please do", "sounds good", "looks good", "lgtm", "sgtm",
  "ok thanks", "ok thank you", "ok great", "great thanks", "perfect thanks",
  "yes do it", "yes go ahead", "yes please do", "do that again", "run it again",
]);

/**
 * True when the entire normalized message is a bare acknowledgement /
 * confirmation with no informational intent to anticipate. Matches the WHOLE
 * message (not a substring) so "yes, also check the logs" is NOT trivial.
 * A trailing question mark always signals intent (seeking info) ⇒ not trivial.
 */
export function isTrivialAck(message: string): boolean {
  if (!message) return true;
  if (/\?\s*$/.test(message)) return false;
  let m = message.toLowerCase().trim().replace(/\s+/g, " ");
  // Strip surrounding punctuation / symbols / emoji (keep internal apostrophes).
  m = m.replace(/^[\s\p{P}\p{S}]+|[\s\p{P}\p{S}]+$/gu, "").trim();
  if (m.length === 0) return true;
  return ACK_PHRASES.has(m);
}

export interface DeepMemoryGateOptions {
  /** Master switch. Default: env `MEMORY_DEEP_GATE !== "0"` (on). */
  enabled?: boolean;
  /** Also skip when fast recall is already very strong. Default: env `MEMORY_DEEP_GATE_AGGRESSIVE === "1"` (off). */
  aggressive?: boolean;
  /** Top `_score` at/above which fast recall counts as "strong" (aggressive only). */
  strongScore?: number;
}

export interface DeepMemoryGateDecision {
  escalate: boolean;
  reason: string;
}

/**
 * Decide whether the expensive System2 anticipatory memory pass is worth
 * running for this turn. Fails OPEN (escalate) on any uncertainty.
 */
export function shouldRunDeepMemoryPass(
  userMessage: string,
  ranked: ScoredMemory[] = [],
  opts: DeepMemoryGateOptions = {}
): DeepMemoryGateDecision {
  const enabled = opts.enabled ?? (process.env.MEMORY_DEEP_GATE !== "0");
  if (!enabled) return { escalate: true, reason: "gate-disabled" };

  // Triviality gate (default, zero recall risk).
  if (isTrivialAck(userMessage)) return { escalate: false, reason: "trivial-ack" };

  // Aggressive (opt-in): a clearly strong cheap top hit ⇒ skip the deep pass.
  // OFF by default because anticipated memories are cross-category and not
  // necessarily covered by the current turn's vector recall.
  const aggressive = opts.aggressive ?? (process.env.MEMORY_DEEP_GATE_AGGRESSIVE === "1");
  if (aggressive && ranked.length > 0) {
    const strongScore = opts.strongScore ?? (Number(process.env.MEMORY_DEEP_GATE_STRONG_SCORE) || 0.85);
    const top = ranked[0]?._score;
    if (typeof top === "number" && Number.isFinite(top) && top >= strongScore) {
      return { escalate: false, reason: `strong-fast-recall(${top.toFixed(2)})` };
    }
  }

  return { escalate: true, reason: "default-escalate" };
}
