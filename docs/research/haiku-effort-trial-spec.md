# Bounded Haiku effort trial

Owner approved a bounded trial, not a production rollout.

## Outcome and acceptance

- A deterministic Haiku-only policy proposes low for simple work, medium for
  unknown/multistep work, and high only for authorized strict work.
- Jury, approval and non-Haiku calls bypass the policy. Budget pressure defers
  demanding work rather than silently lowering its quality. No automatic retry.
- A manually invoked, workspace-only evaluation uses server-owned synthetic
  fixtures, the native Anthropic Messages API and independently checked answers.
- Verify rejection of an invalid effort value before the effort sweep. Check
  served model, stop reason, text/tool output, and one streamed native response.
- Compare each candidate with the medium baseline on correctness, total output
  tokens (including thinking), latency and observed cost. Do not claim general
  superiority or automatically enable production from this small sample.
- Failures, truncated answers, missing usage or missing coverage make the
  evaluation non-promotable. Preserve all observations, including failures.

## Eight design-gate answers

1. **Cost/scale:** one sequential manual sweep, at most 16 calls including
   canaries; at most 4096 output tokens and a conservative 8192 input-token
   envelope per call. At short-context Haiku rates and cache-write surcharge,
   the worst case is below $0.05. Reserve $0.05 atomically using the existing
   tenant daily-budget claim before spending. SDK retries are disabled.
2. **State:** durable start marker and observed usage in the existing tenant
   cost ledger; no new tables. A local JSON evaluation report is an explicit
   export, not runtime state. Losing it cannot permit an automatic paid rerun.
3. **Failure:** native validation or availability failure stops the trial.
   Unknown paid completion never retries; the reservation remains conservative.
   Ledger failure stops further calls. No fallback model or endpoint.
4. **Idempotency:** tenant plus fixed suite/version digest binds a durable
   start marker before dispatch. Re-running the same evaluation refuses before
   another provider call. No caller-defined dataset, endpoint or model.
5. **Tenant/limits:** owner-only workspace runner, tenant-scoped claims and
   records, one sequential evaluation. No public API, agent tool, customer input
   or tenant credential borrowing.
6. **Stop/observe:** default invocation is dry-run; exact `--run` is required.
   Production execution is refused. Removing/never invoking the script stops
   it; no timer, workflow, flag or production effort hook is installed.
7. **Authority:** owner authorizes the trial; deterministic policy proposes;
   fixed answer checks judge outcomes; owner alone can approve later rollout.
   The model cannot edit its evaluator, budgets, prompts or fixture inputs.
8. **Delta:** identical fixed fixtures across low/medium/high with independent
   extraction, arithmetic, strict-format and untrusted-content/tool checks.
   Native streaming is separately smoke-tested. Report narrow evidence, not
   emergence or permission expansion.

## Not included

No production client replacement, automatic paid retries, model/jury/default
changes, new persona/tool, global paid enablement, autonomous rollout or publish.
