/**
 * Composable termination conditions for agent loops.
 *
 * Inspired by agentspan-ai/agentspan's TerminationCondition pattern (MIT-licensed).
 * Lets callers declare WHEN an agent loop should stop using composable rules
 * combined with `.and(...)` / `.or(...)` instead of hardcoded `if (round >= MAX)`
 * checks scattered across chat-engine, agentic plan executor, etc.
 *
 * Usage example (NOT yet wired into hot paths — opt-in only):
 *
 *   import { textMention, maxRounds, tokenUsage, custom } from "./agent-primitives/termination";
 *
 *   // Stop when LLM emits "DONE" OR after 50 rounds OR over 100k tokens.
 *   const stop = textMention("DONE")
 *     .or(maxRounds(50))
 *     .or(tokenUsage(100_000));
 *
 *   // Inside a loop:
 *   const verdict = stop.evaluate({ result: latestText, round: i, tokensUsed: usage });
 *   if (verdict.shouldTerminate) { console.log(verdict.reason); break; }
 *
 * Design decisions for the VisionClaw port:
 *   - Pure functions, zero I/O, zero deps. Safe to import anywhere.
 *   - Conditions are PLAIN OBJECTS with .evaluate() — no class hierarchy, no abstract base.
 *   - .and() and .or() are method chains (not operator overloading like Python's `&`/`|`).
 *   - Context object is intentionally generic (Record<string, unknown>) so callers can
 *     extend it without modifying this module — termination is a contract, not a coupling.
 *
 * Status: PRIMITIVE AVAILABLE — no callers yet. Wire opt-in when refactoring loops.
 */

export interface TerminationContext {
  /** The latest LLM output text (for text-mention checks). */
  result?: string;
  /** Conversation history so far (count, last-message inspection, etc). */
  messages?: Array<{ role: string; content: string }>;
  /** Current loop iteration / round number (0-indexed or 1-indexed — caller chooses, be consistent). */
  round?: number;
  /** Cumulative token usage if the caller tracks it. */
  tokensUsed?: number;
  /** Last tool that was called (for tool-based stop conditions). */
  lastToolName?: string;
  /** Last tool's result (string-coerced). */
  lastToolResult?: unknown;
  /** Anything else the caller wants to pass — termination conditions can read freely. */
  [key: string]: unknown;
}

export interface TerminationVerdict {
  /** True if the agent should stop. */
  shouldTerminate: boolean;
  /** Human-readable explanation (empty when shouldTerminate=false). */
  reason: string;
}

export interface TerminationCondition {
  /** Stable name for logging/debugging (e.g. "MaxRounds(50)"). */
  readonly name: string;
  /** Evaluate the condition against the current context. */
  evaluate(ctx: TerminationContext): TerminationVerdict;
  /** Combine: terminate when BOTH this AND `other` would terminate. */
  and(other: TerminationCondition): TerminationCondition;
  /** Combine: terminate when EITHER this OR `other` would terminate. */
  or(other: TerminationCondition): TerminationCondition;
}

/** Internal factory — wraps an evaluate function with .and()/.or() helpers. */
function makeCondition(
  name: string,
  evaluate: (ctx: TerminationContext) => TerminationVerdict,
): TerminationCondition {
  const cond: TerminationCondition = {
    name,
    evaluate,
    and(other) {
      return makeCondition(`(${name} AND ${other.name})`, (ctx) => {
        const a = cond.evaluate(ctx);
        if (!a.shouldTerminate) return { shouldTerminate: false, reason: "" };
        const b = other.evaluate(ctx);
        if (!b.shouldTerminate) return { shouldTerminate: false, reason: "" };
        return { shouldTerminate: true, reason: `${a.reason} && ${b.reason}` };
      });
    },
    or(other) {
      return makeCondition(`(${name} OR ${other.name})`, (ctx) => {
        const a = cond.evaluate(ctx);
        if (a.shouldTerminate) return a;
        return other.evaluate(ctx);
      });
    },
  };
  return cond;
}

// ─── Built-in conditions ──────────────────────────────────────────────────

/** Stop when the latest result mentions a specific text (case-insensitive by default). */
export function textMention(text: string, opts: { caseSensitive?: boolean } = {}): TerminationCondition {
  const needle = opts.caseSensitive ? text : text.toLowerCase();
  return makeCondition(`TextMention(${JSON.stringify(text)})`, (ctx) => {
    const hay = ctx.result ?? "";
    const found = opts.caseSensitive ? hay.includes(needle) : hay.toLowerCase().includes(needle);
    return found
      ? { shouldTerminate: true, reason: `mention of "${text}" detected` }
      : { shouldTerminate: false, reason: "" };
  });
}

/** Stop after N loop iterations. */
export function maxRounds(n: number): TerminationCondition {
  return makeCondition(`MaxRounds(${n})`, (ctx) => {
    const r = ctx.round ?? 0;
    return r >= n
      ? { shouldTerminate: true, reason: `max rounds reached (${r}/${n})` }
      : { shouldTerminate: false, reason: "" };
  });
}

