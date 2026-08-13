/**
 * tests/unit/video-finalize-gate.test.ts — R125+139
 *
 * Regression coverage for finalizeVideoJob's fail-closed branches (72h-review
 * follow-up): corrupt state files, invalid MP4 verification (size / ftyp /
 * duration), "never upload/deliver on failed verification", and the repeated
 * concat-failure escalation (video_concat_failed_repeatedly at >= 3 attempts).
 *
 * DB rule: no test here ever executes a query (node-test pg-pool hang rule).
 * All branches exercised are disk-state driven; concat + incident reporting go
 * through the _finalizeTestHooks seams so ffmpeg and the self-repair loop are
 * never touched.
 */
import { test, after } from "node:test";
import assert from "node:assert/strict";
import * as fs from "fs";
import * as path from "path";
import {
  finalizeVideoJob,
  verifyFinalVideo,
  readJobState,
  _finalizeTestHooks,
  type VideoJobState,
} from "../../server/video-job-runner";

const JOBS_ROOT = path.resolve(process.cwd(), "data", "video-jobs");
const TMP = path.resolve(process.cwd(), "data", "video-jobs", "_gate_test_tmp");
const CREATED: string[] = [];

function makeJobId(suffix: string): string {
  const id = `vj_gatetest_${suffix}`;
  CREATED.push(path.join(JOBS_ROOT, id));
  return id;
}

function writeState(state: VideoJobState): void {
  const dir = path.join(JOBS_ROOT, state.job_id);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "state.json"), JSON.stringify(state));
}

function baseState(jobId: string, over: Partial<VideoJobState> = {}): VideoJobState {
  return {
    job_id: jobId,
    tenant_id: 1,
    title: "gate test",
    status: "ready_to_concat",
    total_chapters: 1,
    chapters: [],
    spec: { uploadToDrive: false },
    created_at: Date.now(),
    updated_at: Date.now(),
    concat_attempts: 0,
    ...over,
  };
}

after(() => {
  delete _finalizeTestHooks.concat;
  delete _finalizeTestHooks.incident;
  for (const d of CREATED) fs.rmSync(d, { recursive: true, force: true });
  fs.rmSync(TMP, { recursive: true, force: true });
});

// ---------- verifyFinalVideo (pure quality gate) ----------

test("verifyFinalVideo rejects a too-small file", () => {
  fs.mkdirSync(TMP, { recursive: true });
  const p = path.join(TMP, "tiny.mp4");
  fs.writeFileSync(p, "not a video");
  const errs = verifyFinalVideo(p, 10);
  assert.ok(errs.some((e) => e.includes("< 4096")), errs.join("; "));
});

test("verifyFinalVideo rejects a big file without MP4 ftyp magic", () => {
  fs.mkdirSync(TMP, { recursive: true });
  const p = path.join(TMP, "notmp4.bin");
  fs.writeFileSync(p, Buffer.alloc(10_000, 0x41));
  const errs = verifyFinalVideo(p, 10);
  assert.ok(errs.some((e) => e.includes("ftyp")), errs.join("; "));
});

test("verifyFinalVideo rejects zero/unknown duration", () => {
  fs.mkdirSync(TMP, { recursive: true });
  const p = path.join(TMP, "nodur.mp4");
  const buf = Buffer.alloc(10_000, 0);
  buf.write("ftyp", 4, "ascii"); // valid magic at bytes 4-8
  fs.writeFileSync(p, buf);
  assert.ok(verifyFinalVideo(p, 0).some((e) => e.includes("duration")));
  assert.ok(verifyFinalVideo(p, undefined).some((e) => e.includes("duration")));
  // and the happy path: valid magic + size + duration = clean
  assert.deepEqual(verifyFinalVideo(p, 12.5), []);
});

test("verifyFinalVideo rejects a missing/unreadable file", () => {
  const errs = verifyFinalVideo(path.join(TMP, "does-not-exist.mp4"), 10);
  assert.ok(errs.some((e) => e.includes("unreadable")), errs.join("; "));
});

// ---------- finalizeVideoJob fail-closed branches ----------

test("invalid job_id format is rejected before any path operation", async () => {
  const r = await finalizeVideoJob({ tenantId: 1, jobId: "../../etc/passwd" });
  assert.equal(r.success, false);
  assert.equal(r.error, "invalid_job_id");
});

test("missing job returns not_found (not corrupt)", async () => {
  const r = await finalizeVideoJob({ tenantId: 1, jobId: "vj_gatetest_never_existed" });
  assert.equal(r.success, false);
  assert.equal(r.error, "not_found");
});

test("corrupt state file returns corrupt_state, never an auth-shaped error", async () => {
  const jobId = makeJobId("corrupt01");
  const dir = path.join(JOBS_ROOT, jobId);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "state.json"), "{ this is not json !!!");
  const r = await finalizeVideoJob({ tenantId: 1, jobId });
  assert.equal(r.success, false);
  assert.equal(r.error, "corrupt_state");
  assert.ok(r.message.includes("CORRUPT"), r.message);
  assert.ok(!/auth|owned/i.test(r.error!));
});

