import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  emptySelfImprovementSummary,
  summarizeSelfImprovement,
} from "../../server/lib/self-improvement-metrics";

describe("self-improvement metrics (Anthropic Institute 2026 catch-rate)", () => {
  it("empty summary uses the essay-anchored 33% threshold and is not breached", () => {
    const e = emptySelfImprovementSummary();
    assert.equal(e.sampleSize, 0);
    assert.equal(e.autoResolveRate, 0);
    assert.equal(e.threshold, 0.33);
    assert.equal(e.breached, false);
    assert.deepEqual(e.byClassification, []);
  });

  it("returns the empty summary for an invalid tenant id without a DB hit", async () => {
    for (const t of [0, -1, 1.5, Number.NaN] as number[]) {
      const s = await summarizeSelfImprovement(t);
      assert.equal(s.sampleSize, 0);
      assert.equal(s.breached, false);
      assert.equal(s.threshold, 0.33);
    }
  });

  it("never breaches with zero sample (sub-10 minimum-sample guard)", () => {
    // breach requires sampleSize >= 10 AND rate < floor; an empty summary must be false.
    assert.equal(emptySelfImprovementSummary().breached, false);
  });
});
