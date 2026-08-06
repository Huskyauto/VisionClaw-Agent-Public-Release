// R77.5 — KisMATH-style math/finance chain verifier (arxiv 2507.11408v2)
//
// KisMATH §3 introduces "Causal CoT Graphs": treating each reasoning step as a
// node and the answer as a leaf, then probing whether the value at each node
// truly mediates the leaf. For finance and math chains this is a *deterministic*
// problem — every numeric step is a pure function of named inputs and we can
// re-execute it without an LLM.
//
// Inputs:
//   steps: Array of {id, expression, dependsOn?} — expressions are basic
//          arithmetic over named variables ({a-zA-Z_][\w]*) and literal numbers.
//          Operators: + - * / % ** and parentheses. No function calls, no
//          identifiers that aren't pre-declared, no string ops.
//   bindings: Record<string, number> — initial named values (e.g. revenue=1000).
//   expectedFinal?: number — optional final-answer expectation.
//
// Output: passed/failed per step, recomputed value, plus a chain-level
// "load-bearing" report (which steps are referenced by later steps).
//
// Used by Cassandra (financial planning), Atlas (analysis), and any persona
// that emits an arithmetic chain it wants the supervisor to vouch for.

export interface MathStep {
  id: string;
  expression: string;     // e.g. "revenue - cost"
  claimedValue?: number;  // what the LLM said this step equals
  dependsOn?: string[];   // optional explicit hints; auto-derived from expression if omitted
  unit?: string;          // optional unit string for unit-mismatch detection
}

export interface MathStepResult {
  id: string;
  expression: string;
  computedValue: number | null;
  claimedValue?: number;
  passed: boolean;
  error?: string;
  loadBearing: boolean;   // true if any later step refers to this step's id
  unitWarnings?: string[];
}

export interface VerifyMathChainOptions {
  steps: MathStep[];
  bindings?: Record<string, number>;
  expectedFinal?: number;
  tolerance?: number;     // relative tolerance for floating-point comparison (default 1e-6)
}

const DEFAULT_TOLERANCE = 1e-6;
const MAX_STEPS = 64;
const MAX_EXPR_LEN = 240;

const IDENT_RE = /[A-Za-z_][\w]*/g;
// Restrict the operator set we'll permit in expressions; anything else is rejected
// to keep the evaluator a pure arithmetic island (no function calls, no globals).
const SAFE_EXPR_RE = /^[\s0-9+\-*/%().,_eE**A-Za-z]+$/;

function extractIdents(expr: string): string[] {
  const idents = new Set<string>();
  for (const m of expr.matchAll(IDENT_RE)) {
    const name = m[0];
    // Filter out scientific-notation pseudo-identifiers like "e10"
    if (/^[eE]\d/.test(name)) continue;
    idents.add(name);
  }
  return [...idents];
}

function evalExpression(expr: string, scope: Record<string, number>): number {
  if (expr.length > MAX_EXPR_LEN) {
    throw new Error(`expression exceeds max length ${MAX_EXPR_LEN}`);
  }
  if (!SAFE_EXPR_RE.test(expr)) {
    throw new Error(`expression contains disallowed characters`);
  }
  // Resolve identifiers up-front and substitute their numeric values, so the
  // Function constructor only ever sees literals + operators. This refuses any
  // identifier the caller didn't declare in `scope`.
  const idents = extractIdents(expr);
  for (const id of idents) {
    if (!(id in scope)) {
      throw new Error(`undefined identifier "${id}" — declare it in bindings or earlier in the chain`);
    }
    if (typeof scope[id] !== "number" || !Number.isFinite(scope[id])) {
      throw new Error(`identifier "${id}" is not a finite number`);
    }
  }
  // Token-replace: longest names first so "revenue_total" doesn't get mangled by "revenue".
  const sorted = [...idents].sort((a, b) => b.length - a.length);
  let safeExpr = expr;
  for (const id of sorted) {
    const v = scope[id];
    safeExpr = safeExpr.replace(new RegExp(`\\b${id}\\b`, "g"), `(${v})`);
  }
  // Final guard: after substitution, the only allowed chars are digits, ops,
  // parens, dots, commas, e/E (sci notation), and whitespace. No remaining
  // letters allowed.
  if (/[A-Za-z_]/.test(safeExpr.replace(/[eE]/g, ""))) {
    throw new Error("post-substitution leftover identifiers");
  }
  // eslint-disable-next-line no-new-func
  const fn = new Function(`"use strict"; return (${safeExpr});`);
  const result = fn();
  if (typeof result !== "number" || !Number.isFinite(result)) {
    throw new Error(`expression did not evaluate to a finite number (got ${result})`);
  }
  return result;
}

function relClose(a: number, b: number, tol: number): boolean {
  if (a === b) return true;
  const denom = Math.max(Math.abs(a), Math.abs(b), 1e-12);
  return Math.abs(a - b) / denom <= tol;
}

