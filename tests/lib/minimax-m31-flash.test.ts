import { test } from "node:test";
import assert from "node:assert/strict";
import { MODEL_REGISTRY, getMaxOutputTokens } from "../../server/model-registry";

test("MiniMax M3.1 Flash is a selectable verified promotional OpenRouter model", () => {
  const matches = MODEL_REGISTRY.filter(m => m.id === "minimax/minimax-m3.1-flash:free");
  assert.equal(matches.length, 1, "exact upstream ID must be registered once");
  const model = matches[0];
  assert.equal(model.provider, "openrouter");
  assert.equal(model.costClass, "free");
  assert.equal(model.trainingRegime, "unknown");
  for (const capability of ["vision", "code", "tools"]) {
    assert.ok(model.capabilities?.includes(capability as "vision" | "code" | "tools"));
  }
  assert.match(model.description, /promotional/i);
  assert.match(model.description, /not.*default/i);
  assert.match(model.description, /\$0\.15.*\$0\.60/);
  assert.equal(getMaxOutputTokens(model.id), 32768, "bounded operational output, not the 524K provider maximum");
});
