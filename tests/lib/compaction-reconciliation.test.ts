import assert from "node:assert/strict";
import test from "node:test";
import { buildCorrectionAwareCompactionInput } from "../../server/lib/compaction-reconciliation";

test("a recent correction reaches the summarizer even when older history exhausts its budget", () => {
  const old = "Launch October 8. " + "older chatter ".repeat(2000);
  const input = buildCorrectionAwareCompactionInput(old, [
    { role: "user", content: "Correction: launch October 15. Research only, do not build." },
    { role: "tool", content: '{"status":"failed","reason":"approval missing"}' },
  ]);
  assert.match(input, /October 15/);
  assert.match(input, /Research only, do not build/);
  assert.match(input, /approval missing/);
  assert.ok(input.length < 19000);
});
