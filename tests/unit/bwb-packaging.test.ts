import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { reviewBwbPackaging, BWB_PACKAGING_INSTRUCTIONS } from "../../scripts/lib/bwb-packaging";

const candidate = (title: string, thumbnailPrompt: string) => ({
  title, thumbnailPrompt, thumbnailText: "ONE SMALL FIX",
  angle: "A specific practical repair", evidence: [{ scene: 1, quote: "I fixed the stuck report" }],
});
const fixture = () => ({
  title: "I fixed my stuck report",
  thumbnailPrompt: "A report before and after repair",
  scenes: [{ narration: "Today I fixed the stuck report without rebuilding the app." }],
  packagingReview: {
    audience: "Solo builders", promise: "See one real repair",
    selected: 0, selectionReason: "Specific and supported; performance is untested.",
    candidates: [
      candidate("I fixed my stuck report", "A report before and after repair"),
      candidate("The report that would not finish", "A frozen progress bar"),
      candidate("One repair, not another rebuild", "A small highlighted change"),
    ],
  },
});

test("three pairs bind to actual narration and selected upload metadata without claiming truth or CTR", () => {
  const result = reviewBwbPackaging(fixture());
  assert.equal(result.status, "traceable");
  assert.equal(result.semanticVerification, "not_established");
  assert.equal(result.audiencePerformance, "untested");
  assert.equal(result.candidates.length, 3);
  assert.match(result.summary, /not approval/i);
  assert.match(BWB_PACKAGING_INSTRUCTIONS, /watch time/i);
});

test("invented quotations, stale selection, repeated copy and malformed input are needs-review", () => {
  for (const mutate of [
    (s: any) => { s.packagingReview.candidates[0].evidence[0].quote = "I earned a million dollars"; },
    (s: any) => { s.title = "I made a million dollars"; },
    (s: any) => { s.thumbnailPrompt = "A different unsupported image"; },
    (s: any) => { s.packagingReview.selected = "0"; },
    (s: any) => { s.packagingReview.candidates[0].thumbnailText = s.title; },
    (s: any) => { s.packagingReview.candidates[0].thumbnailText = "I FIXED"; },
    (s: any) => { s.packagingReview.candidates[0].thumbnailText = "REPORT STUCK"; },
    (s: any) => { s.packagingReview.candidates = []; },
    (s: any) => { s.packagingReview.candidates[0].evidence[0].scene = 999; },
    (s: any) => { s.title = s.packagingReview.candidates[0].title = "I saved $900"; },
  ]) {
    const script = fixture(); mutate(script);
    assert.equal(reviewBwbPackaging(script).status, "needs_review");
  }
  assert.equal(reviewBwbPackaging({ title: "Legacy", scenes: [] }).status, "needs_review");
  assert.equal(reviewBwbPackaging(null).status, "needs_review");
});

test("review identity follows final narration; a literal match is never factual or audience proof", () => {
  const script = fixture();
  const first = reviewBwbPackaging(script);
  script.scenes[0].narration += " I still need independent testing.";
  assert.notEqual(reviewBwbPackaging(script).subjectHash, first.subjectHash);
  script.title = script.packagingReview.candidates[0].title = "This made me a millionaire";
  // A literal checker cannot establish this inference; it MUST retain unknown.
  const unsupportedMeaning = reviewBwbPackaging(script);
  assert.equal(unsupportedMeaning.semanticVerification, "not_established");
  assert.equal(unsupportedMeaning.audiencePerformance, "untested");
});

test("both render backends and weekly generation expose the same review without new generation calls", () => {
  for (const file of ["scripts/build-bwb-video.ts", "scripts/bwb-render-github.ts"]) {
    const source = readFileSync(file, "utf8");
    assert.match(source, /reviewBwbPackaging\(script\)/);
    assert.match(source, /packagingReview: packaging/);
    assert.match(source, /\$\{packaging.summary\}/);
  }
  const weekly = readFileSync("scripts/build-bwb-weekly.ts", "utf8");
  assert.match(weekly, /\$\{BWB_PACKAGING_INSTRUCTIONS\}/);
  assert.match(weekly, /packagingReview: j.packagingReview/);
  const orchestrator = readFileSync("scripts/bwb-weekly-orchestrator.ts", "utf8");
  assert.match(orchestrator, /\$\{packagingSummaryHtml\}/);
  assert.match(orchestrator, /text:[\s\S]*\$\{packagingSummary\}/);
});
