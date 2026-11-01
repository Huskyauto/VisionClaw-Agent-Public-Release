import test from "node:test";
import assert from "node:assert/strict";
import { auditScheduleDecision, auditCommand } from "../../server/lib/tenant-audit-schedule-policy";

const now = new Date("2026-10-24T09:00:00Z");
test("a missing audit is due and warns rather than implying coverage", () => {
  assert.deepEqual(auditScheduleDecision(now, []), { enqueue: true, warning: "missing", window: "2026-10-24" });
});

test("a newly published repair can rearm an old terminal audit without rearming unchanged failures", () => {
  const job = { status: "failed_terminal", createdAt: now.toISOString(), window: "2026-10-24", sourceHash: "old" };
  assert.equal(auditScheduleDecision(now, [job], "new").enqueue, true);
  assert.equal(auditScheduleDecision(now, [job], "old").enqueue, false);
});
test("an active audit prevents overlapping daily work but stale progress warns", () => {
  const job = { status: "pending", createdAt: "2026-10-23T01:00:00Z", window: "2026-10-23",
    progressAt: "2026-10-23T02:00:00Z" };
  assert.equal(auditScheduleDecision(now, [job]).enqueue, false);
  assert.equal(auditScheduleDecision(now, [job]).warning, "stalled");
  assert.equal(auditScheduleDecision(now, [{ ...job, progressAt: now.toISOString() }]).warning, "incomplete");
});
test("failed or incomplete current-day audit warns and is not silently replaced", () => {
  const job = { status: "failed", createdAt: now.toISOString(), window: "2026-10-24" };
  assert.equal(auditScheduleDecision(now, [job]).enqueue, false);
  assert.equal(auditScheduleDecision(now, [job]).warning, "incomplete");
});
test("only complete current-day coverage suppresses warnings", () => {
  const job = { status: "succeeded", createdAt: now.toISOString(), window: "2026-10-24", complete: true };
  assert.equal(auditScheduleDecision(now, [job]).warning, null);
  assert.equal(auditScheduleDecision(now, [{ ...job, complete: false }]).warning, "incomplete");
  assert.equal(auditScheduleDecision(now, [{ ...job, window: "2026-10-23" }]).enqueue, true);
});
test("production requires a plain-Node audit bundle and never installs a loader", () => {
  assert.throws(() => auditCommand(true, () => false), /bundle missing/);
  const command = auditCommand(true, () => true);
  assert.equal(command.command, process.execPath);
  assert.match(command.args[0], /tenant-isolation-audit\.cjs$/);
  assert.equal(auditCommand(false).command, "npx");
});
test("redeployment cannot reuse security clearance from different source bytes", () => {
  const job = { status: "succeeded", createdAt: now.toISOString(), window: "2026-10-24",
    complete: true, sourceHash: "old" };
  assert.equal(auditScheduleDecision(now, [job], "new").warning, "source_changed");
  assert.equal(auditScheduleDecision(now, [job], "new").enqueue, true);
  assert.equal(auditScheduleDecision(now, [{ ...job, sourceHash: "new" }], "new").enqueue, false);
  assert.equal(auditScheduleDecision(now, [{ ...job, sourceHash: "new", findingsRequireAttention: true }], "new").warning, "findings");
});