export function verifyMathChain(opts: VerifyMathChainOptions): {
  passed: boolean;
  totalSteps: number;
  passedSteps: number;
  results: MathStepResult[];
  finalValue: number | null;
  finalMatch?: boolean;
  summary: string;
} {
  const tol = opts.tolerance ?? DEFAULT_TOLERANCE;
  const steps = opts.steps || [];
  if (steps.length === 0) {
    return { passed: false, totalSteps: 0, passedSteps: 0, results: [], finalValue: null, summary: "No steps provided." };
  }
  if (steps.length > MAX_STEPS) {
    return { passed: false, totalSteps: steps.length, passedSteps: 0, results: [], finalValue: null, summary: `Refusing to verify chain of ${steps.length} steps (max ${MAX_STEPS}).` };
  }

  // Reject duplicate ids — they break the dependency graph.
  const ids = new Set<string>();
  for (const s of steps) {
    if (!s.id || typeof s.id !== "string") {
      return { passed: false, totalSteps: steps.length, passedSteps: 0, results: [], finalValue: null, summary: `Step missing id: ${JSON.stringify(s).slice(0, 120)}` };
    }
    if (ids.has(s.id)) {
      return { passed: false, totalSteps: steps.length, passedSteps: 0, results: [], finalValue: null, summary: `Duplicate step id "${s.id}"` };
    }
    ids.add(s.id);
  }

  const scope: Record<string, number> = { ...(opts.bindings || {}) };
  const unitMap: Record<string, string | undefined> = {};
  // Bind incoming units as undefined initially (we only have units when the LLM declares them per-step).
  for (const k of Object.keys(scope)) unitMap[k] = undefined;

  const results: MathStepResult[] = [];
  // Precompute referrers for "load-bearing" detection.
  const referrers: Record<string, Set<string>> = {};
  for (const s of steps) referrers[s.id] = new Set();
  for (let i = 0; i < steps.length; i++) {
    const s = steps[i];
    const idents = extractIdents(s.expression);
    for (const id of idents) {
      if (referrers[id]) referrers[id].add(s.id);
    }
  }

  for (const s of steps) {
    let computed: number | null = null;
    let error: string | undefined;
    const unitWarnings: string[] = [];
    try {
      computed = evalExpression(s.expression, scope);
      // Unit propagation: if every referenced ident has a unit, all must agree
      // for + / - and be combinable for * / /. We do a soft check: just warn
      // when units are declared but mismatch on +/-.
      const idents = extractIdents(s.expression);
      const declaredUnits = idents.map(id => unitMap[id]).filter(Boolean) as string[];
      if (/[+\-]/.test(s.expression) && declaredUnits.length >= 2) {
        const distinct = new Set(declaredUnits);
        if (distinct.size > 1) {
          unitWarnings.push(`unit mismatch on +/- (${[...distinct].join(", ")})`);
        }
      }
    } catch (e) {
      error = (e as Error).message;
    }

    let passed = error == null;
    if (passed && computed != null && typeof s.claimedValue === "number" && Number.isFinite(s.claimedValue)) {
      if (!relClose(computed, s.claimedValue, tol)) {
        passed = false;
        error = `claimed_value=${s.claimedValue} but expression evaluates to ${computed}`;
      }
    }

    if (computed != null) {
      scope[s.id] = computed;
      unitMap[s.id] = s.unit;
    }

    results.push({
      id: s.id,
      expression: s.expression,
      computedValue: computed,
      claimedValue: s.claimedValue,
      passed,
      error,
      loadBearing: referrers[s.id].size > 0,
      unitWarnings: unitWarnings.length > 0 ? unitWarnings : undefined,
    });
  }

  const lastStep = results[results.length - 1];
  const finalValue = lastStep?.computedValue ?? null;
  let finalMatch: boolean | undefined;
  if (typeof opts.expectedFinal === "number" && Number.isFinite(opts.expectedFinal) && finalValue != null) {
    finalMatch = relClose(finalValue, opts.expectedFinal, tol);
  }

  const passedSteps = results.filter(r => r.passed).length;
  const allPassed = passedSteps === results.length && (finalMatch !== false);

  const failedDetail = results.filter(r => !r.passed).map(r => `${r.id}: ${r.error}`).join("; ");
  const decorativeStepIds = results.filter(r => !r.loadBearing && r !== lastStep).map(r => r.id);
  let summary: string;
  if (allPassed) {
    summary = `Chain verified — ${passedSteps}/${results.length} steps pass, final = ${finalValue}${finalMatch === true ? ` (matches expected ${opts.expectedFinal})` : ""}.`;
    if (decorativeStepIds.length > 0) {
      summary += ` ${decorativeStepIds.length} non-load-bearing step(s): ${decorativeStepIds.slice(0, 5).join(", ")}${decorativeStepIds.length > 5 ? "…" : ""}.`;
    }
  } else {
    summary = `Chain FAILED — ${passedSteps}/${results.length} steps pass. ${failedDetail || ""}`.trim();
    if (finalMatch === false) summary += ` Final ${finalValue} differs from expected ${opts.expectedFinal}.`;
  }

  return {
    passed: allPassed,
    totalSteps: results.length,
    passedSteps,
    results,
    finalValue,
    finalMatch,
    summary,
  };
}
