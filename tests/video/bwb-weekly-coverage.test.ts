import test from "node:test";
import assert from "node:assert/strict";
import { assertCompleteDriveTranscripts, weeklySourceKey, weeklyVideoId } from "../../scripts/lib/bwb-weekly-coverage";
import { readFileSync } from "node:fs";

const sources = Array.from({ length: 7 }, (_, i) => ({
  fileId: `daily_${i}`, name: `2026-10-${25 + i} Morning.mp4`,
  modifiedTime: "2026-11-01T00:00:00Z",
}));
const transcripts = sources.map(s => ({ videoId: s.fileId, transcript: `Update ${s.fileId}` }));

test("a cached three-clip set cannot satisfy the seven selected uploads", () => {
  assert.throws(() => assertCompleteDriveTranscripts(sources, transcripts.slice(0, 3)), /2026-10-28 Morning.mp4/);
  assert.doesNotThrow(() => assertCompleteDriveTranscripts(sources, transcripts));
  assert.throws(() => assertCompleteDriveTranscripts(sources,
    transcripts.map((t, i) => i === 6 ? { ...t, transcript: " " } : t)), /2026-10-31/);
  assert.throws(() => assertCompleteDriveTranscripts(sources,
    [...transcripts.slice(0, 6), transcripts[0]]), /2026-10-31/);
});

test("source checkpoint identity changes with coverage or revised bytes, not listing order", () => {
  assert.notEqual(weeklySourceKey(sources), weeklySourceKey(sources.slice(0, 3)));
  assert.equal(weeklySourceKey(sources), weeklySourceKey([...sources].reverse()));
  assert.notEqual(weeklySourceKey(sources), weeklySourceKey(
    sources.map((s, i) => i === 0 ? { ...s, modifiedTime: "2026-11-01T01:00:00Z" } : s)));
});

test("corrected coverage cannot reuse delivery identity of a prior three-clip recap", () => {
  const seven = weeklyVideoId("weekly-2026-11-01", weeklySourceKey(sources));
  assert.notEqual(seven, weeklyVideoId("weekly-2026-11-01", weeklySourceKey(sources.slice(0, 3))));
  assert.equal(seven, weeklyVideoId("weekly-2026-11-01", weeklySourceKey([...sources].reverse())));
  assert.notEqual(seven, "weekly-2026-11-01");
});

test("the builder binds both cached stages to sources and requires full coverage before planning", () => {
  const builder = readFileSync("scripts/build-bwb-weekly.ts", "utf8");
  assert.match(builder, /stage: "transcription",\s+unitKey: driveSourceKey/);
  assert.match(builder, /unitKey: \[driveSourceKey, planUnitKey\]/);
  const cacheReturn = builder.indexOf(").then((r) => r.result);");
  assert.ok(cacheReturn >= 0);
  const coverageCheck = builder.indexOf("assertCompleteDriveTranscripts", cacheReturn);
  assert.ok(coverageCheck > cacheReturn && coverageCheck < builder.indexOf('stage: "planning"'));
  assert.match(builder, /s.videoId = weeklyVideoId\(s.videoId, driveSourceKey\)/);
  assert.match(builder, /starting estimates, NOT limits/);
  assert.match(builder, /Add scenes and let the recap run/);
  assert.doesNotMatch(builder, /EXACTLY \$\{targetScenes\}|Math\.min\(22/);
});