test("failed verification: no delivery, state stays retry-able, incident filed", async () => {
  const jobId = makeJobId("verify01");
  // one "done" chapter whose file exists (content irrelevant — concat is hooked)
  fs.mkdirSync(TMP, { recursive: true });
  const chapterFile = path.join(TMP, "chapter1.mp4");
  fs.writeFileSync(chapterFile, Buffer.alloc(8192, 1));
  // concat "succeeds" but emits a garbage output file (simulates overlayFS
  // truncation / ffmpeg partial write)
  const badOut = path.join(TMP, "final-bad.mp4");
  fs.writeFileSync(badOut, "garbage");
  writeState(baseState(jobId, {
    chapters: [{ idx: 0, title: "c1", scene_count: 1, status: "done", file_path: chapterFile, attempts: 1 }],
  }));
  const incidents: any[] = [];
  _finalizeTestHooks.concat = async () => ({ success: true, filePath: badOut, durationSeconds: 0, sizeBytes: 7 } as any);
  _finalizeTestHooks.incident = (i) => incidents.push(i);
  try {
    const r = await finalizeVideoJob({ tenantId: 1, jobId });
    assert.equal(r.success, false);
    assert.equal(r.status, "ready_to_concat"); // retry-able, NOT done/failed
    assert.ok(String(r.error).includes("quality-gate"), String(r.error));
    assert.ok(r.message.includes("NOT uploaded or delivered"), r.message);
    const st = readJobState(jobId)!;
    assert.equal(st.status, "ready_to_concat");
    assert.equal(st.final_file_path, undefined); // never marked delivered
    assert.equal(incidents.length, 1);
    assert.equal(incidents[0].signature, "video_final_failed_quality_gate");
  } finally {
    delete _finalizeTestHooks.concat;
    delete _finalizeTestHooks.incident;
  }
});

test("repeated concat failure (>=3 attempts) escalates video_concat_failed_repeatedly", async () => {
  const jobId = makeJobId("concat3x");
  fs.mkdirSync(TMP, { recursive: true });
  const chapterFile = path.join(TMP, "chapter2.mp4");
  fs.writeFileSync(chapterFile, Buffer.alloc(8192, 1));
  writeState(baseState(jobId, {
    concat_attempts: 2, // this run becomes attempt #3
    chapters: [{ idx: 0, title: "c1", scene_count: 1, status: "done", file_path: chapterFile, attempts: 1 }],
  }));
  const incidents: any[] = [];
  _finalizeTestHooks.concat = async () => ({ success: false, error: "simulated concat failure" } as any);
  _finalizeTestHooks.incident = (i) => incidents.push(i);
  try {
    const r = await finalizeVideoJob({ tenantId: 1, jobId });
    assert.equal(r.success, false);
    assert.equal(r.status, "ready_to_concat");
    assert.equal(incidents.length, 1);
    assert.equal(incidents[0].signature, "video_concat_failed_repeatedly");
    assert.equal(incidents[0].metadata.concatAttempts, 3);
  } finally {
    delete _finalizeTestHooks.concat;
    delete _finalizeTestHooks.incident;
  }
});

test("thrown concat at >=3 attempts also escalates (symmetric with {success:false})", async () => {
  const jobId = makeJobId("concatthrow");
  fs.mkdirSync(TMP, { recursive: true });
  const chapterFile = path.join(TMP, "chapter3.mp4");
  fs.writeFileSync(chapterFile, Buffer.alloc(8192, 1));
  writeState(baseState(jobId, {
    concat_attempts: 2,
    chapters: [{ idx: 0, title: "c1", scene_count: 1, status: "done", file_path: chapterFile, attempts: 1 }],
  }));
  const incidents: any[] = [];
  _finalizeTestHooks.concat = async () => { throw new Error("simulated ffmpeg crash"); };
  _finalizeTestHooks.incident = (i) => incidents.push(i);
  try {
    const r = await finalizeVideoJob({ tenantId: 1, jobId });
    assert.equal(r.success, false);
    assert.equal(r.status, "ready_to_concat");
    assert.equal(incidents.length, 1);
    assert.equal(incidents[0].signature, "video_concat_failed_repeatedly");
    assert.equal(incidents[0].metadata.thrown, true);
  } finally {
    delete _finalizeTestHooks.concat;
    delete _finalizeTestHooks.incident;
  }
});

test("tenant mismatch on an existing job returns not_found (no ownership leak)", async () => {
  const jobId = makeJobId("tenantiso");
  writeState(baseState(jobId, { tenant_id: 42 }));
  const r = await finalizeVideoJob({ tenantId: 1, jobId });
  assert.equal(r.success, false);
  assert.equal(r.error, "not_found");
});
