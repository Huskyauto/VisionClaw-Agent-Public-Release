import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { estimateCostUsd } from "../../server/agentic/cost-ledger";
import { MODEL_REGISTRY, MODEL_MAX_OUTPUT } from "../../server/model-registry";
import { estimateQueryCost, estimatePlanCost, createLiveCostTracker, estimateMessageComplexityCost } from "../../server/resource-predictor";
import { getContextWindow } from "../../server/context-window-guard";

test("Haiku 5.5 is a selectable low-cost Anthropic workhorse with tools and vision", () => {
  const model = MODEL_REGISTRY.find(row => row.id === "claude-haiku-5-5");
  assert.ok(model);
  assert.equal(model.provider, "anthropic");
  assert.equal(model.tier, "fast");
  assert.equal(model.costClass, "cheap");
  assert.ok(model.capabilities?.includes("tools"));
  assert.ok(model.capabilities?.includes("vision"));
  assert.equal(MODEL_MAX_OUTPUT[model.id], 128000);
  assert.equal(getContextWindow(model.id), 1_000_000);
});

test("Haiku short-context costs include the inclusive 100K boundary", () => {
  assert.equal(estimateCostUsd("claude-haiku-5-5", 100_000, 100_000), 0.06);
  assert.equal(estimateCostUsd("claude-haiku-5-5", 100_000, 0, 100_000), 0.001);
  assert.equal(estimateCostUsd("claude-haiku-5-5", 100_000, 0, 0, 100_000), 0.0125);
});

test("Haiku prompts over 100K apply fivefold rates to the entire request including cache", () => {
  const close = (actual: number, expected: number) => assert.ok(Math.abs(actual - expected) < 1e-12);
  close(estimateCostUsd("claude-haiku-5-5", 100_001, 10_000), 0.0750005);
  close(estimateCostUsd("claude-haiku-5-5", 200_000, 10_000), 0.125);
  close(estimateCostUsd("claude-haiku-5-5", 200_000, 0, 200_000), 0.01);
  close(estimateCostUsd("claude-haiku-5-5", 200_000, 0, 0, 200_000), 0.125);
  close(estimateCostUsd("claude-haiku-5-5", 200_000, 10_000, 50_000, 50_000), 0.10875);
});

test("Haiku pricing is explicit in forecasts and insights rather than an unknown-model fallback", () => {
  const predictor = readFileSync("server/resource-predictor.ts", "utf8");
  const insights = readFileSync("server/insights-engine.ts", "utf8");
  assert.match(predictor, /"claude-haiku-5-5":\s*\{\s*input:\s*0\.10,\s*output:\s*0\.50\s*\}/);
  assert.match(insights, /\["claude-haiku-5-5",\s*\{\s*in:\s*0\.10,\s*out:\s*0\.50\s*\}\]/);
  assert.doesNotMatch(insights, /getCostSummary|recordedModelCost|promptTokens\s*>\s*100_000/);
  assert.equal(estimateQueryCost(8000, "claude-haiku-5-5").estimatedCostUsd, 0.002);
  assert.equal(estimateQueryCost(400000, "claude-haiku-5-5").estimatedCostUsd, 0.061);
});

test("Plan totals do not turn individually short calls into long-context calls", () => {
  const plan = estimatePlanCost(Array.from({ length: 110 }, () => ({})), "claude-haiku-5-5");
  assert.equal(plan.modelBreakdown[0].costUsd, 0.04445);
});

test("An empty plan still prices its initial model call", () => {
  const plan = estimatePlanCost([], "claude-haiku-5-5");
  assert.equal(plan.modelBreakdown[0].calls, 1);
  assert.equal(plan.modelBreakdown[0].costUsd, 0.00045);
});

test("Live tracker prices long prompts including native cache tokens", () => {
  const tracker = createLiveCostTracker(1);
  tracker.recordStep("llm_task", "claude-haiku-5-5", { prompt_tokens: 200000, completion_tokens: 10000 });
  assert.equal(tracker.steps[0].costUsd, 0.125);
  tracker.recordStep("llm_task", "claude-haiku-5-5", {
    input_tokens: 100000, cache_read_input_tokens: 50000,
    cache_creation_input_tokens: 50000, output_tokens: 10000,
  });
  assert.equal(tracker.steps[1].costUsd, 0.10875);
});

test("Complexity forecasts apply Haiku prompt-length pricing", () => {
  const message = Array(80000).fill("word").join(" ");
  assert.equal(estimateMessageComplexityCost(message, "claude-haiku-5-5", 0).expectedCostUsd, 0.05775);
});

