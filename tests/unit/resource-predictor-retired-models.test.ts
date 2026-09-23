import assert from "node:assert/strict";
import test from "node:test";

import {
  MODEL_COST_PER_MILLION,
  estimateMessageComplexityCost,
  estimatePlanCost,
  estimateQueryCost,
} from "../../server/resource-predictor";

test("resource forecasts normalize retired model ids to GPT-5.4", () => {
  const canonical = estimatePlanCost([{ tool: "llm_task" }], "gpt-5.4");

  for (const retired of [
    "gpt-5-mini",
    "o4-mini",
    "o4-mini-openai",
    "openai/gpt-5-mini",
  ]) {
    const estimate = estimatePlanCost([{ tool: "llm_task" }], retired);
    assert.equal(estimate.estimatedCostUsd, canonical.estimatedCostUsd);
    assert.equal(estimate.modelBreakdown[0]?.model, "gpt-5.4");

    const query = estimateQueryCost(100, retired, 1);
    const canonicalQuery = estimateQueryCost(100, "gpt-5.4", 1);
    assert.equal(query.estimatedCostUsd, canonicalQuery.estimatedCostUsd);
    assert.equal(query.modelBreakdown[0]?.model, "gpt-5.4");
    assert.match(query.recommendation, /GPT-5\.4/i);

    const complexity = estimateMessageComplexityCost("Please research this question?", retired, 3);
    const canonicalComplexity = estimateMessageComplexityCost("Please research this question?", "gpt-5.4", 3);
    assert.deepEqual(complexity, canonicalComplexity);
  }

  assert.equal("gpt-5-mini" in MODEL_COST_PER_MILLION, false);
  assert.equal("o4-mini" in MODEL_COST_PER_MILLION, false);
  assert.equal("o4-mini-openai" in MODEL_COST_PER_MILLION, false);
});