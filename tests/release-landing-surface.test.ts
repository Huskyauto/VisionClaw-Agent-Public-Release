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
  const { registeredTools, activePersonas, declaredTables, liveTables, platformIndexes } = facts.metrics;

  assert.match(
    source,
    new RegExp(
      `Platform Online — ${activePersonas} Agents, ${registeredTools} Tools, ${declaredTables} Declared / ${liveTables} Live Tables, ${platformIndexes} Platform Indexes`,
    ),
  );
  assert.match(source, new RegExp(`Connected tools", v: "${registeredTools}"`));
  assert.match(source, new RegExp(`Database tables", v: "${declaredTables} declared / ${liveTables} live tables"`));
  assert.match(source, new RegExp(`const tools = useCountUp\\(${registeredTools}`));
  assert.doesNotMatch(source, /R125\+155\+sec12/);
});

test("release facts retain the distinction between registry and public documentation", () => {
  assert.equal(facts.metrics.registeredTools, 417);
  assert.equal(facts.metrics.publicDocumentedTools, 386);
  assert.ok(facts.metrics.registeredTools > facts.metrics.publicDocumentedTools);
});

test("the public landing only fetches or renders protected platform stats for an admin tenant", () => {
  assert.match(
    source,
    /const isPlatformAdmin = tenant\?\.isAdmin === true;[\s\S]{0,600}queryKey:\s*\["\/api\/public\/stats"\],[\s\S]{0,160}enabled:\s*isPlatformAdmin,[\s\S]{0,160}const stats = isPlatformAdmin \? fetchedStats : undefined;/,
  );
});