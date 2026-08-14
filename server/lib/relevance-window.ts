/**
 * Relevance-windowed source extraction for the code-proposal generator.
 *
 * The proposal LLM must copy its OLD_CODE block *verbatim* from the source we
 * show it, or the find/replace edit is dropped at validation. Feeding only the
 * first 120 lines of a file works for the small targets (pricing.tsx, a seed
 * file) but is structurally impossible for the big server modules the nightly
 * research programs target — tools.ts (~15k lines), chat-engine.ts, providers.ts.
 * The code relevant to a finding is never in the header, so OLD_CODE can never
 * match and EVERY proposal against those files is silently dropped. That is the
 * root cause of "many experiments, ~0 code proposals" for the big-file programs.
 *
 * Instead: keep the file header (imports / top-of-file context) AND surface the
 * sliding windows whose content best overlaps the finding's keywords. The code
 * inside each window is left byte-for-byte intact (no line-number prefixes) so
 * the model copies a region it can actually see and OLD_CODE matches on disk.
 */

const STOPWORDS = new Set([
  "the", "and", "for", "with", "that", "this", "from", "into", "your", "you",
  "are", "was", "were", "has", "have", "will", "would", "could", "should", "a",
  "an", "of", "to", "in", "on", "is", "it", "as", "be", "by", "or", "at", "we",
  "our", "its", "not", "but", "can", "may", "more", "most", "than", "then",
  "when", "which", "what", "how", "why", "use", "using", "via", "per", "all",
]);

/** Lowercased, de-duped, stop-word-filtered identifiers/words from the finding. */
export function tokenizeQuery(query: string): string[] {
  const words = (query.toLowerCase().match(/[a-z_][a-z0-9_]{2,}/g) || []);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const w of words) {
    if (STOPWORDS.has(w) || seen.has(w)) continue;
    seen.add(w);
    out.push(w);
    if (out.length >= 40) break;
  }
  return out;
}

export interface RelevanceWindowOpts {
  /** Lines of the file header always included (imports / context). */
  headerLines?: number;
  /** Size of each scored sliding window. */
  windowLines?: number;
  /** Max number of relevant windows to surface. */
  maxWindows?: number;
  /** Hard cap on total lines emitted (header + windows). */
  maxTotalLines?: number;
}

/**
 * Return a relevance-windowed extract of `content` for the finding `query`.
 * Small files (<= maxTotalLines) are returned whole. Big files are returned as
 * the header plus up to `maxWindows` keyword-scored windows, each labelled with
 * its real line range. Window CODE is verbatim so OLD_CODE copies cleanly.
 */
export function extractRelevantWindows(
  content: string,
  query: string,
  opts: RelevanceWindowOpts = {},
): string {
  const headerLines = opts.headerLines ?? 60;
  const windowLines = opts.windowLines ?? 90;
  const maxWindows = opts.maxWindows ?? 3;
  const maxTotalLines = opts.maxTotalLines ?? 420;

  const lines = content.split("\n");
  const total = lines.length;

  // Small file: hand over the whole thing — scoring would only add noise.
  if (total <= maxTotalLines) {
    return content;
  }

  const keywords = tokenizeQuery(query);
  const headerEnd = Math.min(headerLines, total);
  const sections: string[] = [
    `--- file header (lines 1-${headerEnd}) ---\n${lines.slice(0, headerEnd).join("\n")}`,
  ];

  // Score non-overlapping windows below the header by keyword hits.
  const scored: Array<{ start: number; end: number; score: number }> = [];
  for (let start = headerEnd; start < total; start += windowLines) {
    const end = Math.min(start + windowLines, total);
    let score = 0;
    for (let i = start; i < end; i++) {
      const lower = lines[i].toLowerCase();
      for (const kw of keywords) {
        if (lower.includes(kw)) score++;
      }
    }
    if (score > 0) scored.push({ start, end, score });
  }

  // Select highest-scoring windows FIRST, honoring the total-line budget as we
  // go — never reorder before truncating, or the budget would drop high-relevance
  // tail windows purely by file position (lost-in-the-middle). Skip (don't break)
  // a window that would overshoot so a smaller later window can still fit.
  scored.sort((a, b) => b.score - a.score || a.start - b.start);
  const selected: typeof scored = [];
  let used = headerEnd;
  for (const w of scored) {
    if (selected.length >= maxWindows) break;
    const size = w.end - w.start;
    if (used + size > maxTotalLines) continue;
    selected.push(w);
    used += size;
  }

  // Only now restore source order for readability (model reads top-to-bottom).
  const picked = selected.sort((a, b) => a.start - b.start);
  for (const w of picked) {
    sections.push(
      `--- relevant region (lines ${w.start + 1}-${w.end}, keyword score ${w.score}) ---\n${lines.slice(w.start, w.end).join("\n")}`,
    );
  }

  if (picked.length === 0) {
    // Nothing in the body matched the finding's keywords — be explicit so the
    // model copies OLD_CODE from the header or returns NO_CODE_CHANGE rather
    // than hallucinating a region it was never shown.
    sections.push(
      `--- note ---\nNo region of this file matched the finding's keywords; only the header is shown above. Propose a change ONLY if OLD_CODE can be copied verbatim from the header, otherwise return NO_CODE_CHANGE.`,
    );
  }

  return sections.join("\n\n");
}
