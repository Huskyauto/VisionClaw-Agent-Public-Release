import { test } from "node:test";
import assert from "node:assert";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  MODEL_REGISTRY,
  getMultimodalModelsForTier,
  getMaxOutputTokens,
  isSyntheticEvaluationModel,
} from "../../server/model-registry";
import { getContextWindow } from "../../server/context-window-guard";
import { findFallbackModel } from "../../server/model-failover";
import { getClientForModel } from "../../server/providers";
import {
  UNION_ALPHA_SYNTHETIC_FIXTURES,
  scoreUnionAlphaFixture,
  validateUnionAlphaCompletion,
} from "../../server/lib/union-alpha-eval-core";

const ROOT = resolve(import.meta.dirname, "..", "..");
const read = (path: string) => readFileSync(resolve(ROOT, path), "utf8");
const MODEL_ID = "stealth/union-alpha";

test("Union Alpha is registered with conservative synthetic-evaluation metadata", () => {
  const model = MODEL_REGISTRY.find((entry) => entry.id === MODEL_ID);
  assert.deepEqual(model, {
    id: MODEL_ID,
    label: "Union Alpha (Synthetic Evaluation)",
    provider: "openrouter",
    tier: "powerful",
    description: "Anonymous OpenRouter preview model for bounded synthetic coding and tool-use evaluation only; prompts may be retained by the provider",
    capabilities: ["vision", "code", "tools"],
    costClass: "paid",
    trainingRegime: "unknown",
  });
  assert.equal(getContextWindow(MODEL_ID), 262_144);
  assert.equal(getMaxOutputTokens(MODEL_ID), 32_768);
  assert.equal(isSyntheticEvaluationModel(MODEL_ID), true);
});

test("the general provider client can never return Union Alpha", async () => {
  await assert.rejects(
    () => getClientForModel(MODEL_ID, 1, {
      explicitOwnerSelection: true,
      platformAdminVerified: true,
      providerLane: "openrouter",
    }),
    /only available through its fixed synthetic evaluation runner/,
  );
});

test("Union Alpha cannot enter automatic routing, discovery, or failover", () => {
  for (const path of [
    "server/auto-router.ts",
    "server/moa.ts",
    "data/model-tiers.json",
    "data/model-registry-overlay.json",
  ]) {
    assert.doesNotMatch(read(path), /stealth\/union-alpha/, `${path} must not auto-route to Union Alpha`);
  }

  const providers = read("server/providers.ts");
  assert.match(providers, /!isSyntheticEvaluationModel\(m\.id\)/);
  assert.equal(
    getMultimodalModelsForTier("powerful").some((model) => model.id === MODEL_ID),
    false,
  );
  assert.equal(
    findFallbackModel("gpt-5.4", [MODEL_REGISTRY.find((entry) => entry.id === MODEL_ID)!]),
    null,
  );
});

test("the Union Alpha runner exposes only fixed, bounded synthetic fixtures", () => {
  assert.equal(UNION_ALPHA_SYNTHETIC_FIXTURES.length, 3);
  assert.deepEqual(
    UNION_ALPHA_SYNTHETIC_FIXTURES.map((fixture) => fixture.kind),
    ["code", "review", "tool"],
  );
  for (const fixture of UNION_ALPHA_SYNTHETIC_FIXTURES) {
    assert.match(fixture.prompt, /SYNTHETIC FIXTURE/);
    assert.ok(fixture.prompt.length < 2_000);
  }

  assert.deepEqual(
    scoreUnionAlphaFixture(UNION_ALPHA_SYNTHETIC_FIXTURES[0], {
      text: "```ts\nreturn [...new Set(values)].sort((a, b) => a - b);\n```",
      toolCalls: [],
    }),
    { passed: false, checksPassed: 3, checksTotal: 4 },
  );
});

test("synthetic scoring rejects token-only prose and extra tool arguments", () => {
  assert.equal(
    scoreUnionAlphaFixture(UNION_ALPHA_SYNTHETIC_FIXTURES[0], {
      text: "A good answer would use Set, call .sort(, and compare a - b.",
      toolCalls: [],
    }).passed,
    false,
  );
  assert.equal(
    scoreUnionAlphaFixture(UNION_ALPHA_SYNTHETIC_FIXTURES[1], {
      text: "The issue involves forEach. Consider Promise.all and await save.",
      toolCalls: [],
    }).passed,
    false,
  );
  assert.equal(
    scoreUnionAlphaFixture(UNION_ALPHA_SYNTHETIC_FIXTURES[2], {
      text: "",
      toolCalls: [{
        name: "lookup_dependency",
        arguments: JSON.stringify({ package: "zod", version: "4.1.5", privateData: "x" }),
      }],
    }).passed,
    false,
  );
});

test("completion validation rejects truncated, empty, and ambiguous responses", () => {
  const codeFixture = UNION_ALPHA_SYNTHETIC_FIXTURES[0];
  assert.throws(
    () => validateUnionAlphaCompletion(codeFixture, {
      choiceCount: 1,
      finishReason: "length",
      text: "function normalizeIds",
      toolCalls: [],
    }),
    /finish reason/,
  );
  assert.throws(
    () => validateUnionAlphaCompletion(codeFixture, {
      choiceCount: 1,
      finishReason: "stop",
      text: "",
      toolCalls: [],
    }),
    /empty text/,
  );
  assert.throws(
    () => validateUnionAlphaCompletion(codeFixture, {
      choiceCount: 2,
      finishReason: "stop",
      text: "function normalizeIds() {}",
      toolCalls: [],
    }),
    /exactly one choice/,
  );
});

test("the dedicated runner owns the payload and bypasses persistent cost tracking", () => {
  const providers = read("server/providers.ts");
  const script = read("scripts/evaluate-union-alpha.ts");
  const runnerStart = providers.indexOf("export async function runUnionAlphaSyntheticFixture");
  const runnerEnd = providers.indexOf("\nfunction tryPinnedAnthropicApiLane", runnerStart + 1);
  assert.ok(runnerStart >= 0, "provider-owned fixed-fixture runner must exist");
  const runner = providers.slice(runnerStart, runnerEnd >= 0 ? runnerEnd : undefined);
  assert.doesNotMatch(runner, /wrapClientWithCostTracking|recordCost/);
  assert.doesNotMatch(runner, /wrapOpenRouterFailureMarking/);
  assert.match(runner, /timeout:\s*60_000/);
  assert.match(runner, /maxRetries:\s*0/);
  assert.doesNotMatch(script, /getClientForModel/);
  assert.match(script, /runUnionAlphaSyntheticFixture/);
});