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
import { isBwbWeeklyRecapBrief, buildVideoFromBrief } from "../../server/build-video-from-brief";

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
