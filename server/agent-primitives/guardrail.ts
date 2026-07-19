/**
 * Guardrail abstraction with 4 failure modes.
 *
 * Inspired by agentspan-ai/agentspan's Guardrail pattern (MIT-licensed).
 * Unifies the validation surface so input/output checks (PII, length caps,
 * brand voice, critique judgments, KB-injection guards) all share one shape:
 *
 *   {passed, message, fixedOutput} → on failure, do one of: retry / raise / fix / human
 *
 * VisionClaw today has critique-agent.ts, active-clarification.ts, and the
 * KB-injection-shield as 3 disconnected validators. This module gives them a
 * common interface so future code can compose multiple validators without
 * touching chat-engine.
 *
 * Status: PRIMITIVE AVAILABLE — no hot-path callers yet. Wire opt-in.
 *
 * Usage example:
 *
 *   import { Guardrail, lengthCap, regexBlock, runGuardrails } from "./agent-primitives/guardrail";
 *
 *   const checks: Guardrail[] = [
 *     lengthCap(4000, "output"),
 *     regexBlock(/\b\d{16}\b/, "output", { message: "credit card number detected", onFail: "raise" }),
 *   ];
 *
 *   const verdict = await runGuardrails(assistantText, checks);
 *   if (!verdict.passed) {
 *     switch (verdict.action) {
 *       case "retry": // re-call LLM with verdict.message appended to prompt
 *       case "raise": // throw / 4xx the request
 *       case "fix":   // use verdict.fixedOutput in place of original
 *       case "human": // queue for human review
 *     }
 *   }
 */

export type OnFail = "retry" | "raise" | "fix" | "human";
export type Position = "input" | "output";

export interface GuardrailResult {
  /** True if content passes the guardrail. */
  passed: boolean;
  /** Feedback message — appended to prompt on retry, surfaced to humans on raise/human. */
  message?: string;
  /** Replacement content for `onFail: "fix"`. Ignored when passed=true. */
  fixedOutput?: string;
}

export interface Guardrail {
  /** Stable identifier for logging/auditing. */
  readonly name: string;
  /** Where this guardrail runs relative to the LLM call. */
  readonly position: Position;
  /** What to do when this guardrail fails. */
  readonly onFail: OnFail;
  /** The validation function — sync or async. */
  check(content: string, ctx?: GuardrailContext): GuardrailResult | Promise<GuardrailResult>;
}

export interface GuardrailContext {
  /** The user's original request (for output guardrails that need to compare). */
  userMessage?: string;
  /** Persona / role hint. */
  personaRole?: string;
  /** Tenant scope (for tenant-aware guardrails). */
  tenantId?: number;
  /** Anything else callers want to pass. */
  [key: string]: unknown;
}

export interface GuardrailVerdict {
  /** True if ALL guardrails passed. */
  passed: boolean;
  /** First failed guardrail's onFail mode (undefined when passed=true). */
  action?: OnFail;
  /** First failed guardrail's name. */
  failedBy?: string;
  /** First failed guardrail's message. */
  message?: string;
  /** First failed guardrail's fixedOutput (for action="fix"). */
  fixedOutput?: string;
  /** All results in order, for auditing. */
  results: Array<{ guardrail: string; result: GuardrailResult }>;
}

/** Run a chain of guardrails against content. Stops at the first failure. */
export async function runGuardrails(
  content: string,
  guardrails: Guardrail[],
  ctx: GuardrailContext = {},
): Promise<GuardrailVerdict> {
  const results: Array<{ guardrail: string; result: GuardrailResult }> = [];
  for (const g of guardrails) {
    const r = await g.check(content, ctx);
    results.push({ guardrail: g.name, result: r });
    if (!r.passed) {
      return {
        passed: false,
        action: g.onFail,
        failedBy: g.name,
        message: r.message,
        fixedOutput: r.fixedOutput,
        results,
      };
    }
  }
  return { passed: true, results };
}

// ─── Built-in guardrails ──────────────────────────────────────────────────

/** Cap output length. onFail="fix" truncates; others raise/retry. The fixed output is GUARANTEED to be <= maxChars. */
export function lengthCap(maxChars: number, position: Position = "output", opts: { onFail?: OnFail } = {}): Guardrail {
  const onFail = opts.onFail ?? "fix";
  return {
    name: `lengthCap(${maxChars})`,
    position,
    onFail,
    check(content) {
      if (content.length <= maxChars) return { passed: true };
      // R74.13 hot-fix #1 — was `slice(0, maxChars) + "…"` which is `maxChars + 1` chars.
      // Now reserves 1 char for ellipsis so the fixed output never exceeds the cap.
      // For maxChars <= 0, return empty string (degenerate but defined).
      let fixedOutput: string | undefined;
      if (onFail === "fix") {
        fixedOutput = maxChars >= 1 ? content.slice(0, maxChars - 1) + "…" : "";
      }
      return {
        passed: false,
        message: `Content exceeds ${maxChars} chars (got ${content.length}).`,
        fixedOutput,
      };
    },
  };
}

