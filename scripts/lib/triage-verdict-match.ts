/**
 * scripts/lib/triage-verdict-match.ts — pure, fail-CLOSED resolution of a
 * precision-triage SUPPRESS verdict back to the single severe finding it targets.
 *
 * The tenant-isolation audit's precision second-pass may suppress a severe finding
 * ONLY when the model's verdict maps to exactly ONE finding unambiguously. Any
 * ambiguity — no match, multiple matches, or a numeric line the model gave that
 * does not match any finding — resolves to `null` so the finding stays KEEP.
 * This prevents a wrong/duplicate/mis-lined verdict from silently hiding a
 * DIFFERENT (possibly genuine) cross-tenant-leak finding.
 */

export interface MatchableFinding {
  file: string;
  line?: number | null;
}

export interface MatchableVerdict {
  file: string;
  line?: number;
}

/**
 * Resolve a SUPPRESS verdict to its single target finding within `batch`.
 *
 * - A finite numeric `verdict.line` matches by (file, line). A numeric line that
 *   matches no finding returns `null` — it NEVER falls back to a line-less finding
 *   (that fallback is the over-suppression bug this guard closes).
 * - A missing / non-finite `verdict.line` matches file-only, but ONLY when the
 *   file has exactly one line-less finding in the batch.
 * - Any case with 0 or >1 candidates returns `null` (fail closed → keep).
 */
export function matchVerdictToFinding<T extends MatchableFinding>(
  batch: T[],
  verdict: MatchableVerdict,
): T | null {
  const hasValidLine = typeof verdict.line === "number" && Number.isFinite(verdict.line);
  const candidates = hasValidLine
    ? batch.filter((x) => x.file === verdict.file && (x.line ?? null) === verdict.line)
    : batch.filter((x) => x.file === verdict.file && x.line == null);
  return candidates.length === 1 ? candidates[0] : null;
}
