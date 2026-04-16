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

    const accessBoost = Math.min((m.accessCount || 0) / 20, 0.1);
    let rawScore = semanticScore * 0.7 + accessBoost;

    rawScore = applyTemporalDecay(rawScore, m.lastAccessed, tdConfig);

    return { ...m, _score: rawScore };
  });

  scored.sort((a, b) => b._score - a._score);

  return mmrRerank(scored, mmrConfig, options.maxResults);
}
