import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { classifyJuryHealth } from "../../server/lib/ecosystem-health";

// Query-free: classifyJuryHealth is pure, so this never opens the pg pool (a real
// db.execute here would hang node:test under run.sh — see the node-test-db-pool-hang
// convention). Thresholds mirror DEFAULTS: theater κ≥0.93 & esc≤0.02; noise κ<0.30
// OR esc≥0.60; min 12 samples to score at all.
describe("classifyJuryHealth (Forge No.08 jury vital sign)", () => {
  it("returns insufficient below the per-class sample floor", () => {
    assert.equal(classifyJuryHealth({ sampleSize: 11, meanKappa: 0.99, escalationRate: 0 }), "insufficient");
    assert.equal(classifyJuryHealth({ sampleSize: 0, meanKappa: 0.1, escalationRate: 0.9 }), "insufficient");
  });

  it("flags a rubber-stamp class (very high κ, near-zero escalation) as theater", () => {
    assert.equal(classifyJuryHealth({ sampleSize: 40, meanKappa: 0.97, escalationRate: 0.0 }), "theater");
    assert.equal(classifyJuryHealth({ sampleSize: 12, meanKappa: 0.93, escalationRate: 0.02 }), "theater");
  });

  it("does NOT flag theater when escalation is meaningfully non-zero", () => {
    // High κ but the jury still splits sometimes → the audit carries signal.
    assert.equal(classifyJuryHealth({ sampleSize: 40, meanKappa: 0.97, escalationRate: 0.10 }), "useful");
  });

  it("flags an always-split class as noise (low mean κ)", () => {
    assert.equal(classifyJuryHealth({ sampleSize: 30, meanKappa: 0.25, escalationRate: 0.4 }), "noise");
  });

  it("flags a high-escalation class as noise even with mid κ", () => {
    assert.equal(classifyJuryHealth({ sampleSize: 30, meanKappa: 0.55, escalationRate: 0.7 }), "noise");
  });

  it("classifies the healthy middle band as useful", () => {
    assert.equal(classifyJuryHealth({ sampleSize: 50, meanKappa: 0.72, escalationRate: 0.2 }), "useful");
    assert.equal(classifyJuryHealth({ sampleSize: 50, meanKappa: 0.60, escalationRate: 0.15 }), "useful");
  });

  it("fails open toward insufficient / safe on non-finite inputs", () => {
    assert.equal(classifyJuryHealth({ sampleSize: NaN, meanKappa: 0.99, escalationRate: 0 }), "insufficient");
    // NaN κ/esc coerce to 0 → 0 < noiseKappa ⇒ noise (a degraded reading, not silently "useful").
    assert.equal(classifyJuryHealth({ sampleSize: 40, meanKappa: NaN, escalationRate: NaN }), "noise");
  });
});
