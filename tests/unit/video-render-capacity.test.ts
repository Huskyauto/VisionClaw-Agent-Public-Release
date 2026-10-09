import { test, after } from "node:test";
import assert from "node:assert/strict";
import * as fs from "fs";
import * as path from "path";
import { PgDialect } from "drizzle-orm/pg-core";
import {
  _videoRenderTestHooks,
  type VideoJobState,
} from "../../server/video-job-runner";

const baseState = (jobId: string): VideoJobState => ({
  job_id: jobId,
  tenant_id: 42,
  title: "capacity test",
  status: "rendering",
  total_chapters: 1,
  chapters: [{
    idx: 0,
    title: "Chapter 1",
    scene_count: 1,
    status: "queued",
    attempts: 0,
  }],
  spec: {},
  created_at: Date.now(),
  updated_at: Date.now(),
  concat_attempts: 0,
});

const chapter = { chapterTitle: "Chapter 1", scenes: [{ title: "Scene 1" }] } as any;
const createdJobDirs: string[] = [];

after(() => {
  delete _videoRenderTestHooks.acquireLane;
  delete _videoRenderTestHooks.produceVideo;
  delete _videoRenderTestHooks.timeoutMs;
  delete _videoRenderTestHooks.admissionBackoffMs;
  delete _videoRenderTestHooks.persistState;
  delete _videoRenderTestHooks.heartbeat;
  delete _videoRenderTestHooks.checkStartAuthorization;
  for (const dir of createdJobDirs) fs.rmSync(dir, { recursive: true, force: true });
});

test("a second job defers under contention, then renders after the first releases capacity", async () => {
  let occupied = false;
  let maxActive = 0;
  let activeRenders = 0;
  let rendersStarted = 0;
  let outputId = 0;
  _videoRenderTestHooks.checkStartAuthorization = async () => "owned";
  _videoRenderTestHooks.acquireLane = async (_label, _options) => {
    if (occupied) return null;
    occupied = true;
    return async () => { occupied = false; };
  };
  _videoRenderTestHooks.persistState = () => {};
  _videoRenderTestHooks.produceVideo = async () => {
    rendersStarted += 1;
    activeRenders += 1;
    maxActive = Math.max(maxActive, activeRenders);
    await new Promise((resolve) => setTimeout(resolve, 50));
    activeRenders -= 1;
    const filePath = path.join("/tmp", `video-capacity-${Date.now()}-${++outputId}.mp4`);
    fs.writeFileSync(filePath, Buffer.alloc(8_192, 1));
    return { success: true, filePath, durationSeconds: 1 } as any;
  };

  const first = baseState("vj_capacitytest_jobone");
  const second = baseState("vj_capacitytest_jobtwo");
  for (const state of [first, second]) createdJobDirs.push(path.resolve(process.cwd(), "data", "video-jobs", state.job_id));
  await Promise.all([
    _videoRenderTestHooks.renderChapter!(first, chapter, 0),
    _videoRenderTestHooks.renderChapter!(second, chapter, 0),
  ]);

  assert.equal(maxActive, 1);
  assert.equal(rendersStarted, 2);
  assert.equal(first.chapters[0].status, "done");
  assert.equal(second.chapters[0].status, "done");
});

test("exhausted lane admission leaves the chapter queued without charging a render attempt", async () => {
  _videoRenderTestHooks.checkStartAuthorization = async () => "owned";
  _videoRenderTestHooks.acquireLane = async () => null;
  _videoRenderTestHooks.admissionBackoffMs = [1, 1, 1, 1];
  _videoRenderTestHooks.persistState = () => {};
  let rendersStarted = 0;
  _videoRenderTestHooks.produceVideo = async () => {
    rendersStarted += 1;
    return { success: false, error: "should not run" } as any;
  };

  const state = baseState("vj_capacitytest_deferred");
  const outcome = await _videoRenderTestHooks.renderChapter!(state, chapter, 0);

  assert.equal(outcome, "deferred");
  assert.equal(state.chapters[0].status, "queued");
  assert.equal(state.chapters[0].attempts, 0);
  assert.equal(rendersStarted, 0);
});

