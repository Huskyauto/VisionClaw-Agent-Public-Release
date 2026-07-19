/**
 * tests/unit/relevance-window-budget.test.ts
 *
 * Regression for the budget/order bug in extractRelevantWindows(): the line
 * budget MUST be applied while selecting in score order, never after windows
 * are re-sorted into file (source) order — otherwise a tight budget keeps an
 * earlier LOW-relevance window and drops a later HIGH-relevance one purely by
 * file position (the lost-in-the-middle failure). Also pins no-overshoot.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { extractRelevantWindows } from "../../server/lib/relevance-window";

test("tight budget keeps the highest-score window and drops the earlier low-score one", () => {
  // The scorer counts LINES that contain the keyword (not occurrences), so the
  // later window must have more keyword-bearing lines to outscore the earlier one.
  const lines: string[] = [];
  for (let i = 0; i < 600; i++) {
    if (i === 60) lines.push("TARGET here");                              // earlier window: score 1
    else if (i === 500 || i === 510 || i === 520) lines.push("TARGET line"); // later window: score 3
    else lines.push(`filler_${i}`);
  }
  const content = lines.join("\n");

  // header (40) + exactly one 90-line body window fits the budget.
  const out = extractRelevantWindows(content, "TARGET", {
    headerLines: 40,
    windowLines: 90,
    maxWindows: 3,
    maxTotalLines: 40 + 90,
  });

  // The highest-score (later) region must survive truncation...
  assert.ok(out.includes("TARGET line"), "highest-score window must be retained under a tight budget");
  // ...and the lower-score earlier region (line 61, not in the 1-40 header) must be dropped.
  assert.ok(!out.includes("TARGET here"), "lower-score earlier window must be dropped under a tight budget");

  // No overshoot: only the header + one body region were emitted.
  const regionCount = (out.match(/--- relevant region /g) || []).length;
  assert.equal(regionCount, 1, "exactly one body window fits the budget — no overshoot");
});
