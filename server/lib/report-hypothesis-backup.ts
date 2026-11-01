/** Advisory proposals only. No network, execution, scoring, or validation authority. */
export type HypothesisSource = {
  id: string; title: string; text: string; kind: "public" | "customer" | "measurement"; url?: string;
};
export type HypothesisPlan = {
  hypothesis: string; test: string; disproof: string; status: "untested";
  evidence: { sourceId: string; quote: string }[];
};
export const HYPOTHESIS_LIMITS = { plans: 3, hypothesis: 400, test: 500, disproof: 400, evidence: 2, quote: 300 } as const;
export const HYPOTHESIS_OMISSION_WARNING =
  "Some optional hypothesis plans or excerpts were omitted because they were malformed, over limit or not bound to supplied evidence. Raw provider responses remain retained; this is not complete hypothesis coverage.";
export const HYPOTHESIS_RESEARCH_GUIDANCE = `TESTABLE HYPOTHESES (advisory only):
Within the existing RESULT paragraph, include at most three concise proposed connections:
HYPOTHESIS (not a fact), EVIDENCE (exact inspected reference and conditions, or unavailable),
TEST (cheapest comparison with baseline and measured outcome), DISPROOF (failure threshold
and stop condition), VALIDATION STATUS (untested unless an independently recorded executed
test supports a different outcome). Distinguish supported, contradicted and inconclusive
observations; source wording and model confidence never certify causal truth or a successful
experiment. Do not execute tests, add calls, change approvals, or invent confidence scores.`;

export const HYPOTHESIS_PACKAGE_GUIDANCE = `For this final synthesis, add an optional top-level "hypothesisPlans" array with 1–3
company-specific testable recommendations, within the SAME report output budget:
{"hypothesis":"proposed connection, at most 400 characters","test":"cheapest safe comparison, baseline, metric and bounded duration, at most 500 characters","disproof":"failure threshold and stop condition, at most 400 characters","evidence":[{"sourceId":"exact supplied source ID","quote":"exact continuous source excerpt, at most 300 characters"}]}.
Use at most two evidence excerpts per plan, or [] when no suitable evidence exists.
Never use research limitations as company evidence. Quote evidence exactly, not paraphrased.
All plans are UNTESTED proposals, never verified outcomes, predictions of profit or execution
approval. Include material contrary evidence; do not invent sources, test results, numerical
confidence or extra research. No plan may buy additional model calls or exceed existing limits.`;

function boundedText(value: unknown, limit: number): value is string {
  return typeof value === "string" && value.trim().length >= 10 && value.length <= limit;
}

export function hypothesisBackup(input: unknown, sources: readonly HypothesisSource[]): {
  plans: HypothesisPlan[]; omitted?: boolean; section?: { heading: string; body: string };
} {
  if (input === undefined) return { plans: [] };
  const candidates = Array.isArray(input) ? input : [];
  const plans: HypothesisPlan[] = [];
  let omittedEvidence = 0;
  for (const raw of candidates.slice(0, HYPOTHESIS_LIMITS.plans)) {
    if (!raw || !boundedText(raw.hypothesis, HYPOTHESIS_LIMITS.hypothesis) ||
        !boundedText(raw.test, HYPOTHESIS_LIMITS.test) || !boundedText(raw.disproof, HYPOTHESIS_LIMITS.disproof)) continue;
    const prose = [raw.hypothesis, raw.test, raw.disproof].join("\n");
    const assertionText = prose.normalize("NFKC").replace(/[*_`]/g, "");
    // Conservative editorial guard, not a semantic truth detector. These are
    // optional proposals: apparent certificates/status overrides are excluded.
    if (/\b(?:validation\s+status|confidence)\s*[:=]|\b(?:verified|validated|confirmed|proven|guaranteed|supported)\b/i.test(assertionText)) continue;
    // Preserve ordinary report URL rules: no invented destinations in optional prose.
    if ((prose.match(/https?:\/\/[^\s<>"'`)]+/g) || []).some(url => !sources.some(source => source.url === url))) continue;
    const proposedEvidence = Array.isArray(raw.evidence) ? raw.evidence : [];
    if (!Array.isArray(raw.evidence)) omittedEvidence++;
    const evidence: HypothesisPlan["evidence"] = proposedEvidence.slice(0, HYPOTHESIS_LIMITS.evidence).flatMap((item: any) => {
      const source = sources.find(source => source.id === item?.sourceId);
      if (!source || /^L_\d+$/.test(source.id) ||
          !boundedText(item?.quote, HYPOTHESIS_LIMITS.quote) || !source.text.includes(item.quote)) return [];
      return [{ sourceId: source.id, quote: item.quote }];
    });
    omittedEvidence += proposedEvidence.length - evidence.length;
    const citedIds = new Set(evidence.map(item => item.sourceId));
    const inlineIds = prose.match(/\b(?:[SW]\d+|[EL]_\d+)\b/gi) || [];
    if (inlineIds.some(id => !citedIds.has(id))) continue;
    const singleLine = (text: string) => text.replace(/\s+/g, " ").trim();
    plans.push({ hypothesis: singleLine(raw.hypothesis), test: singleLine(raw.test), disproof: singleLine(raw.disproof),
      status: "untested", evidence });
  }
  const submitted = candidates.length;
  const intro = "These are proposed experiments, not verified outcomes or approval to execute. " +
    "Exact excerpts establish source wording, not proof the hypothesis is true. " +
    "Source selection is not exhaustive and does not establish source independence or absence of contrary evidence.";
  const body = plans.map((plan, index) => [
    `Hypothesis ${index + 1} (unverified proposal text): ${JSON.stringify(plan.hypothesis)}`,
    "Validation status: Untested. No executed experiment is certified by this report.",
    plan.evidence.length ? "Source evidence:\n" + plan.evidence.map(item => {
      const source = sources.find(source => source.id === item.sourceId)!;
      const linkedOnly = (item.quote.match(/https?:\/\/[^\s<>"'`)]+/g) || []).filter(url =>
        !sources.some(candidate => candidate.url === url || candidate.url === url.replace(/[.,;:!?]+$/, "")));
      return `[${item.sourceId}] ${source.kind === "customer" ? "Customer-supplied context (not independently verified)" :
        source.kind === "measurement" ? "Recorded observation (scope limited to the supplied record)" : "Source excerpt (not independent verification)"}: ${JSON.stringify(item.quote)}` +
        linkedOnly.map(url => `\nLinked URL only (destination content not verified): ${url}`).join("");
    }).join("\n") : "Source evidence: Unavailable. This proposal has no validated supporting excerpt.",
    `Cheapest useful test (unverified proposal text): ${JSON.stringify(plan.test)}`,
    `Disproof / stop condition (unverified proposal text): ${JSON.stringify(plan.disproof)}`,
  ].join("\n")).join("\n\n");
  // Describe the bounded policy, not transient pre-normalization counts.
  // Revalidating canonical reports must produce the same PDF/narration text.
  const coverage = `Bounded coverage: ${plans.length} plans retained. At most three candidate plans and two excerpts per candidate are assessed. ` +
    "This is not a complete review of all possible hypotheses or source evidence.";
  const omitted = !Array.isArray(input) || plans.length !== submitted || omittedEvidence > 0;
  return { plans, omitted, section: { heading: "Evidence & Testable Hypotheses",
    body: [intro, coverage, body].filter(Boolean).join("\n\n") } };
}
