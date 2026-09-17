/**
 * R125+19 — Built With Bob WEEKLY RECAP routing regression tests.
 *
 * Bob watched a "Week of 5-23 to 30 Recap" render generic evergreen chapters
 * (same as prior weeks) one-at-a-time, because the request was routed to the
 * generic build_video_from_brief path — which PLANS chapters from the brief
 * text via an LLM director and never discovers/transcribes this week's actual
 * Drive clips. The fix steers the weekly recap to bwb_weekly_build. Description
 * carve-outs alone are insufficient (tool-pick summaries truncate descriptions
 * before the exception), so the routing is enforced at the buildVideoFromBrief
 * chokepoint via the pure isBwbWeeklyRecapBrief detector.
 *
 * These tests assert the detector fires on real recap phrasings, does NOT
 * divert unrelated narrated videos, and that the live guard short-circuits a
 * recap brief (with the env escape hatch honored).
 *
 * Pure helper + early-return guard — no DB / LLM / render, runs every push.
 */
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { isBwbWeeklyRecapBrief, extractBwbWeekWindow, extractBwbWeightFacts, buildVideoFromBrief } from "../../server/build-video-from-brief";

after(() => { setTimeout(() => process.exit(process.exitCode ?? 0), 50).unref(); });

function withOverride<T>(value: string | undefined, fn: () => T): T {
  const prev = process.env.BWB_BRIEF_RECAP_OVERRIDE_OK;
  if (value === undefined) delete process.env.BWB_BRIEF_RECAP_OVERRIDE_OK;
  else process.env.BWB_BRIEF_RECAP_OVERRIDE_OK = value;
  try { return fn(); } finally {
    if (prev === undefined) delete process.env.BWB_BRIEF_RECAP_OVERRIDE_OK;
    else process.env.BWB_BRIEF_RECAP_OVERRIDE_OK = prev;
  }
}

// ---- detector: real recap phrasings fire -----------------------------------
test("the exact prompt Bob used is detected as a weekly recap", () => {
  assert.equal(isBwbWeeklyRecapBrief("Built With Bob: Week of 5-23 to 30-26 Recap"), true);
});

test("common recap phrasings are detected", () => {
  assert.equal(isBwbWeeklyRecapBrief("this week's Built With Bob recap"), true);
  assert.equal(isBwbWeeklyRecapBrief("BWB weekly recap"), true);
  assert.equal(isBwbWeeklyRecapBrief("make the weekly recap", undefined, true), true); // bwbBrand flag supplies the BWB signal
});

// ---- detector: unrelated videos are NOT diverted ---------------------------
test("a generic non-BWB narrated video is NOT diverted", () => {
  assert.equal(isBwbWeeklyRecapBrief("A cinematic explainer about photosynthesis"), false);
  assert.equal(isBwbWeeklyRecapBrief("Customer testimonial video for Acme Corp"), false);
});

test("a BWB video with no weekly/recap signal is NOT diverted", () => {
  // bwbBrand:true but the brief is a one-off topic — must still render normally.
  assert.equal(isBwbWeeklyRecapBrief("Bob explains how wellness works", undefined, true), false);
});

test("a 'weekly' topic that isn't BWB is NOT diverted", () => {
  assert.equal(isBwbWeeklyRecapBrief("Our weekly sales standup recap for the team"), false);
});

// ---- precision: a BWB video that is weekly OR recap (but not a weekly recap) --
test("BWB weekly content WITHOUT a recap cue is NOT diverted", () => {
  assert.equal(isBwbWeeklyRecapBrief("Built With Bob weekly check-in on mindset", undefined, true), false);
  assert.equal(isBwbWeeklyRecapBrief("Built With Bob weekly recipe ideas", undefined, true), false);
});

test("BWB recap content that isn't weekly is NOT diverted", () => {
  assert.equal(isBwbWeeklyRecapBrief("Built With Bob recap of my first month of progress", undefined, true), false);
});

// ---- live guard: recap brief short-circuits before any render side-effect ----
test("buildVideoFromBrief short-circuits a recap brief to bwb_weekly_build", async () => {
  const r = await withOverride(undefined, () =>
    buildVideoFromBrief({ tenantId: 1, brief: "Built With Bob: Week of 5-23 to 30-26 Recap", bwbBrand: true }),
  );
  assert.equal(r.success, false);
  assert.equal((r as any).error, "use_bwb_weekly_build");
});

test("BWB_BRIEF_RECAP_OVERRIDE_OK=1 lets a recap brief through the guard", async () => {
  // With the override the guard is skipped — we only assert it does NOT return
  // the use_bwb_weekly_build redirect (it proceeds into the normal pipeline).
  const r = await withOverride("1", () =>
    buildVideoFromBrief({ tenantId: 0, brief: "Built With Bob: Week of 5-23 to 30-26 Recap", bwbBrand: true }),
  );
  // tenantId:0 trips the tenant guard AFTER the recap guard is skipped, proving
  // the recap redirect did not fire.
  assert.notEqual((r as any).error, "use_bwb_weekly_build");
});

// ---- extractor: explicit week windows (2026-07-18 wrong-week incident) ------
const NOW = new Date("2026-07-18T23:00:00Z");

test("Bob's exact phrasing 'July 11th through the 18th' extracts the window", () => {
  assert.deepEqual(
    extractBwbWeekWindow("Built With Bob weekly recap July 11th through the 18th", NOW),
    { weekStart: "2026-07-11", weekEnd: "2026-07-18" },
  );
});

