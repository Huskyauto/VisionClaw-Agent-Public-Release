/**
 * tests/unit/relevance-window.test.ts
 *
 * The code-proposal generator MUST show the proposal LLM a region of the target
 * file it can copy OLD_CODE from verbatim. Feeding only the first 120 lines made
 * proposals against the big server modules (tools.ts, chat-engine.ts) impossible
 * — the relevant code is never in the header, so OLD_CODE never matched and every
 * such proposal was silently dropped (root cause of "experiments but ~0 proposals").
 *
 * These tests pin the relevance-window contract query-free (pure functions, no DB):
 *   1. small files are returned whole,
 *   2. a big file surfaces the header AND the window containing the finding's
 *      keywords, with the matched code present BYTE-FOR-BYTE (so OLD_CODE matches),
 *   3. tokenizeQuery drops stopwords and de-dupes.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { extractRelevantWindows, tokenizeQuery } from "../../server/lib/relevance-window";

test("small file is returned whole, unchanged", () => {
  const content = ["line a", "line b", "line c"].join("\n");
  const out = extractRelevantWindows(content, "anything", { maxTotalLines: 420 });
  assert.equal(out, content);
});

test("big file surfaces header + the window with the matched keyword verbatim", () => {
  const lines: string[] = [];
  for (let i = 0; i < 600; i++) {
    if (i === 350) lines.push("function computeWidgetSalience(input: WidgetInput) {");
    else if (i === 351) lines.push("  return input.score * REORDER_FACTOR; // the bug is here");
    else lines.push(`  const filler_${i} = ${i};`);
  }
  const content = lines.join("\n");
  const out = extractRelevantWindows(content, "computeWidgetSalience REORDER_FACTOR off by one", {
    headerLines: 40,
    windowLines: 90,
    maxWindows: 3,
    maxTotalLines: 300,
  });

  // header present
  assert.match(out, /file header \(lines 1-40\)/);
  // the matched region is surfaced and copyable verbatim
  assert.ok(out.includes("function computeWidgetSalience(input: WidgetInput) {"), "matched line should be present verbatim");
  assert.ok(out.includes("return input.score * REORDER_FACTOR; // the bug is here"));
  // and a line range label is shown for the region
  assert.match(out, /relevant region \(lines \d+-\d+, keyword score \d+\)/);
});

test("big file with no keyword match shows the explicit NO_CODE_CHANGE note", () => {
  const lines: string[] = [];
  for (let i = 0; i < 600; i++) lines.push(`  const unrelated_${i} = ${i};`);
  const out = extractRelevantWindows(lines.join("\n"), "zzz_nonexistent_token_qqq", { maxTotalLines: 300 });
  assert.match(out, /No region of this file matched/);
  assert.match(out, /NO_CODE_CHANGE/);
});

test("tokenizeQuery drops stopwords and de-dupes", () => {
  const toks = tokenizeQuery("The widget and the WIDGET should be reordered with the score");
  assert.ok(toks.includes("widget"));
  assert.ok(toks.includes("reordered"));
  assert.ok(toks.includes("score"));
  assert.ok(!toks.includes("the"));
  assert.ok(!toks.includes("and"));
  assert.ok(!toks.includes("with"));
  // de-duped (WIDGET / widget collapse to one)
  assert.equal(toks.filter((t) => t === "widget").length, 1);
});
