import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

// Isolate the actual pre-dispatch block without importing provider/DB clients.
// A synthetic require failure exercises the policy-import plumbing catch.
function gate(policyLoader: () => unknown) {
  const source = fs.readFileSync("server/tools.ts", "utf8");
  const start = source.indexOf("  let _tnrActionId: string | undefined;");
  const end = source.indexOf("  const _ledgerStart = Date.now();", start);
  assert.ok(start >= 0 && end > start, "locate the production snapshot gate");
  const compiled = ts.transpileModule(
    `async function run(name, params) { ${source.slice(start, end)} return { continued: true }; }; module.exports = run;`,
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } },
  ).outputText;
  const module = { exports: undefined as any };
  vm.runInNewContext(compiled, {
    module, exports: module.exports, console: { error() {}, warn() {} },
    errorMessage: (error: Error) => error.message,
    require: (name: string) => {
      assert.equal(name, "./safety/destructive-tool-policy");
      return policyLoader();
    },
  });
  return module.exports;
}

test("unavailable snapshot policy refuses dispatch instead of silently falling through", async () => {
  const run = gate(() => { throw new Error("synthetic policy import failure"); });
  const result = await run("synthetic_irreversible_tool", { _tenantId: 123 });
  assert.equal(result.continued, undefined);
  assert.match(result.error, /TNR/);
});

test("an affirmatively non-irreversible policy still permits ordinary dispatch", async () => {
  const run = gate(() => ({ TOOL_POLICIES: { synthetic_read: { risk: "safe" } } }));
  assert.equal((await run("synthetic_read", { _tenantId: 123 })).continued, true);
});
