/** Editorial research discipline, not a substitute for deterministic evaluators. */
export const RESEARCH_EVIDENCE_INSTRUCTIONS = `EVIDENCE DISCIPLINE:
Inside the existing RESULT paragraph, label OBSERVED (directly inspected source or executed
measurement, with reference and conditions), INFERRED (reasoned interpretation), UNKNOWN
(unverified/missing evidence), and FALSIFIER (cheapest test, baseline, unacceptable outcome
and stop condition). Keep these labels in ONE paragraph, without blank lines or new top-level
output fields, to preserve the existing parser. A quotation or code reconstruction does not
prove causal behavior, correctness, profitable trading or an improvement.
Do not invent sources, executed tests, measurements or profitability. Expert-only analysis
may be useful but must be labeled inferred. When proposing adoption, require independent
held-out cases, realistic end-to-end costs including failures/retries/operating overhead,
and retained rejected/inconclusive experiments. Tool/setup availability is not execution.
Recommendations are not execution approval; existing tenant, safety, spend and publish
controls still apply. Explicit owner-directed implementation does not turn uncertainty into proof.`;
