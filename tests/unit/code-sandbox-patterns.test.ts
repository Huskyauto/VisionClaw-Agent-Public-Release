/**
 * tests/unit/code-sandbox-patterns.test.ts — Bob 2026-06-03
 *
 * The execute_code sandbox blocklist used substring matching, which falsely
 * blocked legitimate agent code (getFunction(), preprocess.x, retrieval()).
 * Patterns were tightened to word-boundary matching: this must (a) still block
 * the real escape/Node-global vectors and (b) stop falsely blocking benign
 * identifiers that merely CONTAIN a banned word. The vm context also nulls out
 * process/require/etc, so the blocklist is defense-in-depth — these tests guard
 * against a future revert to sloppy substring matching.
 *
 * Run: node --import tsx --test tests/unit/code-sandbox-patterns.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import { executeCode } from "../../server/code-sandbox";

function blocked(res: ReturnType<typeof executeCode>): boolean {
  return res.success === false && /restricted pattern/.test(String(res.error));
}

// --- still blocked (security must NOT regress) ----------------------------

test("blocks process.* access", () => {
  assert.equal(blocked(executeCode("__result__ = process.env.SECRET;")), true);
});

test("blocks eval(", () => {
  assert.equal(blocked(executeCode('eval("1+1");')), true);
});

test("blocks the Function constructor", () => {
  assert.equal(blocked(executeCode('Function("return 1")();')), true);
});

test("blocks require( and import(", () => {
  assert.equal(blocked(executeCode('require("fs");')), true);
  assert.equal(blocked(executeCode('import("fs");')), true);
});

test("blocks prototype-chain escape vectors", () => {
  assert.equal(blocked(executeCode("({}).constructor;")), true);
  assert.equal(blocked(executeCode("const x = {}; x.__proto__;")), true);
  assert.equal(blocked(executeCode("globalThis;")), true);
});

test("blocks child_process and fs.", () => {
  assert.equal(blocked(executeCode('const m = "child_process";')), true);
  assert.equal(blocked(executeCode("fs.readFileSync('x');")), true);
});

// --- no longer falsely blocked (the false-positive fix) -------------------

test("allows identifiers ending in 'Function'", () => {
  const r = executeCode("const getFunction = () => 7; __result__ = getFunction();");
  assert.equal(r.success, true);
  assert.equal(r.returnValue, 7);
});

test("allows identifiers ending in 'process'", () => {
  const r = executeCode("const preprocess = { run: () => 9 }; __result__ = preprocess.run();");
  assert.equal(r.success, true);
  assert.equal(r.returnValue, 9);
});

test("allows identifiers containing 'eval' (e.g. retrieval)", () => {
  const r = executeCode("const retrieval = (x) => x * 2; __result__ = retrieval(5);");
  assert.equal(r.success, true);
  assert.equal(r.returnValue, 10);
});

test("allows identifiers containing 'fs' (e.g. refs/prefs)", () => {
  const r = executeCode("const refs = { count: 3 }; __result__ = refs.count;");
  assert.equal(r.success, true);
  assert.equal(r.returnValue, 3);
});

// --- adversarial: tokens the blocklist intentionally MISSES must still ----
// --- fail safely via the vm context (defense-in-depth, not the regex) -----

test("unicode-escaped 'process' is not caught by the regex but is unreachable in the vm", () => {
  // \\u0063 == 'c'; pro\u0063ess is the identifier `process`, which the
  // substring blocklist does NOT match — the vm context nulls it instead.
  const r = executeCode("__result__ = (typeof pro\\u0063ess === 'undefined');");
  assert.equal(r.success, true);
  assert.equal(r.returnValue, true);
});

test("bracketed constructor escape is blocked by codeGeneration:false, not the regex", () => {
  // ['constructor']['constructor']('return 1')() is the classic Function escape;
  // bracket access dodges /\\.constructor/, but strings codegen is disabled.
  const r = executeCode("__result__ = ({})['constructor']['constructor']('return 1')();");
  assert.equal(r.success, false);
  assert.notEqual(r.returnValue, 1);
});
