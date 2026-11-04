# RuHarness: adaptive diagnosis, fixed acceptance

Reviewed November 2, 2026.

## Verdict

Retain as a promising engineering reference. A bounded, report-only comparison
inside the existing per-model harness process is justified as a research
question, not yet as a production change. Do not install another harness, add
another scheduler, or let learned diagnostic criteria rewrite acceptance,
permissions, safety checks or confirmation receipts.

**Why:** changing failure patterns can make fixed diagnostic priorities stale,
but prioritizing a weakness is not proof that a proposed correction works.

Sources:
- https://arxiv.org/abs/2610.36826
- https://arxiv.org/html/2610.36826v1
- Supplied image: `attached_assets/FB_IMG_1793652855632_1793652908244.jpg`

## Source observations

RuHarness keeps task objectives fixed while evolving behavioral diagnostic
criteria. The behavioral judge labels each trajectory Satisfied, Violated or
N/A without the final task label; later utility calculations use task outcomes.
Separate evolution, validation-selection and final test splits are declared.
It generates at most three candidates per round and selects at most one;
selection requires validation improvement above the stated threshold.

The criterion lifecycle is probation, active, dormant and retired. Dormant
criteria can reactivate; retired criteria are terminal. Therefore the summary
"criteria return when the weakness reappears" is qualified by the lifecycle:
it does not mean every historical criterion remains monitored forever.
This lifecycle is appropriate for advisory diagnostic priorities, not for
retiring safety/tenant/payment requirements.

Table 1 reports five-domain held-out macro averages:
- Qwen3.5-35B-A3B: 53.7 versus AHE's 49.2, about +4.5 percentage points.
- GLM-4.7-Flash: 38.0 versus Self-Harness's 32.7, about +5.3 points.

An executed arithmetic check of the five displayed domain values yielded
53.70 versus 49.24 (+4.46), and 37.98 versus 32.72 (+5.26).
This checks reported arithmetic, not experimental reproducibility or native
performance. The strongest average baseline differs between the two models.

The fixed-rubric ablation on Qwen has 44.4 held-out versus 53.7 for the full
method; removing the rubric entirely scores 45.8. This supports the authors'
stale-diagnosis hypothesis in their experiment, not removing fixed safety rules.
Appendix A.5 reports three-seed robustness for two selected model/domain
settings, not uncertainty for every Table 1 comparison.

The study uses one underlying agent framework and two model backbones. It does
not establish benefits for our production models or customer journeys. The
reviewed sections match candidate/round/validation protocols but do not establish
end-to-end token-cost parity for additional diagnosis and judging.

## Cross-case comparison with the native system

This is a source/code comparison, not an executed native A/B trial.

| Case | Existing native baseline / boundary | Useful delta / counterexample |
| --- | --- | --- |
| Model-specific recurring failures | `server/agentic/harness-adaptation.ts` already mines recent failures by model and proposes one minimal addendum | Not a new capability by itself; investigate diagnostic freshness rather than duplicate the loop |
| Distinguishing meaningful from generic criteria | Native harness mining primarily reads failed/declined spans; `server/skill-optimizer.ts` accepts per-case rubrics | RuHarness compares failures AND successful applicable trajectories; failure-only counts cannot establish discrimination |
| Failure disappears and later recurs | Native harness proposals use a recent window; no RuHarness criterion lifecycle was identified in the reviewed path | Persistent advisory criterion identity and recurrence monitoring may help, but bookkeeping overhead needs measurement |
| Candidate promotion | Current held-out harness check asks an LLM whether an addendum would LIKELY have prevented held-out failures, then uses a jury | Hypothetical prevention is weaker than matched execution-backed outcomes; better diagnosis alone does not close that gap |
| Rare consequential errors | Independent authorization, tenant, spend and safety constraints must remain fixed | A criterion with zero recent incidents must not cause those controls to become dormant |
| Confirmation of completed work | Run confirmation requires named evidence and treats missing outcome proof as unverified | New learned checks may suggest missing evidence, never replace required checks or manufacture a green receipt |

## Bounded falsifiable trial

HYPOTHESIS: Adding current, outcome-aware diagnostic prioritization improves
selection of genuinely unresolved model-specific weaknesses over our existing
recent-failure digest, under the same proposal budget.

Use existing redacted, tenant-authorized traces with independently established
outcomes. Include successful controls, failures, N/A behavior, unknown outcomes,
resolved-then-recurring weaknesses, rare safety cases and model changes. Keep
development, candidate selection and final task families separate. Unknown
outcomes are not failed or successful labels.

Compare the actual existing digest/proposal path against the augmented path,
not a deliberately weak static straw baseline. First measure diagnostic
precision and missed recurring failures with an independent adjudicator.
Only then assess candidate changes through safe offline executable tasks.
Keep final acceptance and all mandatory safety checks inaccessible to the
adaptive component. Never replay emails, purchases, deliveries or other external
side effects for evaluation.

Report independently verified held-out completion, error-family coverage,
unnecessary proposals, all model/judge/retry costs and latency. Any safety or
tenant regression, no useful diagnostic improvement, or overhead exceeding
benefit rejects promotion. A win on diagnostic ranking alone is not a completion
improvement.

VALIDATION STATUS: The paper and native implementation were inspected; reported
Table 1 arithmetic was checked. No representative outcome-labeled native corpus
was assembled, no native A/B or causal improvement test was run, and no benefit
to this platform is established. Retain as unverified pending that comparison.

No runtime changes, new models, tools, dependencies, schedules, approval
authority, commits, pushes or publication were performed for this assessment.

## Subsequent owner-authorized implementation

After this assessment, the owner explicitly directed selective implementation.
The existing harness job now has bounded, training-only recurrence priorities:
see [implementation and limits](adaptive-harness-diagnosis.md). This borrows
diagnostic freshness, not RuHarness's full rubric lifecycle or evaluator.
Synthetic mechanism tests do not establish native completion gains.
