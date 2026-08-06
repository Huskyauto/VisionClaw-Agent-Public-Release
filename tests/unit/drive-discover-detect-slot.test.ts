/**
 * tests/unit/drive-discover-detect-slot.test.ts
 *
 * Covers `detectSlot` in scripts/lib/drive-discover.ts — the time-of-day parser
 * that makes a same-day morning + evening talk first-class so the weekly recap
 * never collapses the two into one (the bug where one daily talk was dropped).
 *
 * Run: node --import tsx --test tests/unit/drive-discover-detect-slot.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import { detectSlot } from "../../scripts/lib/drive-discover";

// --- morning ------------------------------------------------------------
test("morning keyword", () => {
  assert.equal(detectSlot("2026-05-30 morning.mp4"), "morning");
});
test("am token", () => {
  assert.equal(detectSlot("2026-05-30 am.mp4"), "morning");
});
test("a.m. dotted token", () => {
  assert.equal(detectSlot("clip 2026-05-30 a.m..mov"), "morning");
});
test("sunrise / wake-up synonyms", () => {
  assert.equal(detectSlot("2026-05-30 sunrise walk.mp4"), "morning");
  assert.equal(detectSlot("2026-05-30 wake-up.mp4"), "morning");
});

// --- evening ------------------------------------------------------------
test("evening keyword", () => {
  assert.equal(detectSlot("2026-05-30 evening.mp4"), "evening");
});
test("pm token", () => {
  assert.equal(detectSlot("2026-05-30 pm.mp4"), "evening");
});
test("night / bedtime synonyms", () => {
  assert.equal(detectSlot("2026-05-30 night reflection.mp4"), "evening");
  assert.equal(detectSlot("2026-05-30 bedtime.mp4"), "evening");
});

// --- morning + evening are distinguished on the SAME day -----------------
test("same-day morning and evening resolve to different slots", () => {
  const m = detectSlot("2026-05-30 morning.mp4");
  const e = detectSlot("2026-05-30 evening.mp4");
  assert.equal(m, "morning");
  assert.equal(e, "evening");
  assert.notEqual(m, e);
});

// --- no slot ------------------------------------------------------------
test("undated/unslotted clip → null", () => {
  assert.equal(detectSlot("2026-05-30.mp4"), null);
  assert.equal(detectSlot("daily-clip.mp4"), null);
});
test("'programmer' does not false-match 'am'", () => {
  assert.equal(detectSlot("programmer-notes.mp4"), null);
});

// --- Raw phone-camera compact name derives slot from the capture hour ----
test("compact phone name before noon → morning", () => {
  assert.equal(detectSlot("20260603_073012_75444064.mp4"), "morning");
});
test("compact phone name afternoon/evening → evening", () => {
  assert.equal(detectSlot("20260603_153712_75444064.mp4"), "evening");
});
