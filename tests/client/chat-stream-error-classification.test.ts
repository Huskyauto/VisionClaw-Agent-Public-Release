import assert from "node:assert/strict";
import { test } from "node:test";
import { isUnrecoverableChatStreamError } from "../../client/src/lib/chat-stream-errors";

test("a recoverable tool failure does not appear as a fatal chat error", () => {
  assert.equal(isUnrecoverableChatStreamError({
    type: "adaptive_heal",
    tool: "project",
    error: "Project not found",
    attempt: 1,
  }), false);
  assert.equal(isUnrecoverableChatStreamError({ type: "adaptive_escalation", error: "Project not found" }), false);
});

test("actual stream errors still alert, including legacy untyped errors", () => {
  assert.equal(isUnrecoverableChatStreamError({ type: "error", error: "Connection lost" }), true);
  assert.equal(isUnrecoverableChatStreamError({ error: "Connection lost" }), true);
  assert.equal(isUnrecoverableChatStreamError({ type: "fatal_error", error: "Stopped" }), false);
  assert.equal(isUnrecoverableChatStreamError({ type: "error", error: "Stopped", done: true }), false);
});