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
