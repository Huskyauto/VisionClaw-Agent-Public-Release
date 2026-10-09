import { test } from "node:test";
import assert from "node:assert/strict";
import { approvePlanFromFelix } from "../client/src/lib/plan-decision";

test("one-tap Felix approval posts a durable decision without a browser prompt", async () => {
  const calls: Array<{ method: string; url: string; body: unknown }> = [];
  const result = await approvePlanFromFelix(6287, async (method, url, body) => {
    calls.push({ method, url, body });
    return { ok: true, status: "approved" };
  });

  assert.deepEqual(calls, [{
    method: "POST",
    url: "/api/plans/6287/decide",
    body: {
      decision: "approve",
      reason: "Approved by Felix from Plans Awaiting Felix.",
    },
  }]);
  assert.deepEqual(result, { ok: true, status: "approved" });
});

test("duplicate taps share the server's single in-flight approval boundary", async () => {
  let release!: (value: any) => void;
  const pending = new Promise<any>((resolve) => { release = resolve; });
  let calls = 0;
  const request = async () => {
    calls += 1;
    return pending;
  };

  const first = approvePlanFromFelix(6287, request);
  await assert.rejects(
    approvePlanFromFelix(6287, request),
    /already in progress/,
  );
  assert.equal(calls, 1);
  release({ ok: true, status: "executing" });
  assert.deepEqual(await first, { ok: true, status: "executing" });
});

test("an unconfirmed server response does not count as approval", async () => {
  await assert.rejects(
    approvePlanFromFelix(6287, async () => ({ ok: true, status: "awaiting_approval" })),
    /not confirmed by the server/,
  );
  await assert.rejects(
    approvePlanFromFelix(6287, async () => ({ ok: true, status: "failed" })),
    /not confirmed by the server/,
  );
});