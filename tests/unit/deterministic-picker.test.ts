/**
 * Deterministic-picker discipline (FareedKhan-dev/all-agentic-architectures,
 * MIT — pattern, not code). These tests lock the code-side composition of the
 * deciding number from the model's CATEGORICAL commits, so the LLM never emits
 * a raw score. Two converted surfaces:
 *   - server/cross-critique.ts  — rebuttalSurvival composed from 4 booleans
 *   - server/memory-intelligence.ts — confidence weight mapped from a category
 *
 * All three functions under test are pure (no I/O), so this file stays
 * query-free and exits cleanly under tests/run.sh (no pg-pool hang).
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  composeRebuttalSurvival,
  certaintyToWeight,
  statedToWeight,
} from "../../server/lib/deterministic-picker";

describe("composeRebuttalSurvival (cross-critique)", () => {
  it("returns the base 5 when no signals are set", () => {
    assert.equal(
      composeRebuttalSurvival({
        attacksCoreAssumption: false,
        hasConcreteEvidence: false,
        easilyMitigated: false,
        dependsOnRareCondition: false,
      }),
      5,
    );
  });

  it("a load-bearing, evidenced finding scores high (5+2+2=9)", () => {
    assert.equal(
      composeRebuttalSurvival({
        attacksCoreAssumption: true,
        hasConcreteEvidence: true,
        easilyMitigated: false,
        dependsOnRareCondition: false,
      }),
      9,
    );
  });

  it("an easily-mitigated edge-case finding floors at 1 (5-3-2=0 → clamp 1)", () => {
    assert.equal(
      composeRebuttalSurvival({
        attacksCoreAssumption: false,
        hasConcreteEvidence: false,
        easilyMitigated: true,
        dependsOnRareCondition: true,
      }),
      1,
    );
  });

  it("clamps to [1,10] — all-positive never exceeds 10", () => {
    const v = composeRebuttalSurvival({
      attacksCoreAssumption: true,
      hasConcreteEvidence: true,
      easilyMitigated: false,
      dependsOnRareCondition: false,
    });
    assert.ok(v >= 1 && v <= 10);
  });
});

describe("certaintyToWeight (memory relationship gates)", () => {
  // Gate semantics that MUST be preserved: dedup gate (>0.7) passes only
  // "high"; update gate (>0.6) passes "high" + "medium"; "low" passes neither.
  it("high passes both the dedup (>0.7) and update (>0.6) gates", () => {
    const w = certaintyToWeight("high");
    assert.ok(w > 0.7 && w > 0.6);
  });

  it("medium passes the update gate (>0.6) but NOT the dedup gate (>0.7)", () => {
    const w = certaintyToWeight("medium");
    assert.ok(w > 0.6 && !(w > 0.7));
  });

  it("low passes neither gate", () => {
    const w = certaintyToWeight("low");
    assert.ok(!(w > 0.6) && !(w > 0.7));
  });

  it("unknown/missing falls back to a neutral 0.5 (matches prior default)", () => {
    assert.equal(certaintyToWeight(undefined), 0.5);
    assert.equal(certaintyToWeight("garbage"), 0.5);
  });
});

describe("statedToWeight (memory extraction keep-gate)", () => {
  // Keep gate is >= 0.5: "explicit" and "implied" are kept, "speculative" dropped.
  it("explicit is kept (>= 0.5)", () => {
    assert.ok(statedToWeight("explicit") >= 0.5);
  });

  it("implied is kept (>= 0.5)", () => {
    assert.ok(statedToWeight("implied") >= 0.5);
  });

  it("speculative is dropped (< 0.5)", () => {
    assert.ok(statedToWeight("speculative") < 0.5);
  });

  it("unknown/missing is treated as implied (kept)", () => {
    assert.ok(statedToWeight(undefined) >= 0.5);
  });
});
