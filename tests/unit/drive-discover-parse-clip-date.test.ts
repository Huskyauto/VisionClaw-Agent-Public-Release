/**
 * tests/unit/drive-discover-parse-clip-date.test.ts
 *
 * Closes the deferred test-coverage gap for `parseClipDate` in
 * scripts/lib/drive-discover.ts (BWB weekly-clip discovery). The function is
 * security/correctness-sensitive: it picks which Drive clips fall inside the
 * weekly window, and its boundary guards exist specifically so an embedded run
 * of digits or a word like "marathon"/"junk" can't be mis-sliced into a date.
 *
 * Run: node --import tsx --test tests/unit/drive-discover-parse-clip-date.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import { parseClipDate } from "../../scripts/lib/drive-discover";

function ymd(d: Date | null): string | null {
  if (!d) return null;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// --- ISO YYYY-MM-DD ------------------------------------------------------
test("ISO date, bare", () => {
  assert.equal(ymd(parseClipDate("2026-05-30")), "2026-05-30");
});
test("ISO date embedded in a filename", () => {
  assert.equal(ymd(parseClipDate("bwb-2026-05-30-daily.mp4")), "2026-05-30");
});
test("ISO takes precedence over the US slicer (no 26-05-30 mis-parse)", () => {
  // If the US M-D-YY branch ran first it would grab "26-05-30" → 2030.
  const d = parseClipDate("2026-05-30");
  assert.equal(d?.getFullYear(), 2026);
});

// --- US M-D-YY / M-D-YYYY ------------------------------------------------
test("US short year with dashes", () => {
  assert.equal(ymd(parseClipDate("5-30-26")), "2026-05-30");
});
test("US full year with slashes", () => {
  assert.equal(ymd(parseClipDate("clip 5/30/2026.mov")), "2026-05-30");
});

// --- Month name ----------------------------------------------------------
test("Month name, comma form", () => {
  assert.equal(ymd(parseClipDate("May 30, 2026")), "2026-05-30");
});
test("Month name, dashed short year", () => {
  assert.equal(ymd(parseClipDate("May-23-26")), "2026-05-23");
});
test("Abbreviated month, spaced short year", () => {
  assert.equal(ymd(parseClipDate("Jun 5 26 recap")), "2026-06-05");
});

// --- False-match guards (the whole reason this fn is hand-rolled) ---------
test("'marathon' does not false-match the 'mar' month", () => {
  assert.equal(parseClipDate("marathon-training.mp4"), null);
});
test("'junk' does not false-match the 'jun' month", () => {
  assert.equal(parseClipDate("junk-clip.mp4"), null);
});
test("no date at all → null", () => {
  assert.equal(parseClipDate("weekly-recap-final.mp4"), null);
});
test("undelimited digit run is not sliced into a date", () => {
  assert.equal(parseClipDate("v20260530clip.mp4"), null);
});

// --- Invalid / rollover dates are rejected -------------------------------
test("impossible calendar date (Feb 30) → null, not a March rollover", () => {
  assert.equal(parseClipDate("2026-02-30"), null);
});
test("month out of range → null", () => {
  assert.equal(parseClipDate("2026-13-01"), null);
});

// --- Compact phone-camera YYYYMMDD[_HHMMSS] format -----------------------
test("compact YYYYMMDD with HHMMSS + random suffix → date", () => {
  assert.equal(ymd(parseClipDate("20260603_153712_75444064.mp4")), "2026-06-03");
});
test("compact YYYYMMDD alone → date", () => {
  assert.equal(ymd(parseClipDate("20260603.mp4")), "2026-06-03");
});
test("'Copy of' compact phone clip → date", () => {
  assert.equal(ymd(parseClipDate("Copy of 20260530_180103_f914f597.mp4")), "2026-05-30");
});
test("random 8-digit suffix that isn't a valid date → null", () => {
  assert.equal(parseClipDate("clip_75444064.mp4"), null);
});
