import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const engineSource = readFileSync("server/research-engine.ts", "utf8");
const shadowSource = readFileSync("server/lib/research-meta-n-shadow.ts", "utf8");
const envExample = readFileSync(".env.example", "utf8");

test("research engine wires Meta^n after baseline persistence as report-only evidence", () => {
  assert.match(engineSource, /metaNStrategyLayers:\s*ResearchMetaNShadowRecord\[\]/);
  assert.match(
    engineSource,
    /session\.previousResults\.push\([\s\S]*persistResearchDiscoveryShadow\([\s\S]*persistResearchMetaNShadow\(/,
    "Meta^n runs only after the completed result enters baseline history",
  );
  assert.doesNotMatch(
    engineSource,
    /META[_^]?N[\s\S]{0,120}(?:STRATEGY:|const prompt =)/i,
    "Meta^n output must not be injected into the experiment prompt",
  );
});

test("Meta^n runtime is budgeted, tenant-scoped, bounded, and off by default", () => {
  assert.match(shadowSource, /process\.env\.RESEARCH_META_N_MODE/);
  assert.match(shadowSource, /claimAutonomousBudget/);
  assert.match(shadowSource, /getClientForModel/);
  assert.match(shadowSource, /maxRetries:\s*0/);
  assert.doesNotMatch(shadowSource, /executeWithFailover/);
  assert.match(shadowSource, /max_completion_tokens:\s*700/);
  assert.match(
    shadowSource,
    /UPDATE research_experiments SET verification_details[\s\S]*WHERE id = \$\{experimentId\} AND tenant_id = \$\{tenantId\}/,
  );
  assert.match(envExample, /RESEARCH_META_N_MODE=off/);
});