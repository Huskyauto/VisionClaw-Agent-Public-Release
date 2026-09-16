/**
 * Pure core of the offline golden-set evaluation harness (scripts/offline-eval.ts).
 *
 * This module holds the LLM-free, IO-free logic so it is (a) covered by `npm run
 * check` (scripts/ is OUTSIDE tsconfig include — see memory scripts-outside-tsc-scope)
 * and (b) unit-testable network-free (memory node-test-db-pool-hang: keep lib tests
 * query-free). The script imports `validateGoldenSet` + `computeVerdict` and supplies
 * the model calls + file IO around them.
 *
 * The security-relevant invariant lives in `computeVerdict`: coverage fails CLOSED
 * (a mostly-unevaluable run is DEGRADED → non-zero, never a green "0 regressions"
 * off a broken run — memory audit-fail-closed-coverage).
 */

export interface GoldenCase {
  id: string;
  category: string;
  prompt: string;
  rubric: string[];
  mustRefuse: boolean;
  minScore?: number;
}

export function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

export interface OfflineEvalCandidate {
  index: number;
  evaluated: boolean;
  score: number | null;
}

export interface OfflineEvalCandidateSelection {
  complete: boolean;
  selectedIndex: number | null;
  score: number | null;
  scoreMargin: number | null;
  reason?: string;
}

const MAX_OFFLINE_EVAL_CANDIDATES = 3;

export function parseOfflineEvalCandidateCount(raw: string | undefined): 1 | 2 | 3 {
  if (raw === undefined || raw.trim() === "") return 1;
  const count = Number(raw);
  if (
    !Number.isSafeInteger(count) ||
    count < 1 ||
    count > MAX_OFFLINE_EVAL_CANDIDATES
  ) {
    throw new Error(
      `invalid offline-eval candidate count "${raw}" (must be an integer from 1 to ${MAX_OFFLINE_EVAL_CANDIDATES})`,
    );
  }
  return count as 1 | 2 | 3;
}

/** Choose the highest independently-rubric-scored candidate. */
export function selectOfflineEvalCandidate(input: {
  expectedCandidates: number;
  candidates: OfflineEvalCandidate[];
}): OfflineEvalCandidateSelection {
  if (
    !Number.isSafeInteger(input.expectedCandidates) ||
    input.expectedCandidates < 1 ||
    input.expectedCandidates > 3
  ) {
    return {
      complete: false,
      selectedIndex: null,
      score: null,
      scoreMargin: null,
      reason: "invalid expected candidate count",
    };
  }
  if (input.candidates.length !== input.expectedCandidates) {
    return {
      complete: false,
      selectedIndex: null,
      score: null,
      scoreMargin: null,
      reason: `incomplete candidate set: ${input.candidates.length}/${input.expectedCandidates}`,
    };
  }
  const indexes = input.candidates.map(candidate => candidate.index);
  const hasValidIndexes =
    new Set(indexes).size === input.expectedCandidates &&
    indexes.every(
      index =>
        Number.isSafeInteger(index) &&
        index >= 0 &&
        index < input.expectedCandidates,
    );
  if (!hasValidIndexes) {
    return {
      complete: false,
      selectedIndex: null,
      score: null,
      scoreMargin: null,
      reason: "malformed candidate indexes",
    };
  }
  const evaluated = input.candidates.filter(
    candidate =>
      candidate.evaluated === true &&
      typeof candidate.score === "number" &&
      Number.isFinite(candidate.score) &&
      candidate.score >= 0 &&
      candidate.score <= 1,
  );
  if (evaluated.length !== input.expectedCandidates) {
    return {
      complete: false,
      selectedIndex: null,
      score: null,
      scoreMargin: null,
      reason:
        evaluated.length === 0
          ? "no evaluated candidates"
          : `incomplete candidate set: ${evaluated.length}/${input.expectedCandidates}`,
    };
  }
  const ranked = [...evaluated].sort(
    (a, b) => (b.score! - a.score!) || (a.index - b.index),
  );
  const winner = ranked[0];
  const runnerUp = ranked[1];
  return {
    complete: true,
    selectedIndex: winner.index,
    score: winner.score,
    scoreMargin: runnerUp ? Number((winner.score! - runnerUp.score!).toFixed(6)) : null,
  };
}

