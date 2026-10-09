import { test } from "node:test";
import assert from "node:assert/strict";
import { WorkspaceRequestLane, workspaceReadFailureBlocksControls, readWorkspaceJson } from "../../client/src/lib/browser-workspace-requests";

test("queued actions never borrow credentials after an account transition", async () => {
  let identity = 1;
  const lane = new WorkspaceRequestLane(() => identity);
  let finish!: () => void;
  const gate = new Promise<void>(resolve => { finish = resolve; });
  const first = lane.enqueue(async () => { await gate; return true; }, 1);
  await Promise.resolve();
  let effect = 0;
  const queued = lane.enqueue(async () => { effect++; }, 1);
  const outcomes = Promise.allSettled([first, queued]);
  identity = 2;
  finish();
  assert.deepEqual((await outcomes).map(x => x.status), ["rejected", "rejected"]);
  assert.equal(effect, 0);
  await lane.enqueue(async () => { effect++; }, 2);
  assert.equal(effect, 1);
});

test("unmount and cancelled reads invalidate work before dispatch", async () => {
  const lane = new WorkspaceRequestLane(() => 1);
  const pending = lane.enqueue(async () => assert.fail("must not dispatch"), 1);
  lane.dispose(); lane.activate();
  await assert.rejects(pending, /expired/);
  const abort = new AbortController(); abort.abort();
  await assert.rejects(lane.enqueue(async () => assert.fail("cancelled"), 1, abort.signal), /expired/);
});

test("failed refresh retains handback for an account-bound confirmed state, never an unknown mode", () => {
  assert.equal(workspaceReadFailureBlocksControls(true, true), false);
  assert.equal(workspaceReadFailureBlocksControls(true, false), true);
  assert.equal(workspaceReadFailureBlocksControls(false, true), false);
});

test("read-only busy conflicts wait briefly and return the new authoritative response", async () => {
  let calls = 0;
  const delays: number[] = [];
  const result = await readWorkspaceJson(async () => ++calls < 3
    ? Response.json({ code: "browser_busy", error: "busy" }, { status: 409 })
    : Response.json({ state: { mode: "human" } }), () => true, undefined,
    async ms => { delays.push(ms); });
  assert.deepEqual(result, { state: { mode: "human" } });
  assert.equal(calls, 3);
  assert.deepEqual(delays, [250, 500]);
});

test("busy read retry is bounded and never applies to auth, throttling, remote failure or unmarked conflicts", async () => {
  let calls = 0;
  await assert.rejects(readWorkspaceJson(async () => {
    calls++; return Response.json({ code: "browser_busy", error: "busy" }, { status: 409 });
  }, () => true, undefined, async () => {}), /busy/);
  assert.equal(calls, 6);
  for (const status of [401, 403, 429, 502, 409]) {
    calls = 0;
    await assert.rejects(readWorkspaceJson(async () => {
      calls++; return Response.json({ code: status === 409 ? "other" : "browser_busy", error: "stop" }, { status });
    }, () => true, undefined, async () => assert.fail("must not wait")), /stop/);
    assert.equal(calls, 1);
  }
});

test("account transition or cancellation during busy wait prevents any further authenticated read", async () => {
  for (const cancel of [false, true]) {
    let identity = 1, calls = 0;
    const controller = new AbortController();
    await assert.rejects(readWorkspaceJson(async () => {
      calls++; return Response.json({ code: "browser_busy" }, { status: 409 });
    }, () => identity === 1, controller.signal, async () => {
      if (cancel) controller.abort(); else identity = 2;
    }), /expired/);
    assert.equal(calls, 1);
  }
});

test("a real pending busy-read timer stops promptly on cancellation", async () => {
  const controller = new AbortController();
  let calls = 0;
  const request = readWorkspaceJson(async () => {
    calls++; return Response.json({ code: "browser_busy" }, { status: 409 });
  }, () => true, controller.signal);
  setTimeout(() => controller.abort(), 5);
  await assert.rejects(request, /expired/);
  assert.equal(calls, 1);
});