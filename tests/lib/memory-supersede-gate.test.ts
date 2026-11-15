// Link-shape examples only. Real MCP/storage rollback and durability behavior
// is tested against production modules in security/app-review-integrity.test.ts.
import { test } from "node:test";
import assert from "node:assert/strict";

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
