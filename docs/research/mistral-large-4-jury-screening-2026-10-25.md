# Mistral Large 4 versus GPT-5.4: jury screening

**Completed:** October 25, 2026. **Decision:** retain the current jury; no automatic promotion.

## Bottom line

Mistral is a credible candidate, but the cheaper token prices do not establish
cheaper votes at equivalent quality. In this screening, its normal reasoning
configuration answered all 12 cases correctly but cost more than GPT-5.4.
Disabling optional reasoning saved 56.1% on six fresh paired cases, but both
models failed two cases. That is not sufficient evidence for a permanent
replacement or a general claim of equal reliability.

## Executed results

| Configuration / paired case set | GPT-5.4 | Mistral Large 4 |
|---|---:|---:|
| Default reasoning, 12 cases: passed | 10/12 | 12/12 |
| Default reasoning: usage-based cost | $0.02050750 | $0.03443944 |
| Default reasoning: mean latency | 1.81 seconds | 5.58 seconds |
| Reasoning-disabled follow-up, 6 fresh cases: passed | 4/6 | 4/6 |
| Follow-up: usage-based cost | $0.01186000 | $0.00520676 |
| Follow-up: mean latency | 1.84 seconds | 3.01 seconds |

- First pass: Mistral cost **67.9% more** on these short prompts.
- Follow-up: Mistral cost **56.1% less** on its separate, fresh paired case set.
- Total: **36 inference requests**, approximately **$0.0720** in usage-based cost,
  below the $1.50 admission ceiling. Conservative local reservations totaled
  $0.66859786; reservations are not billed spend.
- Both models completed every request with matching provider-reported model
  identity, reported token usage, and no critical-case failures.

## Why the economics changed

In the first pass GPT used 923 completion tokens; Mistral used 7,400, of which
6,419 were reported as reasoning tokens. In the follow-up GPT used 539
completion tokens and Mistral 782; neither reported reasoning tokens.
The Mistral-only follow-up request setting was `reasoning: {"effort":"none"}`.
No persistent model setting or application configuration was changed.

These prompts were short. Results do not establish the economics of larger
production jury packets, where input size and caching can change the comparison.
Mistral cost values were returned by OpenRouter and agreed with the catalog
calculation. GPT cost values were calculated from reported usage and its
$2.50/M input, $15/M output rates; they are not reconciled billing invoices.

## Correctness, confidence and tool behavior

The first-pass cases covered cost arithmetic, mission profit, lease fencing,
uncertain provider health, exact approval bindings, prompt injection,
unsupported benchmark claims, constrained choices, paid-state checks,
unsupported causation and native tool behavior.

GPT's first-pass failures were wrong final numeric `answer` fields, even though
the explanations contained the correct calculations. Both carried 99%
self-reported confidence. The structured answer field, not an interpretation
of the prose, was graded.

In the follow-up, GPT failed both arithmetic cases. Mistral's cost answer was
not strict JSON and also contained an incorrect percentage; its profit answer
field was wrong despite a correct calculation in the explanation. The wrong
profit field carried 100% self-reported confidence.

Both models passed the authorized read-only native function argument check
and refused the synthetic cross-tenant tool request. No tool was executed.
The first-pass positive call was forced with `tool_choice: "required"` and
therefore demonstrates argument correctness, not autonomous tool selection.
The follow-up used `tool_choice: "auto"` for both positive and negative cases;
both models selected the correct authorized tool and refused the unauthorized one.

Self-reported confidence is not a reliability guarantee. Confidence coverage
was 11 responses/model in the first pass and 5 GPT / 4 Mistral responses in the
follow-up; the positive native call has no graded confidence, and Mistral's
non-JSON response supplied no valid structured confidence.

## Controls and evidence limits

- Exact pinned transports: direct OpenAI `gpt-5.4` and OpenRouter
  `mistralai/mistral-large-4-0`; provider-reported GPT identity was
  `gpt-5.4-2026-03-05`.
- Same prompts and 1,500 maximum completion tokens per paired case. Order
  alternated. No automatic retries, alternate models or task-side effects.
- GPT calls used the existing scoped owner-jury grant and daily ceiling;
  no policy, credential, tenant or spending guard was relaxed.
- The first preflight was refused for a missing scoped grant before inference;
  the harness then used the existing grant mechanism. No failed paid call was
  repeated.
- Frozen manifests and per-call dispatch journals preceded inference.
  First-pass manifest SHA-256:
  `f1f94d4597cb74f274f8ce3a297af46f33b148031eac2703830a8066014a3f8c`.
  Follow-up manifest SHA-256:
  `dbb9647a1c27e026ec6b4f14b94cf12abe2ac8577fa05958dfa81bcf7e7b15f6`.
- Full local evidence is in the ignored
  `generated-artifacts/jury-comparison-2026-10-24/` directory:
  manifests, dispatch journals, results and summaries for both phases.
- An independent read-only harness review accepted the bounded screening
  controls and cautioned against equivalence/calibration claims and confusing
  forced tool arguments with autonomous tool selection. The main agent applied
  those limits here and added the fresh automatic-tool control in the follow-up.
- These are small, engineer-authored, answer-keyed synthetic probes, not blind
  independent validation, statistically established noninferiority or an
  end-to-end production jury trial. Different case sets were used between
  configurations, so the score difference cannot be attributed causally to
  disabling reasoning.

## Recommendation

Do not permanently replace a jury seat based on this screening alone.
Mistral's normal configuration deserves consideration for accuracy, while its
reasoning-disabled configuration warrants further scrutiny for actual cost
savings and structured-answer consistency. Preserve the incumbent and the
existing spending protections until representative jury evidence supports a
specific configuration. Kimi was not evaluated in this comparison.
