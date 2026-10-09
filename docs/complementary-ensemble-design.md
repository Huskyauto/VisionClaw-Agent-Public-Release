# Complementary ensemble perspectives

Owner-directed adaptation of arXiv:2609.37834v1, not a reproduction of its adaptive
search. No proven quality gain is claimed. Ordinary ensembles and paid report
drafts get evidence, implementation and counterexample lenses; synthesis retains
supported minority findings and acknowledges unresolved contradictions.

## Design gate
- Cost: same N proposer calls and one synthesis, same model/output limits.
  Fixed instructions add input tokens (under 1,300 characters per proposer and
  under 1,500 per synthesizer); no added calls, retries or concurrency.
- State: stateless request-local prompt preparation, existing result/log storage.
- Failure: preserve existing fallback behavior; no new approval or quality gate.
- Idempotency: existing request/delivery identity unchanged, no new side effects.
- Tenants/limits: existing caller scope, provider budgets and caps unchanged.
- Disable/observe: complementaryPerspectives=false at internal calls; existing
  ensemble disable controls remain; enabled MoA runs get a telemetry suffix.
- Authority: perspectives advise only; juries remain independent neutral voters.
  Existing safety, approval, evaluator and budget authority stays outside this.
- Delta: no new models, tools or autonomy. Deterministic and mocked checks cover
  prompt diversity, original instructions, minority evidence, opt-out, specialist
  preservation and call count. These do not demonstrate real-model quality gains.

## Acceptance
- Wire tool and automatic reasoning ensembles, not approval juries.
- Preserve existing polarity/custom prompts and model/provider identities.
- Wire paid-report drafting with unchanged completion count and formats.
- Final agent checks supported contributions, source dependence and uncertainty.
- Keep a bounded internal opt-out and independent review; do not publish.