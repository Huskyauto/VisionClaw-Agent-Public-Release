import { test } from "node:test";
import assert from "node:assert/strict";
import { executeCode } from "../../server/code-sandbox";

// Regression guard for the host-realm sandbox escape (Fable 5 finding A0,
// empirically reproduced 2026-07-01). Before the fix, host intrinsics injected
// into the vm context bridged to the HOST realm's Function constructor, so
// `Date["constr"+"uctor"]("return process")()` returned the real Node `process`.
// Two independent layers must hold: (1) the regex blocklist (defense-in-depth),
// and (2) the vm layer — context-native intrinsics + codeGeneration:strings:false
// — which must hold EVEN when the regex is bypassed.

// --- Layer 2 proof: keyword-free probes bypass the regex and must still fail closed.
// A successful escape compiles a function from a string => codeGen was NOT blocked.
const keywordFreeEscapeProbes: Array<[string, string]> = [
  ["host Date intrinsic bridge", `__result__ = typeof Date["co"+"nstructor"]("return 1");`],
  ["host Number intrinsic bridge", `__result__ = typeof Number["co"+"nstructor"]("return 1");`],
  ["host Math method bridge", `__result__ = typeof Math["va"+"lueOf"]["co"+"nstructor"]("return 1");`],
  ["context-native array literal", `__result__ = typeof ([])["co"+"nstructor"]["co"+"nstructor"]("return 1");`],
];

for (const [name, code] of keywordFreeEscapeProbes) {
  test(`vm layer blocks codegen (regex-bypassing): ${name}`, () => {
    const r = executeCode(code);
    // Must NOT have compiled a function from a string.
    assert.notEqual(r.returnValue, "function", `escape: ${name} compiled a function from a string`);
    assert.equal(r.success, false, `escape: ${name} should fail closed`);
  });
}

// --- Layer 1 + full-stack: classic escape payloads must never leak host `process`.
const escapePayloads: Array<[string, string]> = [
  ["eval literal", `__result__ = eval("1+1");`],
  ["this.constructor walk", `__result__ = this.constructor.constructor("return process")();`],
  ["Date.constructor dotted", `__result__ = Date.constructor("return process")();`],
  ["Date computed concat 1x", `__result__ = Date["constr"+"uctor"]("return process")();`],
  ["Date computed concat 2x env", `__result__ = Date["constr"+"uctor"]["constr"+"uctor"]("return process.env")();`],
  ["console.log computed constructor", `__result__ = console.log["constr"+"uctor"]("return process")();`],
];

for (const [name, code] of escapePayloads) {
  test(`no host process leak: ${name}`, () => {
    const r = executeCode(code);
    const leakedProcess = r.success && r.returnValue && typeof r.returnValue === "object"
      && typeof (r.returnValue as any).version === "string";
    assert.equal(leakedProcess, false, `escape: ${name} leaked host process`);
  });
}

// --- Benign code must still work (no over-blocking of legitimate computation).
const benign: Array<[string, string, string]> = [
  ["arithmetic", `__result__ = 2 + 2;`, "4"],
  ["Math", `__result__ = Math.max(1, 9, 3);`, "9"],
  ["Date.now is number", `__result__ = typeof Date.now();`, "number"],
  ["JSON roundtrip", `__result__ = JSON.parse(JSON.stringify({ a: 1 })).a;`, "1"],
  ["btoa/atob roundtrip", `__result__ = atob(btoa("Hello, World!"));`, "Hello, World!"],
  ["array map", `__result__ = [1, 2, 3].map((x) => x * 2).join(",");`, "2,4,6"],
];

for (const [name, code, expected] of benign) {
  test(`benign still works: ${name}`, () => {
    const r = executeCode(code);
    const got = r.returnValue !== undefined ? String(r.returnValue) : r.output;
    assert.equal(r.success, true, `benign ${name} should succeed (err: ${r.error})`);
    assert.equal(got, expected);
  });
}

