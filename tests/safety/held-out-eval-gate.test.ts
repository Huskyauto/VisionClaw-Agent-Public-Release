/**
 * tests/safety/held-out-eval-gate.test.ts — R125+13.24
 *
 * The held-out eval gate is itself a verifier — so it gets held-out tests:
 * proves it BLOCKS the canonical verifier-gaming diffs (delete the test,
 * .skip the test, strip a sanitizer) and PASSES genuine fixes.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { heldOutEvalGate } from "../../server/safety/held-out-eval-gate";

const prevMode = process.env.HELD_OUT_EVAL_GATE;
// Set enforce mode in a before-hook (runs at test EXECUTION time, not module
// load) so every test below deterministically asserts under enforce — not the
// ambient env. Restored in the after-hook.
before(() => { process.env.HELD_OUT_EVAL_GATE = "enforce"; });
after(() => {
  // Truly restore absence when the var was originally unset — assigning
  // `undefined` would leave a literal 'undefined' string in the env.
  if (prevMode === undefined) delete process.env.HELD_OUT_EVAL_GATE;
  else process.env.HELD_OUT_EVAL_GATE = prevMode;
});

test("BLOCKS deleting a test case to make the suite pass", () => {
  const r = heldOutEvalGate({
    targetFile: "tests/foo.test.ts",
    oldCode: `it("a", () => { expect(x).toBe(1); });\nit("b", () => { expect(y).toBe(2); });`,
    newCode: `it("a", () => { expect(x).toBe(1); });`,
  });
  assert.equal(r.passed, false);
  assert.equal(r.severity, "block");
  assert.ok(r.violations.some(v => v.includes("test-block-erosion") || v.includes("assertion-erosion")));
});

test("BLOCKS skipping a failing test instead of fixing it", () => {
  const r = heldOutEvalGate({
    targetFile: "tests/foo.test.ts",
    oldCode: `it("flaky", () => { expect(x).toBe(1); });`,
    newCode: `it.skip("flaky", () => { expect(x).toBe(1); });`,
  });
  assert.equal(r.passed, false);
  assert.ok(r.violations.some(v => v.includes("test-skip-or-only-introduced")));
});

test("BLOCKS removing a sanitizer call in server code", () => {
  const r = heldOutEvalGate({
    targetFile: "server/research-engine.ts",
    oldCode: `const safe = sanitizeUntrusted(raw, { maxBytes: 300 });\nuse(safe);`,
    newCode: `use(raw);`,
  });
  assert.equal(r.passed, false);
  assert.ok(r.violations.some(v => v.includes("sanitizer-removal")));
});

test("PASSES a genuine fix that adds code", () => {
  const r = heldOutEvalGate({
    targetFile: "server/foo.ts",
    oldCode: `function add(a: number, b: number) { return a - b; }`,
    newCode: `function add(a: number, b: number) { if (!Number.isFinite(a)) throw new Error("bad"); return a + b; }`,
  });
  assert.equal(r.passed, true);
  assert.equal(r.severity, "ok");
});

test("PASSES a genuine fix that adds assertions to a test file", () => {
  const r = heldOutEvalGate({
    targetFile: "tests/foo.test.ts",
    oldCode: `it("a", () => { expect(x).toBe(1); });`,
    newCode: `it("a", () => { expect(x).toBe(1); expect(x).toBeDefined(); });`,
  });
  assert.equal(r.passed, true);
});

test("BLOCK-severity (tenant ref drop) fails the gate — auto-apply fails closed on tenant erosion", () => {
  const r = heldOutEvalGate({
    targetFile: "server/foo.ts",
    oldCode: `db.query({ tenantId, id });`,
    newCode: `db.query({ id });`,
  });
  // tenant-filter-erosion is block-severity: the autonomous auto-apply path
  // must fail closed when tenant references net-out (highest-risk surface).
  assert.equal(r.passed, false);
  assert.equal(r.severity, "block");
  assert.ok(r.violations.some(v => v.includes("tenant-filter-erosion")));
});

test("WARN-severity (throw-guard drop) records but does not fail the gate", () => {
  const r = heldOutEvalGate({
    targetFile: "server/foo.ts",
    oldCode: `function f() { if (!ok) throw new Error("bad"); return 1; }`,
    newCode: `function f() { return 1; }`,
  });
  // throw-guard-erosion is warn-severity → recorded but not blocking
  assert.equal(r.passed, true);
  assert.equal(r.severity, "warn");
  assert.ok(r.violations.some(v => v.includes("throw-guard-erosion")));
});

test("anti-bypass: comment-padding cannot mask a real assertion removal", () => {
  const r = heldOutEvalGate({
    targetFile: "tests/foo.test.ts",
    oldCode: `it("a", () => { expect(x).toBe(1); expect(y).toBe(2); });`,
    // removes a real expect() but pads the count with a comment + string
    newCode: `it("a", () => { /* expect(y).toBe(2) */ const s = "expect(z).toBe(3)"; expect(x).toBe(1); });`,
  });
  assert.equal(r.passed, false);
  assert.ok(r.violations.some(v => v.includes("assertion-erosion")));
});

test("legit refactor: net-neutral assertion count passes", () => {
  const r = heldOutEvalGate({
    targetFile: "tests/foo.test.ts",
    oldCode: `it("a", () => { expect(x).toBe(1); });`,
    newCode: `it("a", () => { const v = compute(); expect(v).toBe(1); });`,
  });
  assert.equal(r.passed, true);
  assert.equal(r.severity, "ok");
});

test("test.todo scaffolding is not treated as gaming", () => {
  const r = heldOutEvalGate({
    targetFile: "tests/foo.test.ts",
    oldCode: `it("a", () => { expect(x).toBe(1); });`,
    newCode: `it("a", () => { expect(x).toBe(1); });\ntest.todo("handle empty input");`,
  });
  assert.equal(r.passed, true);
});

// Pins KNOWN limits of the heuristic stripper (documented, accepted for a
// fail-OPEN gate — see stripCommentsAndStrings doc). If a future parser upgrade
// changes these, update intentionally.
test("known limit: assertions inside template interpolation are not counted", () => {
  const r = heldOutEvalGate({
    targetFile: "tests/foo.test.ts",
    oldCode: "it('a', () => { const m = `${expect(x).toBe(1)}`; expect(y).toBe(2); });",
    newCode: "it('a', () => { const m = ``; expect(y).toBe(2); });",
  });
  // The interpolated expect() is stripped with the template, so counts are equal → passes.
  assert.equal(r.passed, true);
});

test("known limit: regex literal containing // does not crash the gate", () => {
  const r = heldOutEvalGate({
    targetFile: "tests/foo.test.ts",
    oldCode: `it('a', () => { const re = /a\\/\\/b/; expect(x).toBe(1); });`,
    newCode: `it('a', () => { const re = /a\\/\\/b/; expect(x).toBe(1); expect(y).toBe(2); });`,
  });
  assert.equal(r.passed, true);
});

test("off mode disables all checks", () => {
  process.env.HELD_OUT_EVAL_GATE = "off";
  const r = heldOutEvalGate({
    targetFile: "tests/foo.test.ts",
    oldCode: `it("a", () => {}); it("b", () => {});`,
    newCode: `it("a", () => {});`,
  });
  assert.equal(r.passed, true);
  assert.equal(r.severity, "ok");
  process.env.HELD_OUT_EVAL_GATE = "enforce";
});

test("warn mode records but never fails, even on block-severity", () => {
  process.env.HELD_OUT_EVAL_GATE = "warn";
  const r = heldOutEvalGate({
    targetFile: "tests/foo.test.ts",
    oldCode: `it("a", () => {}); it("b", () => {});`,
    newCode: `it("a", () => {});`,
  });
  assert.equal(r.passed, true);
  assert.equal(r.severity, "block");
  assert.ok(r.violations.length > 0);
  process.env.HELD_OUT_EVAL_GATE = "enforce";
});
