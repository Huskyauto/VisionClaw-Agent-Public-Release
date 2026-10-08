/**
 * tests/unit/bwb-weekly-weight-guard.test.ts
 *
 * Covers `findWeightViolations` in scripts/lib/bwb-weight-guard.ts — the
 * fail-closed net that stops the weekly recap from speaking a fabricated weight
 * (the "said 265 lbs when Bob actually gained ~7 lb" bug).
 *
 * Run: node --import tsx --test tests/unit/bwb-weekly-weight-guard.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import { findWeightViolations } from "../../scripts/lib/bwb-weight-guard";

const NONE = new Set<string>();
const FACTS = new Set<string>(["268", "236", "504"]); // current / lost / start

// --- digit + unit -------------------------------------------------------
test("digit+unit weight not in facts is flagged", () => {
  assert.deepEqual(findWeightViolations("I'm at 265 lbs this week.", FACTS), ["265 lbs"]);
});
test("digit+unit weight that IS a fact passes", () => {
  assert.deepEqual(findWeightViolations("The scale read 268 pounds.", FACTS), []);
});
test("with no facts supplied, ANY unit weight is a violation", () => {
  assert.deepEqual(findWeightViolations("Down to 240 lbs.", NONE), ["240 lbs"]);
});

// --- unit-less contextual digit ----------------------------------------
test("'down to 265' (no unit) is flagged", () => {
  assert.deepEqual(findWeightViolations("I'm down to 265 now.", FACTS), ["265 lbs"]);
});
test("'weigh 265' (no unit) is flagged", () => {
  assert.deepEqual(findWeightViolations("I weigh 265 today.", FACTS), ["265 lbs"]);
});
test("'the scale read 265' (no unit) is flagged", () => {
  assert.deepEqual(findWeightViolations("The scale read 265 this morning.", FACTS), ["265 lbs"]);
});
test("contextual fact value passes", () => {
  assert.deepEqual(findWeightViolations("I'm down to 268 now.", FACTS), []);
});

// --- range gate: non-weight numbers must NOT false-match ----------------
test("'down to 30 minutes' is NOT flagged (below weight range)", () => {
  assert.deepEqual(findWeightViolations("I got my walk down to 30 minutes.", FACTS), []);
});
test("generic numbers (steps, minutes, calories context) are ignored", () => {
  assert.deepEqual(
    findWeightViolations("I hit 10000 steps, walked 45 minutes, felt great.", FACTS),
    [],
  );
});

// --- decimals -----------------------------------------------------------
test("decimal digit+unit weight is flagged", () => {
  assert.deepEqual(findWeightViolations("I'm at 268.5 lbs.", FACTS), ["268.5 lbs"]);
});
test("decimal contextual weight is flagged", () => {
  assert.deepEqual(findWeightViolations("I weigh 268.5 today.", FACTS), ["268.5 lbs"]);
});
test("fact stated with .0 decimal still passes", () => {
  assert.deepEqual(findWeightViolations("The scale read 268.0 pounds.", FACTS), []);
});

// --- spelled-out (incl. colloquial unit-dropped) ------------------------
test("spelled-out 'two hundred sixty-five pounds' is flagged as 265", () => {
  assert.deepEqual(findWeightViolations("I'm at two hundred sixty-five pounds.", FACTS), ["265 lbs"]);
});
test("colloquial unit-dropped 'two sixty-five' is flagged as 265", () => {
  assert.deepEqual(findWeightViolations("I'm at two sixty-five now and focused.", FACTS), ["265 lbs"]);
});
test("'five hundred four' that IS a fact passes", () => {
  assert.deepEqual(findWeightViolations("I started at five hundred four pounds.", FACTS), []);
});
test("spelled-out 'one hundred fifty calories' is NOT flagged", () => {
  assert.deepEqual(findWeightViolations("I cut down to one hundred fifty calories.", FACTS), []);
});
test("spelled year 'two thousand twenty six' is NOT flagged", () => {
  assert.deepEqual(findWeightViolations("Here's to two thousand twenty six.", FACTS), []);
});
test("motivational 'one pound at a time' is NOT flagged", () => {
  assert.deepEqual(findWeightViolations("We do this one pound at a time.", FACTS), []);
});
test("low spelled number 'sixty-five minutes' is NOT flagged", () => {
  assert.deepEqual(findWeightViolations("I walked sixty-five minutes today.", FACTS), []);
});

// --- cue-independent unit-less phrasings (all must flag) -----------------
test("'I'm down to 265 now' IS flagged", () => {
  assert.deepEqual(findWeightViolations("I'm down to 265 now.", FACTS), ["265 lbs"]);
});
test("'I'm at 265 now' IS flagged", () => {
  assert.deepEqual(findWeightViolations("I'm at 265 now and feeling better.", FACTS), ["265 lbs"]);
});
test("'I'm currently 265' IS flagged", () => {
  assert.deepEqual(findWeightViolations("I'm currently 265.", FACTS), ["265 lbs"]);
});
test("'sitting at 265 this week' IS flagged", () => {
  assert.deepEqual(findWeightViolations("We are sitting at 265 this week.", FACTS), ["265 lbs"]);
});
test("'up to 265 now' IS flagged", () => {
  assert.deepEqual(findWeightViolations("I'm up to 265 now.", FACTS), ["265 lbs"]);
});
test("no facts supplied: any in-range figure IS flagged", () => {
  assert.deepEqual(findWeightViolations("I'm at 265 now and feeling better.", NONE), ["265 lbs"]);
});

// --- false-positive guard (non-weight in-range numbers) -----------------
test("'down to 150 carbs' is NOT flagged", () => {
  assert.deepEqual(findWeightViolations("I got my diet down to 150 carbs a day.", FACTS), []);
});
test("'150 minutes' is NOT flagged", () => {
  assert.deepEqual(findWeightViolations("Walked 150 minutes this week.", FACTS), []);
});
test("'165 bpm' heart rate is NOT flagged", () => {
  assert.deepEqual(findWeightViolations("My heart rate hit 165 bpm on the bike.", FACTS), []);
});
test("blood pressure '130 over 80' fail-closes (no BP exemption by design)", () => {
  // "X over Y" is irreducibly ambiguous; we fail closed rather than reopen a
  // wrong-weight bypass. 130 is not a supplied fact, so it flags.
  assert.deepEqual(findWeightViolations("My blood pressure was 130 over 80.", FACTS), ["130 lbs"]);
});
test("'265 over 4 pounds higher' comparative IS flagged", () => {
  assert.deepEqual(
    findWeightViolations("I came in at 265 over 4 pounds higher than last Friday.", FACTS),
    ["265 lbs"],
  );
});
test("spelled '265 over 4 pounds higher' comparative IS flagged", () => {
  assert.deepEqual(
    findWeightViolations("I came in at two sixty-five over 4 pounds higher than last Friday.", FACTS),
    ["265 lbs"],
  );
});
test("'265 over the weekend' (time phrase) IS flagged", () => {
  assert.deepEqual(findWeightViolations("I sat at 265 over the weekend.", FACTS), ["265 lbs"]);
});
test("spelled 'two sixty-five over the weekend' IS flagged", () => {
  assert.deepEqual(findWeightViolations("I was at two sixty-five over the weekend.", FACTS), ["265 lbs"]);
});
test("'265 over 7 days' (duration) IS flagged", () => {
  assert.deepEqual(findWeightViolations("I averaged 265 over 7 days this week.", FACTS), ["265 lbs"]);
});
test("'265 over 10 days' (duration) IS flagged", () => {
  assert.deepEqual(findWeightViolations("I held at 265 over 10 days before it dropped.", FACTS), ["265 lbs"]);
});
test("'$300 a month' is NOT flagged", () => {
  assert.deepEqual(findWeightViolations("The medication runs $300 a month.", FACTS), []);
});
test("'200 calories' is NOT flagged", () => {
  assert.deepEqual(findWeightViolations("I cut about 200 calories from dinner.", FACTS), []);
});
test("sub-range number (90 minutes) is NOT flagged", () => {
  assert.deepEqual(findWeightViolations("Cut my workout down to 90 minutes.", FACTS), []);
});
test("year '2026' (4 digits) is NOT flagged", () => {
  assert.deepEqual(findWeightViolations("It's been a great start to 2026.", FACTS), []);
});

// --- clean narration ----------------------------------------------------
test("qualitative recap with no weight figure passes (no facts)", () => {
  assert.deepEqual(
    findWeightViolations("This week was tough but I stayed consistent and feel stronger.", NONE),
    [],
  );
});
test("gained-weight week stated qualitatively passes", () => {
  assert.deepEqual(
    findWeightViolations("The scale went up a little this week, and that's okay.", NONE),
    [],
  );
});
