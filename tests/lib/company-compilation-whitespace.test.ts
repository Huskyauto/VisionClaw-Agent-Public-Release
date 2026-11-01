import test from "node:test";
import assert from "node:assert/strict";
import { acceptCompilation, COMPANY_HEADINGS } from "../../server/lib/company-compilation-content";
import { compilationOperations, advanceCompilationMatrix, newCompilationMatrix } from "../../server/lib/company-compilation-matrix";
import { initialPackage } from "../../server/lib/company-report-package-core";
import { hashReportBytes } from "../../server/lib/business-report-evidence";

const source = "Software Integration and Technology Implementation Digital transformation requires careful planning.";
const quote = source.replace("Implementation Digital", "Implementation\nDigital");
function fixture(text = quote, sourceIds = ["S1"]) {
  const state = initialPackage({ company: "Offline example", website: "https://example.com" });
  state.research = { complete: true, coverage: { discovered: 1, reviewed: 1, failed: 0, capped: false },
    evidence: { version: 1, capturedAt: "2026-10-20", sources: [
      { id: "S1", text: source, sha256: hashReportBytes(source), title: "Services",
        url: "https://example.com", kind: "public", retrievedAt: "2026-10-20" },
    ], limitations: [] } };
  const op = compilationOperations()[0];
  const report = { sections: COMPANY_HEADINGS.readiness.map(heading => ({ heading, blocks: [
    { type: "fact", text, sourceIds },
    { type: "recommendation", text: "Assign an operations owner to plan a small pilot and measure the results before expanding. ".repeat(7), sourceIds: ["S1"] },
    { type: "assumption", text: "Assume staff time is available; verify capacity and costs with the owner before proceeding. ".repeat(7), sourceIds: [] },
  ] })), unknowns: ["Internal staffing is not verified."] };
  const raw = { model: op.model, choices: [{ finish_reason: "stop", message: { content: JSON.stringify(report) } }] };
  return { state, op, raw };
}

test("a retained compilation restores source-exact whitespace without another model request", async () => {
  const f = fixture(), original = JSON.stringify(f.raw);
  const matrix = newCompilationMatrix("offline-subject");
  matrix.slots[f.op.key] = { phase: "received", raw: f.raw };
  let requests = 0;
  await advanceCompilationMatrix(matrix, {
    checkpoint: async () => {},
    request: async () => { requests++; throw new Error("No paid calls permitted"); },
    accept: (op, raw) => acceptCompilation(f.state, op, raw),
  });
  assert.equal(requests, 0);
  assert.equal(matrix.slots[f.op.key].phase, "complete");
  const accepted = JSON.parse(matrix.slots[f.op.key].text!);
  assert.equal(accepted.sections[0].blocks[0].text, source);
  assert.equal(JSON.stringify(f.raw), original, "Provider receipt is immutable");
});

test("whitespace recovery never changes words, punctuation or citation authority", () => {
  for (const text of [quote.replace("requires", "guarantees"), quote.replace("planning.", "planning!"),
    quote.replace("requires", "requi res"), quote.replace("\nDigital", "Digital")]) {
    const f = fixture(text);
    assert.throws(() => acceptCompilation(f.state, f.op, f.raw), /Factual quotation/);
  }
  for (const ids of [["S2"], ["S1", "S2"], []]) {
    const f = fixture(quote, ids);
    assert.throws(() => acceptCompilation(f.state, f.op, f.raw), /citation|Factual quotation/);
  }
});
