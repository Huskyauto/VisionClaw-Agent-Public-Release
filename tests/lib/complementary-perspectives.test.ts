import assert from "node:assert/strict";
import test from "node:test";
import { applyComplementaryPerspectives, complementarySynthesisRules, perspectiveSystemPrompt, recoverPerspectiveSpec, estimatePromptInputTokens } from "../../server/lib/complementary-perspectives";

test("three independent seats retain original instructions and use distinct complementary lenses", () => {
  const specs = applyComplementaryPerspectives(
    [{ modelId: "a" }, { modelId: "b" }, { modelId: "c" }],
    "Original safety and format instructions", true,
  );
  assert.equal(new Set(specs.map(s => s.label)).size, 3);
  for (const spec of specs) {
    assert.match(spec.systemPrompt!, /^Original safety and format instructions/);
    assert.match(spec.systemPrompt!, /complete answer/);
    assert.match(spec.systemPrompt!, /Do not invent/);
  }
  assert.match(specs[0].systemPrompt!, /evidence/i);
  assert.match(specs[1].systemPrompt!, /implementation/i);
  assert.match(specs[2].systemPrompt!, /counterexample/i);
});

test("opt-out is identity-preserving and custom traditions are not overwritten", () => {
  const plain = [{ modelId: "a" }];
  assert.equal(applyComplementaryPerspectives(plain, "base", false), plain);
  const custom = [{ modelId: "x", label: "taleb", systemPrompt: "custom tail-risk", providerLane: "pinned" }];
  const output = applyComplementaryPerspectives(custom, "base", true);
  assert.deepEqual(output, custom);
  assert.deepEqual(custom[0], { modelId: "x", label: "taleb", systemPrompt: "custom tail-risk", providerLane: "pinned" });
});

test("synthesis protects minority evidence and source uncertainty without demanding extra output sections", () => {
  assert.match(complementarySynthesisRules, /minority/i);
  assert.match(complementarySynthesisRules, /not independent verification/i);
  assert.match(complementarySynthesisRules, /unresolved/i);
  assert.match(complementarySynthesisRules, /format/i);
  assert.match(complementarySynthesisRules, /untrusted/i);
  assert.ok(perspectiveSystemPrompt("base", 0).length - "base".length < 1300);
});

test("recovery retains perspective while using the new pinned transport", () => {
  const failed = applyComplementaryPerspectives([{ modelId: "old", providerLane: "old-lane" }], "base", true)[0];
  const recovered = recoverPerspectiveSpec(failed, { modelId: "new", providerLane: "new-lane" }, "recovery");
  assert.equal(recovered.modelId, "new");
  assert.equal(recovered.providerLane, "new-lane");
  assert.equal(recovered.systemPrompt, failed.systemPrompt);
  assert.equal(recovered.label, "evidence");
  const neutral = recoverPerspectiveSpec({ modelId: "old" }, { modelId: "new" }, "recovery");
  assert.equal(neutral.systemPrompt, undefined);
  assert.equal(neutral.label, "recovery");
});

test("missing-usage estimate includes added perspective instructions", () => {
  const original = estimatePromptInputTokens("base", "question");
  const withLens = perspectiveSystemPrompt("base", 0);
  const enhanced = estimatePromptInputTokens(withLens, "question");
  assert.equal(enhanced, Math.ceil((withLens.length + "question".length) / 4));
  assert.ok(enhanced > original);
});