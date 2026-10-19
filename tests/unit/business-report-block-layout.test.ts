import test from "node:test";
import assert from "node:assert/strict";
import { normalizeReportBlockLayout } from "../../server/lib/business-report-block-layout";

test("oversized executive overview retains every whole bullet and all heading coverage without raising the block cap", () => {
  const headings = ["Website", "Customer service", "Revenue"];
  const verdict = "- Overall verdict: " + "Preserve the complete recommendations. ".repeat(20);
  const bullets = headings.map(heading => `- ${heading}: ` + "Useful specific section analysis. ".repeat(24));
  const text = [verdict, ...bullets].join("\n");
  assert.ok(text.length > 3000);
  const candidate = { report: { sections: [
    { heading: "Executive Summary", blocks: [{ type: "recommendation", text, sourceIds: ["S1"] }] },
    ...headings.map(heading => ({ heading, blocks: [] })),
  ] } };
  const original = structuredClone(candidate);
  const normalized = normalizeReportBlockLayout(candidate);
  assert.deepEqual(candidate, original, "the provider candidate is immutable");
  const blocks = normalized.candidate.report.sections[0].blocks;
  assert.equal(blocks.length, 2);
  assert.ok(blocks.every((block: any) => block.text.length <= 3000));
  assert.ok(headings.every(heading => blocks[0].text.includes(heading)));
  assert.deepEqual(blocks.flatMap((block: any) => block.text.split("\n")).sort(), text.split("\n").sort());
  assert.deepEqual(blocks.map((block: any) => block.sourceIds), [["S1"], ["S1"]]);
  assert.equal(normalized.receipt?.version, "report-block-layout-v1");
});

test("layout normalization cannot rewrite facts, shorten text, or bypass unresolved overflows", () => {
  for (const type of ["fact", "recommendation"]) {
    const candidate = { report: { sections: [{ heading: "Executive Summary",
      blocks: [{ type, text: "x".repeat(3215), sourceIds: ["S1"] }] },
      { heading: "Website", blocks: [] }] } };
    const result = normalizeReportBlockLayout(candidate);
    assert.deepEqual(result.candidate, candidate);
    assert.equal(result.receipt, undefined);
  }
});