// --- console capture still works.
test("console.log output is captured", () => {
  const r = executeCode(`console.log("captured", 42);`);
  assert.equal(r.success, true);
  assert.match(r.output, /captured 42/);
});

// --- DoS regression: the host reads back results ONLY as typeof-guarded string
// data-properties on the global; the log buffer is private and never exposed to
// user code. So poisoning context globals / installing accessor traps cannot
// hang executeCode outside the 5s script timeout (architect findings 2026-07-01:
// (1) unbounded post-run vm.runInContext("JSON.stringify(...)"); (2) accessor
// getter on a __logs__ array index fired during host-side raw[i] read).
//
// These probes must return WELL under the 5s timeout because the poisoned thing
// is never touched by the host read-back path.
const promptProbes: Array<[string, string]> = [
  ["monkey-patch JSON.stringify to infinite loop", `JSON.stringify = () => { while (true) {} }; __result__ = 1;`],
  ["monkey-patch String to infinite loop", `String = () => { while (true) {} }; __result__ = 2;`],
  ["poison Array.isArray", `Array.isArray = () => { while (true) {} }; __result__ = 3;`],
  ["accessor trap on a local object (host never reads it)", `const o = []; Object.defineProperty(o, "0", { get() { while (true) {} } }); __result__ = 4;`],
  ["console a hostile-toString object (private buffer, pristine fmt)", `console.log({ toString() { while (true) {} } }); __result__ = 5;`],
];

for (const [name, code] of promptProbes) {
  test(`no host hang — read-back untouched by poison: ${name}`, () => {
    const t0 = Date.now();
    const r = executeCode(code);
    const elapsed = Date.now() - t0;
    assert.ok(elapsed < 4000, `read-back hung: ${name} took ${elapsed}ms`);
    assert.equal(r.success, true, `${name} should complete (err: ${r.error})`);
  });
}

// The architect's exact repro: __logs__ is no longer a global handle, so this
// TypeErrors inside the (bounded) script and returns promptly rather than hanging
// the host on a getter during read-back.
test("no host hang — architect repro (defineProperty on __logs__ index)", () => {
  const t0 = Date.now();
  const r = executeCode(`console.log("x"); Object.defineProperty(__logs__, "0", { get() { while (true) {} } }); __result__ = 1;`);
  const elapsed = Date.now() - t0;
  assert.ok(elapsed < 4000, `hung: took ${elapsed}ms`);
});

// Hostile toJSON on the RESULT is serialized inside the script — bounded by the
// 5s timeout (returns a timeout error), never an unbounded host hang.
test("hostile result toJSON is BOUNDED by script timeout (not unbounded)", () => {
  const t0 = Date.now();
  const r = executeCode(`__result__ = { toJSON() { while (true) {} } };`);
  const elapsed = Date.now() - t0;
  assert.ok(elapsed < 7000, `not bounded by timeout: took ${elapsed}ms`);
  assert.equal(r.success, false);
});

// The read-back string properties + helpers are non-configurable, so user code
// cannot redefine them as accessors to trap the host read. These attempts throw
// inside the (bounded) script; the host read-back is unaffected and prompt.
const subvertProbes = ["__logsStr__", "__resultStr__", "__collectLogs__", "__toResultStr__"];
for (const prop of subvertProbes) {
  test(`cannot redefine ${prop} as an accessor (non-configurable)`, () => {
    const t0 = Date.now();
    const r = executeCode(
      `try { Object.defineProperty(this === undefined ? ({}) : this, "${prop}", { get() { while (true) {} } }); } catch (e) {} console.log("ok"); __result__ = 1;`,
    );
    const elapsed = Date.now() - t0;
    assert.ok(elapsed < 4000, `hung redefining ${prop}: ${elapsed}ms`);
    assert.equal(r.success, true);
    assert.match(r.output, /ok/);
  });
}
