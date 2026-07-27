// R115.6 — Reranker post-processing utilities. Zero dependencies so the
// matching test suite can import these helpers without pulling in the full
// embeddings module (which initializes the DB pool on import).

// Lost-in-the-middle reorder (Liu et al. 2023, arXiv:2307.03172). LLMs attend
// best to content at the head and tail of long contexts and worst to the
// middle. Given a relevance-ranked list [r1..rN] (most→least relevant), we
// reorder to [r1, r3, r5, ..., r6, r4, r2] so the strongest chunks land at
// positions 0 and N-1, the weakest in the middle. Stable for N <= 2.
export function lostInTheMiddleReorder<T>(ranked: T[]): T[] {
  if (ranked.length <= 2) return ranked.slice();
  const odd: T[] = [];
  const even: T[] = [];
  for (let i = 0; i < ranked.length; i++) {
    (i % 2 === 0 ? odd : even).push(ranked[i]!);
  }
  return [...odd, ...even.reverse()];
}

// Diversity dedup via trigram Jaccard. Cross-encoder rerankers happily return
// three near-duplicate chunks at positions 1-3 when an answer is repeated
// across documents. We keep result[0] verbatim, then drop any later candidate
// whose trigram Jaccard against any already-kept item exceeds `threshold`
// (default 0.82 — empirically separates "same source restated" from
// "different evidence for same claim"). Fails OPEN: short text (<3 chars) ⇒
// no dedup applied for that item (item is kept).
export const DIVERSITY_THRESHOLD_DEFAULT = 0.82;

function trigrams(text: string): Set<string> {
  const norm = text.toLowerCase().replace(/\s+/g, " ").trim();
  if (norm.length < 3) return new Set();
  const out = new Set<string>();
  for (let i = 0; i <= norm.length - 3; i++) out.add(norm.slice(i, i + 3));
  return out;
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  return inter / (a.size + b.size - inter);
}

export function diversityDedup<T>(
  items: T[],
  textOf: (item: T) => string,
  threshold: number = DIVERSITY_THRESHOLD_DEFAULT,
): T[] {
  if (items.length <= 1) return items.slice();
  const kept: T[] = [];
  const keptGrams: Set<string>[] = [];
  for (const it of items) {
    const g = trigrams(textOf(it).slice(0, 1500));
    let dup = false;
    if (g.size > 0) {
      for (const kg of keptGrams) {
        if (jaccard(g, kg) >= threshold) { dup = true; break; }
      }
    }
    if (!dup) {
      kept.push(it);
      keptGrams.push(g);
    }
  }
  return kept;
}
