import test from "node:test";
import assert from "node:assert/strict";
import { runAuditSlices } from "../../scripts/run-tenant-isolation-audit-resumable";

test("workspace recovery releases admission, backs off, reacquires and resumes until completion", async () => {
  const calls: string[] = [], outcomes = [8, 8, 7, 0];
  const result = await runAuditSlices({
    limit: 4,
    acquire: async () => { calls.push("acquire"); return async () => { calls.push("release"); }; },
    recover: async n => { calls.push(`backoff:${n}`); },
    slice: async () => outcomes.shift()!,
  });
  assert.equal(result, 0);
  assert.deepEqual(calls, ["acquire", "release", "backoff:1", "acquire", "release", "backoff:2", "acquire", "release"]);
});

test("total recovery budget is finite and never reports all-provider outage as green", async () => {
  let dispatches = 0, sleeps = 0;
  const result = await runAuditSlices({
    limit: 3, acquire: async () => async () => {},
    slice: async () => { dispatches++; return 8; },
    recover: async () => { sleeps++; },
  });
  assert.equal(result, 8);
  assert.equal(dispatches, 3);
  assert.equal(sleeps, 2);
});
