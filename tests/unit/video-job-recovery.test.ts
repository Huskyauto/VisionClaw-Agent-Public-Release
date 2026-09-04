/**
 * Regression coverage for generic video-job recovery.
 *
 * This file deliberately exercises pure/file-local recovery decisions without
 * importing or querying PostgreSQL, so it cannot keep a DB pool alive.
 */
import { test, after } from "node:test";
import assert from "node:assert/strict";
import * as fs from "fs";
import * as path from "path";
import {
  normalizeRenderManifest,
  prepareChaptersForRecovery,
  verifyReusableChapterArtifact,
} from "../../server/video-job-recovery";
import {
  _autoDeliveryTestHooks,
  _recoveryTestHooks,
  claimVideoJobAutoDelivery,
  recoverStaleVideoJobs,
} from "../../server/video-job-runner";
import { toClientRow } from "../../server/routes/video-jobs";

const JOBS_ROOT = path.resolve(process.cwd(), "data", "video-jobs");
const jobId = "vj_recoverytest_validchapter";
const jobDir = path.join(JOBS_ROOT, jobId);

after(() => fs.rmSync(jobDir, { recursive: true, force: true }));

test("recovery reuses only a valid MP4 in the expected chapter slot", () => {
  const expected = path.join(jobDir, "chapters", "chapter_001.mp4");
  fs.mkdirSync(path.dirname(expected), { recursive: true });
  const mp4 = Buffer.alloc(8_192, 0);
  mp4.write("ftyp", 4, "ascii");
  fs.writeFileSync(expected, mp4);

  assert.deepEqual(
    verifyReusableChapterArtifact(jobId, 0, expected),
    { valid: true, path: expected },
  );
});

test("recovery keeps verified chapters and queues corrupted chapters for repair", () => {
  const valid = path.join(jobDir, "chapters", "chapter_001.mp4");
  const corrupt = path.join(jobDir, "chapters", "chapter_002.mp4");
  fs.mkdirSync(path.dirname(valid), { recursive: true });
  const mp4 = Buffer.alloc(8_192, 0);
  mp4.write("ftyp", 4, "ascii");
  fs.writeFileSync(valid, mp4);
  fs.writeFileSync(corrupt, "partial render");

  const result = prepareChaptersForRecovery(jobId, [
    { idx: 0, title: "kept", scene_count: 1, status: "done", file_path: valid, attempts: 1 },
    { idx: 1, title: "repaired", scene_count: 1, status: "done", file_path: corrupt, attempts: 1 },
  ], 2);

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.chapters[0].status, "done");
  assert.equal(result.chapters[1].status, "queued");
  assert.equal(result.chapters[1].file_path, undefined);
  assert.match(result.chapters[1].error || "", /recovery will re-render/i);
});

test("recovery queues a missing completed artifact for repair", () => {
  fs.rmSync(path.join(jobDir, "chapters", "chapter_001.mp4"), { force: true });
  const result = prepareChaptersForRecovery(jobId, [
    { idx: 0, title: "missing", scene_count: 1, status: "done", file_path: path.join(jobDir, "chapters", "chapter_001.mp4"), attempts: 1 },
  ], 1);

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.chapters[0].status, "queued");
  assert.equal(result.chapters[0].file_path, undefined);
});

test("recovery manifest preserves a bounded normalized chapter plan", () => {
  const manifest = normalizeRenderManifest([{
    chapterTitle: "Opening",
    scenes: [{
      title: "Intro frame",
      narration: "A real narration.",
      imagePrompt: "Sunrise over a quiet city.",
      durationOverride: 12,
      qualityTier: "hero",
      videoClipPrompt: "Slow aerial movement.",
    }],
  }]);

  assert.equal(manifest.version, 1);
  assert.equal(manifest.chapters.length, 1);
  assert.deepEqual(manifest.chapters[0].scenes[0], {
    title: "Intro frame",
    narration: "A real narration.",
    imagePrompt: "Sunrise over a quiet city.",
    durationOverride: 12,
    qualityTier: "hero",
    videoClipPrompt: "Slow aerial movement.",
  });
  assert.throws(
    () => normalizeRenderManifest([{ chapterTitle: "bad", scenes: [] }]),
    /at least one scene/i,
  );
});

