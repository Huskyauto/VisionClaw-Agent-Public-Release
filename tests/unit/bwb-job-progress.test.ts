/**
 * tests/unit/bwb-job-progress.test.ts
 *
 * The Built With Bob WEEKLY RECAP live-progress writer (server/lib/bwb-job-progress.ts)
 * is called from the tool (server process) AND from two detached subprocesses
 * (build-bwb-weekly.ts, bwb-render-github.ts). Its two non-negotiable contracts:
 *
 *   1. NEVER-THROW. A progress write must never break the actual video build.
 *   2. SAFE NO-OP when BWB_JOB_ID is unset (manual CLI runs) or the tenant is
 *      invalid — and it must reach that no-op WITHOUT touching the DB, so a
 *      subprocess with no DB env / no job id can call it unconditionally.
 *
 * These tests pin both contracts query-free (no BWB_JOB_ID → the functions
 * return before any db call, so the pg pool never opens — avoids the run.sh
 * DB-pool exit-124 hang). A second block is a source-level regression that the
 * progress wiring stays present in the three call sites (so it can't be silently
 * dropped by a future edit / the self-healer).
 *
 * Run: node --import tsx --test tests/unit/bwb-job-progress.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  newBwbJobId,
  createBwbJob,
  setBwbPhase,
  updateBwbChapters,
  completeBwbJob,
  failBwbJob,
} from "../../server/lib/bwb-job-progress";

// Guarantee the no-op path: with no BWB_JOB_ID every write returns before the DB.
delete process.env.BWB_JOB_ID;
delete process.env.BWB_TENANT_ID;

test("newBwbJobId mints the vj_ id the video-job-runner accepts", () => {
  const id = newBwbJobId();
  assert.match(id, /^vj_[a-z0-9_]{8,80}$/);
  // unique per call
  assert.notEqual(newBwbJobId(), newBwbJobId());
});

test("all writers no-op (never throw) when BWB_JOB_ID is unset", async () => {
  await assert.doesNotReject(setBwbPhase("Discovering"));
  await assert.doesNotReject(updateBwbChapters([{ idx: 0, title: "Chapter 1", scene_count: 3, status: "queued" }]));
  await assert.doesNotReject(completeBwbJob({ filePath: "/x.mp4", finalDriveUrl: "https://drive" }));
  await assert.doesNotReject(failBwbJob("boom"));
});

test("createBwbJob no-ops on bad job id or non-positive tenant (no DB touch)", async () => {
  await assert.doesNotReject(createBwbJob({ jobId: "not-a-vj-id", tenantId: 1 }));
  await assert.doesNotReject(createBwbJob({ jobId: newBwbJobId(), tenantId: 0 }));
  await assert.doesNotReject(createBwbJob({ jobId: newBwbJobId(), tenantId: -5 }));
});

test("writers fail closed when job id exists but tenant is missing", async () => {
  const jobId = newBwbJobId();
  await assert.doesNotReject(setBwbPhase("Discovering", { jobId }));
  await assert.doesNotReject(updateBwbChapters([], { jobId }));
  await assert.doesNotReject(completeBwbJob({ jobId }));
  await assert.doesNotReject(failBwbJob("boom", jobId));
});

// --- Source-level regression: the progress wiring must stay present ----------
const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");

test("every progress update predicate requires job and tenant", () => {
  const src = read("server/lib/bwb-job-progress.ts");
  assert.match(src, /function scope\(jobId: string, tenantId: number/);
  assert.match(src, /eq\(videoJobs\.jobId, jobId\)[\s\S]*eq\(videoJobs\.tenantId, tenantId\)/);
  assert.doesNotMatch(src, /if \(tid\) clauses\.push/);
});

test("the tool creates the live row + threads env BEFORE spawning", () => {
  const tools = read("server/tools.ts");
  assert.match(tools, /createBwbJob\(\{ jobId: bwbJobId, tenantId: adminTenant/);
  assert.match(tools, /env\.BWB_JOB_ID = bwbJobId/);
  assert.match(tools, /env\.BWB_TENANT_ID = String\(adminTenant\)/);
  assert.match(
    tools,
    /failBwbJob\([\s\S]*?bwbJobId,[\s\S]*?adminTenant,[\s\S]*?\);/,
    "the server-side early-failure watchdog must persist failure with the owning tenant",
  );
});

test("build-bwb-weekly sets phases and chapter progress", () => {
  const src = read("scripts/build-bwb-weekly.ts");
  assert.match(src, /setBwbPhase\("Discovering this week's clips"\)/);
  assert.match(src, /setBwbPhase\(`Transcribing/);
  assert.match(src, /updateBwbChapters\(chapterRows/);
});

test("the github render farm exposes an onProgress sink and reports per-chapter", () => {
  const farm = read("scripts/lib/github-render-farm.ts");
  assert.match(farm, /onProgress\?\: \(p: FarmProgress\) => void/);
  assert.match(farm, /report\(\{[\s\S]*?chapters: sortedJobs\.map/);
});

test("bwb-render-github maps onProgress onto the DB writer", () => {
  const wrap = read("scripts/bwb-render-github.ts");
  assert.match(wrap, /onProgress:/);
  assert.match(wrap, /updateBwbChapters\(p\.chapters/);
  assert.match(wrap, /setBwbPhase\(p\.phase/);
});

test("the orchestrator completes from the sidecar and fails on build/sidecar failure", () => {
  const orch = read("scripts/bwb-weekly-orchestrator.ts");
  // Tolerant of sibling named imports (e.g. `{ failBwbJob, setBwbPhase }`).
  assert.match(orch, /import \{[^}]*\bfailBwbJob\b[^}]*\} from "\.\.\/server\/lib\/bwb-job-progress"/);
  assert.match(orch, /await failBwbJob\(/);
  assert.match(orch, /await completeBwbJob\(\{[\s\S]*?filePath:[\s\S]*?finalDriveUrl:/);
});