test("a render timeout does not release capacity or mark the chapter complete while rendering continues", async () => {
  let released = false;
  let finishRender!: (value: any) => void;
  _videoRenderTestHooks.acquireLane = async () => async () => { released = true; };
  _videoRenderTestHooks.checkStartAuthorization = async () => "owned";
  _videoRenderTestHooks.persistState = () => {};
  _videoRenderTestHooks.timeoutMs = 5;
  _videoRenderTestHooks.produceVideo = () => new Promise((resolve) => { finishRender = resolve; }) as any;

  const state = baseState("vj_capacitytest_timeout");
  const run = _videoRenderTestHooks.renderChapter!(state, chapter, 0);
  await new Promise((resolve) => setTimeout(resolve, 15));

  assert.equal(state.chapters[0].status, "rendering");
  assert.equal(released, false);
  finishRender({ success: false, error: "late render completion" });
  await run;

  assert.equal(state.chapters[0].status, "failed");
  assert.match(state.chapters[0].error || "", /timeout/i);
  assert.equal(released, true);
});

test("a lane-loss notification while rendering prevents successful chapter completion", async () => {
  let onLost: (() => void) | undefined;
  let finishRender!: (value: any) => void;
  _videoRenderTestHooks.acquireLane = async (_label, options) => {
    onLost = options?.onLost;
    return async () => {};
  };
  _videoRenderTestHooks.checkStartAuthorization = async () => "owned";
  _videoRenderTestHooks.persistState = () => {};
  _videoRenderTestHooks.produceVideo = () => new Promise((resolve) => { finishRender = resolve; }) as any;

  const state = baseState("vj_capacitytest_lanelost");
  createdJobDirs.push(path.resolve(process.cwd(), "data", "video-jobs", state.job_id));
  const run = _videoRenderTestHooks.renderChapter!(state, chapter, 0);
  while (!finishRender) await new Promise((resolve) => setTimeout(resolve, 1));

  onLost?.();
  finishRender({ success: false, error: "late render completion" });
  const outcome = await run;

  assert.equal(outcome, "fenced");
  assert.equal(state.chapters[0].status, "failed");
  assert.match(state.chapters[0].error || "", /lane lost/i);
});

test("a stale runner's mirror update cannot overwrite a recovery owner's instance fence", () => {
  const incoming = { tenantId: 42, instanceId: "old-runner", updatedAt: new Date("2026-01-01T00:02:00Z") };
  const query = new PgDialect().sqlToQuery(_videoRenderTestHooks.mirrorConflictWhere!(incoming));
  assert.match(query.sql, /instance_id/);

  const [tenantId, instanceId, updatedAt] = query.params;
  const currentRecoveredRow = {
    tenantId: 42,
    instanceId: "recovery-runner",
    updatedAt: new Date("2026-01-01T00:01:00Z"),
  };
  const allowsUpdate = currentRecoveredRow.tenantId === tenantId
    && currentRecoveredRow.instanceId === instanceId
    && currentRecoveredRow.updatedAt < new Date(updatedAt as string);
  assert.equal(allowsUpdate, false);
});

test("heartbeat database errors are logged and contained", async () => {
  const originalError = console.error;
  const errors: string[] = [];
  _videoRenderTestHooks.heartbeat = async () => { throw new Error("simulated heartbeat outage"); };
  console.error = (...args: any[]) => { errors.push(args.map(String).join(" ")); };
  try {
    await _videoRenderTestHooks.runHeartbeat!(baseState("vj_capacitytest_heartbeat"));
  } finally {
    console.error = originalError;
  }
  assert.ok(errors.some((error) => error.includes("heartbeat failed")));
});

test("a recovery claim racing chapter completion fences the old runner's final done write", async () => {
  let authorizationChecks = 0;
  _videoRenderTestHooks.acquireLane = async () => async () => {};
  _videoRenderTestHooks.checkStartAuthorization = async () => {
    authorizationChecks += 1;
    // Admission checks, post-render check, then the final pre-done CAS check.
    return authorizationChecks >= 4 ? "fenced" : "owned";
  };
  _videoRenderTestHooks.persistState = () => {};
  let outputId = 0;
  _videoRenderTestHooks.produceVideo = async () => {
    const filePath = path.join("/tmp", `video-capacity-race-${Date.now()}-${++outputId}.mp4`);
    fs.writeFileSync(filePath, Buffer.alloc(8_192, 1));
    return { success: true, filePath, durationSeconds: 1 } as any;
  };

  const state = baseState("vj_capacitytest_claimrace");
  createdJobDirs.push(path.resolve(process.cwd(), "data", "video-jobs", state.job_id));
  const outcome = await _videoRenderTestHooks.renderChapter!(state, chapter, 0);

  assert.equal(outcome, "fenced");
  assert.equal(state.chapters[0].status, "rendering");
  assert.equal(authorizationChecks, 4);
});