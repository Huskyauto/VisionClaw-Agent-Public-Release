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

function blocked(res: Awaited<ReturnType<typeof executeCode>>): boolean {
  return res.success === false && /restricted pattern/.test(String(res.error));
}

// --- still blocked (security must NOT regress) ----------------------------

test("blocks process.* access", async () => {
  assert.equal(blocked(await executeCode("__result__ = process.env.SECRET;")), true);
});

test("blocks eval(", async () => {
  assert.equal(blocked(await executeCode('eval("1+1");')), true);
});

test("blocks the Function constructor", async () => {
  assert.equal(blocked(await executeCode('Function("return 1")();')), true);
});

test("blocks require( and import(", async () => {
  assert.equal(blocked(await executeCode('require("fs");')), true);
  assert.equal(blocked(await executeCode('import("fs");')), true);
});

test("blocks prototype-chain escape vectors", async () => {
  assert.equal(blocked(await executeCode("({}).constructor;")), true);
  assert.equal(blocked(await executeCode("const x = {}; x.__proto__;")), true);
  assert.equal(blocked(await executeCode("globalThis;")), true);
});

test("blocks child_process and fs.", async () => {
  assert.equal(blocked(await executeCode('const m = "child_process";')), true);
  assert.equal(blocked(await executeCode("fs.readFileSync('x');")), true);
});

// --- no longer falsely blocked (the false-positive fix) -------------------

test("allows identifiers ending in 'Function'", async () => {
  const r = await executeCode("const getFunction = () => 7; __result__ = getFunction();");
  assert.equal(r.success, true);
  assert.equal(r.returnValue, 7);
});

test("allows identifiers ending in 'process'", async () => {
  const r = await executeCode("const preprocess = { run: () => 9 }; __result__ = preprocess.run();");
  assert.equal(r.success, true);
  assert.equal(r.returnValue, 9);
});

test("allows identifiers containing 'eval' (e.g. retrieval)", async () => {
  const r = await executeCode("const retrieval = (x) => x * 2; __result__ = retrieval(5);");
  assert.equal(r.success, true);
  assert.equal(r.returnValue, 10);
});

test("allows identifiers containing 'fs' (e.g. refs/prefs)", async () => {
  const r = await executeCode("const refs = { count: 3 }; __result__ = refs.count;");
  assert.equal(r.success, true);
  assert.equal(r.returnValue, 3);
});

// --- adversarial: tokens the blocklist intentionally MISSES must still ----
// --- fail safely via the vm context (defense-in-depth, not the regex) -----

test("unicode-escaped 'process' is not caught by the regex but is unreachable in the vm", async () => {
  // \\u0063 == 'c'; pro\u0063ess is the identifier `process`, which the
  // substring blocklist does NOT match — the vm context nulls it instead.
  const r = await executeCode("__result__ = (typeof pro\\u0063ess === 'undefined');");
  assert.equal(r.success, true);
  assert.equal(r.returnValue, true);
});

test("bracketed constructor escape is blocked by codeGeneration:false, not the regex", async () => {
  // ['constructor']['constructor']('return 1')() is the classic Function escape;
  // bracket access dodges /\\.constructor/, but strings codegen is disabled.
  const r = await executeCode("__result__ = ({})['constructor']['constructor']('return 1')();");
  assert.equal(r.success, false);
  assert.notEqual(r.returnValue, 1);
});

test("host serialization never executes a sandbox result getter", async () => {
  const result = await executeCode(`
    __result__ = {
      get value() {
        const started = Date.now();
        while (Date.now() - started < 1000) {}
        return 1;
      }
    };
  `);

  const started = Date.now();
  JSON.stringify(result);
  const hostSerializationMs = Date.now() - started;

  assert.ok(
    hostSerializationMs < 200,
    `host serialization ran sandbox code for ${hostSerializationMs}ms`,
  );
  assert.ok(
    result.returnValue === undefined
      || Object.getPrototypeOf(result.returnValue) === Object.prototype,
    "returnValue must be a plain host-realm value",
  );
});

test("an infinite result getter is stopped by the VM timeout", async () => {
  const started = Date.now();
  const result = await executeCode(`
    __result__ = {
      get value() {
        while (true) {}
      }
    };
  `);

  assert.equal(result.success, false);
  assert.match(result.error ?? "", /timed out/i);
  assert.ok(Date.now() - started < 8000);
});

test("plain sandbox results preserve their normal data shapes", async () => {
  assert.deepEqual(
    (await executeCode("__result__ = { a: 1, b: [2, 3] };")).returnValue,
    { a: 1, b: [2, 3] },
  );
  assert.equal((await executeCode("__result__ = 42;")).returnValue, 42);
  assert.equal((await executeCode('__result__ = "hello";')).returnValue, "hello");
  assert.equal((await executeCode("__result__ = null;")).returnValue, null);
  assert.equal((await executeCode("const untouched = true;")).returnValue, undefined);
});

test("structured results larger than the display-output cap keep their shape", async () => {
  const result = await executeCode('__result__ = { text: "x".repeat(12000) };');

  assert.equal(result.success, true);
  assert.equal(typeof result.returnValue, "object");
  assert.equal(result.returnValue.text.length, 12000);
  assert.match(result.output, /output truncated/);
});

test("cyclic object results fail explicitly instead of becoming plausible strings", async () => {
  const result = await executeCode(`
    const value = {};
    value.self = value;
    __result__ = value;
  `);

  assert.equal(result.success, false);
  assert.match(result.error ?? "", /serializ/i);
  assert.equal(result.returnValue, undefined);
});

test("a result getter cannot corrupt trusted reconstruction metadata", async () => {
  const result = await executeCode(`
    __result__ = {
      get value() {
        __resultType__ = "string";
        __resultStr__ = "attacker-controlled";
        return 1;
      }
    };
  `);

  assert.equal(result.success, true);
  assert.deepEqual(result.returnValue, { value: 1 });
});

test("result toJSON cannot erase trusted reconstruction metadata", async () => {
  const result = await executeCode(`
    __result__ = {
      toJSON() {
        __resultType__ = "undefined";
        __resultStr__ = "attacker-controlled";
        return { ok: 1 };
      }
    };
  `);

  assert.equal(result.success, true);
  assert.deepEqual(result.returnValue, { ok: 1 });
});
