# Scoped Haiku 5.5 rollout

Owner authorized preparation for republishing on 2026-10-08.

Scope: upgrade the existing paid content-repurposing operation from Haiku 4.5
to Haiku 5.5, fixed medium effort. No global model, jury, approval, security
review or premium-finalizer changes. Automatic low/high proposals remain shadow-only.
Generic routing stays unchanged: its fast tier is broader than this specific task.

## Verification

- Seven adapter tests cover medium/native request, admission, tenant identity,
  cache-inclusive accounting, unknown completion/no retries, flat route
  preservation, invalid usage/model/truncation, cancellation and ledger failure.
- Existing content-repurposer tests retain six-platform behavior and unchanged
  public schema; migrated-surface identity check also includes the already
  registered Copilot definition (its explicit expected map and inventory
  snapshot were stale; no runtime registration changed).
- TypeScript validation passed.
- One synthetic live repurposeContent call produced X (148 characters) and
  LinkedIn (667 characters), retained the source's 42 reading, and was untruncated.
  Owner-scoped native ledger: Haiku 5.5, medium:observed_usage, 739 input /330
  output tokens, estimated $0.000239. Nothing was published or scheduled.
- Independent architect review found no rollout blocker. Fake route tests do
  not prove other tenants' live credentials or general drafting quality.
- Do not rerun paid smoke automatically. Owner chooses when to republish.

## Design gate

1. Cost: one inference per operation, 8192 input / 4096 output tokens maximum,
   conservative $0.003072 bound. Native SDK retries disabled. Reserve against
   existing tenant daily budget; retain the Anthropic daily breaker.
2. State: existing tenant cost ledger, including conservative unknown completion.
   Draft generation only; no publishing, scheduling or new durable tables.
3. Failure: missing tenant, native key, budget, usage or complete output fails
   explicitly. No paid retry or post-dispatch fallback.
4. Idempotency: no internal retry scheduler; existing tool action lifecycle
   remains responsible for distinct invocations. Daily admission bounds spend.
5. Tenant: handler supplies trusted ctx.tenantId, never a public argument.
   Owner approval permits a metered exception only for this existing paid task.
   Other tenants retain ordinary provider cost policy and their own credentials.
6. Stop: revert this task-specific default; no environment flag or timer added.
7. Authority: owner authorized placement; model cannot select route/effort,
   change budget, invoke tools or publish its drafts.
8. Evidence: medium passed the native fixed-fixture trial. Verify this task
   through its existing public repurposeContent interface, synthetic live draft
   generation, deterministic routing/accounting tests and independent review.
   No claim of broad quality gains; price comparison is per token, not measured
   aggregate savings. Haiku 5.5 short-context listed rates are one tenth of the
   older Haiku 4.5 rates.