test("concurrent recovery sweeps resume a stale job only after one atomic claim", async () => {
  const candidate = {
    jobId: "vj_recoverytest_claimrace",
    tenantId: 42,
    title: "claim race",
    status: "rendering",
    totalChapters: 1,
    chapters: [{ idx: 0, title: "one", scene_count: 1, status: "queued", attempts: 0 }],
    spec: { renderManifest: normalizeRenderManifest([{ chapterTitle: "one", scenes: [{ narration: "hello" }] }]) },
    cancelRequested: false,
    createdAt: new Date(),
    updatedAt: new Date(0),
  };
  let claims = 0;
  let resumes = 0;
  _recoveryTestHooks.listStale = async () => [candidate];
  _recoveryTestHooks.claim = async () => (++claims === 1 ? candidate : null);
  _recoveryTestHooks.resume = async (claimed) => {
    assert.equal(claimed.tenantId, 42);
    resumes += 1;
  };
  try {
    const [a, b] = await Promise.all([recoverStaleVideoJobs(), recoverStaleVideoJobs()]);
    assert.equal(claims, 2);
    assert.equal(a.recovered + b.recovered, 1);
    assert.equal(resumes, 1);
  } finally {
    delete _recoveryTestHooks.listStale;
    delete _recoveryTestHooks.claim;
    delete _recoveryTestHooks.resume;
  }
});

test("concurrent recovered finalizers claim customer delivery only once", async () => {
  let claims = 0;
  _autoDeliveryTestHooks.claim = async () => (++claims === 1);
  try {
    const [a, b] = await Promise.all([
      claimVideoJobAutoDelivery("vj_recoverytest_deliveryrace", 42),
      claimVideoJobAutoDelivery("vj_recoverytest_deliveryrace", 42),
    ]);
    assert.deepEqual([a, b].sort(), [false, true]);
    assert.equal(claims, 2);
  } finally {
    delete _autoDeliveryTestHooks.claim;
  }
});

test("delivery claim rejects an invalid tenant before touching the claim seam", async () => {
  let calls = 0;
  _autoDeliveryTestHooks.claim = async () => { calls += 1; return true; };
  try {
    assert.equal(await claimVideoJobAutoDelivery("vj_recoverytest_invalidtenant", 0), false);
    assert.equal(calls, 0);
  } finally {
    delete _autoDeliveryTestHooks.claim;
  }
});

test("cancelled jobs are never claimed or scheduled for recovery", async () => {
  const cancelled = {
    jobId: "vj_recoverytest_cancelled",
    tenantId: 42,
    title: "cancelled",
    status: "rendering",
    totalChapters: 1,
    chapters: [],
    spec: {},
    cancelRequested: true,
    createdAt: new Date(),
    updatedAt: new Date(0),
  };
  let claims = 0;
  _recoveryTestHooks.listStale = async () => [cancelled];
  _recoveryTestHooks.claim = async () => { claims += 1; return cancelled; };
  try {
    assert.deepEqual(await recoverStaleVideoJobs(), { recovered: 0 });
    assert.equal(claims, 0);
  } finally {
    delete _recoveryTestHooks.listStale;
    delete _recoveryTestHooks.claim;
  }
});

test("client job projection strips private render plans and server paths", () => {
  const projected = toClientRow({
    jobId: "vj_recoverytest_projection",
    status: "rendering",
    tenantId: 42,
    finalFilePath: "/workspace/private/output.mp4",
    spec: {
      voice: "onyx",
      renderManifest: { version: 1, chapters: [{ chapterTitle: "private narration", scenes: [] }] },
      backgroundMusicPath: "/workspace/private/music.mp3",
      customerEmail: "customer@example.com",
      customerName: "Private Customer",
      _projectDriveFolderId: "private-folder",
    },
  }, 42);

  assert.equal(projected.finalFilePath, undefined);
  assert.equal(projected.spec.renderManifest, undefined);
  assert.equal((projected.spec as any).backgroundMusicPath, undefined);
  assert.equal((projected.spec as any).customerEmail, undefined);
  assert.equal((projected.spec as any)._projectDriveFolderId, undefined);
  assert.equal(projected.spec.voice, "onyx");
});