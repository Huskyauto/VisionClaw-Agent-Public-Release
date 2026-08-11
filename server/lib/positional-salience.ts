/**
 * Lost-in-the-Middle mitigation.
 *
 * LLMs attend most strongly to the START and END of a long context block and
 * systematically under-use the MIDDLE (Liu et al. 2023, "Lost in the Middle";
 * reinforced by the code-intelligence survey arXiv:2511.18538, takeaway #7 —
 * huge context windows do NOT guarantee the buried content is actually used).
 *
 * When we render a relevance-RANKED list of retrieved chunks (memory facts,
 * knowledge-base entries) into a long prompt block in plain descending order,
 * the 2nd..Nth most-relevant items land precisely in that dead zone.
 *
 * `reorderForPositionalSalience` takes a list already sorted by relevance
 * (most-relevant first) and returns a U-shaped ("bathtub") ordering: the
 * highest-relevance items sit at the two EDGES, the lowest-relevance in the
 * middle. It is a PURE presentation reorder — it never adds, drops, or mutates
 * items, and it is a no-op for lists of length <= 2 (no meaningful middle).
 *
 * Example (input sorted best->worst as [1,2,3,4,5,6]):
 *   head = ranks at even indices -> [1,3,5]
 *   tail = ranks at odd  indices -> [2,4,6] reversed -> [6,4,2]
 *   result = [1,3,5,6,4,2]  => edges hold ranks 1 & 2, middle holds ranks 5 & 6.
 *
 * IMPORTANT: apply this AFTER any sequential char/token-budget truncation, never
 * before. Budget truncation drops the tail of its input; if you reorder first,
 * a high-relevance item placed at the tail would be the one dropped. Select the
 * survivors in relevance order, decrement the budget, THEN reorder for display.
 */
export function reorderForPositionalSalience<T>(sortedByRelevanceDesc: T[]): T[] {
  if (sortedByRelevanceDesc.length <= 2) return sortedByRelevanceDesc.slice();
  const head: T[] = [];
  const tail: T[] = [];
  for (let i = 0; i < sortedByRelevanceDesc.length; i++) {
    if (i % 2 === 0) head.push(sortedByRelevanceDesc[i]);
    else tail.push(sortedByRelevanceDesc[i]);
  }
  tail.reverse();
  return [...head, ...tail];
}
