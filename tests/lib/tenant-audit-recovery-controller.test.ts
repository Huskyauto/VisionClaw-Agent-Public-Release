import test from "node:test";
import assert from "node:assert/strict";
import { runAuditSlices } from "../../scripts/run-tenant-isolation-audit-resumable";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { transformSync } from "esbuild";

test("the real child-process deadline uses the remaining total budget", async () => {
  const source = readFileSync("scripts/run-tenant-isolation-audit-resumable.ts", "utf8");
  const start = source.indexOf("function runSlice(");
  const end = source.indexOf("\nexport async function runAuditSlices", start);
  assert.ok(start >= 0 && end > start);
  const listeners: Record<string, (...args: any[]) => void> = {};
  let timerMs = 0, fire: () => void = () => {};
  const kills: number[] = [];
  const module = { exports: {} as any };
  vm.runInNewContext(transformSync(
    source.slice(start, end) + "\nmodule.exports.runSlice = runSlice;",
    { loader: "ts", format: "cjs" },
  ).code, {
    module, exports: module.exports, sliceChunks: 8,
    process: { env: {}, kill: (pid: number) => { kills.push(pid); } },
    spawn: () => ({ pid: 123, once: (name: string, fn: (...args: any[]) => void) => { listeners[name] = fn; } }),
    setTimeout: (fn: () => void, ms: number) => {
      timerMs = ms; fire = fn; return { unref() {} };
    },
    clearTimeout() {},
    console: { error() {} },
  });
  const result = module.exports.runSlice(17_000);
  assert.equal(timerMs, 17_000);
  fire();
  assert.deepEqual(kills, [-123]);
  listeners.close(null);
  assert.equal(await result, 9);
});

test("provider outage is deferred immediately with checkpoint retained and lane released", async () => {
  const calls: string[] = [];
  const result = await runAuditSlices({
    limit: 4,
    acquire: async () => { calls.push("acquire"); return async () => { calls.push("release"); }; },
    slice: async () => { calls.push("outage"); return 8; },
  });
  assert.equal(result, 8);
  assert.deepEqual(calls, ["acquire", "outage", "release"]);
});

test("CLI watchdog bounds hung admission or cleanup and kills an active detached child", () => {
  const source = readFileSync("scripts/run-tenant-isolation-audit-resumable.ts", "utf8");
  const start = source.indexOf("function installControllerDeadline(");
  const end = source.indexOf("\nfunction boundedInt(", start);
  assert.ok(start >= 0 && end > start);
  let fire: () => void = () => {}, timerMs = 0, exitCode = 0;
  const kills: number[] = [];
  const module = { exports: {} as any };
  vm.runInNewContext(transformSync(
    source.slice(start, end) + "\nmodule.exports.installControllerDeadline = installControllerDeadline;",
    { loader: "ts", format: "cjs" },
  ).code, {
    module, exports: module.exports, TOTAL_RUN_BUDGET_MS: 600_000, activeChildPid: 123,
    process: { kill: (pid: number) => { kills.push(pid); }, exit: (code: number) => { exitCode = code; } },
    setTimeout: (fn: () => void, ms: number) => { fire = fn; timerMs = ms; return 1; },
    console: { error() {} },
  });
  module.exports.installControllerDeadline();
  assert.equal(timerMs, 600_000);
  fire();
  assert.deepEqual(kills, [-123]);
  assert.equal(exitCode, 9);
});

test("total run budget stops further slices and releases admission without becoming green", async () => {
  let clock = 0, dispatches = 0, releases = 0;
  const result = await runAuditSlices({
    limit: 3,
    budgetMs: 10_000,
    now: () => clock,
    acquire: async () => async () => { releases++; },
    slice: async () => { dispatches++; clock = 10_000; return 7; },
  });
  assert.equal(result, 7);
  assert.equal(dispatches, 1);
  assert.equal(releases, 1);
});
