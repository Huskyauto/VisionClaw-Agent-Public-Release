import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  buildAstraReportDraft,
  parseAstraReportDraft,
} from "../../server/research-report-fulfillment";

const sections = [
  { heading: "One", body: "First verified section. ".repeat(12) },
  { heading: "Two", body: "Second verified section. ".repeat(12) },
];

test("completed-report Astra contract round-trips every section in order", () => {
  const text = buildAstraReportDraft(sections);
  assert.deepEqual(parseAstraReportDraft(text, ["One", "Two"]), sections.map((section) => ({
    ...section,
    body: section.body.trim(),
  })));
});

test("completed-report Astra contract rejects missing, reordered, or short sections", () => {
  assert.equal(parseAstraReportDraft(buildAstraReportDraft(sections.slice(0, 1)), ["One", "Two"]), null);
  assert.equal(parseAstraReportDraft(buildAstraReportDraft([...sections].reverse()), ["One", "Two"]), null);
  assert.equal(parseAstraReportDraft("=== SECTION: One ===\nshort\n\n=== SECTION: Two ===\nshort", ["One", "Two"]), null);
  const abbreviated = [
    "=== SECTION: One ===",
    "Still nonempty. ".repeat(8),
    "=== SECTION: Two ===",
    "Still nonempty. ".repeat(8),
  ].join("\n");
  assert.equal(parseAstraReportDraft(abbreviated, ["One", "Two"], sections), null);
  assert.equal(parseAstraReportDraft(`preamble\n${buildAstraReportDraft(sections)}`, ["One", "Two"], sections), null);
});

test("completed research reports use the adaptive Astra output limit", () => {
  const source = readFileSync("server/research-report-fulfillment.ts", "utf8");
  const call = source.match(/finishWithAstra\(\{([\s\S]*?)\n  \}\);/)?.[1] || "";
  assert.ok(call.includes("preparedDraft: preparedReport"));
  assert.doesNotMatch(call, /maxOutputTokens\s*:/);
});