import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_WORDS_PER_SEC,
  TIMING_TOLERANCE_SEC,
  countWords,
  estimateNarrationSeconds,
  wordsPerSec,
  summarizeScenesTiming,
  compareEstimateVsActual,
} from "../../scripts/lib/bwb-narration-timing";

test("countWords handles empty/whitespace/null", () => {
  assert.equal(countWords(""), 0);
  assert.equal(countWords("   "), 0);
  assert.equal(countWords(null), 0);
  assert.equal(countWords(undefined), 0);
  assert.equal(countWords("one  two\tthree\nfour"), 4);
});

test("estimateNarrationSeconds uses the default rate and floors at 1s", () => {
  // 25 words / 2.5 wps = 10s
  assert.equal(estimateNarrationSeconds(Array(25).fill("w").join(" ")), 10);
  // one word still gets a visible slide (floored to 1.0s, not 0.4s)
  assert.equal(estimateNarrationSeconds("hi"), 1.0);
  assert.equal(estimateNarrationSeconds(""), 1.0);
});

test("wordsPerSec honors a sane BWB_NARRATION_WPS override and rejects junk", () => {
  const prev = process.env.BWB_NARRATION_WPS;
  try {
    process.env.BWB_NARRATION_WPS = "3";
    assert.equal(wordsPerSec(), 3);
    // 30 words / 3 wps = 10s
    assert.equal(estimateNarrationSeconds(Array(30).fill("w").join(" ")), 10);

    for (const junk of ["", "  ", "0", "-2", "abc", "NaN"]) {
      process.env.BWB_NARRATION_WPS = junk;
      assert.equal(wordsPerSec(), DEFAULT_WORDS_PER_SEC, `junk "${junk}" should fall back to default`);
    }
    delete process.env.BWB_NARRATION_WPS;
    assert.equal(wordsPerSec(), DEFAULT_WORDS_PER_SEC);
  } finally {
    if (prev === undefined) delete process.env.BWB_NARRATION_WPS;
    else process.env.BWB_NARRATION_WPS = prev;
  }
});

test("summarizeScenesTiming totals words and seconds across scenes", () => {
  const prev = process.env.BWB_NARRATION_WPS;
  delete process.env.BWB_NARRATION_WPS;
  try {
    const t = summarizeScenesTiming([
      { narration: Array(25).fill("w").join(" ") }, // 25 words -> 10s
      { narration: "hi" },                          // 1 word -> floored 1.0s
      { narration: "" },                            // 0 words -> floored 1.0s
    ]);
    assert.equal(t.totalWords, 26);
    assert.equal(t.wps, DEFAULT_WORDS_PER_SEC);
    assert.equal(t.perScene.length, 3);
    assert.equal(t.perScene[0].index, 1);
    assert.equal(t.perScene[0].estSec, 10);
    // 10 + 1 + 1 = 12
    assert.equal(t.totalEstSec, 12);
  } finally {
    if (prev !== undefined) process.env.BWB_NARRATION_WPS = prev;
  }
});

test("compareEstimateVsActual flags drift beyond tolerance, signed delta", () => {
  const ok = compareEstimateVsActual(10, 11.5);
  assert.equal(ok.withinTolerance, true);
  assert.ok(Math.abs(ok.deltaSec - 1.5) < 1e-9);

  const drift = compareEstimateVsActual(10, 13);
  assert.equal(drift.withinTolerance, false);
  assert.ok(Math.abs(drift.deltaSec - 3) < 1e-9);

  // actual shorter than estimate is also drift (negative delta)
  const short = compareEstimateVsActual(10, 7);
  assert.equal(short.withinTolerance, false);
  assert.ok(Math.abs(short.deltaSec - -3) < 1e-9);

  // exactly at tolerance is within
  const edge = compareEstimateVsActual(10, 10 + TIMING_TOLERANCE_SEC);
  assert.equal(edge.withinTolerance, true);
});
