# Bounded prompt rollout and run confirmation

## Approved outcome
Keep the comparison harness; trial schema compaction only in owner plan LLM
steps; add read-only, evidence-based confirmation after project runs.
Confirmation never means publication approval or a second AI agreeing.

## Design gate
1. Cost: deterministic confirmation costs zero model calls. Existing plan calls
   are not duplicated. Live A/B remains explicit, capped at 44 requests.
2. State: plan evidence remains in existing tenant-scoped Postgres logs.
   Workspace project receipts are explicitly local engineering outputs, not
   production state; loss requires rerunning checks, never inventing a receipt.
3. Failure: failed checks => failed; missing/skipped checks or changed source =>
   unverified. Confirmation never retries side effects or changes run status.
4. Identity: bind each receipt to exact requirement IDs, observed evidence,
   verifier version and source digest. A hash binds bytes; it is not a signature.
5. Scope: authenticated existing run-detail route retains its tenant WHERE.
   Engineering CLI is owner-operated, offline and accepts no arbitrary command.
6. Stop: COMPACT_OWNER_PLAN_SCHEMAS=1 is exact opt-in; unset/0 restores pretty
   schemas on the next call. Confirmation has fixed input/check/output bounds.
7. Authority: owner defines acceptance checks before running; deterministic
   checks assess them. Models cannot redefine passing, approve or publish.
8. Delta: whitespace only; owner plan LLM steps only. No model, tool, refusal,
   repair, tenant, retry or permission changes. Regression fixtures include
   nested schema, missing evidence, failure and stale source.

## Acceptance
- Trial is opt-in, owner-only and limited to the plan-step profile.
- Same schema and all policy text survive compaction; rollback restores exact
  baseline formatting. Attempt logs identify the profile and format.
- A project confirmation command runs an explicit bounded list of offline
  node:test files, binds exact workspace source before/after, and writes JSON
  and Markdown reports with confirmed/failed/unverified status.
- Existing targeted release checks also issue the same scoped confirmation.
- Existing workflow replay shows a read-only evidence assessment. Model success
  and tool-return success alone cannot confirm the user's business outcome.
- No automatic promotion, customer-action replay, publication, commits or push.

## Limits
First version confirms engineering acceptance checks and exposes agent-run
evidence, not arbitrary real-world facts. Inbox receipt, paid fulfillment and
other external outcomes still require their own authoritative verifier.
