import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { MODEL_REGISTRY, getMaxOutputTokens } from "../../server/model-registry";

const source = (path: string) => readFileSync(resolve(import.meta.dirname, "../..", path), "utf8");

test("Muse Spark 1.3 is selectable with explicit paid pricing and bounded context/output", () => {
  const model = MODEL_REGISTRY.find((entry) => entry.id === "meta/muse-spark-1.3");
  assert.ok(model, "The current Muse version must be selectable");
  assert.equal(model.label, "Muse Spark 1.3");
  assert.equal(model.provider, "openrouter");
  assert.equal(model.costClass, "paid");
  assert.ok(model.capabilities?.includes("tools"));
  assert.equal(getMaxOutputTokens(model.id), 32768);
  assert.match(source("server/context-window-guard.ts"), /"meta\/muse-spark-1\.3":\s*1_048_576/);
  assert.match(source("server/resource-predictor.ts"), /"meta\/muse-spark-1\.3":\s*\{\s*input:\s*1\.25,\s*output:\s*4\.25\s*\}/);
  assert.match(source("server/insights-engine.ts"), /\["meta\/muse-spark-1\.3",\s*\{\s*in:\s*1\.25,\s*out:\s*4\.25\s*\}\]/);
  assert.match(source("server/agentic/cost-ledger.ts"), /"meta\/muse-spark-1\.3":\s*\{\s*in:\s*0\.00125,\s*out:\s*0\.00425\s*\}/);
  assert.ok(MODEL_REGISTRY.some((entry) => entry.id === "meta/muse-spark-1.1"), "Existing conversation choices remain supported");
});

test("Retained Muse 1.1 conversations also have an explicit ledger price", () => {
  assert.match(source("server/agentic/cost-ledger.ts"), /"meta\/muse-spark-1\.1":\s*\{\s*in:\s*0\.00125,\s*out:\s*0\.00425\s*\}/);
});
