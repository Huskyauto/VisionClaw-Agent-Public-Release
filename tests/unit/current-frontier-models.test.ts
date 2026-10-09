import { test } from "node:test";
import assert from "node:assert/strict";
import { MODEL_REGISTRY, getMaxOutputTokens } from "../../server/model-registry";
import { getContextWindow } from "../../server/context-window-guard";

test("verified Opus 5.5 and Gemini 3.8 are selectable metered OpenRouter models with exact limits", () => {
  for (const expected of [
    { id: "anthropic/claude-opus-5.5", label: "Claude Opus 5.5", context: 1_000_000, output: 128_000 },
    { id: "google/gemini-3.8-flash", label: "Gemini 3.8 Flash", context: 1_048_576, output: 65_536 },
  ]) {
    const model = MODEL_REGISTRY.find(entry => entry.id === expected.id);
    assert.ok(model, `${expected.id} must be registered`);
    assert.equal(model.label, expected.label);
    assert.equal(model.provider, "openrouter");
    assert.equal(model.costClass, "paid");
    assert.ok(model.capabilities?.includes("tools"));
    assert.ok(model.capabilities?.includes("vision"));
    assert.equal(getMaxOutputTokens(expected.id), expected.output);
    assert.equal(getContextWindow(expected.id), expected.context);
    assert.doesNotMatch(model.description, /flat.rate|free|Profundo/i);
  }
});