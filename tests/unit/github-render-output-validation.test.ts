/**
 * Regression coverage for the GitHub render pre-delivery quality gate.
 *
 * Run: node --import tsx --test tests/unit/github-render-output-validation.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createStableVideoSnapshot, validateRenderedVideo } from "../../scripts/lib/video-output-validation";

const VALID_RENDER = path.resolve(process.cwd(), "data/youtube/video-01-origin-story-v2.mp4");

test("rejects a symlink even when it points to a real video file", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bwb-render-validation-"));
  const real = path.join(dir, "real.mp4");
  const link = path.join(dir, "final.mp4");
  try {
    fs.writeFileSync(real, "not a video");
    fs.symlinkSync(real, link);
    const result = validateRenderedVideo(link);
    assert.equal(result.ok, false);
    assert.match(result.reason, /regular file|symlink/i);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("creates a stable regular-file snapshot for the bytes being delivered", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bwb-render-validation-"));
  const source = path.join(dir, "source.mp4");
  fs.copyFileSync(VALID_RENDER, source);
  const snapshot = createStableVideoSnapshot(source);
  try {
    assert.notEqual(snapshot.filePath, source);
    assert.equal(fs.lstatSync(snapshot.filePath).isFile(), true);
    const snapshotSize = fs.statSync(snapshot.filePath).size;
    fs.writeFileSync(source, "replacement bytes");
    assert.equal(fs.statSync(snapshot.filePath).size, snapshotSize, "snapshot must not change when the source pathname is replaced");
    const result = validateRenderedVideo(snapshot.filePath);
    assert.equal(result.ok, true, result.reason);
  } finally {
    snapshot.cleanup();
    fs.rmSync(dir, { recursive: true, force: true });
  }
  assert.equal(fs.existsSync(snapshot.filePath), false);
});

test("refuses to snapshot a symlink before any delivery can use it", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bwb-render-validation-"));
  const real = path.join(dir, "real.mp4");
  const link = path.join(dir, "final.mp4");
  try {
    fs.writeFileSync(real, "not a video");
    fs.symlinkSync(real, link);
    assert.throws(() => createStableVideoSnapshot(link), /regular file|symlink/i);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("accepts a completed 1920x1080 h264/aac render", () => {
  const result = validateRenderedVideo(VALID_RENDER);
  assert.equal(result.ok, true, result.reason);
  assert.match(result.reason, /h264\/aac 1920x1080/);
});

test("rejects a truncated render artifact", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bwb-render-validation-"));
  const truncated = path.join(dir, "truncated.mp4");
  try {
    const source = fs.openSync(VALID_RENDER, "r");
    try {
      const bytes = Buffer.alloc(1024);
      fs.readSync(source, bytes, 0, bytes.length, 0);
      fs.writeFileSync(truncated, bytes);
    } finally {
      fs.closeSync(source);
    }
    const result = validateRenderedVideo(truncated);
    assert.equal(result.ok, false);
    assert.match(result.reason, /ffprobe|duration|metadata/i);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("runs the validation gate before importing the delivery pipeline", () => {
  const wrapper = fs.readFileSync(path.resolve(process.cwd(), "scripts/bwb-render-github.ts"), "utf8");
  const validation = wrapper.indexOf("validateRenderedVideo(videoSnapshot.filePath)");
  const deliveryImport = wrapper.indexOf('await import("../server/delivery-pipeline")');
  assert.ok(validation >= 0, "GitHub wrapper must validate the rendered MP4");
  assert.ok(deliveryImport > validation, "delivery must not be reached before validation");
  assert.match(wrapper, /deliverDigitalProduct\(\{[\s\S]*?filePath:\s*videoSnapshot\.filePath/);
});