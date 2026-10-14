import assert from "node:assert/strict";
import test from "node:test";
import { PromptHistoryComparison } from "../../server/lib/prompt-history-comparison";

test("appending a turn preserves historical bytes; changing old enrichment is reported", () => {
  const compare = new PromptHistoryComparison();
  const scope = { tenantId: 1, conversationId: 7, channel: "sse" };
  assert.equal(compare.observe(scope, [{ id: 1, message: { role: "user", content: "original" } }]).compared, 0);
  const stable = compare.observe(scope, [
    { id: 1, message: { role: "user", content: "original" } },
    { id: 2, message: { role: "assistant", content: "answer" } },
  ]);
  assert.equal(stable.compared, 1);
  assert.equal(stable.changed, 0);
  const drift = compare.observe(scope, [
    { id: 1, message: { role: "user", content: "rebuilt enrichment" } },
    { id: 2, message: { role: "assistant", content: "answer" } },
  ]);
  assert.equal(drift.changed, 1);
});

test("tenant, conversation and channel boundaries cannot compare each other's history", () => {
  const compare = new PromptHistoryComparison();
  const message = [{ id: 1, message: "private" }];
  compare.observe({ tenantId: 1, conversationId: 7, channel: "sse" }, message);
  for (const scope of [
    { tenantId: 2, conversationId: 7, channel: "sse" },
    { tenantId: 1, conversationId: 8, channel: "sse" },
    { tenantId: 1, conversationId: 7, channel: "engine" },
  ]) assert.equal(compare.observe(scope, [{ id: 1, message: "different" }]).compared, 0);
});

test("eviction, expiry, invalid scope and oversized input stay bounded", () => {
  const compare = new PromptHistoryComparison(1, 10);
  const scope = { tenantId: 1, conversationId: 7, channel: "sse" };
  compare.observe(scope, [{ id: 1, message: "x" }], 0);
  assert.equal(compare.observe(scope, [{ id: 1, message: "y" }], 11).compared, 0);
  compare.observe({ ...scope, conversationId: 8 }, [{ id: 1, message: "z" }], 12);
  assert.equal(compare.observe(scope, [{ id: 1, message: "y" }], 13).compared, 0);
  assert.equal(compare.observe({ ...scope, tenantId: 0 }, [{ id: 1, message: "x" }]).skipped, 1);
  assert.equal(compare.observe(scope, [{ id: 1, message: "x".repeat(600000) }]).skipped, 1);
});

test("diagnostics skip large/non-data shapes before serialization or getter execution", () => {
  const compare = new PromptHistoryComparison();
  const scope = { tenantId: 1, conversationId: 7, channel: "sse" };
  let invoked = false;
  const hostile = { get content() { invoked = true; return "secret"; } };
  assert.equal(compare.observe(scope, [{ id: 1, message: hostile }]).skipped, 1);
  const custom = { toJSON() { invoked = true; return "secret"; } };
  assert.equal(compare.observe(scope, [{ id: 1, message: custom }]).skipped, 1);
  assert.equal(invoked, false);
  assert.throws(() => new PromptHistoryComparison(-1), /bounds/);
});
