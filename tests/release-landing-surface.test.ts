import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

type ReleaseFacts = {
  metrics: {
    registeredTools: number;
    publicDocumentedTools: number;
    activePersonas: number;
    declaredTables: number;
    liveTables: number;
    platformIndexes: number;
  };
};

const facts = JSON.parse(fs.readFileSync("docs/release-facts.json", "utf8")) as ReleaseFacts;
const source = fs.readFileSync("client/src/pages/landing.tsx", "utf8");

test("landing current-state claims use release-fact semantics, not release labels", () => {
  const summary = fs.readFileSync("client/src/components/prepublication-notice.tsx", "utf8");
  assert.match(source, /Platform source — \{SOURCE_UPDATE_SUMMARY\} \{DEVELOPMENT_PLATFORM_SUMMARY\}/);
  for (const field of ["registeredTools", "activePersonas", "declaredTables", "liveTables", "platformIndexes"]) {
    assert.ok(summary.includes(`facts.metrics.${field}`), `shared summary must use ${field}`);
  }
  assert.match(source, /l: "Registered tools", v: releaseFacts\.metrics\.registeredTools/);
  assert.match(source, /l: "Declared tables", v: releaseFacts\.metrics\.declaredTables/);
  assert.match(source, /const tools = useCountUp\(releaseFacts\.metrics\.registeredTools/);
  assert.doesNotMatch(source, /R125\+155\+sec12/);
});

test("release facts retain the distinction between registry and public documentation", () => {
  assert.equal(facts.metrics.registeredTools, 428);
  assert.equal(facts.metrics.publicDocumentedTools, 386);
  assert.ok(facts.metrics.registeredTools > facts.metrics.publicDocumentedTools);
});

test("the public landing only fetches or renders protected platform stats for an admin tenant", () => {
  assert.match(
    source,
    /const isPlatformAdmin = tenant\?\.isAdmin === true;[\s\S]{0,600}queryKey:\s*\["\/api\/public\/stats"\],[\s\S]{0,160}enabled:\s*isPlatformAdmin,[\s\S]{0,160}const stats = isPlatformAdmin \? fetchedStats : undefined;/,
  );
});