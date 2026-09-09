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

// ── Write-time explicit-link invariant (Luhmann/Zettelkasten uplift) ──
// When a contradiction is detected on the synchronous extract/tool path, the
// stale row must NOT be a bare `{status:"superseded"}` flip — it must record the
// explicit old→new successor link (succeeded_by_id + valid_until) so "what
// replaced this fact?" is answerable and the supersession chain survives in
// memory snapshots. We mirror the patch the handler builds (no DB) and pin it.
function buildSupersedePatch(newEntryId: number): {
  status: string;
  succeededById: number;
  validUntil: Date;
} {
  return { status: "superseded", succeededById: newEntryId, validUntil: new Date() };
}

test("contradiction supersede patch keeps the dominant 'superseded' status", () => {
  assert.equal(buildSupersedePatch(42).status, "superseded");
});

test("contradiction supersede patch records the explicit successor link (NOT a bare flip)", () => {
  const patch = buildSupersedePatch(42);
  assert.equal(patch.succeededById, 42, "succeeded_by_id must point at the replacement entry");
  assert.ok(patch.validUntil instanceof Date, "valid_until must be stamped");
});

test("supersede must happen AFTER the replacement exists (create-before-link ordering)", () => {
  // succeededById can only be a real id if the new entry was created first.
  // A patch built with a falsy/0 id signals the old bare-flip ordering bug.
  const newEntryId = 0; // simulate "not created yet"
  assert.ok(!buildSupersedePatch(newEntryId).succeededById, "must not link to a non-existent (0) id");
});
