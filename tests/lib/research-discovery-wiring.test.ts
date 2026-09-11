import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const engineSource = readFileSync("server/research-engine.ts", "utf8");
const shadowSource = readFileSync("server/lib/research-discovery-shadow.ts", "utf8");
const envExample = readFileSync(".env.example", "utf8");

test("research engine wires the discovery controller as tenant-scoped shadow metadata", () => {
  assert.match(
    engineSource,
    /discoveryObservations:\s*ResearchDiscoveryObservation\[\]/,
    "each active session owns its own controller history",
  );
  assert.match(engineSource, /persistResearchDiscoveryShadow\(/);
  assert.match(
    shadowSource,
    /process\.env\.RESEARCH_DISCOVERY_CONTROLLER_MODE/,
    "the kill switch is checked in the experiment path",
  );
  assert.match(shadowSource, /buildResearchDiscoveryShadowRecord\(/);
  assert.match(shadowSource, /serializeResearchDiscoveryShadowRecord\(/);
  assert.match(
    shadowSource,
    /UPDATE research_experiments SET verification_details[\s\S]*WHERE id = \$\{input\.experimentId\} AND tenant_id = \$\{session\.tenantId\}/,
    "shadow metadata updates only the current tenant's experiment",
  );
  assert.match(envExample, /RESEARCH_DISCOVERY_CONTROLLER_MODE=off/);
});