/** Block content matching a regex (e.g. credit-card numbers, secrets). */
export function regexBlock(
  pattern: RegExp,
  position: Position = "output",
  opts: { message?: string; onFail?: OnFail } = {},
): Guardrail {
  const onFail = opts.onFail ?? "raise";
  return {
    name: `regexBlock(${pattern.source.slice(0, 40)})`,
    position,
    onFail,
    check(content) {
      const m = content.match(pattern);
      if (!m) return { passed: true };
      return {
        passed: false,
        message: opts.message ?? `Content matched blocked pattern: ${pattern.source.slice(0, 40)}`,
      };
    },
  };
}

/** Require content to match a regex (e.g. must include a citation footnote). */
export function regexRequire(
  pattern: RegExp,
  position: Position = "output",
  opts: { message?: string; onFail?: OnFail } = {},
): Guardrail {
  const onFail = opts.onFail ?? "retry";
  return {
    name: `regexRequire(${pattern.source.slice(0, 40)})`,
    position,
    onFail,
    check(content) {
      // R74.13 hot-fix #2 — pattern.test() mutates lastIndex on /g and /y patterns,
      // causing alternating pass/fail across repeated checks on the same instance.
      // Reset lastIndex defensively (no-op for non-g/y patterns).
      pattern.lastIndex = 0;
      if (pattern.test(content)) return { passed: true };
      return {
        passed: false,
        message: opts.message ?? `Content did not match required pattern: ${pattern.source.slice(0, 40)}`,
      };
    },
  };
}

/** Adapt an arbitrary async predicate as a Guardrail. */
export function customGuardrail(
  name: string,
  position: Position,
  onFail: OnFail,
  fn: (content: string, ctx?: GuardrailContext) => GuardrailResult | Promise<GuardrailResult>,
): Guardrail {
  return { name, position, onFail, check: fn };
}

/**
 * Adapt the project's `critiqueResponse` (server/critique-agent.ts) as a Guardrail.
 *
 * R74.13 hot-fix — the original adapter assumed `{ score, issues? }`, but the
 * real critique-agent returns `{ score, accuracy, completeness, relevance,
 * critique?, refinedResponse?, wasRefined }`. The new shape:
 *   - PASS when `score >= minScore` (default 7) AND `wasRefined === false`
 *   - FAIL with `fixedOutput = refinedResponse` when the critique already
 *     produced a refined version (drops cleanly into onFail="fix" path)
 *   - FAIL with no `fixedOutput` (just a message) when the critique scored
 *     low but produced no refinement (caller can retry/raise per onFail)
 *
 * The adapter takes a thunk-style critiqueFn so the call site can close over
 * `userMessage`/`personaRole` instead of stuffing them into ctx.
 */
export function fromCritique(
  critiqueFn: (assistantResponse: string) => Promise<{
    score: number;
    refinedResponse?: string;
    wasRefined?: boolean;
    issues?: string[];
    critique?: string;
  }>,
  opts: { name?: string; minScore?: number; onFail?: OnFail } = {},
): Guardrail {
  const minScore = opts.minScore ?? 7;
  const onFail = opts.onFail ?? "fix";
  return {
    name: opts.name ?? `critique(min=${minScore})`,
    position: "output",
    onFail,
    async check(content) {
      const result = await critiqueFn(content);
      // Pass: score met threshold AND nothing was refined.
      if (result.score >= minScore && !result.wasRefined) {
        return { passed: true };
      }
      // Two distinct fail reasons — message should reflect WHICH one tripped:
      //   (a) wasRefined=true (regardless of score) → critique improved the output, surface that.
      //   (b) score < minScore → quality bar miss, surface the score + issues.
      const detail = result.issues?.length
        ? `\nIssues: ${result.issues.join("; ")}`
        : (result.critique ? `\n${result.critique.slice(0, 200)}` : "");
      const baseMsg = result.wasRefined
        ? `Critique auto-refined output (score ${result.score}/10).`
        : `Critique score ${result.score}/10 below threshold ${minScore}.`;
      return {
        passed: false,
        message: `${baseMsg}${detail}`,
        fixedOutput: result.refinedResponse,
      };
    },
  };
}

