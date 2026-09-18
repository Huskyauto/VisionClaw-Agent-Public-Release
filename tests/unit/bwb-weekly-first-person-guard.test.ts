/**
 * tests/unit/bwb-weekly-first-person-guard.test.ts
 *
 * Covers the first-person net in scripts/lib/bwb-first-person-guard.ts — the
 * fail-closed guard that keeps the weekly recap as Bob talking AS himself to the
 * viewer, never a third-person narrator describing him.
 *
 * Run: node --import tsx --test tests/unit/bwb-weekly-first-person-guard.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  auditFirstPerson,
  isFirstPersonNarration,
  hasThirdPersonSelfReference,
  findThirdPersonOffense,
} from "../../scripts/lib/bwb-first-person-guard";

// --- first-person marker detection -------------------------------------
test("first-person scene is detected", () => {
  assert.equal(isFirstPersonNarration("I woke up at 5am and weighed in."), true);
});
test("possessive 'my' counts as first person", () => {
  assert.equal(isFirstPersonNarration("My morning walk felt easier this week."), true);
});
test("'we/our' counts as first person", () => {
  assert.equal(isFirstPersonNarration("We hit a new milestone and our streak held."), true);
});
test("intro-style 'I am Bob' (name used) is still first person", () => {
  assert.equal(isFirstPersonNarration("I am Bob and this is my week."), true);
});
test("curly-apostrophe contraction is detected", () => {
  assert.equal(isFirstPersonNarration("I’ve kept my protein high."), true);
});
test("'myth' does not false-match 'my'", () => {
  assert.equal(isFirstPersonNarration("The myth about plateaus is everywhere."), false);
});
test("markerless line (no explicit pronoun) is not flagged as first person", () => {
  assert.equal(isFirstPersonNarration("Stayed consistent all week and feeling stronger."), false);
});

// --- third-person self-reference detection -----------------------------
test("'Bob woke up' is third-person self-reference", () => {
  assert.equal(hasThirdPersonSelfReference("Bob woke up at 5am and weighed in."), true);
});
test("possessive 'Bob's journey' is third-person self-reference", () => {
  assert.equal(hasThirdPersonSelfReference("This is Bob's journey to better health."), true);
});
test("mixed 'I watched Bob push through his walk' is STILL third person (names Bob)", () => {
  assert.equal(hasThirdPersonSelfReference("I watched Bob push through his walk."), true);
});
test("bare 'He woke up. His walk...' (no first person) is third person", () => {
  assert.equal(hasThirdPersonSelfReference("He woke up early. His walk was easier."), true);
});
test("'my doctor said he was impressed' is NOT drift (he = someone else, first-person framing)", () => {
  assert.equal(hasThirdPersonSelfReference("My doctor said he was impressed with my progress."), false);
});
test("brand phrase 'Built With Bob' does NOT trip the Bob self-reference", () => {
  assert.equal(hasThirdPersonSelfReference("Welcome back to another Built With Bob update — I feel great."), false);
});

// --- whole-script audit: passing recaps --------------------------------
test("a genuine first-person recap passes", () => {
  const a = auditFirstPerson([
    "I woke up at 5am and weighed in.",
    "My morning walk felt easier this week.",
    "I kept my protein high and it paid off.",
    "We hit a new milestone together.",
  ]);
  assert.equal(a.passes, true);
  assert.equal(a.drift, 0);
  assert.equal(a.firstPerson, 4);
});
test("first-person recap with one neutral markerless line still passes (>=0.7)", () => {
  const a = auditFirstPerson([
    "I woke up early and felt good.",
    "My walk was the best of the week.",
    "I pushed hard on the bike.",
    "Consistency is everything.", // neutral, no pronoun, no Bob/he
  ]);
  assert.equal(a.passes, true); // 3/4 = 0.75 >= 0.7, zero drift
  assert.equal(a.drift, 0);
});
test("brand mention in narration does not fail the audit", () => {
  const a = auditFirstPerson([
    "Welcome back to Built With Bob — I'm feeling strong.",
    "My week was full of long walks.",
    "I rode farther than ever before.",
  ]);
  assert.equal(a.passes, true);
  assert.equal(a.drift, 0);
});

// --- whole-script audit: failing recaps (fail-closed) ------------------
test("a fully third-person recap FAILS closed", () => {
  const a = auditFirstPerson([
    "Bob woke up at 5am.",
    "His morning walk was easier.",
    "Bob kept his protein high.",
    "He reached a milestone.",
  ]);
  assert.equal(a.passes, false);
  assert.ok(a.drift >= 3);
});
test("a SINGLE third-person self-reference fails the whole render", () => {
  const a = auditFirstPerson([
    "I woke up early and felt good.",
    "My walk was great.",
    "I rode the bike hard.",
    "Bob then cooked a healthy dinner.", // one narrator slip
  ]);
  assert.equal(a.passes, false);
  assert.equal(a.drift, 1);
  assert.ok(a.driftExamples.length === 1);
});
test("mixed-perspective narrator ('I watched Bob...') fails despite first-person token", () => {
  const a = auditFirstPerson([
    "I watched Bob push through his walk.",
    "Bob's energy was higher than last week.",
    "He kept going on the bike.",
  ]);
  assert.equal(a.passes, false);
  assert.ok(a.drift >= 2);
});
test("low first-person floor (mostly neutral captions) fails even with zero drift", () => {
  const a = auditFirstPerson([
    "A tough week on the protocol.",
    "Long walks every morning.",
    "Bike rides in the afternoon.",
    "I stayed consistent.", // only 1/4 first person, but no third-person drift
  ]);
  assert.equal(a.drift, 0);
  assert.equal(a.passes, false); // 0.25 < 0.7 floor
});

// --- boundary + empty-input behavior -----------------------------------
test("empty narration list passes (nothing to check, no false alarm)", () => {
  const a = auditFirstPerson([]);
  assert.equal(a.passes, true);
  assert.equal(a.total, 0);
  assert.equal(a.ratio, 1);
});
test("blank/whitespace scenes are ignored", () => {
  const a = auditFirstPerson(["", "   ", "I felt strong today."]);
  assert.equal(a.total, 1);
  assert.equal(a.passes, true);
});
test("exactly-at-threshold ratio (0.7) with zero drift passes", () => {
  // 7 first-person + 3 neutral = 0.7 exactly; threshold is >=
  const fp = ["I a", "I b", "I c", "I d", "I e", "I f", "I g"];
  const neutral = ["walks", "rides", "rest"];
  const a = auditFirstPerson([...fp, ...neutral]);
  assert.equal(a.drift, 0);
  assert.equal(Math.round(a.ratio * 100), 70);
  assert.equal(a.passes, true);
});
test("just-below-threshold ratio fails", () => {
  const fp = ["I a", "I b", "I c", "I d", "I e", "I f"]; // 6
  const neutral = ["walks", "rides", "rest", "more"]; // 4 -> 6/10 = 0.6
  const a = auditFirstPerson([...fp, ...neutral]);
  assert.equal(a.drift, 0);
  assert.equal(a.passes, false);
});

// --- offense localization: error/retry must quote the OFFENDING token ----
test("findThirdPersonOffense points at the bare 'Bob', not the first-person prefix", () => {
  const off = findThirdPersonOffense(
    "Every Thursday I also do a session of infrared therapy on my troubled areas, the way Bob recommends.",
  );
  assert.ok(off);
  assert.equal(off!.token, "Bob");
});
test("findThirdPersonOffense ignores the brand phrase and finds the trailing bare Bob", () => {
  const off = findThirdPersonOffense("Welcome back to Built With Bob — Bob crushed it.");
  assert.ok(off);
  // index must land on the SECOND 'Bob' (the bare self-reference), not the brand one
  assert.equal(off!.token, "Bob");
  assert.ok(off!.index > "Welcome back to Built With Bob".length - 3);
});
test("findThirdPersonOffense returns null for a clean first-person scene", () => {
  assert.equal(findThirdPersonOffense("I woke up and my walk felt great."), null);
});
test("findThirdPersonOffense finds bare he/him/his when no first person present", () => {
  const off = findThirdPersonOffense("He woke up early and his walk was easier.");
  assert.ok(off);
  assert.equal(off!.token.toLowerCase(), "he");
});
test("findThirdPersonOffense brackets the possessive 'Bob’s'", () => {
  const off = findThirdPersonOffense("This week was all about Bob’s comeback.");
  assert.ok(off);
  assert.equal(off!.token, "Bob’s");
  const a = auditFirstPerson(["This week was all about Bob’s comeback."]);
  assert.ok(a.driftExamples[0].includes("[Bob’s]"), a.driftExamples[0]);
});
test("driftExample brackets the offending token even when it sits past char 77", () => {
  const scene =
    "Every Thursday I also do a session of infrared therapy on my troubled areas, the way Bob recommends each week.";
  const a = auditFirstPerson([scene]);
  assert.equal(a.drift, 1);
  // The OLD truncation cut at 77 chars and never showed why it tripped; the new
  // example must surface the bracketed offender so it doesn't look like an FP.
  assert.ok(a.driftExamples[0].includes("[Bob]"), a.driftExamples[0]);
});
