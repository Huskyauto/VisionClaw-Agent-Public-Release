# Research-Informed Safety and Learning — Plan

## Slices

### S1: Shadow anti-sycophancy telemetry
- **Acceptance:** bounded tenant-scoped turns produce aggregate repeated-agreement risk metrics only in exact shadow mode.
- **Files:** `server/lib/anti-sycophancy-evaluator.ts`, `server/evaluators.ts`, focused tests.
- **Status:** done

### S2: Retrieval evaluation primitive
- **Acceptance:** a pure evaluator reports standard ranking metrics and authorization leakage with deterministic fixtures.
- **Files:** `server/lib/retrieval-evaluation.ts`, focused tests.
- **Status:** done

### S3: Research crossover shadow policy
- **Acceptance:** two empirical quality-passing parents can produce a shadow recommendation, but no live decision changes.
- **Files:** `server/lib/research-discovery-controller.ts`, `server/research-engine.ts`, focused tests.
- **Status:** done

### S4: Existing WikiSkill-layer verification and release gates
- **Acceptance:** tests document that evolution lessons remain proposer-only, evidence-linked, tenant-scoped, and separate from runtime skill execution; all release gates and architect review pass.
- **Files:** existing SkillOpt tests, feature contract, `replit.md`.
- **Status:** done