/**
 * Skill Pool Similarity Watchdog (lib) — R125+155 (2026-08-18).
 *
 * Rationale (arXiv:2608.14036): retrieval precision over a skill pool decays
 * hard as the pool grows, and "confusable distractors" (near-duplicate skill
 * descriptions) are the main mechanism. This lib computes pairwise semantic
 * similarity across the pool and flags pairs above a confusability threshold
 * as merge/prune candidates.
 *
 * Invariants:
 * - PURE + injectable embedder — no DB, no network in this module (lib tests
 *   stay query-free; drivers live in scripts/ and weekly-maintenance).
 * - ADVISORY: output is a report; nothing here disables or deletes a skill.
 * - Per-item fail-open: a skill whose embedding fails is skipped and counted
 *   in `skipped`, never aborts the whole analysis.
 */

export interface PoolSkill {
  name: string;
  text: string;
  /** Where the skill lives, e.g. "db" | "agents-dir" — reported, not compared. */
  source?: string;
}

export interface ConfusablePair {
  a: string;
  b: string;
  aSource?: string;
  bSource?: string;
  similarity: number;
}

export interface PoolAnalysis {
  poolSize: number;
  embedded: number;
  skipped: string[];
  /** All pairs ≥ warnThreshold, sorted most-similar first. */
  confusablePairs: ConfusablePair[];
  /** Subset ≥ flagThreshold — strong merge/prune candidates. */
  flaggedPairs: ConfusablePair[];
  /** Paper-derived: pools this size measurably dilute retrieval precision. */
  inDangerZone: boolean;
  summary: string;
}

export interface PoolAnalysisOptions {
  skills: PoolSkill[];
  embed: (text: string) => Promise<number[] | null>;
  /** Report pairs at/above this similarity. */
  warnThreshold?: number;
  /** Flag pairs at/above this similarity as merge/prune candidates. */
  flagThreshold?: number;
  /** Pool size at which the paper's precision decay is material. */
  dangerZoneSize?: number;
  /** Bound the O(n²) comparison; excess skills are skipped (reported). */
  maxSkills?: number;
  /** Bound parallel embedding calls. */
  concurrency?: number;
}

export const DEFAULT_WARN_THRESHOLD = 0.75;
export const DEFAULT_FLAG_THRESHOLD = 0.85;
export const DEFAULT_DANGER_ZONE = 40;
const DEFAULT_MAX_SKILLS = 250;
const DEFAULT_CONCURRENCY = 8;

function cosine(a: number[], b: number[]): number {
  let dot = 0, na = 0, nb = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

export async function analyzeSkillPool(opts: PoolAnalysisOptions): Promise<PoolAnalysis> {
  const warnThreshold = opts.warnThreshold ?? DEFAULT_WARN_THRESHOLD;
  const flagThreshold = opts.flagThreshold ?? DEFAULT_FLAG_THRESHOLD;
  const dangerZoneSize = opts.dangerZoneSize ?? DEFAULT_DANGER_ZONE;
  const maxSkills = opts.maxSkills ?? DEFAULT_MAX_SKILLS;
  const concurrency = Math.max(1, opts.concurrency ?? DEFAULT_CONCURRENCY);

  const all = (opts.skills || []).filter(s => s && s.name && (s.text || "").trim().length > 0);
  const capped = all.slice(0, maxSkills);
  const overflow = all.slice(maxSkills).map(s => `${s.name} (over maxSkills cap)`);

  const safeEmbed = async (text: string): Promise<number[] | null> => {
    try {
      return await opts.embed(text);
    } catch {
      return null;
    }
  };

  // Bounded-concurrency embedding (rate-limit pace-not-kill).
  const vecs: Array<number[] | null> = new Array(capped.length).fill(null);
  let idx = 0;
  const worker = async () => {
    while (idx < capped.length) {
      const i = idx++;
      vecs[i] = await safeEmbed(capped[i].text.slice(0, 1500));
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, capped.length) }, worker));

  const skipped: string[] = [...overflow];
  const embedded: Array<{ s: PoolSkill; v: number[] }> = [];
  capped.forEach((s, i) => {
    const v = vecs[i];
    if (v && v.length > 0) embedded.push({ s, v });
    else skipped.push(s.name);
  });

  const confusablePairs: ConfusablePair[] = [];
  for (let i = 0; i < embedded.length; i++) {
    for (let j = i + 1; j < embedded.length; j++) {
      const sim = cosine(embedded[i].v, embedded[j].v);
      if (sim >= warnThreshold) {
        confusablePairs.push({
          a: embedded[i].s.name,
          b: embedded[j].s.name,
          aSource: embedded[i].s.source,
          bSource: embedded[j].s.source,
          similarity: sim,
        });
      }
    }
  }
  confusablePairs.sort((x, y) => y.similarity - x.similarity);
  const flaggedPairs = confusablePairs.filter(p => p.similarity >= flagThreshold);

  const poolSize = all.length;
  const inDangerZone = poolSize >= dangerZoneSize;
  const summary =
    `pool=${poolSize} embedded=${embedded.length} skipped=${skipped.length} ` +
    `confusable(≥${warnThreshold})=${confusablePairs.length} ` +
    `flagged(≥${flagThreshold})=${flaggedPairs.length}` +
    (inDangerZone ? ` — pool in precision-decay danger zone (≥${dangerZoneSize}; arXiv:2608.14036)` : "");

  return { poolSize, embedded: embedded.length, skipped, confusablePairs, flaggedPairs, inDangerZone, summary };
}
