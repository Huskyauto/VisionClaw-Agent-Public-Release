# Research-Informed Safety and Learning

## Outcome

VisionClaw gains three bounded improvements supported by the supplied research: tenant-scoped shadow telemetry for repeated unqualified agreement, a reusable retrieval-quality measurement primitive, and a shadow-only research-crossover policy that can learn whether combining two strong empirical parents would outperform the current research process. Existing SkillOpt evolution lessons are treated as the WikiSkill-style durable lesson layer rather than duplicated.

## Scope (in)

- Add a deterministic anti-sycophancy assessment over bounded user/assistant turns.
- Run that assessment only when `ANTI_SYCOPHANCY_EVAL_MODE=shadow`, through the existing tenant heartbeat evaluator path.
- Persist aggregate metrics only; never persist sampled message text or conversation identifiers in evaluator snapshots.
- Add pure retrieval metrics for Precision@k, Recall@k, MRR, nDCG, and authorization leakage.
- Add a research-crossover policy that selects two independently evaluated empirical parents and judges a child only in exact `shadow` mode.
- Keep existing research keep/discard decisions authoritative.
- Confirm the existing SkillOpt evolution-lesson path already separates immutable attempt evidence, proposer knowledge, and executable skills.

## Scope (out)

- No model-weight training, RL post-training, Kimi/linear-attention hosting, or new model provider.
- No autonomous trading or hedge-fund execution.
- No new memory subsystem, vector store, database table, scheduled workflow, or timer.
- No production reply rewriting, user diagnosis, crisis classification, or user-facing warning based on heuristic telemetry.
- No research auto-apply or promotion authority.

## Acceptance criteria

1. Exact `shadow` is the only anti-sycophancy mode that scans messages.
2. The assessment detects repeated unqualified agreement while distinguishing respectful uncertainty/counterevidence.
3. The evaluator query binds both message and conversation tenant IDs, excludes deleted conversations, and caps the time window and row count.
4. Stored anti-sycophancy metrics contain no message text or conversation IDs.
5. Retrieval metrics are deterministic, bounded to the supplied ranking, and count out-of-scope retrieval as authorization leakage.
6. Research crossover requires two quality-passing empirical parents and never changes live selection outside shadow telemetry.
7. A crossover child is considered promising only on strict objective improvement with no quality regression.
8. Focused tests, TypeScript, build, wiring/stale-string gates, and independent architect review pass.

## Dependencies

- Existing `messages`, `conversations`, and `evaluator_snapshots` tables.
- Existing heartbeat `runAllEvaluators(tenantId)` call.
- Existing SkillOpt evolution lessons and research discovery observations.

## Unknowns

- Known: the supplied material supports measuring longitudinal agreement risk, not diagnosing users.
- Known: WikiSkill separation and lesson persistence already exist; no second implementation is warranted.
- Known: research crossover can reuse the existing experiment call by selecting parents and evaluating outcomes in shadow mode, avoiding an extra LLM call.

## Stop conditions

- Stop if implementation requires a schema migration or new recurring process.
- Stop if any feature changes a live reply, research keep/discard decision, or skill promotion.
- Stop if a new paid model call is required.
- Stop if aggregate telemetry cannot be kept tenant-scoped and value-free.

## Pre-build design gate

1. **Cost/scale:** anti-sycophancy scans at most 240 existing rows per tenant heartbeat with deterministic regexes; retrieval and crossover scoring are pure computation; additional LLM calls/day = `0 × $0 = $0`.
2. **State:** only existing Postgres evaluator snapshots are used. Pure helpers are stateless. No local-disk runtime state.
3. **Failure:** quality telemetry fails open for product behavior but reports `warning/degraded`; malformed crossover evidence fails closed to `not_ready`; existing replies and research decisions continue unchanged.
4. **Idempotency:** evaluator snapshots are append-only observations through the existing runner; no external side effects. Crossover records are derived from stable candidate IDs and do not execute actions.
5. **Tenant/limits:** every message query binds the tenant on both joined tables, excludes deleted conversations, uses a fixed lookback and row cap, and stores aggregates only.
6. **Kill switch/observation:** exact-value modes default off. Snapshot metrics and versioned shadow log records prove execution without enabling control.
7. **Authority dispersal:** the new code may observe and propose only. Existing independent evaluators, research scoring, owner controls, and deployment configuration retain approval, execution, audit, and stop authority.

## Scope changes

- 2026-08-31: Initial contract created from the supplied anti-sycophancy, WikiSkill, RAG/embeddings, EnvHarness, TTPO, and SwarmWorld material.