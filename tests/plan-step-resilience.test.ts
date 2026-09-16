import test from "node:test";
import assert from "node:assert/strict";
import {
  isTransientPlanStepFailure,
  runPlanStepTaskWithRetry,
  shouldRecoverTransientPlan,
  shouldRecoverStalePlan,
} from "../server/lib/plan-step-resilience";

test("safety-policy aborts and explicit refusals are never retried", () => {
  assert.equal(isTransientPlanStepFailure({
    success: false,
    error: "Request aborted by content safety policy",
  }), false);
  assert.equal(isTransientPlanStepFailure({
    success: false,
    error: "Request was aborted.",
    refused: true,
  }), false);
  assert.equal(isTransientPlanStepFailure({
    success: false,
    error: "LLM task deadline exceeded during preflight",
  }), true);
});

test("a transiently aborted plan step retries once with a longer deadline", async () => {
  const calls: number[] = [];

  const outcome = await runPlanStepTaskWithRetry(async (timeoutMs) => {
    calls.push(timeoutMs);
    return calls.length === 1
      ? { success: false, error: "Request was aborted." }
      : { success: true, json: { success: true, summary: "finished" } };
  });

  assert.deepEqual(calls, [60_000, 180_000]);
  assert.equal(outcome.attempts, 2);
  assert.equal(outcome.result.success, true);
});

test("restart recovery accepts one recent timeout failure only when replay has no structured tool side effects", () => {
  const base = {
    status: "failed",
    ceoDecision: "approved",
    ceoDecidedAt: "2026-09-15T21:12:00.000Z",
    planJson: { steps: [{ n: 1, agent: "Radar" }, { n: 2, agent: "Forge" }] },
    executionLog: [
      { step: 1, success: true },
      { step: 2, success: false, error: "Request was aborted." },
      { type: "execution.failed", at: "2026-09-15T21:13:01.000Z" },
    ],
    nowMs: Date.parse("2026-09-15T21:20:00.000Z"),
  };

  assert.equal(shouldRecoverTransientPlan(base), true);
  assert.equal(shouldRecoverTransientPlan({
    ...base,
    planJson: { steps: [{ n: 1, tool: "send_email" }] },
  }), false);
  assert.equal(shouldRecoverTransientPlan({
    ...base,
    executionLog: [
      ...base.executionLog.slice(0, -1),
      { type: "execution.transient-recovery" },
      { type: "execution.failed", at: "2026-09-15T21:13:01.000Z" },
    ],
  }), false);
});

test("failed-plan recovery requires the terminal failure to be transient", () => {
  const candidate = {
    status: "failed",
    ceoDecision: "approved",
    ceoDecidedAt: "2026-09-15T21:12:00.000Z",
    planJson: { steps: [{ n: 1, agent: "Forge" }] },
    executionLog: [
      { type: "execution.started", at: "2026-09-15T21:12:01.000Z" },
      { step: 1, success: false, error: "Request was aborted." },
      { type: "execution.deadlock", at: "2026-09-15T21:13:00.000Z" },
      { type: "execution.failed", at: "2026-09-15T21:13:01.000Z" },
    ],
    nowMs: Date.parse("2026-09-15T21:20:00.000Z"),
  };

  assert.equal(shouldRecoverTransientPlan(candidate), false);
  assert.equal(shouldRecoverTransientPlan({
    ...candidate,
    executionLog: [
      { type: "execution.started", at: "2026-09-15T21:12:01.000Z" },
      { step: 1, success: false, error: "Request was aborted." },
      {
        type: "execution.failed",
        at: "2026-09-15T21:13:01.000Z",
        failedReason: "Permanent policy failure",
      },
    ],
  }), false);
});

test("stale recovery is one-time and refuses every structured tool plan", () => {
  const base = {
    status: "executing",
    planJson: { steps: [{ n: 1, agent: "Forge" }] },
    executionLog: [{ type: "execution.started" }],
  };

  assert.equal(shouldRecoverStalePlan(base), true);
  assert.equal(shouldRecoverStalePlan({
    ...base,
    planJson: { steps: [{ n: 1, tool: "send_email" }] },
  }), false);
  assert.equal(shouldRecoverStalePlan({
    ...base,
    planJson: { steps: [{ n: 1, tool: null }] },
  }), false);
  assert.equal(shouldRecoverStalePlan({
    ...base,
    planJson: { steps: [{ n: 1, tool: "" }] },
  }), false);
  assert.equal(shouldRecoverStalePlan({
    ...base,
    executionLog: [
      ...base.executionLog,
      { type: "execution.transient-recovery" },
    ],
  }), false);
});