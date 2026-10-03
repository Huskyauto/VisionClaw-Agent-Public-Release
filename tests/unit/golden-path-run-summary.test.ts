import assert from "node:assert/strict";
import test from "node:test";
import {
  completeGoldenPathRunRecords,
  formatGoldenPathRunSummary,
} from "../../scripts/lib/golden-path-run-summary";

test("golden-path final summary names every fixture, failure reason, and review link", () => {
  const summary = formatGoldenPathRunSummary([
    {
      id: "html_app_password_generator",
      format: "html_app",
      ran_at: "2026-09-23T08:03:00.000Z",
      ok: false,
      notes: "producer threw: empty output",
    },
    {
      id: "bwb_video_3chapter_multichapter_smoke",
      format: "video",
      ran_at: "2026-09-23T08:04:00.000Z",
      ok: true,
      artifact_size_bytes: 1_718_746,
      archive_view_url: "https://drive.google.com/file/d/video/view",
    },
  ]);

  assert.match(summary, /INCIDENT-SUMMARY/);
  assert.match(summary, /FAIL html_app_password_generator/);
  assert.match(summary, /producer threw: empty output/);
  assert.match(summary, /PASS bwb_video_3chapter_multichapter_smoke/);
  assert.match(summary, /1718746B/);
  assert.match(summary, /https:\/\/drive\.google\.com\/file\/d\/video\/view/);
});

test("golden-path completion records every fixture after an early abort", () => {
  const complete = completeGoldenPathRunRecords(
    [
      {
        id: "first",
        format: "html_app",
        ran_at: "2026-09-23T08:03:00.000Z",
        ok: true,
      },
    ],
    [
      { id: "first", format: "html_app" },
      { id: "second", format: "pdf" },
      { id: "third", format: "video" },
    ],
    "not run: $1 because the replay stopped early",
  );

  assert.deepEqual(complete.map((record) => record.id), ["first", "second", "third"]);
  assert.equal(complete[1].ok, false);
  assert.equal(complete[1].outcome, "not_run");
  assert.equal(complete[1].notes, "not run: second because the replay stopped early");
  assert.equal(complete[2].notes, "not run: third because the replay stopped early");
  const summary = formatGoldenPathRunSummary(complete);
  assert.match(summary, /NOT-RUN second/);
  assert.doesNotMatch(summary, /FAIL second/);
});