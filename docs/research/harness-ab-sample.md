# Report-only harness A/B sample

## Follow-on
The original sample remains frozen. The bounded owner-plan trial, rollback,
read-only run confirmation and separate representative fixture profile are
documented in `docs/research/run-confirmation.md`. Production configuration
and publication remain unchanged.

## Approved outcome and scope
Build a runnable sample and run real model comparisons plus regression tests.
Use the current structured-task system prompt formatter as baseline. Candidate
only minifies its JSON schema; all instructions, schema semantics, model,
sampling, limits and task inputs stay unchanged. This is not a whole-agent
benchmark or a test of tool-menu pruning. Never promote automatically.

## Design gate
1. Cost: maximum 48 sequential requests, 512 output tokens each, zero retries.
   Pin Replit / GPT-5.4; native usage charges apply, external fallback forbidden.
   The first flat-rate Profundo preflight was unavailable before any requests.
   No provider flag or credential is changed. No new schedule.
2. State: versioned synthetic fixtures and source in Git; ignored generated
   results are owner research output, not production state. Disk loss means
   rerun explicitly; never silently resume or spend.
3. Failure: preserve every failed attempt; missing usage/model/answer evidence
   makes the comparison inconclusive. Provider failures stop further requests.
4. Identity: hash fixture, both exact system prompts and experiment settings;
   retain each response before grading. Refuse an existing output directory.
5. Tenant: owner-run CLI, explicit tenant 1, synthetic data only, no tool
   executor, custom database writes, external messages or customer inputs.
   Existing provider cost accounting remains active.
6. Stop: explicit CLI opt-in, per-request deadline, request/token ceilings,
   sequential work and Ctrl-C. Logs identify each case and arm.
7. Authority: deterministic independent oracles score outputs. Models cannot
   change fixtures, evaluator, policy or deployment. Owner alone may adopt.
8. Delta: no new execution authority. Counterbalance arm order; use matching
   tasks/repetitions, report served model, tokens, elapsed time and safety.

## Acceptance and limits
- Tests reject mismatched schema transformations, missing/duplicate pairs,
  model drift, absent usage, partial completion and unsafe answers.
- Development cases exercise plumbing; only evaluation cases inform the result.
- Evaluate both arms twice on each of ten evaluation cases (40 requests),
  plus both arms on two development cases (4 requests): 44 calls total.
- Existing production formatter is invoked directly, not reconstructed.
- An engineering-visible synthetic set is not a blind or customer-journey test.
  Small samples support an efficiency hypothesis, not a universal gain.
- Full canonical server regression suite and targeted sample tests are run;
  separately report existing failures and browser/E2E exclusions.
- No production prompt, route, tool menu, permission, scheduler or model switch.
