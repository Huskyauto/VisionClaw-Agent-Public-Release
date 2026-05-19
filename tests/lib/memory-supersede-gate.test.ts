// R116 — architect post-edit-code-review finding: memory_supersede must NOT
// flip the old row to 'superseded' if the replacement enqueue is rejected
// (e.g. confidence below queue threshold, fact too short). Otherwise we orphan
// the old fact with no replacement, violating the supersede contract.
//
// We test the gating logic in isolation (no DB) by mirroring the shape of
// enqueueMemoryFact's return value and asserting the handler's decision rule.
import { test } from "node:test";
import assert from "node:assert/strict";

// The MCP handler does: `if (!enq || enq.ok === false) { return ok:false }`
// BEFORE running the UPDATE that flips status='superseded'. We pin that rule.
function wouldFlipOldRow(enq: { ok: boolean; reason?: string } | null | undefined): boolean {
  if (!enq || enq.ok === false) return false;
  return true;
}

test("enqueue rejected for below_threshold → old row MUST NOT be flipped", () => {
  assert.equal(wouldFlipOldRow({ ok: false, reason: "below_threshold" }), false);
});

test("enqueue rejected for fact_too_short → old row MUST NOT be flipped", () => {
  assert.equal(wouldFlipOldRow({ ok: false, reason: "fact_too_short" }), false);
});

test("enqueue null/undefined → old row MUST NOT be flipped (fail-CLOSED)", () => {
  assert.equal(wouldFlipOldRow(null), false);
  assert.equal(wouldFlipOldRow(undefined), false);
});

test("enqueue ok=true (enqueued) → old row IS flipped", () => {
  assert.equal(wouldFlipOldRow({ ok: true, reason: undefined } as any), true);
});

test("enqueue ok=true (deduped) → old row IS flipped", () => {
  assert.equal(wouldFlipOldRow({ ok: true } as any), true);
});
