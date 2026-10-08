import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const features = readFileSync("server/agentic-features.ts", "utf8");
const definitions = readFileSync("server/tools/domains/research-intel/definitions.ts", "utf8");
const handlers = readFileSync("server/tools/domains/research-intel/handlers.ts", "utf8");
const registry = readFileSync("server/tool-registry.ts", "utf8");
const policy = readFileSync("server/safety/destructive-tool-policy.ts", "utf8");
const mapper = readFileSync("server/lib/project-relationship-evidence.ts", "utf8");

test("project relationship reads are explicitly scoped to tenant and trusted project context", () => {
  const queryBlock = features
    .split("export async function queryProjectRelationships")[1]
    .split("export async function synthesizeResearch")[0];

  assert.match(queryBlock, /tenant_id = \$\{params\.tenantId\}/);
  assert.match(queryBlock, /project_id = \$\{params\.projectId\}/);
  assert.match(queryBlock, /buildProjectRelationshipMap/);
  assert.match(mapper, /PROJECT_RELATIONSHIP_RESEARCH/);

  const handlerBlock = handlers
    .split("async function queryProjectRelationshipsHandler")[1]
    .split("async function synthesizeResearchHandler")[0];
  assert.match(handlerBlock, /ctx\.tenantId/);
  assert.match(handlerBlock, /ctx\.projectId/);
  assert.match(handlerBlock, /Tenant and project context required/);
  assert.doesNotMatch(handlerBlock, /params\.projectId/);
  assert.doesNotMatch(handlerBlock, /params\._projectId/);
});

test("relationship tool has no caller-controlled scope fields and is registered as safe", () => {
  const definitionBlock = definitions
    .split("export const queryProjectRelationshipsDefinition")[1]
    .split("export const synthesizeResearchDefinition")[0];
  assert.match(definitionBlock, /name: "query_project_relationships"/);
  assert.doesNotMatch(definitionBlock, /projectId|tenantId|_projectId|_tenantId/);
  assert.match(registry, /registerTool\("query_project_relationships", \{ categories: \["research"\], speed: "normal", isProductOutput: false, isNetworkTool: false \}\)/);
  assert.match(policy, /query_project_relationships:\s+\{ name: "query_project_relationships", risk: "safe", riskClass: "LOW" \}/);
});