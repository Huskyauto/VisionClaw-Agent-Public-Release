import assert from "node:assert/strict";
import test from "node:test";
import {
  resolveResearchMetaNMode,
  runResearchMetaNShadowStep,
  type ResearchMetaNDeps,
  type ResearchMetaNTrace,
} from "../../server/lib/research-meta-n";

const traces: ResearchMetaNTrace[] = [
  {
    experimentId: 11,
    hypothesis: "Start with a baseline",
    approach: "Measure the current behavior",
    result: "Baseline score was 5",
    status: "discard",
    score: 5,
  },
  {
    experimentId: 12,
    hypothesis: "Add explicit verification",
    approach: "Require evidence before keeping",
    result: "Score improved to 7",
    status: "keep",
    score: 7,
  },
];

function deps(overrides: Partial<ResearchMetaNDeps> = {}): ResearchMetaNDeps {
  return {
    claimBudget: async () => ({
      ok: true,
      reason: "within-budget",
      claimId: 91,
      claimedUsd: 0.03,
    }),
    generateStrategy: async () => ({
      content: JSON.stringify({
        role: "strategist",
        diagnosis: "The second trace improved because it added evidence.",
        directives: ["Retain explicit verification", "Test one additional constraint"],
        helperIdeas: ["A declarative evidence checklist"],
      }),
      model: "test-model",
      tokens: 123,
    }),
    persistRecord: async () => {},
    ...overrides,
  };
}

test("Meta^n shadow accepts only the exact shadow mode", () => {
  assert.equal(resolveResearchMetaNMode(undefined), "off");
  assert.equal(resolveResearchMetaNMode("on"), "off");
  assert.equal(resolveResearchMetaNMode("SHADOW"), "off");
  assert.equal(resolveResearchMetaNMode("shadow"), "shadow");
});

test("Meta^n shadow is inert when disabled or before two completed traces", async () => {
  let calls = 0;
  const d = deps({
    claimBudget: async () => {
      calls++;
      return { ok: true };
    },
  });
  const base = { tenantId: 7, sessionId: 3, experimentId: 12, existingLayers: [] };
  assert.equal(await runResearchMetaNShadowStep({ ...base, modeValue: "off", traces }, d), null);
  assert.equal(await runResearchMetaNShadowStep({ ...base, modeValue: "shadow", traces: traces.slice(0, 1) }, d), null);
  assert.equal(calls, 0);
});

test("Meta^n shadow claims budget before generation and persists a report-only layer", async () => {
  const order: string[] = [];
  let capturedPrompt = "";
  const record = await runResearchMetaNShadowStep({
    modeValue: "shadow",
    tenantId: 7,
    sessionId: 3,
    experimentId: 12,
    traces,
    existingLayers: [],
  }, deps({
    claimBudget: async (claim) => {
      order.push("claim");
      assert.deepEqual(claim, {
        tenantId: 7,
        estimatedUsd: 0.03,
        label: "research-engine:meta-n-shadow",
      });
      return { ok: true, claimId: 91, claimedUsd: 0.03 };
    },
    generateStrategy: async (prompt) => {
      order.push("generate");
      capturedPrompt = prompt;
      return {
        content: JSON.stringify({
          role: "strategist",
          diagnosis: "Verification improved the result.",
          directives: ["Preserve evidence checks"],
          helperIdeas: [],
        }),
        model: "test-model",
        tokens: 42,
      };
    },
    persistRecord: async (persisted) => {
      order.push("persist");
      assert.equal(persisted.tenantId, 7);
      assert.equal(persisted.experimentId, 12);
    },
  }));

  assert.deepEqual(order, ["claim", "generate", "persist"]);
  assert.equal(record?.status, "generated");
  assert.equal(record?.depth, 1);
  assert.equal(record?.wouldApply, false);
  assert.deepEqual(record?.parentExperimentIds, [11, 12]);
  assert.match(capturedPrompt, /FIXED META-OPERATION Ω/);
  assert.match(capturedPrompt, /must not modify or evaluate itself/i);
});

