import { test } from "node:test";
import assert from "node:assert/strict";
import { formatSparkLinePollOutcome } from "../../server/spark-line-poll";

test("a completed API run returns the entire persisted assistant response", () => {
  const full = "A".repeat(80_000) + "\nThe final paragraph.";
  const outcome = formatSparkLinePollOutcome(
    "complete", { completedReply: full, reason: null, failedAt: null },
    { id: 9, content: "stale preview", created_at: new Date("2026-09-27T12:00:00Z") },
    true,
  );
  assert.equal(outcome.lastAssistantMessage?.content, full);
  assert.equal(outcome.lastAssistantMessage?.content.length, full.length);
});

test("missing reply cannot be labeled complete; failed always includes a reason", () => {
  assert.throws(() => formatSparkLinePollOutcome(
    "complete", { completedReply: null, reason: null, failedAt: null }, null, true,
  ), /reply unavailable/);
  const failedAt = new Date("2026-09-27T12:15:00Z");
  const outcome = formatSparkLinePollOutcome(
    "failed", { completedReply: null, reason: "timeout", failedAt }, null, true,
  );
  assert.equal(outcome.reason, "timeout");
  assert.equal(outcome.failedAt, failedAt);
});

test("an unmarked legacy conversation remains readable after completion", () => {
  const oldReply = { id: 599, content: "The previous full reply", created_at: new Date("2026-09-27T12:00:00Z") };
  const outcome = formatSparkLinePollOutcome(
    "complete", { completedReply: null, reason: null, failedAt: null }, oldReply, false,
  );
  assert.equal(outcome.lastAssistantMessage.content, oldReply.content);
  assert.equal(outcome.lastAssistantMessage.id, oldReply.id);
});