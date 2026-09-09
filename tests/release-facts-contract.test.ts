import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

type ReleaseFacts = {
  schemaVersion: number;
  releaseDate: string;
  metrics: Record<string, number>;
};

const facts = JSON.parse(fs.readFileSync("docs/release-facts.json", "utf8")) as ReleaseFacts;
const totals = fs.readFileSync("docs/CURRENT_PLATFORM_TOTALS.md", "utf8");
const readme = fs.readFileSync("README.md", "utf8");
const roadmap = fs.readFileSync("ROADMAP.md", "utf8");
const indexHtml = fs.readFileSync("client/index.html", "utf8");
const plugin = JSON.parse(fs.readFileSync(".codex-plugin/plugin.json", "utf8")) as {
  license?: unknown;
  description?: unknown;
};

test("release facts distinguish complete registered tools from the public index", () => {
  assert.equal(facts.schemaVersion, 1);
  assert.equal(facts.releaseDate, "2026-09-06");
  assert.equal(facts.metrics.registeredTools, 417);
  assert.equal(facts.metrics.publicDocumentedTools, 386);
  assert.ok(facts.metrics.registeredTools > facts.metrics.publicDocumentedTools);

  for (const text of [totals, readme, roadmap, indexHtml]) {
    assert.match(text, /417 (?:total )?registered tools/i);
    assert.match(text, /386 public(?:ly)? documented tools/i);
  }
});

test("human-facing totals are explicitly generated from release facts", () => {
  assert.match(totals, /release-facts\.json.*machine-readable source/is);
  assert.match(readme, /release-facts\.json/);
  assert.match(roadmap, /release-facts\.json/);
  assert.match(fs.readFileSync("scripts/refresh-totals.ts", "utf8"), /FACTS_PATH = "docs\/release-facts\.json"/);
  assert.match(fs.readFileSync("scripts/verify-counts.ts", "utf8"), /const FACTS = "docs\/release-facts\.json"/);
});

test("release evidence uses a versioned stable input, not the wall clock", () => {
  const generator = fs.readFileSync("scripts/refresh-totals.ts", "utf8");
  const input = JSON.parse(fs.readFileSync("docs/release-facts-input.json", "utf8")) as {
    releaseDate?: unknown;
  };
  assert.equal(input.releaseDate, facts.releaseDate);
  assert.match(generator, /FACTS_INPUT_PATH = "docs\/release-facts-input\.json"/);
  assert.doesNotMatch(generator, /new Date\(\)/);
  assert.match(totals, /publication-time evidence snapshot/i);
  assert.match(totals, /not reproducible from a fresh public\s+checkout/i);
});

test("license wording keeps repository and component terms separate", () => {
  assert.match(readme, /repository source and documentation are licensed under the \[MIT License\]/i);
  assert.match(readme, /does \*\*not\*\* automatically license every component/i);
  assert.equal(plugin.license, "Proprietary");
  assert.match(String(plugin.description), /configured VisionClaw instance/i);
});