test("Meta^n shadow stops at depth three and advances only every two traces", async () => {
  let calls = 0;
  const d = deps({
    claimBudget: async () => {
      calls++;
      return { ok: true, claimId: 91, claimedUsd: 0.03 };
    },
  });
  const existing = [
    { policyVersion: "research-meta-n-shadow-v1" as const, operatorVersion: "omega-v1" as const, mode: "shadow" as const, status: "generated" as const, depth: 1, tenantId: 7, sessionId: 3, experimentId: 12, parentExperimentIds: [11, 12], role: "strategist" as const, diagnosis: "a", directives: ["a"], helperIdeas: [], wouldApply: false as const, model: "m", tokens: 1, reason: null },
  ];
  assert.equal(await runResearchMetaNShadowStep({
    modeValue: "shadow", tenantId: 7, sessionId: 3, experimentId: 13,
    traces: [...traces, { ...traces[0], experimentId: 13 }], existingLayers: existing,
  }, d), null);

  const six = Array.from({ length: 6 }, (_, index) => ({
    ...traces[index % 2],
    experimentId: 20 + index,
  }));
  const depthThree = [
    existing[0],
    { ...existing[0], depth: 2, experimentId: 14 },
    { ...existing[0], depth: 3, experimentId: 16 },
  ];
  assert.equal(await runResearchMetaNShadowStep({
    modeValue: "shadow", tenantId: 7, sessionId: 3, experimentId: 25,
    traces: six, existingLayers: depthThree,
  }, d), null);
  assert.equal(calls, 0);
});

test("Meta^n shadow generates depth two and three only at traces four and six", async () => {
  const makeTraces = (count: number) => Array.from({ length: count }, (_, index) => ({
    ...traces[index % 2],
    experimentId: 30 + index,
  }));
  const depthOne = (await runResearchMetaNShadowStep({
    modeValue: "shadow", tenantId: 7, sessionId: 3, experimentId: 31,
    traces: makeTraces(2), existingLayers: [],
  }, deps()))!;
  const depthTwo = (await runResearchMetaNShadowStep({
    modeValue: "shadow", tenantId: 7, sessionId: 3, experimentId: 33,
    traces: makeTraces(4), existingLayers: [depthOne],
  }, deps()))!;
  const depthThree = (await runResearchMetaNShadowStep({
    modeValue: "shadow", tenantId: 7, sessionId: 3, experimentId: 35,
    traces: makeTraces(6), existingLayers: [depthOne, depthTwo],
  }, deps()))!;
  assert.deepEqual([depthOne.depth, depthTwo.depth, depthThree.depth], [1, 2, 3]);
  assert.equal(depthThree.parentExperimentIds.length, 6);
});

test("Meta^n shadow refuses spend cleanly and never calls the generator", async () => {
  let generated = false;
  let persistedStatus = "";
  const record = await runResearchMetaNShadowStep({
    modeValue: "shadow", tenantId: 7, sessionId: 3, experimentId: 12,
    traces, existingLayers: [],
  }, deps({
    claimBudget: async () => ({ ok: false, reason: "daily-cap-exceeded" }),
    generateStrategy: async () => {
      generated = true;
      throw new Error("must not run");
    },
    persistRecord: async (persisted) => {
      persistedStatus = persisted.record.status;
    },
  }));
  assert.equal(generated, false);
  assert.equal(record?.status, "blocked");
  assert.equal(record?.reason, "daily-cap-exceeded");
  assert.equal(persistedStatus, "blocked");
});

test("Meta^n shadow blocks a fail-open budget result without a durable claim", async () => {
  let generated = false;
  const record = await runResearchMetaNShadowStep({
    modeValue: "shadow", tenantId: 7, sessionId: 3, experimentId: 12,
    traces, existingLayers: [],
  }, deps({
    claimBudget: async () => ({ ok: true, reason: "ledger-failed-fail-open", claimedUsd: 0 }),
    generateStrategy: async () => {
      generated = true;
      throw new Error("must not run");
    },
  }));
  assert.equal(generated, false);
  assert.equal(record?.status, "blocked");
  assert.equal(record?.reason, "durable-budget-claim-required");
});

