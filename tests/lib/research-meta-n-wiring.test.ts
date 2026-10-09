import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const engineSource = readFileSync("server/research-engine.ts", "utf8");
const adapterSource = readFileSync("server/research-discovery-adapters.ts", "utf8");
const shadowSource = readFileSync("server/lib/research-meta-n-shadow.ts", "utf8");
const envExample = readFileSync(".env.example", "utf8");

test("research engine wires Meta^n after baseline persistence as report-only evidence", () => {
  assert.match(adapterSource, /metaNStrategyLayers:\s*ResearchMetaNShadowRecord\[\]/);
  assert.match(
    engineSource,
    /session\.previousResults\.push\([\s\S]*await persistResearchDiscoveryAdapters\(\{ session,/,
    "The engine must invoke the adapter only after baseline history",
  );
  const baseline = engineSource.indexOf("session.previousResults.push(");
  const adapterCall = engineSource.indexOf("await persistResearchDiscoveryAdapters(");
  assert.ok(baseline >= 0 && adapterCall > baseline,
    "Moving the adapter invocation before baseline persistence must fail");
  assert.match(adapterSource, /await persistResearchDiscoveryShadow\(input\)[\s\S]*await persistResearchMetaNShadow\(\{ session, experimentId \}\)/);
  assert.ok(adapterSource.indexOf("await persistResearchMetaNShadow(") >
    adapterSource.indexOf("await persistResearchDiscoveryShadow("));
  assert.doesNotMatch(
    engineSource,
    /META[_^]?N[\s\S]{0,120}(?:STRATEGY:|const prompt =)/i,
    "Meta^n output must not be injected into the experiment prompt",
  );
  assert.doesNotMatch(adapterSource, /META[_^]?N[\s\S]{0,120}(?:STRATEGY:|const prompt =)/i);
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