test("named-month variants extract", () => {
  assert.deepEqual(extractBwbWeekWindow("recap for July 11 to July 18", NOW), { weekStart: "2026-07-11", weekEnd: "2026-07-18" });
  assert.deepEqual(extractBwbWeekWindow("week of June 28 through 4", NOW), { weekStart: "2026-06-28", weekEnd: "2026-07-04" });
});

test("numeric and ISO variants extract", () => {
  assert.deepEqual(extractBwbWeekWindow("recap 7/11 to 7/18", NOW), { weekStart: "2026-07-11", weekEnd: "2026-07-18" });
  assert.deepEqual(extractBwbWeekWindow("redo 2026-07-11 to 2026-07-18", NOW), { weekStart: "2026-07-11", weekEnd: "2026-07-18" });
});

test("no explicit window returns null (auto-pin remains the default)", () => {
  assert.equal(extractBwbWeekWindow("Built With Bob weekly recap, this week's recap please", NOW), null);
  assert.equal(extractBwbWeekWindow("", NOW), null);
});

test("mis-parse guards: too-long range, invalid dates, reversed order", () => {
  assert.equal(extractBwbWeekWindow("January 1 to March 30", NOW), null);
  assert.equal(extractBwbWeekWindow("2026-07-31 to 2026-07-11", NOW), null);
  assert.equal(extractBwbWeekWindow("February 30 to February 31", NOW), null);
});

test("far-future window rolls back a year (recaps look backward)", () => {
  assert.deepEqual(extractBwbWeekWindow("recap December 1 to December 7", NOW), { weekStart: "2025-12-01", weekEnd: "2025-12-07" });
});

test("Bob's exact prod prompt with arrow separator extracts (wrong-week incident #2)", () => {
  assert.deepEqual(
    extractBwbWeekWindow(
      "Build this week\u2019s Built With Bob weekly recap. Week window 2026-07-12 \u2192 2026-07-18. Weight facts: current 279 lbs, total lost 225lbs, start 504 lbs. Use the weekly builder on the GitHub render farm, auto-discover my Drive daily clips \u2014 don\u2019t hand-write it.",
      NOW,
    ),
    { weekStart: "2026-07-12", weekEnd: "2026-07-18" },
  );
  assert.deepEqual(extractBwbWeekWindow("recap 7/12 -> 7/18", NOW), { weekStart: "2026-07-12", weekEnd: "2026-07-18" });
});

test("weight facts extract from Bob's verbatim prompt (wrong-numbers incident R125+137.37)", () => {
  assert.deepEqual(
    extractBwbWeightFacts(
      "Build this week\u2019s Built With Bob weekly recap. Week window 2026-07-12 \u2192 2026-07-18. Weight facts: current 279 lbs, total lost 225lbs, start 504 lbs. Use the weekly builder on the GitHub render farm, auto-discover my Drive daily clips \u2014 don\u2019t hand-write it.",
    ),
    { currentWeight: 279, totalLost: 225, startWeight: 504 },
  );
});

test("weight facts: labeled variants, partials, and range guards", () => {
  assert.deepEqual(extractBwbWeightFacts("currently 279 pounds, down 225 lbs total, started at 504"), {
    currentWeight: 279, totalLost: 225, startWeight: 504,
  });
  assert.deepEqual(extractBwbWeightFacts("current weight is 279"), { currentWeight: 279 });
  assert.equal(extractBwbWeightFacts("make a recap about week 28 with 12 clips"), null);
  assert.equal(extractBwbWeightFacts("current 5000 lbs"), null); // out of range dropped
  assert.equal(extractBwbWeightFacts(""), null);
});

test("weight facts: mis-parse resistance — non-weight start/down/current numbers do NOT extract (architect R125+137.37)", () => {
  // "start"/"down"/"current" used in non-weight senses must not become weight facts.
  assert.equal(
    extractBwbWeightFacts("start the recap at chapter 3, down to 12 clips, current week is 29"),
    null,
  );
  assert.equal(extractBwbWeightFacts("render started at 504p resolution, down 225 frames"), null);
});

test("ISO range also enforces the 21-day mis-parse guard (architect R125+137.36)", () => {
  assert.equal(extractBwbWeekWindow("2026-01-01 to 2026-12-31", NOW), null);
  assert.equal(extractBwbWeekWindow("2026-07-01 to 2026-08-15", NOW), null);
});

test("explicit years in named-month text are honored, not silently replaced", () => {
  assert.deepEqual(
    extractBwbWeekWindow("recap July 11, 2025 through July 18, 2025", NOW),
    { weekStart: "2025-07-11", weekEnd: "2025-07-18" },
  );
  assert.deepEqual(
    extractBwbWeekWindow("recap 7/11/2025 to 7/18/2025", NOW),
    { weekStart: "2025-07-11", weekEnd: "2025-07-18" },
  );
  // Year on one side only, Dec→Jan rollover
  assert.deepEqual(
    extractBwbWeekWindow("recap December 28, 2025 to January 3", NOW),
    { weekStart: "2025-12-28", weekEnd: "2026-01-03" },
  );
  // Reversed explicit years fail closed
  assert.equal(extractBwbWeekWindow("recap July 11, 2026 to July 18, 2025", NOW), null);
});