test("Meta^n shadow fails open when the budget claim itself errors", async () => {
  let generated = false;
  const record = await runResearchMetaNShadowStep({
    modeValue: "shadow", tenantId: 7, sessionId: 3, experimentId: 12,
    traces, existingLayers: [],
  }, deps({
    claimBudget: async () => {
      throw new Error("budget database unavailable");
    },
    generateStrategy: async () => {
      generated = true;
      throw new Error("must not run");
    },
  }));
  assert.equal(generated, false);
  assert.equal(record?.status, "degraded");
  assert.equal(record?.reason, "budget-claim-failed");
});

test("Meta^n shadow bounds a stuck budget claim", async () => {
  const started = Date.now();
  const record = await runResearchMetaNShadowStep({
    modeValue: "shadow", tenantId: 7, sessionId: 3, experimentId: 12,
    traces, existingLayers: [],
  }, deps({
    claimBudget: async () => new Promise(() => {}),
    claimTimeoutMs: 10,
  }));
  assert.equal(record?.status, "degraded");
  assert.equal(record?.reason, "budget-claim-failed");
  assert.ok(Date.now() - started < 250, "timeout should release the shadow step promptly");
});

test("Meta^n shadow fails open when generation or persistence throws", async () => {
  const generated = await runResearchMetaNShadowStep({
    modeValue: "shadow", tenantId: 7, sessionId: 3, experimentId: 12,
    traces, existingLayers: [],
  }, deps({
    generateStrategy: async () => {
      throw new Error("provider unavailable");
    },
    persistRecord: async () => {
      throw new Error("database unavailable");
    },
  }));
  assert.equal(generated?.status, "degraded");
  assert.equal(generated?.reason, "strategy-generation-failed");

  const persisted = await runResearchMetaNShadowStep({
    modeValue: "shadow", tenantId: 7, sessionId: 3, experimentId: 12,
    traces, existingLayers: [],
  }, deps({
    persistRecord: async () => {
      throw new Error("database unavailable");
    },
  }));
  assert.equal(persisted?.status, "generated");
});

test("Meta^n shadow bounds provider lookup and generation as one operation", async () => {
  const started = Date.now();
  const record = await runResearchMetaNShadowStep({
    modeValue: "shadow", tenantId: 7, sessionId: 3, experimentId: 12,
    traces, existingLayers: [],
  }, deps({
    generateStrategy: async () => new Promise(() => {}),
    generationTimeoutMs: 10,
  }));
  assert.equal(record?.status, "degraded");
  assert.equal(record?.reason, "strategy-generation-failed");
  assert.ok(Date.now() - started < 250, "generation timeout should release the session promptly");
});

test("Meta^n shadow bounds persistence before a DB transaction is acquired", async () => {
  const started = Date.now();
  const record = await runResearchMetaNShadowStep({
    modeValue: "shadow", tenantId: 7, sessionId: 3, experimentId: 12,
    traces, existingLayers: [],
  }, deps({
    persistRecord: async () => new Promise(() => {}),
    persistenceTimeoutMs: 10,
  }));
  assert.equal(record?.status, "generated");
  assert.ok(Date.now() - started < 250, "persistence timeout should release the session promptly");
});

test("Meta^n shadow degrades malformed output without applying it", async () => {
  const record = await runResearchMetaNShadowStep({
    modeValue: "shadow", tenantId: 7, sessionId: 3, experimentId: 12,
    traces, existingLayers: [],
  }, deps({
    generateStrategy: async () => ({ content: "not json", model: "test-model", tokens: 5 }),
  }));
  assert.equal(record?.status, "degraded");
  assert.equal(record?.wouldApply, false);
  assert.equal(record?.reason, "malformed-strategy-output");
});