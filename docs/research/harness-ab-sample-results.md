# VisionClaw harness sample — measured results

Date: November 2, 2026

## Bottom line

Schema compaction reduced input tokens by **17.9%** in this controlled sample,
with **no measured improvement or loss in rubric accuracy**. This supports
further investigation of prompt efficiency, not a claim that the whole agent
is better. No production prompt, model routing, permission or tool was changed.
Automatic adoption is disabled.

## Live experiment

The baseline calls the existing production structured-task system formatter.
The candidate only removes JSON schema formatting whitespace. All schema
fields and instructions are preserved. Both arms use identical task inputs,
temperature 0, reasoning effort `none`, JSON output mode and 512 output-token
ceilings. There are no retries, repairs, external-provider fallbacks or actual
tool executions.

- Model: Replit-hosted GPT-5.4; every response reported
  `gpt-5.4-2026-03-05`, the publisher-documented snapshot.
- 44 actual model calls: four development observations, then ten evaluation
  cases, twice per arm. Arm order is counterbalanced.
- Cases cover arithmetic, newest evidence, exact identity, missing data,
  tenant decisions, forged approval, injected instructions, uncertain delivery,
  destructive requests and bounded evidence.
- Deterministic fixed oracles, not model self-grading. Development outcomes
  are excluded from the comparison.

| Measurement | Current formatter | Compact schema |
|---|---:|---:|
| Evaluation observations | 20 | 20 |
| Rubric passes | 18/20 (90%) | 18/20 (90%) |
| Safety-decision failures | 0/10 | 0/10 |
| Mean input tokens | 374.3 | 307.3 |
| Mean output tokens | 23.7 | 23.7 |
| Mean response time | 1.916 seconds | 1.835 seconds |

Input savings: **67 tokens per evaluation call, 17.9%**. Mean elapsed time was
about 4.2% lower in this run, but the small sample does not establish a speed
improvement. All 44 calls together used 14,954 input and 1,044 output tokens;
reported cached-input tokens were zero. Normal Replit model charges apply;
this is not a measured dollar-savings claim.

### The two rubric failures in each arm

Both repetitions of `unknown-stock` produced the correct abstention status and
`unknown` value, but cited record `part`; the frozen oracle required an empty
evidence list. The fixture does not explicitly settle whether a record missing
its count should be cited as evidence for uncertainty. This may be a citation
contract ambiguity rather than an incorrect business answer.

**The oracle was not relaxed after seeing the responses.** Reported accuracy
remains 18/20 in both arms. Future fixtures should resolve this ambiguity before
another trial; these observations do not establish a genuine factual failure.

## Verification

- **11/11 targeted tests passed:** five new sample/evaluation tests and six
  existing harness-scoring tests.
- **TypeScript check passed:** full application `tsc --noEmit`, with a 2,304 MB
  V8 heap limit.
- **Canonical server suite completed:** 280 suites passed, four failed
  (284 total). Server integration cases were included.
- Browser Playwright tests were explicitly excluded using the configured
  `RUN_E2E=0` convention. No UI or browser interaction changed.

The broad suite is **not green**. Failures outside the changed sample code:

1. `tests/safety/no-silent-catch.test.ts`: empty catches in
   `company-report-recovery.ts` and `company-report-research-batch.ts`.
2. `tests/security/route-census.test.ts`: 817 endpoints counted versus 813 in
   the fixture. This sample adds no routes.
3. `tests/security/persona-identity-drift.test.ts`: Felix's saved operating
   instructions differ from the source composition. Do not blindly reseed.
4. `tests/tools/registry-invariants.test.ts`: the tools-layer import policy
   rejects the existing `undici` import in `safe-fetch.ts`.

These results are reported, not hidden by changing unrelated expectations.
The canonical suite ran before the final evaluator-review corrections; the
changed evaluator tests were rerun afterward and passed.

## Review and evidence integrity

A scoped independent review identified two missing evaluation gates:
empty answers could appear efficient, and a uniform but wrong served-model
identity could escape detection. Both are fixed and regression-tested.
Missing answer evidence or an unexpected exact model identity now makes the
comparison inconclusive, including development observations.

The same retained responses were regraded under these stricter checks without
another paid inference. The verdict and measurements did not change. The
original manifest, exact prompts, fixed oracles, raw response records and
original report remain intact alongside a separate reviewed summary.

The initial Profundo preflight was unavailable and made zero model calls.
It remains a separate inconclusive record, not part of the successful trial.

## Boundaries and recommendation

This is an engineering-visible synthetic **structured-prompt sample**, not a
blind study, whole-agent comparison, tool-enforcement audit, or production
certification. Adaptive model addenda were absent from both arms. No conclusion
about Opus 5.5, arbitrary instruction removal, tool-menu pruning, or customer
workloads follows from it.

**Recommendation:** keep the report-only testing system. Compaction is a
promising efficiency candidate; do not describe it as improved intelligence
or automatically roll it into production. A broader outcome claim needs more
representative, unambiguous cases and actual bounded agent-journey evidence.

Rerun only when intended, since model usage is billed:

```sh
npx tsx scripts/harness-ab-sample.ts --run
```

Snapshot documentation: https://developers.openai.com/api/docs/models/gpt-5.4
