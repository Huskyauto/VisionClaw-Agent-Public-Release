import { test } from "node:test";
import assert from "node:assert/strict";
import { derivePlanLifecycle } from "../server/minerva-planner";
import { readFileSync } from "node:fs";

const event = (type: string, extra: Record<string, unknown> = {}) => ({ type, ...extra });

test("recovery blocked and ordinary failed repairs remain blocked with bounded reasons", () => {
  const recovery = derivePlanLifecycle({
    status: "failed",
    execution_log: [event("execution.recovery_blocked", { reason: "Manual review required after one replay." })],
  });
  assert.equal(recovery.lifecycle, "blocked");
  assert.equal(recovery.blockerReason, "Manual review required after one replay.");
  assert.equal(recovery.blockerClass, "stale_recovery_refusal");
  assert.equal(recovery.actionable, false);
  assert.equal(recovery.nextAction, "Recorded as a safety stop; review in plan history if needed.");

  const failed = derivePlanLifecycle({
    status: "failed",
    execution_log: [event("execution.failed", { failedReason: "Agent verification failed." })],
  });
  assert.equal(failed.lifecycle, "blocked");
  assert.equal(failed.blockerReason, "Agent verification failed.");
  assert.equal(failed.actionable, true);

  const verification = derivePlanLifecycle({
    status: "failed",
    execution_log: [event("verification.failed", { reason: "Evidence did not match." })],
  });
  assert.equal(verification.lifecycle, "blocked");
  assert.equal(verification.actionable, true);
});

test("both recovery refusal evidence shapes are non-actionable safety stops", () => {
  const structuredSideEffectRefusal = derivePlanLifecycle({
    status: "failed",
    execution_log: [event("execution.recovery_blocked", {
      reason: "Structured side effect requires manual review.",
      structuredSideEffects: ["send_email"],
      replayAttempted: false,
    })],
  });
  const exhaustedStaleReplay = derivePlanLifecycle({
    status: "failed",
    execution_log: [event("execution.recovery_blocked", {
      reason: "One-time stale replay already exhausted.",
      staleReplayAttempts: 1,
      replayExhausted: true,
    })],
  });

  for (const safetyStop of [structuredSideEffectRefusal, exhaustedStaleReplay]) {
    assert.equal(safetyStop.lifecycle, "blocked");
    assert.equal(safetyStop.blockerClass, "stale_recovery_refusal");
    assert.equal(safetyStop.actionable, false);
    assert.equal(safetyStop.nextAction, "Recorded as a safety stop; review in plan history if needed.");
  }
});

test("publish-required and evidence-backed completed plans project deterministic actions", () => {
  const publish = derivePlanLifecycle({ status: "publish_required", execution_log: [event("execution.publish_required")] });
  assert.equal(publish.lifecycle, "publish_required");
  assert.equal(publish.publish_required, true);
  assert.equal(publish.nextAction, "Review and publish when ready");

  const verified = derivePlanLifecycle({
    status: "completed",
    execution_log: [event("execution.completed", { okSteps: 2, totalSteps: 2 })],
  });
  assert.equal(verified.lifecycle, "verified");
  assert.equal(verified.verified, true);
});

test("handoff-pending projects a visible but non-actionable workspace review state", () => {
  const pending = derivePlanLifecycle({ status: "handoff_pending", execution_log: [] });
  assert.equal(pending.lifecycle, "handoff_pending");
  assert.equal(pending.actionable, false);
  assert.equal(pending.nextAction, "Verification, review, and apply must finish before workspace handoff can proceed");
});

test("dedup-suppressed rows are archived and not actionable", () => {
  const result = derivePlanLifecycle({
    status: "failed",
    execution_log: [event("plan.dedup_suppressed"), event("execution.failed", { reason: "duplicate" })],
  });
  assert.equal(result.lifecycle, "archived");
  assert.equal(result.actionable, false);
});

test("activity query preserves tenant scope and puts unresolved originals first", () => {
  const source = readFileSync("server/minerva-planner.ts", "utf8");
  const activity = source.slice(source.indexOf("args.activity"), source.indexOf("args.activity") + 1300);
  assert.match(activity, /tenant_id = \$\{tenantId\}/);
  assert.match(activity, /status IN \('approved', 'executing', 'completed', 'failed', 'handoff_pending', 'publish_required'\)/);
  assert.match(activity, /WHEN status IN \('publish_required', 'handoff_pending', 'executing', 'approved'\) THEN 0/);
  assert.match(activity, /source_ref, execution_log/);
  assert.match(activity, /jsonb_array_elements\(COALESCE\(plans\.execution_log/);
  assert.match(activity, /execution\.recovery_blocked/);
  assert.match(activity, /status = 'failed' AND NOT EXISTS/);
  assert.match(activity, /status = 'completed' AND NOT EXISTS/);
  assert.match(activity, /THEN 1[\s\S]*THEN 2[\s\S]*ELSE 3/);
  assert.match(activity, /LIMIT \$\{limit\}/);
});
