import type { Validation } from "./ideabrowser-scenario";

type ScenarioNumbers = {
  revenue12moUsd: number; buildCostUsd: number; buildHours: number;
  monthlyRunCostUsd: number; successProbabilityPct: number; verdict: string;
};
type ValidatorVerdict = { adjustedSuccessProbabilityPct: number; goNoGo: string };

/** Rankings are comparative hypotheses, not permission to launch.
 * Recompute economics instead of trusting a model-supplied profit or ROI. */
export function scenarioDecision(s: ScenarioNumbers, validation: ValidatorVerdict | null) {
  const valid = [s.revenue12moUsd, s.buildCostUsd, s.buildHours, s.monthlyRunCostUsd,
    s.successProbabilityPct].every(n => typeof n === "number" && Number.isFinite(n) && n >= 0) &&
    s.successProbabilityPct <= 100;
  const validationValid = validation !== null &&
    typeof validation.adjustedSuccessProbabilityPct === "number" &&
    Number.isFinite(validation.adjustedSuccessProbabilityPct) &&
    validation.adjustedSuccessProbabilityPct >= 0 && validation.adjustedSuccessProbabilityPct <= 100;
  const total = valid ? s.buildCostUsd + s.buildHours * 50 + s.monthlyRunCostUsd * 12 : NaN;
  const profit = valid ? s.revenue12moUsd * s.successProbabilityPct / 100 - total : NaN;
  const adjusted = valid && validationValid
    ? s.revenue12moUsd * validation!.adjustedSuccessProbabilityPct / 100 - total : NaN;
  const analystExpectedProfitUsd = Number.isFinite(profit) ? profit : null;
  const adjustedExpectedProfitUsd = Number.isFinite(adjusted) ? adjusted : null;
  const reject = analystExpectedProfitUsd !== null && analystExpectedProfitUsd <= 0 ||
    adjustedExpectedProfitUsd !== null && adjustedExpectedProfitUsd <= 0 ||
    typeof s.verdict === "string" && /^\s*(?:skip|no[\s–—-]*go)\b/i.test(s.verdict) ||
    validation && /^\s*no[\s–—-]*go\b/i.test(validation.goNoGo);
  const showLaunchPlan = !reject && analystExpectedProfitUsd !== null && adjustedExpectedProfitUsd !== null &&
    typeof s.verdict === "string" && /^\s*(?:build|go)\b/i.test(s.verdict) &&
    /^\s*go\b/i.test(validation!.goNoGo);
  const status = reject ? "no-go" : showLaunchPlan ? "review-only" : "needs-validation";
  return { status, showLaunchPlan, analystExpectedProfitUsd, adjustedExpectedProfitUsd,
    label: showLaunchPlan ? "Candidate for owner review" : "Highest-ranked scenario — not recommended for launch",
    notice: showLaunchPlan
      ? "Advisory estimates, not verified demand or authorization. Proposed actions require owner approval; costs are not guaranteed."
      : "Launch plan withheld: economics, verdicts or independent validation do not support proceeding. No spending, outreach or build is authorized." };
}

/** The same projection feeds Markdown and email so a NO-GO cannot retain an
 * actionable plan on one transport after it was withheld on the other. */
export function scenarioValidationSummary(s: ScenarioNumbers, v: Validation | null, markdown = true): string {
  const decision = scenarioDecision(s, v);
  const heading = markdown ? "## Independent validation" : "INDEPENDENT VALIDATION";
  if (!v) return `${heading}\n\nValidation unavailable. ${decision.notice}\n\n`;
  let text = `${heading}\n\nWhat it is: ${v.whatItIs}\n\nNumbers check: ${v.numbersVerdict}\n\n` +
    `Adjusted success probability: ${v.adjustedSuccessProbabilityPct}% (advisory)\n\n` +
    `Go / No-go: ${v.goNoGo}\n\n${decision.notice}\n\n`;
  if (decision.showLaunchPlan) {
    text += `Proposed discovery plan for owner review (estimated cash cost $${v.totalOutOfPocketUsd.toLocaleString()}, not verified actual cost):\n\n` +
      v.cheapestMoneyPlan.map((step, i) => `${i + 1}. ${step}`).join("\n") +
      "\n\nProposed week-1 actions — not authorized:\n\n" +
      v.week1Actions.map(action => `- ${action}`).join("\n") + "\n\n";
  }
  return text;
}
