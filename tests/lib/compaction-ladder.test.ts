import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  compactLadder,
  computeContextBudget,
  smartTruncateToolResults,
  estimateLadderTokens,
  boundedFallback,
} from "../../server/lib/compaction-ladder";

type Msg = { role: string; content: any };

// ~3.5 chars/token. A 700K-char tool result ≈ 200K tokens, comfortably over the
// 90K budget that a numeric 120000 budget yields (120000 * 0.75).
function bigToolResult(chars: number): string {
  return "x".repeat(chars);
}

describe("compaction-ladder: budget math", () => {
  it("numeric budget keeps the legacy *0.75 scaling", () => {
    assert.equal(computeContextBudget(120000), 90000);
  });

  it("string modelId budget floors at 64K and never exceeds the window", () => {
    const b = computeContextBudget("definitely-not-a-real-model-id");
    assert.ok(b >= 64000, `budget ${b} should floor at 64K`);
  });

  it("estimateLadderTokens counts tool + assistant + user content", () => {
    const msgs: Msg[] = [
      { role: "user", content: "abcdefg" }, // 7 chars
      { role: "tool", content: "abcdefg" }, // 7 chars
    ];
    assert.equal(estimateLadderTokens(msgs), Math.ceil(14 / 3.5));
  });
});

describe("compaction-ladder: free deterministic tiers", () => {
  it("fits → no layers fire, no LLM needed, messages untouched", () => {
    const msgs: Msg[] = [
      { role: "user", content: "hello" },
      { role: "tool", content: "small result" },
    ];
    const r = compactLadder(msgs, { modelId: 120000 });
    assert.equal(r.fits, true);
    assert.equal(r.needsLlmCompaction, false);
    assert.deepEqual(r.layersFired, []);
    assert.equal(r.messages, msgs); // same reference — untouched
  });

  it("over budget → cheapest cap fires FIRST and stops as soon as it fits", () => {
    // One ~700K-char tool result (~200K tokens) against a 90K budget. The first
    // rung (@8000) alone drops it to well under budget, so only ONE layer fires.
    const msgs: Msg[] = [
      { role: "user", content: "do the thing" },
      { role: "tool", content: bigToolResult(700_000) },
    ];
    const r = compactLadder(msgs, { modelId: 120000 });
    assert.equal(r.fits, true);
    assert.equal(r.needsLlmCompaction, false);
    assert.deepEqual(r.layersFired, ["smart-compress@8000"], "only the cheapest rung should fire");
    assert.ok(r.estimatedTokensAfter < r.estimatedTokensBefore);
  });

  it("escalation order is strictly cheapest→tightest (never skips a rung)", () => {
    // Many tool results each just above 8000 chars but the total still over
    // budget after @8000, forcing escalation to tighter rungs in order.
    const tools: Msg[] = [];
    for (let i = 0; i < 60; i++) tools.push({ role: "tool", content: bigToolResult(40_000) });
    const msgs: Msg[] = [{ role: "user", content: "go" }, ...tools];
    const r = compactLadder(msgs, { modelId: 120000 });
    // Layers must be a prefix of the descending cap ladder.
    const expectedOrder = ["smart-compress@8000", "smart-compress@3000", "smart-compress@1000", "smart-compress@400"];
    assert.deepEqual(r.layersFired, expectedOrder.slice(0, r.layersFired.length));
    // And each fired rung must be in descending-cap order.
    const caps = r.layersFired.map((l) => Number(l.split("@")[1]));
    for (let i = 1; i < caps.length; i++) assert.ok(caps[i] < caps[i - 1], "caps must strictly descend");
  });

  it("budget cap is respected — every tool result is <= the fired cap", () => {
    const msgs: Msg[] = [{ role: "tool", content: bigToolResult(700_000) }];
    const out = smartTruncateToolResults(msgs, 8000);
    assert.ok(String(out[0].content).length <= 8000, "compressed tool result must not exceed the cap");
  });

  it("boundedFallback never exceeds the cap, even degenerate tiny caps", () => {
    const text = "y".repeat(50_000);
    for (const cap of [0, 1, 5, 40, 100, 8000]) {
      assert.ok(boundedFallback(text, cap).length <= cap, `cap ${cap} must hold`);
    }
    // shorter-than-cap text is returned verbatim
    assert.equal(boundedFallback("short", 8000), "short");
  });

  it("non-tool messages are never mutated by smartTruncateToolResults", () => {
    const big = bigToolResult(700_000);
    const msgs: Msg[] = [
      { role: "user", content: big },
      { role: "assistant", content: big },
    ];
    const out = smartTruncateToolResults(msgs, 8000);
    assert.equal(out[0].content, big);
    assert.equal(out[1].content, big);
  });
});
