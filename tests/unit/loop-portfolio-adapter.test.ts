import assert from "node:assert/strict";
import test from "node:test";
import { emitLoopOutcomeBestEffort } from "../../server/lib/loop-portfolio-adapter";

test("loop outcome telemetry cannot fail the product loop", async () => {
  const warnings: string[] = [];
  const result = await emitLoopOutcomeBestEffort(
    {
      tenantId: 1,
      eventKey: "test:1",
      loopKind: "test",
      policyVersion: "v1",
      sourceType: "test",
      sourceId: "1",
      mode: "shadow",
      quality: 0.5,
      costUsd: 0,
      latencyMs: 0,
      safetyPassed: true,
      safetyEvaluated: false,
      independentlyEvaluated: false,
      persistedQuality: null,
      explorationValue: null,
      evidence: {},
      occurredAt: "2026-09-18T00:00:00.000Z",
    },
    {
      append: async () => {
        throw new Error("database unavailable");
      },
      warn: (message) => warnings.push(message),
    },
  );

  assert.equal(result, null);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /database unavailable/);
});