// ─── Inline smoke test (run via `npx tsx server/agent-primitives/guardrail.ts`) ───

if (import.meta.url === `file://${process.argv[1]}`) {
  (async () => {
    const tests: Array<[string, boolean]> = [];

    // lengthCap fix mode
    const cap = lengthCap(10);
    const capR1 = await cap.check("short");
    tests.push(["lengthCap pass", capR1.passed === true]);
    const capR2 = await cap.check("this is way too long");
    tests.push(["lengthCap fail", capR2.passed === false]);
    tests.push(["lengthCap fixed output set", typeof capR2.fixedOutput === "string"]);
    // R74.13 hot-fix #1 — fixed output must respect the cap.
    tests.push(["lengthCap fix RESPECTS cap", (capR2.fixedOutput ?? "").length <= 10]);
    // Edge case: maxChars=0
    const cap0 = lengthCap(0);
    const cap0R = await cap0.check("anything");
    tests.push(["lengthCap maxChars=0 fixedOutput is empty", cap0R.fixedOutput === ""]);

    // regexBlock raise mode
    const block = regexBlock(/secret/i);
    tests.push(["regexBlock pass", (await block.check("hello world")).passed === true]);
    tests.push(["regexBlock fail", (await block.check("the SECRET is")).passed === false]);

    // regexRequire retry mode
    const req = regexRequire(/^\[\d+\]/);
    tests.push(["regexRequire pass", (await req.check("[1] cited content")).passed === true]);
    tests.push(["regexRequire fail", (await req.check("uncited content")).passed === false]);
    // R74.13 hot-fix #2 — /g pattern stability across repeated calls (lastIndex reset).
    const reqGlobal = regexRequire(/cited/g);
    const r1 = await reqGlobal.check("the cited content here");
    const r2 = await reqGlobal.check("the cited content here");
    const r3 = await reqGlobal.check("the cited content here");
    tests.push(["regexRequire /g stable across calls", r1.passed === true && r2.passed === true && r3.passed === true]);

    // runGuardrails — chain stops at first failure
    const verdict = await runGuardrails("text with SECRET in it", [
      lengthCap(1000),
      regexBlock(/SECRET/),
      regexRequire(/never-matches-anything/),
    ]);
    tests.push(["chain stops at first fail", verdict.passed === false]);
    tests.push(["chain reports failedBy", verdict.failedBy?.startsWith("regexBlock") === true]);
    tests.push(["chain reports action", verdict.action === "raise"]);
    tests.push(["chain has 2 results (stopped early)", verdict.results.length === 2]);

    // chain that passes
    const okVerdict = await runGuardrails("clean", [lengthCap(100), regexBlock(/secret/)]);
    tests.push(["chain pass", okVerdict.passed === true]);
    tests.push(["chain pass has all results", okVerdict.results.length === 2]);

    // fromCritique adapter — new thunk-style signature matches real critique-agent shape
    const fakeCritique = async (r: string) => ({
      score: r.length > 5 ? 9 : 4,
      wasRefined: r.length > 5 ? false : true,
      refinedResponse: r.length > 5 ? undefined : "fixed-up-response",
      issues: r.length > 5 ? [] : ["too short"],
    });
    const critic = fromCritique(fakeCritique, { minScore: 7, onFail: "fix" });
    tests.push(["critique adapter pass (high score, no refine)", (await critic.check("a long enough response")).passed === true]);
    const critFail = await critic.check("hi");
    tests.push(["critique adapter fail (low score)", critFail.passed === false]);
    tests.push(["critique adapter exposes refinedResponse as fixedOutput", critFail.fixedOutput === "fixed-up-response"]);
    tests.push(["critique adapter message includes issues", (critFail.message ?? "").includes("too short")]);
    // Refined-but-passing-score case (wasRefined=true should still mark as fail so the fix runs)
    const fakeRefinedCritique = async (_r: string) => ({
      score: 9, wasRefined: true, refinedResponse: "polished",
    });
    const criticR = fromCritique(fakeRefinedCritique, { minScore: 7, onFail: "fix" });
    const refinedV = await criticR.check("any input");
    tests.push(["critique adapter — wasRefined trumps score", refinedV.passed === false && refinedV.fixedOutput === "polished"]);

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
    console.log(`guardrail smoke test: ${pass}/${pass + fail} passed`);
    if (fail > 0) process.exit(1);
  })();
}
