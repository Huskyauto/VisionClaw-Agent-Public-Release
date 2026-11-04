import { test } from "node:test";
import assert from "node:assert/strict";
import { buildStructuredTaskPrompt, selectSchemaFormat } from "../../server/lib/structured-task-prompt";

test("compact rollout requires exact opt-in, owner tenant and internal plan profile", () => {
  for (const flag of [undefined, "", "0", "true", "01"]) {
    assert.equal(selectSchemaFormat(flag, 1, "owner-plan-step"), "pretty");
  }
  assert.equal(selectSchemaFormat("1", 2, "owner-plan-step"), "pretty");
  assert.equal(selectSchemaFormat("1", undefined, "owner-plan-step"), "pretty");
  assert.equal(selectSchemaFormat("1", 1, undefined), "pretty");
  assert.equal(selectSchemaFormat("1", 1, "owner-plan-step"), "compact");
  const schema = { type: "object", properties: { rows: { type: "array", items: { type: "string", enum: ["two words", "a\nb"] } } } };
  const input = { schema, thinking: "high", trustedSystemInstruction: "Keep every safety rule." };
  const pretty = buildStructuredTaskPrompt(input);
  const compact = buildStructuredTaskPrompt(input, "compact");
  assert.equal(compact, pretty.replace(JSON.stringify(schema, null, 2), JSON.stringify(schema)));
  assert.equal(buildStructuredTaskPrompt(input, selectSchemaFormat("0", 1, "owner-plan-step")), pretty);
});

for (const [name, schema] of Object.entries({
  report: { type: "object", required: ["sections"], properties: { sections: { type: "array", items: { type: "object", required: ["sources"], properties: { sources: { type: "array", items: { type: "string" } } } } } } },
  research: { type: "object", properties: { confidence: { enum: ["high", "medium", "low"] }, citation: { anyOf: [{ type: "string" }, { type: "null" }] } } },
  toolDecision: { type: "object", additionalProperties: false, properties: { approved: { const: false }, action: { enum: ["verify_first", "needs_approval", "refuse"] } } },
  nestedReferences: { $defs: { item: { type: "string", pattern: "^a b$" } }, type: "array", items: { $ref: "#/$defs/item" } },
})) {
  test(`${name}: compact schema preserves every field, string and policy byte`, () => {
    const input = { schema, trustedSystemInstruction: "Refusals remain final.\nNever bypass tenant or approval rules." };
    const pretty = buildStructuredTaskPrompt(input);
    const compact = buildStructuredTaskPrompt(input, "compact");
    const prefix = pretty.slice(0, pretty.indexOf(JSON.stringify(schema, null, 2)));
    assert.equal(compact, prefix + JSON.stringify(schema));
    assert.deepEqual(JSON.parse(compact.slice(prefix.length)), schema);
  });
}
