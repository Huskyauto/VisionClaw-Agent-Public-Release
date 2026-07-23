// Multimodal RAG image-summary helpers — pure-function invariants.
//
// Runner: node --import tsx --test (via tests/run.sh).
//
// We deliberately do NOT render PDFs, call the vision LLM, or touch the DB here
// (those need poppler + a model + Postgres). These tests pin the *pure* logic:
// the opt/env gate decision and the agent_knowledge row-shaping, so a refactor
// that flips the default-off behavior or drops the sentinel guard fails CI.

import { test } from "node:test";
import assert from "node:assert/strict";
import { imageSummariesEnabled, buildImageSummaryRows } from "../../server/lib/paper-ingest";

test("imageSummariesEnabled: explicit opt wins over env", () => {
  // opt=true overrides an unset / falsey env
  assert.equal(imageSummariesEnabled({ imageSummaries: true }, {}), true);
  // opt=false overrides a truthy env (explicit disable)
  assert.equal(imageSummariesEnabled({ imageSummaries: false }, { INGEST_PDF_IMAGE_SUMMARIES: "1" }), false);
});

test("imageSummariesEnabled: defaults OFF when neither opt nor env set", () => {
  assert.equal(imageSummariesEnabled({}, {}), false);
  assert.equal(imageSummariesEnabled({}, { INGEST_PDF_IMAGE_SUMMARIES: "" }), false);
  assert.equal(imageSummariesEnabled({}, { INGEST_PDF_IMAGE_SUMMARIES: "0" }), false);
  assert.equal(imageSummariesEnabled({}, { INGEST_PDF_IMAGE_SUMMARIES: "no" }), false);
});

test("imageSummariesEnabled: env flag accepts common truthy spellings", () => {
  for (const v of ["1", "true", "TRUE", "yes", "On", " on "]) {
    assert.equal(imageSummariesEnabled({}, { INGEST_PDF_IMAGE_SUMMARIES: v }), true, `expected ${JSON.stringify(v)} → true`);
  }
});

test("buildImageSummaryRows: shapes title/content/priority per page", () => {
  const rows = buildImageSummaryRows("LEANN", [
    { page: 3, summary: "Architecture diagram: encoder feeds a vector store." },
  ]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].title, "LEANN — figure summary (page 3)");
  assert.match(rows[0].content, /^\[FIGURE \/ IMAGE SUMMARY — page 3\]\n/);
  assert.match(rows[0].content, /encoder feeds a vector store/);
  assert.equal(rows[0].priority, 4);
});

test("buildImageSummaryRows: drops blank and sentinel summaries", () => {
  const rows = buildImageSummaryRows("Paper", [
    { page: 1, summary: "" },
    { page: 2, summary: "   " },
    { page: 4, summary: "NO_SUBSTANTIVE_VISUAL" },
    { page: 5, summary: "Real figure summary." },
  ]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].title, "Paper — figure summary (page 5)");
});
