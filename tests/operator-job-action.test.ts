import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { submitOperatorJobAction } from "../client/src/lib/operator-job-action";

test("operator action rejects an unconfirmed success response", async () => {
  await assert.rejects(
    submitOperatorJobAction(12, "retry", async () => ({ success: false })),
    /not confirmed/,
  );
});

test("confirmed retry posts once with the exact job identity", async () => {
  const calls: string[][] = [];
  await submitOperatorJobAction(12, "retry", async (method, url) => {
    calls.push([method, url]);
    return { json: async () => ({ success: true, id: 12 }) };
  });
  assert.deepEqual(calls, [["POST", "/api/admin/agent-jobs/12/retry"]]);
  await assert.rejects(submitOperatorJobAction(12, "cancel", async () => ({ success: true, id: 13 })), /not confirmed/);
});

test("duplicate and conflicting job actions are suppressed until completion", async () => {
  let release!: (value: unknown) => void;
  let calls = 0;
  const first = submitOperatorJobAction(12, "cancel", async () => {
    calls++;
    return new Promise(resolve => { release = resolve; });
  });
  await assert.rejects(submitOperatorJobAction(12, "retry", async () => { calls++; }), /already in progress/);
  release({ success: true, id: 12 });
  await first;
  assert.equal(calls, 1);
  await submitOperatorJobAction(12, "retry", async () => ({ success: true, id: 12 }));
});

test("failed requests release the lock and invalid IDs never dispatch", async () => {
  await assert.rejects(submitOperatorJobAction(12, "retry", async () => { throw new Error("offline"); }), /offline/);
  await submitOperatorJobAction(12, "retry", async () => ({ success: true, id: 12 }));
  for (const id of [0, -1, 1.5, NaN, Infinity]) {
    await assert.rejects(submitOperatorJobAction(id, "cancel", async () => { assert.fail("must not dispatch"); }), /valid job/);
  }
});

test("a cancel acknowledgment is not described as proof of a cancelled job", () => {
  const ui = readFileSync("client/src/pages/operator.tsx", "utf8");
  assert.match(ui, /Cancellation request acknowledged/);
  assert.match(ui, /Check the refreshed job status to confirm it changed/);
  assert.doesNotMatch(ui, /title: "Job cancelled"|title: "Cancellation recorded"/);
});
