import assert from "node:assert/strict";
import test from "node:test";
import { classifyResumeClaim } from "../../server/lib/resume-claim-recovery";

test("a claim owned by another live worker is not mistaken for a restart orphan", () => {
  assert.equal(classifyResumeClaim({
    status: "running", hasContinuation: false,
    leaseUntil: new Date(11000).toISOString(), claimedAt: new Date(1000).toISOString(),
  }, 10000), "wait");
});

test("expired or legacy claims are review evidence, not proof of interruption", () => {
  assert.equal(classifyResumeClaim({
    status: "running", hasContinuation: false, claimedAt: new Date(0).toISOString(),
  }, 700000), "review");
  assert.equal(classifyResumeClaim({
    status: "running", hasContinuation: false,
    leaseUntil: new Date(0).toISOString(),
  }, 1000), "review");
});

test("completed/failed/paused runs are never revived; local continuations stay live", () => {
  for (const status of ["completed", "failed", "paused"]) {
    assert.equal(classifyResumeClaim({ status, hasContinuation: false }, 1000), "skip");
  }
  assert.equal(classifyResumeClaim({ status: "running", hasContinuation: true }, 1000), "live");
});
