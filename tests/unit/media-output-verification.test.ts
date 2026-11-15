import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { getFfmpegPath } from "../../server/lib/ffmpeg-paths";
import { sanitizeSpawnEnv } from "../../server/safety/spawn-env-guard";
import { evaluateVideoMetadata, verifyVideoOutput, scanVideoDiagnostic } from "../../server/lib/video-output-verification";
import { createStableVideoSnapshot } from "../../server/lib/video-output-snapshot";

const metadata = {
  format: { duration: "10" },
  streams: [
    { codec_type: "video", codec_name: "h264", width: 320, height: 180, avg_frame_rate: "30/1", pix_fmt: "yuv420p" },
    { codec_type: "audio", codec_name: "aac" },
  ],
};

test("measures the actual streams and rejects a required stream missing from output", () => {
  assert.equal(evaluateVideoMetadata(metadata, { requireAudio: true }).ok, true);
  const missing = evaluateVideoMetadata({ ...metadata, streams: metadata.streams.slice(0, 1) }, { requireAudio: true });
  assert.equal(missing.ok, false);
  assert.equal(missing.checks.find(c => c.name === "audio")?.status, "FAIL");
});

test("optional detector failure is UNKNOWN with declared bounded coverage", async () => {
  const result = await scanVideoDiagnostic("/missing/video.mp4", "black", 120);
  assert.equal(result.status, "UNKNOWN");
  assert.equal(result.required, false);
  assert.deepEqual(result.coverage, { startSeconds: 0, endSeconds: 60, fullVideo: false });
});

test("technical contracts reject mismatches, invalid numbers and malformed metadata", () => {
  for (const contract of [
    { width: 1920 }, { height: 1080 }, { videoCodec: "hevc" }, { audioCodec: "mp3" },
    { pixelFormat: "yuv444p" }, { fps: 60 }, { fps: NaN },
    { expectedDurationSeconds: 25 }, { expectedDurationSeconds: Infinity },
    { expectedDurationSeconds: 10, durationToleranceSeconds: -1 },
  ]) assert.equal(evaluateVideoMetadata(metadata, contract).ok, false, JSON.stringify(contract));
  for (const value of [null, {}, { streams: {} }, { ...metadata, format: { duration: "NaN" } }])
    assert.equal(evaluateVideoMetadata(value).ok, false);
  assert.equal(evaluateVideoMetadata(metadata, { width: 320, height: 180, fps: 30, pixelFormat: "yuv420p", expectedDurationSeconds: 10 }).ok, true);
  assert.equal(evaluateVideoMetadata({ ...metadata, streams: metadata.streams.slice(0, 1) }, { requireAudio: false }).ok, true);
});

test("real synthetic AV, silent intent and exact snapshot bytes are verified without editing originals", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "media-fixture-"));
  try {
    const av = path.join(dir, "av.mp4");
    execFileSync(getFfmpegPath(), ["-v", "error", "-f", "lavfi", "-i", "color=c=blue:s=320x180:r=30",
      "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=44100", "-t", "1",
      "-c:v", "libx264", "-threads", "1", "-pix_fmt", "yuv420p", "-c:a", "aac", av],
    { timeout: 15_000, env: sanitizeSpawnEnv(process.env) });
    const snapshot = createStableVideoSnapshot(av);
    try {
      const report = await verifyVideoOutput(snapshot.filePath, { width: 320, height: 180, requireAudio: true, expectedDurationSeconds: 1 });
      assert.equal(report.ok, true, JSON.stringify(report));
      assert.match(report.identity!.sha256, /^[a-f0-9]{64}$/);
      fs.writeFileSync(av, "source replaced after snapshot");
      const again = await verifyVideoOutput(snapshot.filePath);
      assert.deepEqual(again.identity, report.identity);
      assert.equal(report.checks.find(c => c.name === "freeze")?.status, "SKIPPED");
      const black = await scanVideoDiagnostic(snapshot.filePath, "black", 1);
      assert.equal(black.status, "PASS");
      assert.equal(black.coverage?.fullVideo, true);
    } finally { snapshot.cleanup(); }
    const silent = path.join(dir, "silent.mp4");
    execFileSync(getFfmpegPath(), ["-v", "error", "-f", "lavfi", "-i", "color=c=black:s=320x180:r=30",
      "-t", "3", "-an", "-c:v", "libx264", "-threads", "1", silent],
    { timeout: 15_000, env: sanitizeSpawnEnv(process.env) });
    assert.equal((await verifyVideoOutput(silent)).ok, false);
    assert.equal((await verifyVideoOutput(silent, { requireAudio: false })).ok, true);
    assert.equal((await scanVideoDiagnostic(silent, "black", 3)).status, "WARN", "artistic black is advisory");
    const link = path.join(dir, "link.mp4");
    fs.symlinkSync(silent, link);
    assert.equal((await verifyVideoOutput(link)).ok, false);
    assert.throws(() => createStableVideoSnapshot(link), /regular file/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("probe failure is UNKNOWN and cannot authorize delivery", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "media-verify-"));
  try {
    const file = path.join(dir, "bad.mp4");
    fs.writeFileSync(file, "corrupt media");
    const report = await verifyVideoOutput(file);
    assert.equal(report.ok, false);
    assert.equal(report.checks.find(c => c.name === "probe")?.status, "UNKNOWN");
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
