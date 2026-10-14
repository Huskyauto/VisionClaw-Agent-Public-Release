import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { transformSync } from "esbuild";

function watchdogFixture() {
  const events: any[] = [];
  const tracker = new Map<number, any>();
  const { code } = transformSync(fs.readFileSync("server/process-watchdog.ts", "utf8"), {
    loader: "ts", format: "cjs", supported: { "dynamic-import": false },
  });
  const module = { exports: {} as any };
  vm.runInNewContext(code, {
    module, exports: module.exports, AbortController,
    console: { log() {}, warn() {}, error() {} },
    require(name: string) {
      if (name === "./lib/silent-catch") return { logSilentCatch() {} };
      if (name === "./event-bus") return {
        async emitEvent(event: any) { events.push(JSON.parse(JSON.stringify(event))); },
      };
      if (name === "./heartbeat") return { activeTaskTracker: tracker };
      throw new Error(`Unexpected test dependency: ${name}`);
    },
  });
  return { watchdog: module.exports, events, tracker };
}

test("watchdog cancellation alert stays with the registered customer's tenant", async () => {
  const { watchdog, events } = watchdogFixture();
  const signal = watchdog.register({
    runId: "fixture-run", kind: "heartbeat-task", label: "Private customer task",
    tenantId: 3, hardCapMs: 1000,
  });
  assert.equal(await watchdog.forceCancel("fixture-run", "fixture timeout"), true);
  assert.equal(signal.aborted, true, "tenant-safe alerts must not disable cancellation");
  assert.equal(events.length, 1);
  assert.equal(events[0].tenantId, 3);
});

test("orphan task alerts use the tenant already held by the heartbeat tracker", async () => {
  const { watchdog, events, tracker } = watchdogFixture();
  tracker.set(12, {
    startedAt: 1, tenantId: 4,
    taskName: "Private customer task", personaName: "Fixture agent",
  });
  await watchdog.forceScanForTest();
  assert.equal(events.length, 1);
  assert.equal(events[0].tenantId, 4);
});

test("an unscoped cancellation still aborts locally but cannot publish an owner-tenant event", async () => {
  const { watchdog, events } = watchdogFixture();
  const signal = watchdog.register({
    runId: "unscoped-run", kind: "other", label: "Private label",
    hardCapMs: 1000,
  });
  assert.equal(await watchdog.forceCancel("unscoped-run", "fixture timeout"), true);
  assert.equal(signal.aborted, true);
  assert.equal(events.length, 0);
});

test("orphan trackers without a valid tenant cannot publish through an admin fallback", async () => {
  const { watchdog, events, tracker } = watchdogFixture();
  tracker.set(13, { startedAt: 1, taskName: "Private label" });
  await watchdog.forceScanForTest();
  assert.equal(events.length, 0);
});
