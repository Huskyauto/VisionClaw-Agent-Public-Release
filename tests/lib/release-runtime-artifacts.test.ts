import test from "node:test";
import assert from "node:assert/strict";
import { isReleaseRuntimeArtifact } from "../../scripts/lib/release-runtime-artifacts";

test("only the exact dated weekly-video job records and generated thumbnail are runtime artifacts", () => {
  for (const file of [
    "data/youtube/scripts/weekly-2026-11-22-src-99ad7170051ff75a.json",
    "data/youtube/scripts/weekly-2026-11-22-src-99ad7170051ff75a.result.json",
    "data/youtube/weekly-2026-11-22-src-99ad7170051ff75a-thumbnail.png",
  ]) assert.equal(isReleaseRuntimeArtifact(file), true, file);

  for (const file of [
    "data/youtube/scripts/weekly-2026-11-22.json",
    "data/youtube/scripts/weekly-2026-11-22.result.json",
    "data/youtube/scripts/weekly-2026-11-22-src-99ad7170051ff75.json",
    "data/youtube/scripts/weekly-2026-11-22-src-99ad7170051ff75a-extra.json",
    "data/youtube/weekly-2026-11-22-thumbnail.png",
    "data/youtube/video-01-thumbnail.png",
    "data/youtube/video-01-origin-story-v2.mp4",
    "data/youtube/brand-style-guide.md",
    "data/youtube/scenes/video-01/scene-1.png",
    "project-assets/brand.png",
  ]) assert.equal(isReleaseRuntimeArtifact(file), false, file);
});