/** Stop after N total messages in the conversation. */
export function maxMessages(n: number): TerminationCondition {
  return makeCondition(`MaxMessages(${n})`, (ctx) => {
    const m = ctx.messages?.length ?? 0;
    return m >= n
      ? { shouldTerminate: true, reason: `max messages reached (${m}/${n})` }
      : { shouldTerminate: false, reason: "" };
  });
}

/** Stop after total cumulative token spend exceeds the budget. */
export function tokenUsage(maxTokens: number): TerminationCondition {
  return makeCondition(`TokenUsage(${maxTokens})`, (ctx) => {
    const t = ctx.tokensUsed ?? 0;
    return t >= maxTokens
      ? { shouldTerminate: true, reason: `token budget exhausted (${t}/${maxTokens})` }
      : { shouldTerminate: false, reason: "" };
  });
}

/** Stop after a specific tool was called (with optional substring match on its result). */
export function toolCalled(
  toolName: string,
  opts: { resultContains?: string } = {},
): TerminationCondition {
  return makeCondition(`ToolCalled(${toolName})`, (ctx) => {
    if (ctx.lastToolName !== toolName) return { shouldTerminate: false, reason: "" };
    if (opts.resultContains !== undefined) {
      const r = String(ctx.lastToolResult ?? "");
      if (!r.includes(opts.resultContains)) return { shouldTerminate: false, reason: "" };
    }
    return { shouldTerminate: true, reason: `tool ${toolName} was called` };
  });
}

/** Wrap an arbitrary predicate as a termination condition. Use for one-off custom logic. */
export function custom(
  name: string,
  fn: (ctx: TerminationContext) => boolean | TerminationVerdict,
): TerminationCondition {
  return makeCondition(name, (ctx) => {
    const out = fn(ctx);
    if (typeof out === "boolean") {
      return out
        ? { shouldTerminate: true, reason: `${name} fired` }
        : { shouldTerminate: false, reason: "" };
    }
    return out;
  });
}

/** Never stops — useful as a no-op default or as `someCondition.or(never())` for testing. */
export const never = (): TerminationCondition =>
  makeCondition("Never", () => ({ shouldTerminate: false, reason: "" }));

/** Always stops on the first call — useful for testing or as a circuit-breaker. */
export const always = (): TerminationCondition =>
  makeCondition("Always", () => ({ shouldTerminate: true, reason: "always-true" }));

// ─── Inline smoke test (run via `npx tsx server/agent-primitives/termination.ts`) ───

if (import.meta.url === `file://${process.argv[1]}`) {
  const tests: Array<[string, boolean]> = [];

  // textMention
  const t1 = textMention("DONE");
  tests.push(["textMention positive", t1.evaluate({ result: "all DONE here" }).shouldTerminate === true]);
  tests.push(["textMention negative", t1.evaluate({ result: "still working" }).shouldTerminate === false]);
  tests.push(["textMention case-insensitive", t1.evaluate({ result: "we are done" }).shouldTerminate === true]);

  // maxRounds
  tests.push(["maxRounds under", maxRounds(5).evaluate({ round: 3 }).shouldTerminate === false]);
  tests.push(["maxRounds at", maxRounds(5).evaluate({ round: 5 }).shouldTerminate === true]);

  // OR composition
  const orStop = textMention("STOP").or(maxRounds(10));
  tests.push(["OR text wins", orStop.evaluate({ result: "STOP", round: 0 }).shouldTerminate === true]);
  tests.push(["OR round wins", orStop.evaluate({ result: "x", round: 10 }).shouldTerminate === true]);
  tests.push(["OR neither", orStop.evaluate({ result: "x", round: 5 }).shouldTerminate === false]);

  // AND composition
  const andStop = textMention("FINAL").and(maxRounds(3));
  tests.push(["AND only text", andStop.evaluate({ result: "FINAL", round: 1 }).shouldTerminate === false]);
  tests.push(["AND only round", andStop.evaluate({ result: "x", round: 3 }).shouldTerminate === false]);
  tests.push(["AND both", andStop.evaluate({ result: "FINAL", round: 3 }).shouldTerminate === true]);

  // toolCalled
  const tc = toolCalled("submit", { resultContains: "ok" });
  tests.push(["toolCalled wrong tool", tc.evaluate({ lastToolName: "other", lastToolResult: "ok" }).shouldTerminate === false]);
  tests.push(["toolCalled match", tc.evaluate({ lastToolName: "submit", lastToolResult: "ok done" }).shouldTerminate === true]);
  tests.push(["toolCalled no substr", tc.evaluate({ lastToolName: "submit", lastToolResult: "fail" }).shouldTerminate === false]);

  let pass = 0;
  let fail = 0;
  for (const [name, ok] of tests) {
    if (ok) {
      pass++;
    } else {
      fail++;
      console.error(`  ✗ ${name}`);
    }
  }
  console.log(`termination smoke test: ${pass}/${pass + fail} passed`);
  if (fail > 0) process.exit(1);
}
