import assert from "node:assert/strict";
import { test } from "node:test";
import { canonicalizePersonaToolsDocInputs } from "../../server/lib/persona-tools-doc-order";

test("persona tools-doc inputs are byte-stable when database row order changes", () => {
  const customTools = [
    { id: 20, name: "Zulu", description: "z", is_active: true, tenant_id: 1 },
    { id: 10, name: "Alpha", description: "a", is_active: true, tenant_id: 1 },
  ];
  const enabledSkills = [
    { id: 30, name: "Writing", category: "content", enabled: true, persona_id: 2 },
    { id: 5, name: "Research", category: "research", enabled: true, persona_id: null },
  ];

  const canonical = canonicalizePersonaToolsDocInputs(customTools, enabledSkills);
  const reversed = canonicalizePersonaToolsDocInputs(
    [...customTools].reverse(),
    [...enabledSkills].reverse(),
  );

  assert.deepEqual(reversed, canonical);
  assert.deepEqual(canonical.customTools.map((tool) => tool.id), [10, 20]);
  assert.deepEqual(canonical.enabledSkills.map((skill) => skill.id), [5, 30]);
});