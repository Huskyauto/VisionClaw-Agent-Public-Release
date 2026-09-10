import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { scoreHumanAiSynergyTrial, type HumanAiTrialInput, sameSynergyPayload, type SynergySemanticPayload } from "../../server/lib/human-ai-synergy-core";

const complete: HumanAiTrialInput = {
  task: "triage support queue",
  securityPass: true,
  arms: [
    { condition: "human_alone", measurements: { outcomeQuality: 70, timeEfficiency: 60, errorDetection: 65, adaptation: 60 } },
    { condition: "ai_alone", measurements: { outcomeQuality: 65, timeEfficiency: 80, errorDetection: 55, adaptation: 60 } },
    { condition: "human_ai", measurements: { outcomeQuality: 90, timeEfficiency: 85, errorDetection: 88, adaptation: 86 } },
  ],
};

describe("human-ai synergy scoring core", () => {
  it("scores all three arms and calculates both baseline lifts", () => {
    const result = scoreHumanAiSynergyTrial(complete);
    assert.equal(result.valid, true);
    if (!result.valid) return;
    assert.equal(result.scores.human_alone, 64.5);
    assert.equal(result.scores.ai_alone, 65.75);
    assert.equal(result.scores.human_ai, 87.55);
    assert.equal(result.liftVsHuman, 23.05);
    assert.equal(result.liftVsAi, 21.8);
    assert.equal(result.verdict, "positive_synergy");
  });

  it("fails closed for missing/duplicate arms, malformed numbers, and security failure", () => {
    for (const arms of [
      complete.arms.slice(0, 2),
      [...complete.arms, complete.arms[0]],
      complete.arms.map((arm) => arm.condition === "ai_alone"
        ? { ...arm, measurements: { ...arm.measurements, adaptation: Number.NaN } } : arm),
    ]) {
      const result = scoreHumanAiSynergyTrial({ ...complete, arms });
      assert.equal(result.valid, false);
    }
    const insecure = scoreHumanAiSynergyTrial({ ...complete, securityPass: false });
    assert.equal(insecure.valid, true);
    if (insecure.valid) assert.equal(insecure.verdict, "no_positive_synergy");
  });

  it("rejects coercible values and overlong strings", () => {
    const result = scoreHumanAiSynergyTrial({
      ...complete,
      task: "x".repeat(201),
      arms: complete.arms.map((arm) => arm.condition === "human_ai"
        ? { ...arm, measurements: { ...arm.measurements, adaptation: "86" as unknown as number } }
        : arm),
    });
    assert.equal(result.valid, false);
  });

  it("rejects malformed arm shapes instead of silently scoring partial data", () => {
    const malformed = scoreHumanAiSynergyTrial({
      ...complete,
      arms: complete.arms.map((arm) => arm.condition === "human_ai"
        ? { condition: "human_ai", measurements: { outcomeQuality: 90 } }
        : arm),
    });
    assert.equal(malformed.valid, false);
    const unknown = scoreHumanAiSynergyTrial({
      ...complete,
      arms: [...complete.arms.slice(0, 2), { condition: "hybrid", measurements: complete.arms[2].measurements }],
    });
    assert.equal(unknown.valid, false);
  });

  it("rejects whitespace-only task labels and compares semantic idempotency payloads", () => {
    assert.equal(scoreHumanAiSynergyTrial({ ...complete, task: "   " }).valid, false);
    const payload: SynergySemanticPayload = {
      trialName: "Pilot", taskLabel: "Task", participantAlias: "A", notes: null,
      securityPass: true, arms: complete.arms, rubricVersion: "human-ai-synergy-v1",
    };
    assert.equal(sameSynergyPayload(payload, { ...payload, arms: [...payload.arms].reverse() }), true);
    assert.equal(sameSynergyPayload(payload, { ...payload, notes: "different" }), false);
  });
});