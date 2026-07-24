// R74.13 — Agent primitive barrel.
// Single import surface so future call sites can pull everything via:
//   import { runGuardrails, lengthCap, maxRounds, fromCritique } from "./agent-primitives";
// instead of remembering the per-file paths. Keeping the barrel paper-thin so dead-code
// elimination still removes unused symbols at the bundler level.

export {
  type Guardrail,
  type GuardrailResult,
  type GuardrailVerdict,
  type Position,
  type OnFail,
  runGuardrails,
  lengthCap,
  regexBlock,
  regexRequire,
  customGuardrail,
  fromCritique,
} from "./guardrail";

export {
  type TerminationCondition,
  type TerminationContext,
  type TerminationVerdict,
  textMention,
  maxRounds,
  maxMessages,
  tokenUsage,
  toolCalled,
  custom,
  never,
  always,
} from "./termination";
