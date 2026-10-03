import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { extractToolNamesStatic } from "../scripts/lib/tool-source-files";

type ReleaseFacts = {
  metrics: {
    registeredTools: number;
    publicDocumentedTools: number;
    activePersonas: number;
    totalSkills: number;
    activeCapabilities: number;
    declaredTables: number;
    liveTables: number;
    platformIndexes: number;
    governanceRules: number;
    coreRegistryModels: number;
  };
};

const facts = JSON.parse(fs.readFileSync("docs/release-facts.json", "utf8")) as ReleaseFacts;
const indexHtml = fs.readFileSync("client/index.html", "utf8");

function metaContent(attribute: "name" | "property", value: string): string {
  const escaped = value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = indexHtml.match(
    new RegExp(`<meta\\s+${attribute}="${escaped}"\\s+content="([^"]*)"\\s*/?>`, "i"),
  );
  assert.ok(match, `missing ${attribute}="${value}" metadata`);
  return match[1];
}

test("static HTML metadata uses current release facts and explicit tool semantics", () => {
  const c = facts.metrics;
  const descriptions = [
    metaContent("name", "description"),
    metaContent("property", "og:description"),
    metaContent("name", "twitter:description"),
  ];

  for (const description of descriptions) {
    assert.match(description, new RegExp(`${c.registeredTools} total registered tools`, "i"));
    assert.match(description, new RegExp(`${c.publicDocumentedTools} publicly documented tools`, "i"));
    assert.match(description, new RegExp(`${c.declaredTables} declared / ${c.liveTables} live tables`, "i"));
    assert.match(description, new RegExp(`${c.platformIndexes} platform indexes`, "i"));
    assert.doesNotMatch(description, /R125\+155|delivery retr/i);
  }

  const jsonLd = indexHtml.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/i)?.[1];
  const noScript = indexHtml.match(/<noscript>([\s\S]*?)<\/noscript>/i)?.[1];
  assert.match(jsonLd ?? "", new RegExp(`${c.registeredTools} Total Registered Tools`, "i"));
  assert.match(jsonLd ?? "", new RegExp(`${c.publicDocumentedTools} Publicly Documented Tools`, "i"));
  assert.match(noScript ?? "", new RegExp(`${c.registeredTools} total registered tools`, "i"));
  assert.match(noScript ?? "", new RegExp(`${c.publicDocumentedTools} publicly documented tools`, "i"));
});

test("the totals generator and static extractor agree on registered tools", () => {
  const refreshTotals = fs.readFileSync("scripts/refresh-totals.ts", "utf8");
  const { names: toolNames, duplicates } = extractToolNamesStatic();

  assert.match(refreshTotals, /FACTS_PATH = "docs\/release-facts\.json"/);
  assert.match(refreshTotals, /extractToolNamesStatic\(\)/);
  assert.match(refreshTotals, /publicDocumentedTools/);
  assert.equal(toolNames.length, facts.metrics.registeredTools);
  assert.equal(new Set(toolNames).size, toolNames.length);
  assert.deepEqual(duplicates, []);
});

test("public current-state documents link to the generated facts", () => {
  const readme = fs.readFileSync("README.md", "utf8");
  const roadmap = fs.readFileSync("ROADMAP.md", "utf8");
  const totals = fs.readFileSync("docs/CURRENT_PLATFORM_TOTALS.md", "utf8");

  for (const text of [readme, roadmap, totals]) {
    assert.match(text, /release-facts\.json/);
    assert.match(text, new RegExp(`${facts.metrics.registeredTools} total registered tools`, "i"));
    assert.match(text, new RegExp(`${facts.metrics.publicDocumentedTools} public documented tools`, "i"));
  }
  assert.match(totals, /machine-readable source/i);
  assert.doesNotMatch(readme, /codeflow-card\.svg/i);
});