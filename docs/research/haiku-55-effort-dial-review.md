# Haiku 5.5 automatic effort controller: engineering review

Date: 2026-10-08
Status: retain the useful design; revise and validate before enabling it.
No application routing, effort policy, retry policy, or spending flags changed.

## Reviewed proposal

Spark's attached “VisionClaw Automatic Effort-Dial Design”, v1.0, proposes a
deterministic classifier, automatic effort adjustments, bounded escalation and
per-tenant decision records. The useful core is adjusting effort within the
selected Haiku model without an additional classifier LLM call.

## Primary-source findings

- Native parameter: `output_config.effort`. No beta header is needed for the
  top-level request setting.
- Haiku supports `low`, `medium`, `high`, `xhigh`, and `max`. There is no native
  `minimal` level. Its default is `medium`.
- Adaptive thinking is on by default. Thinking consumes the output-token budget.
  Do not assume a small visible answer needs only a small `max_tokens` budget.
- Anthropic recommends medium for most work, low for simple chat/short tools,
  and high for longer agent tasks and strict instruction following. At low
  effort, long agent prompts can skip searches or checks.
- The OpenAI compatibility endpoint explicitly ignores `reasoning_effort`.
  Unsupported fields can be silently ignored.

Sources:

- https://platform.claude.com/docs/en/build-with-claude/effort
- https://platform.claude.com/docs/en/models/haiku-5-5/migration-guide
- https://platform.claude.com/docs/en/api/openai-sdk

## Executed provider probe

The existing owner-authorized direct-key route served `claude-haiku-5-5`.
A synthetic request supplied `output_config.effort` with an intentionally invalid
value and disabled retries. The endpoint accepted it and returned a completion
using 35 input and 8 output tokens.

This establishes that the current compatibility path did not reject the invalid
effort value. It does **not** establish working effort control, or measure the
quality/latency/token effect of any valid level. Do not log an effort setting as
provider-enforced solely because a request succeeds. Validate a native Messages
path or another explicitly supported transport before implementing the dial.

## Cross-case design checks

| Case | Draft behavior | Required correction |
|---|---|---|
| Status confirmation | `minimal` | Usually no inference; if inference is necessary, native `low`. |
| Unclassified multistep task | Defaults to low | Keep medium until low is supported by task-specific evaluation. |
| High-effort task with >100K prompt | Steps down to medium | Conflicts with the draft acceptance criterion requiring at most low without override; replace the conflicting rules with an explicit quality/cost policy. |
| Long prompt at low | Steps down to minimal | Invalid native level; longer prompts do not establish simpler work. |
| Human-gated critical analysis | Autonomy caps medium | Human supervision is not evidence that less reasoning is adequate. |
| Transport timeout / rate limit | Retry at greater effort | Do not add thinking or paid retries for transport failure; ambiguous completion must not trigger duplicate side effects. |
| Genuine output-validation failure | Increase effort | Only bounded, authorized, safe-to-repeat inference; retain existing no-paid-retry and side-effect protections. |
| Almost exhausted budget | Reduce effort | Prefer defer/stop or safe simplification; never silently lower critical-work quality or bypass spending controls. |
| Approval/payment work | All “spend-bearing” work excluded | Clarify consequential business actions versus metered inference; all direct Haiku calls themselves bear cost. |

## Recommended corrected scope

1. Haiku-only, deterministic task hints from trusted execution context.
2. Low for validated simple work, medium for unknown/multistep work, high for
   authorized demanding work. No automatic xhigh/max in the initial version.
3. No jury rerouting, global paid enablement, safety-floor reduction, or changes
   to existing retry/approval policy.
4. Per-request decision metadata without raw prompts, private values, or
   caller-forgeable authority signals.
5. First verify native effort transport, streaming/tool-call handling and token
   accounting. Then compare quality, total output tokens and latency on fixed
   representative fixtures before activating automatic effort selection.

The illustrative $0.00045 cost for 2K input/500 output at standard short-context
rates is correct. It is not evidence of effort-related savings: actual thinking
tokens, retries and task completion must be measured against the medium default.
