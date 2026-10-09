import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

test("research shadow persistence records crossover metadata without a new model call or live verdict change", () => {
  const source = fs.readFileSync("server/lib/research-discovery-shadow.ts", "utf8");

  assert.match(source, /buildResearchCrossoverShadowRecord/);
  assert.match(source, /process\.env\.RESEARCH_CROSSOVER_MODE/);
  assert.match(source, /serializeResearchCrossoverShadowRecord/);
  assert.match(source, /WHERE id = \$\{input\.experimentId\} AND tenant_id = \$\{session\.tenantId\}/);
  assert.match(source, /session\.discoveryObservations\.push/);
  assert.doesNotMatch(source, /chat\.completions\.create|executeWithFailover/);
});