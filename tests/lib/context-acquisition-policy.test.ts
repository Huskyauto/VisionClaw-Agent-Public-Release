import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { chooseContextAction } from "../../server/lib/context-acquisition-policy";

describe("context-acquisition policy", () => {
  it("acquires context only when expected task value clears the full cost", () => {
    const decision = chooseContextAction({
      candidates: [
        {
          id: "act-now",
          kind: "act",
          expectedTaskSuccessLift: 0,
          expectedInformationGain: 0,
          tokenCost: 0,
          latencyMs: 0,
          userTurns: 0,
          safetyAllowed: true,
        },
        {
          id: "ask-audience",
          kind: "ask_user",
          expectedTaskSuccessLift: 0.55,
          expectedInformationGain: 0.4,
          tokenCost: 20,
          latencyMs: 900,
          userTurns: 1,
          safetyAllowed: true,
        },
      ],
      policy: {
        informationGainWeight: 0.25,
        tokenCostWeight: 0.001,
        latencyMsWeight: 0.00005,
        userTurnPenalty: 0.1,
        minAcquireScore: 0.1,
      },
    });

    assert.equal(decision.selected.id, "ask-audience");
    assert.equal(decision.shouldAcquire, true);
    assert.ok(decision.selected.utility > 0.1);
  });

  it("does not let a high-value estimate bypass hard safety or budget limits", () => {
    const decision = chooseContextAction({
      candidates: [
        {
          id: "act-now",
          kind: "act",
          expectedTaskSuccessLift: 0,
          expectedInformationGain: 0,
          tokenCost: 0,
          latencyMs: 0,
          userTurns: 0,
          safetyAllowed: true,
        },
        {
          id: "unsafe-lookup",
          kind: "call_safe_tool",
          expectedTaskSuccessLift: 1,
          expectedInformationGain: 1,
          tokenCost: 0,
          latencyMs: 0,
          userTurns: 0,
          safetyAllowed: false,
        },
        {
          id: "too-expensive-search",
          kind: "call_safe_tool",
          expectedTaskSuccessLift: 1,
          expectedInformationGain: 1,
          tokenCost: 1000,
          latencyMs: 0,
          userTurns: 0,
          safetyAllowed: true,
        },
      ],
      policy: {
        informationGainWeight: 1,
        tokenCostWeight: 0,
        latencyMsWeight: 0,
        userTurnPenalty: 0,
        minAcquireScore: 0,
        maxTokenCost: 20,
      },
    });

    assert.equal(decision.selected.id, "act-now");
    assert.equal(decision.shouldAcquire, false);
    assert.match(
      decision.ranked.find((candidate) => candidate.id === "unsafe-lookup")!.exclusionReason!,
      /safety or policy/,
    );
    assert.match(
      decision.ranked.find((candidate) => candidate.id === "too-expensive-search")!.exclusionReason!,
      /budget/,
    );
  });
});