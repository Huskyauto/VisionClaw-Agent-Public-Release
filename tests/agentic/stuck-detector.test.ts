/**
 * tests/agentic/stuck-detector.test.ts
 *
 * Regression coverage for the loop-detection primitive the critic-coach feature
 * depends on. The architect specifically asked that reset() be proven to give
 * the post-coaching retry a clean slate (stale fingerprints must NOT immediately
 * re-trip the detector on the next, possibly-different, output).
 *
 * Pure — no DB, no LLM, no network.
 *
 * Run: node --import tsx --test tests/agentic/stuck-detector.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import { StuckDetector } from "../../server/agentic/stuck-detector";

test("trips at threshold 3 within a window of 4", () => {
  const sd = new StuckDetector();
  assert.equal(sd.observe("same").isStuck, false, "1st identical");
  assert.equal(sd.observe("same").isStuck, false, "2nd identical");
  const third = sd.observe("same");
  assert.equal(third.isStuck, true, "3rd identical → stuck");
  assert.equal(third.identicalCount, 3);
});

test("varied output never trips", () => {
  const sd = new StuckDetector();
  for (const out of ["a", "b", "c", "d", "e", "f"]) {
    assert.equal(sd.observe(out).isStuck, false);
  }
});

test("reset() clears fingerprints so the next retry starts clean", () => {
  const sd = new StuckDetector();
  sd.observe("loop");
  sd.observe("loop");
  assert.equal(sd.observe("loop").isStuck, true, "stuck before reset");

  sd.reset();

  // After reset the SAME repeated output must NOT immediately re-trip — it has
  // to accumulate to threshold again from scratch. This is what guarantees the
  // critic-coached retry isn't instantly re-flagged on its first new output.
  assert.equal(sd.observe("loop").isStuck, false, "1st after reset");
  assert.equal(sd.observe("loop").isStuck, false, "2nd after reset");
  assert.equal(sd.observe("loop").isStuck, true, "3rd after reset re-accumulates");
});

test("masks 8+ digit IDs so cosmetic ID churn still reads as stuck", () => {
  const sd = new StuckDetector();
  // Differ only by an 8+ digit id-shaped number → fingerprint collapses them.
  assert.equal(sd.observe("processing record 100000001").isStuck, false);
  assert.equal(sd.observe("processing record 100000002").isStuck, false);
  assert.equal(sd.observe("processing record 100000003").isStuck, true);
});

test("short numbers stay distinct so real progress isn't a false positive", () => {
  const sd = new StuckDetector();
  // Progress counters / percentages are short numbers → must remain distinct.
  assert.equal(sd.observe("step 1 of 9").isStuck, false);
  assert.equal(sd.observe("step 2 of 9").isStuck, false);
  assert.equal(sd.observe("step 3 of 9").isStuck, false);
});
