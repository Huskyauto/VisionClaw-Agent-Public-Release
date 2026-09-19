# Agent Primitives (R74.13)

Standalone, opt-in building blocks distilled from the agentspan-ai/agentspan
research project. **Nothing here is wired into hot paths automatically.** Each
primitive is a pure-TS module with no I/O and inline smoke tests. Wire them
into a real call site behind a feature flag, then flip the flag once telemetry
confirms zero regression.

## Why this directory exists

Bob's R74.13 directive was "integrate agentspan nuggets as STANDALONE primitives
without bogging down the system." The two patterns most worth lifting were:

1. **Composable termination conditions** — replace ad-hoc `if (round > N) break`
   chains with declarative `cond.and(otherCond).or(thirdCond)` trees that you
   can log, test, and visualise.
2. **Guardrails with explicit failure modes** — instead of `try/catch` around
   every output check, classify each guardrail as `retry` / `raise` / `fix` /
   `human` so the orchestrator can react uniformly.

## What's available

| Primitive | File | Smoke test command | Ready-to-wire? |
|---|---|---|---|
| `runGuardrails`, `lengthCap`, `regexBlock`, `regexRequire`, `fromCritique` | `guardrail.ts` | `npx tsx server/agent-primitives/guardrail.ts` | yes — see "Wiring guardrails" below |
| `textMention`, `maxRounds`, `tokenUsage`, `toolCalled`, `custom`, `.and()`, `.or()` | `termination.ts` | `npx tsx server/agent-primitives/termination.ts` | yes — see "Wiring termination" below |

Both modules are also re-exported from `./index.ts` (the barrel) so callers
can write `import { runGuardrails, maxRounds } from "./agent-primitives"`.

## Wiring guardrails (architect-recommended first integration)

The architect-blessed first call site is the existing `critiqueResponse` block
in `chat-engine.ts` (~line 3379). The plan:

1. Wrap the current critique call in a `runGuardrails([fromCritique(...)])`
   pipeline behind `process.env.GUARDRAILS_ENABLED === "1"` (default OFF).
2. With the flag OFF, the pipeline returns a no-op verdict and the original
   critique-agent path runs unchanged. Zero behavior change.
3. With the flag ON, additional guardrails (e.g. `lengthCap`, `regexBlock` for
   leaked secrets) can be appended to the array — that's the whole upgrade
   path.

Live call site is in `chat-engine.ts` (~line 3380). It's wired but flag-gated.
Default OFF preserves the original critique-only path. Enable with `GUARDRAILS_ENABLED=1`.

```ts
import { runGuardrails, fromCritique, lengthCap } from "./agent-primitives";

if (process.env.GUARDRAILS_ENABLED === "1") {
  const verdict = await runGuardrails(cleanedResponse, [
    // fromCritique takes a THUNK closing over user message + persona role —
    // simpler than stuffing them into the GuardrailContext.
    fromCritique(
      (resp) => critiqueResponse(userMessage, resp, personaRole),
      { name: "critique-agent", onFail: "fix" },
    ),
    lengthCap(8000, "output", { onFail: "fix" }),
  ]);
  if (!verdict.passed) {
    if (verdict.action === "fix" && verdict.fixedOutput) {
      cleanedResponse = verdict.fixedOutput;
    } else if (verdict.action === "raise") {
      console.warn(`[guardrails] Hard fail by ${verdict.failedBy}: ${verdict.message}`);
    }
    // verdict.action can also be "retry" or "human" — handle as needed.
  }
}
```

**Important: short-circuit semantics.** `runGuardrails()` STOPS at the first
failed guardrail and returns its verdict. The remaining guardrails in the array
are NOT evaluated. This is intentional (cheaper, mirrors compiler validation
chains) but means: if you want every guardrail to run regardless, call them
individually and aggregate yourself. The architect flagged this as a gotcha in
the original "append more guardrails" extensibility pitch — chaining is for
serial gating, not for parallel signals.

### `GuardrailVerdict` field reference

| Field | When set | Use |
|---|---|---|
| `passed: boolean` | always | True iff every guardrail passed |
| `action?: OnFail` | when `passed=false` | Which failure-mode the failing guardrail declared |
| `failedBy?: string` | when `passed=false` | Name of the failing guardrail |
| `message?: string` | when `passed=false` | Human-readable failure reason |
| `fixedOutput?: string` | when `action="fix"` | The corrected content to swap in |
| `results: Array<{guardrail, result}>` | always | Per-guardrail audit trail |

## Wiring termination

The existing supervisor loop in `chat-engine.ts` (~line 2569) uses a hardcoded
`MAX_TOOL_ROUNDS = 7` constant. To opt in to composable termination without
breaking the loop:

```ts
import { maxRounds, tokenUsage } from "./agent-primitives";

const stop = maxRounds(MAX_TOOL_ROUNDS).or(tokenUsage(150_000));
for (let round = 0; ; round++) {
  const verdict = stop.evaluate({ round, tokensUsed: tokenBudget.used });
  if (verdict.shouldTerminate) {
    console.log(`[supervisor] Stop reason: ${verdict.reason}`);
    break;
  }
  // ... existing loop body
}
```

This is more invasive than the guardrail wiring, so it's deferred until a
specific need arises (e.g. token-budget-aware loops for multi-tenant cost
control).

## Failure modes

| Mode | Behavior |
|---|---|
| `raise` | Throw immediately. The orchestrator catches and surfaces. |
| `retry` | Verdict says "retry the LLM call with the failure message appended as feedback". |
| `fix` | The guardrail returns a `fixedOutput` string that REPLACES the original (e.g. `lengthCap` truncates). |
| `human` | Pause the run and request human review (wires into agentic/approvals.ts when adopted). |

## What NOT to do

- **Do not import the primitives into `tools.ts`.** They're not LLM-callable
  tools — they're internal orchestration helpers used by the chat engine, the
  agentic plan executor, and the critique pipeline.
- **Do not enable feature flags by default in this directory.** Flags belong
  to the integration site (chat-engine.ts), not the primitive module.
- **Do not add stateful side effects.** Both modules are pure: any state lives
  in the caller (the supervisor loop, the runGuardrails accumulator).

## Related docs

- `docs/agentspan-nuggets-log.md` — ranked backlog of 8 deferred nuggets to
  graduate next (trigger-based handoff, durable HITL pause, prompt-assembly
  compile step, tool circuit breaker, etc.).
- `replit.md` "Agent Scaffolding Map" section — top-level index of every agent
  subsystem (tools, capabilities, skills, personas, primitives, agentic
  executor) so future contributors don't lose the map.