/**
 * Run a bounded candidate set sequentially, then apply the same fail-closed
 * selector used by the evaluator. The injected candidate factory keeps the
 * orchestration network-free and directly testable.
 */
export async function runOfflineEvalCandidateLoop<T extends OfflineEvalCandidate>(
  expectedCandidates: 1 | 2 | 3,
  evaluateCandidate: (index: number) => Promise<T>,
): Promise<{ candidates: T[]; selection: OfflineEvalCandidateSelection }> {
  const candidates: T[] = [];
  for (let index = 0; index < expectedCandidates; index++) {
    candidates.push(await evaluateCandidate(index));
  }
  return {
    candidates,
    selection: selectOfflineEvalCandidate({ expectedCandidates, candidates }),
  };
}

/**
 * Validate + normalize a parsed golden-set document. Accepts either a bare array
 * of cases or `{ cases: [...] }`. THROWS on any structural problem (no cases,
 * malformed case) so the caller can map it to a config-error exit code — never
 * silently drops a malformed case.
 */
export function validateGoldenSet(parsed: unknown): GoldenCase[] {
  const cases: unknown = Array.isArray(parsed)
    ? parsed
    : parsed && typeof parsed === "object"
      ? (parsed as any).cases
      : undefined;
  if (!Array.isArray(cases) || cases.length === 0) {
    throw new Error("golden set has no cases (expected an array or { cases: [...] })");
  }
  const out: GoldenCase[] = [];
  const seen = new Set<string>();
  for (const c of cases as any[]) {
    if (
      !c ||
      typeof c.id !== "string" ||
      !c.id.trim() ||
      typeof c.prompt !== "string" ||
      !c.prompt.trim() ||
      !Array.isArray(c.rubric) ||
      c.rubric.length === 0 ||
      c.rubric.some((r: unknown) => typeof r !== "string" || !String(r).trim())
    ) {
      throw new Error(
        `malformed case (need non-empty id, prompt, and rubric[] of strings): ${JSON.stringify(c)?.slice(0, 140)}`,
      );
    }
    if (seen.has(c.id)) throw new Error(`duplicate case id: ${c.id}`);
    seen.add(c.id);
    out.push({
      id: c.id,
      category: typeof c.category === "string" && c.category.trim() ? c.category : "uncategorized",
      prompt: c.prompt,
      rubric: c.rubric.map((r: unknown) => String(r)),
      mustRefuse: c.mustRefuse === true,
      minScore: typeof c.minScore === "number" ? clamp01(c.minScore) : undefined,
    });
  }
  return out;
}

export interface VerdictInput {
  totalCases: number;
  evaluatedCases: number;
  /** mean rubric pass-rate over the EVALUATED cases, 0..1 */
  suiteScore: number;
  /** most-recent prior run's suite score, or null if no baseline yet */
  baselineScore: number | null;
  minCoverage: number;
  regressionTolerance: number;
}

export interface Verdict {
  coverage: number;
  degraded: boolean;
  regressed: boolean;
  /** baselineScore - suiteScore (positive = quality dropped); 0 when no baseline */
  regressionDrop: number;
  /** 0 pass · 2 quality regression · 3 degraded coverage */
  exitCode: 0 | 2 | 3;
}

/**
 * Decide the run outcome. Coverage is checked FIRST and fails CLOSED: a degraded
 * run is never also reported as a (non-)regression, because its suiteScore is not
 * trustworthy. Regression only applies when a baseline exists AND coverage is ok.
 */
export function computeVerdict(input: VerdictInput): Verdict {
  const coverage = input.totalCases > 0 ? input.evaluatedCases / input.totalCases : 0;
  const minCoverage = clamp01(input.minCoverage);
  const tolerance = clamp01(input.regressionTolerance);

  const degraded = coverage < minCoverage;
  const regressionDrop =
    input.baselineScore != null ? input.baselineScore - input.suiteScore : 0;
  const regressed =
    input.baselineScore != null && !degraded && regressionDrop > tolerance;

  const exitCode: 0 | 2 | 3 = degraded ? 3 : regressed ? 2 : 0;
  return {
    coverage,
    degraded,
    regressed,
    regressionDrop,
    exitCode,
  };
}
