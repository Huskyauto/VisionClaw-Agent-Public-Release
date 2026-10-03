import test from "node:test";
import assert from "node:assert/strict";

import { TEST_MODEL_IDS } from "../server/model-freshness";
import { MODEL_REGISTRY } from "../server/model-registry";

test("xAI health probe uses a current direct xAI model", () => {
  assert.equal(TEST_MODEL_IDS.xai, "grok-4.6");
  assert.ok(
    MODEL_REGISTRY.some(
      model => model.id === "x-ai/grok-4.6" && model.provider === "openrouter",
    ),
  );
  assert.notEqual(TEST_MODEL_IDS.xai, "grok-4");
});