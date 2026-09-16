// Tool Forge Phase 2 — pure gap-selection logic.
// Contract: data/feature-contracts/tool-forge-eviction/. Selects which
// capability_gaps rows earn a module proposal this run. DB-free by design.

export interface ForgeGap {
  id: number;
  tenantId: number;
  gapDescription: string;
  status: string;
  missCount: number;
  priority: string;
}

export interface SelectForgeGapsInput {
  gaps: ForgeGap[];
  /** Minimum repeat-miss demand before a proposal is commissioned. */
  missThreshold: number;
  /** Gap ids that already have a proposal (dir on disk or an approval row) — never re-propose. */
  alreadyProposedGapIds: Set<number>;
  /** Hard cap per run (bounds LLM spend). */
  maxPerRun: number;
}

const ELIGIBLE_STATUSES = new Set(["detected", "researching", "researched"]);
// Test artifacts (dispatch/regression fixtures) leak into capability_gaps with
// inflated missCounts from CI runs — never commission a proposal for them.
const JUNK_GAP_RE = /__\w+__|_test\b|\btest_/i;
const PRIORITY_RANK: Record<string, number> = { critical: 3, high: 2, medium: 1, low: 0 };

/**
 * Deterministic selection: eligible status, demand ≥ threshold, not already
 * proposed; ranked by missCount desc, then priority, then oldest id.
 */
export function selectForgeGaps(input: SelectForgeGapsInput): ForgeGap[] {
  const eligible = input.gaps.filter(
    (g) =>
      ELIGIBLE_STATUSES.has(g.status) &&
      g.missCount >= input.missThreshold &&
      !input.alreadyProposedGapIds.has(g.id) &&
      (g.gapDescription || "").trim().length > 0 &&
      !JUNK_GAP_RE.test(g.gapDescription),
  );
  eligible.sort((a, b) => {
    if (b.missCount !== a.missCount) return b.missCount - a.missCount;
    const pr = (PRIORITY_RANK[b.priority] ?? 0) - (PRIORITY_RANK[a.priority] ?? 0);
    if (pr !== 0) return pr;
    return a.id - b.id;
  });
  return eligible.slice(0, Math.max(0, input.maxPerRun));
}
