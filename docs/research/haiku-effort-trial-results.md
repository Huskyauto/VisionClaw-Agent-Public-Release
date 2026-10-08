# Haiku 5.5 effort trial: measured results

Date: 2026-10-08. Owner-approved workspace-only experiment, not a rollout.

## Outcome

Native Anthropic Messages rejected the deliberately invalid effort value.
All 13 planned valid responses were captured from the expected Haiku model:
four identical synthetic tasks at low/medium/high, plus a streamed tool case.
The stream preserved the expected tool name and argument. No tool was executed.

| Effort | Independent checks passed | Total output tokens | Observed cost |
|---|---:|---:|---:|
| Low | 3 / 4 | 188 | $0.0001605 |
| Medium | 4 / 4 | 179 | $0.0001560 |
| High | 4 / 4 | 282 | $0.0002075 |

The streamed medium tool case also passed and cost $0.0000706.
Total observed inference cost: **$0.0005946**, against a $0.05 reservation.
All responses reported usage; no uncertain-cost calls occurred in this run.
Thinking is included in output-token usage.

Low effort failed the independent invoice-calculation/JSON answer check.
This records an answer-check failure, not a diagnosis of the unseen internal
reasoning. Medium and high passed the same task. On the simple extraction
fixture, high used 120 output tokens versus 17 at low and medium, without an
accuracy gain.

The proposed metadata-driven choices (low extraction, medium arithmetic,
authorized high for strict output and untrusted tool data) passed all four
checks, but their combined observed cost exactly equaled the medium baseline.
This trial therefore did **not** establish a cost-saving advantage.

## Decision and limitations

- Keep the controller **shadow-only**; production effort routing is unchanged.
- Preserve medium for unknown or multistep tasks. Do not reduce reasoning solely
  for long context, human supervision, or budget pressure.
- Low is a candidate for simple work, not a universal cheaper default. High can
  waste tokens on simple tasks.
- The export status is `incomplete` because not every candidate answer passed,
  despite all 13 planned responses being covered. It is non-promotable evidence.
- One pass over four synthetic tasks cannot establish general accuracy,
  latency, savings, safety, or reliable effort classification.
- Native single-call text/tool streaming is tested, not a production multi-turn
  adapter or consequential user journey.
- No automatic retry, fallback, production hook, model-default/jury change or
  production publish was made.

Raw observations:
`docs/research/haiku-effort-trial-d4952496af56849d916c7fa8.json`.
That export retains the evaluated source digest; it was not rewritten or rerun
after the code-review correction below.

## Post-edit review

The reviewer found that an inconclusive invalid-effort canary could stop before
persisting unknown completion. The failure path now records the same conservative
per-call accounting as later calls, with a test first observed failing and then
fixed. A ledger failure after an accepted canary is propagated rather than
misclassified as a provider error or charged twice.

The correction changes only failed-canary accounting. The live run's native
400-effort validation and successful-response measurements are unaffected.
No paid repeat was launched to verify the correction; deterministic tests cover it.

## Operator use

`npx tsx scripts/haiku-effort-trial.ts` is a no-spend dry-run.
Only exact `--run` can initiate a manual workspace evaluation; production is
refused. Each source-bound suite has a durable once-only start marker and a
tenant daily-budget reservation. Do not change the suite version merely to
bypass that marker or automatically rerun a partial paid experiment.
