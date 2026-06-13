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
