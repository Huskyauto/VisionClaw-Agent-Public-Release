/**
 * tests/unit/pipeline-checkpoint.test.ts
 *
 * Resume & reconstitution (Task #53) — repair, don't re-run.
 *
 * Pins the core resume/repair contract on the PURE/INJECTED surface (no DB, no
 * LLM, no shell — an in-memory CheckpointStore stands in for Postgres):
 *   1. A completed stage/unit is REUSED — its fn is never called again.
 *   2. Per-unit repair — on resume, ONLY the failed/incomplete unit's fn runs;
 *      its completed siblings are reused.
 *   3. A failure records a `failed` checkpoint and rethrows; the next resume
 *      re-runs exactly that unit.
 *   4. Ghost-safe reuse — a completed checkpoint whose `verify` returns false is
 *      treated as stale and REDONE.
 *   5. Idempotency — running a fully-complete pipeline again is a no-op (every
 *      stage reused, zero fn calls).
 *   6. Pure helpers — buildManifest / isUnitComplete / getArtifact /
 *      firstIncompleteStage.
 *
 * Run: node --import tsx --test tests/unit/pipeline-checkpoint.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ckptKey,
  buildManifest,
  isUnitComplete,
  getArtifact,
  firstIncompleteStage,
  summarize,
  runStage,
  loadManifest,
  openCheckpoints,
  type CheckpointStore,
  type StageCheckpoint,
  type Manifest,
} from "../../server/agentic/pipeline-checkpoint";

/** In-memory CheckpointStore — same load/upsert contract as the DB-backed one,
 * latest-wins keyed by (tenant, job, stage, unit). */
function memStore() {
  const rows = new Map<string, StageCheckpoint & { tenantId: number; jobKey: string; attempts: number }>();
  const k = (t: number, j: string, s: string, u: string) => `${t}|${j}|${ckptKey(s, u)}`;
  const store: CheckpointStore = {
    async load(tenantId, jobKey) {
      return [...rows.values()]
        .filter((r) => r.tenantId === tenantId && r.jobKey === jobKey)
        .map((r) => ({
          stage: r.stage,
          unitKey: r.unitKey,
          status: r.status,
          artifact: r.artifact,
          artifactPath: r.artifactPath ?? null,
          error: r.error ?? null,
          attempts: r.attempts,
        }));
    },
    async upsert(rec) {
      const key = k(rec.tenantId, rec.jobKey, rec.stage, rec.unitKey);
      const prev = rows.get(key);
      rows.set(key, {
        tenantId: rec.tenantId,
        jobKey: rec.jobKey,
        stage: rec.stage,
        unitKey: rec.unitKey,
        status: rec.status,
        artifact: rec.artifact,
        artifactPath: rec.artifactPath ?? null,
        error: rec.error ?? null,
        attempts: (prev?.attempts ?? 0) + 1,
      });
    },
  };
  return { store, rows };
}

test("pure helpers: buildManifest / isUnitComplete / getArtifact", () => {
  const m: Manifest = buildManifest([
    { stage: "render", unitKey: "", status: "completed", artifact: { finalMp4: "a.mp4" }, attempts: 1 },
    { stage: "image_bake", unitKey: "scene-2", status: "failed", artifact: {}, error: "boom", attempts: 2 },
  ]);
  assert.equal(isUnitComplete(m, "render"), true);
  assert.equal(isUnitComplete(m, "image_bake", "scene-2"), false);
  assert.equal(isUnitComplete(m, "nope"), false);
  assert.deepEqual(getArtifact(m, "render"), { finalMp4: "a.mp4" });
  assert.equal(getArtifact(m, "image_bake", "scene-2"), undefined); // failed ⇒ no artifact
});

test("firstIncompleteStage: resume detection over an ordered stage list", () => {
  const stages = ["discovery", "transcription", "planning", "render", "deliver"];
  const m = buildManifest([
    { stage: "discovery", unitKey: "", status: "completed", artifact: {}, attempts: 1 },
    { stage: "transcription", unitKey: "", status: "completed", artifact: {}, attempts: 1 },
    { stage: "planning", unitKey: "", status: "failed", artifact: {}, error: "x", attempts: 1 },
  ]);
  assert.equal(firstIncompleteStage(m, stages), "planning");
  const allDone = buildManifest(stages.map((s) => ({ stage: s, unitKey: "", status: "completed" as const, artifact: {}, attempts: 1 })));
  assert.equal(firstIncompleteStage(allDone, stages), null);
});

test("a completed stage is REUSED — fn never re-runs", async () => {
  const { store } = memStore();
  let calls = 0;
  const run = async () => {
    const m = await loadManifest(store, 1, "job");
    return runStage(store, m, { tenantId: 1, jobKey: "job", stage: "planning" }, async () => {
      calls++;
      return { script: "v1" };
    });
  };
  const first = await run();
  assert.equal(first.reused, false);
  assert.equal(calls, 1);
  const second = await run();
  assert.equal(second.reused, true);
  assert.equal(calls, 1, "fn must not run again for a completed stage");
  assert.deepEqual(second.result, { script: "v1" });
});

test("per-unit repair: only the failed unit re-runs on resume", async () => {
  const { store } = memStore();
  const baked: string[] = [];
  // PASS 1: scene-2 fails partway; scenes 1 and 3 land.
  const m1 = await loadManifest(store, 1, "bwb");
  for (const i of [1, 2, 3]) {
    try {
      await runStage(
        store,
        m1,
        { tenantId: 1, jobKey: "bwb", stage: "image_bake", unitKey: `scene-${i}` },
        async () => {
          if (i === 2) throw new Error("gpt-image timeout");
          baked.push(`scene-${i}`);
          return { imagePath: `scene-${i}.png` };
        },
      );
    } catch {
      /* expected for scene-2 */
    }
  }
  assert.deepEqual(baked, ["scene-1", "scene-3"]);

  // PASS 2 (resume): scenes 1 & 3 reused, ONLY scene-2 re-baked.
  const baked2: string[] = [];
  const reused: string[] = [];
  const m2 = await loadManifest(store, 1, "bwb");
  for (const i of [1, 2, 3]) {
    const { reused: wasReused } = await runStage(
      store,
      m2,
      { tenantId: 1, jobKey: "bwb", stage: "image_bake", unitKey: `scene-${i}` },
      async () => {
        baked2.push(`scene-${i}`);
        return { imagePath: `scene-${i}.png` };
      },
    );
    if (wasReused) reused.push(`scene-${i}`);
  }
  assert.deepEqual(baked2, ["scene-2"], "only the previously-failed unit should re-run");
  assert.deepEqual(reused, ["scene-1", "scene-3"], "completed siblings should be reused");
});

test("failure records a failed checkpoint and rethrows", async () => {
  const { store } = memStore();
  const m = await loadManifest(store, 1, "j");
  await assert.rejects(
    () => runStage(store, m, { tenantId: 1, jobKey: "j", stage: "render" }, async () => { throw new Error("render OOM"); }),
    /render OOM/,
  );
  const after = await loadManifest(store, 1, "j");
  const ck = after.get(ckptKey("render", ""));
  assert.equal(ck?.status, "failed");
  assert.match(String(ck?.error), /render OOM/);
});

test("ghost-safe reuse: a completed checkpoint failing `verify` is REDONE", async () => {
  const { store } = memStore();
  let calls = 0;
  // PASS 1 lands a file artifact.
  const m1 = await loadManifest(store, 1, "g");
  await runStage(
    store,
    m1,
    { tenantId: 1, jobKey: "g", stage: "render", artifactPathOf: (r: any) => r.finalMp4, verify: () => true },
    async () => { calls++; return { finalMp4: "out.mp4" }; },
  );
  assert.equal(calls, 1);
  // PASS 2: the file is "gone" (verify=false) ⇒ must redo despite completed status.
  const m2 = await loadManifest(store, 1, "g");
  const { reused } = await runStage(
    store,
    m2,
    { tenantId: 1, jobKey: "g", stage: "render", artifactPathOf: (r: any) => r.finalMp4, verify: () => false },
    async () => { calls++; return { finalMp4: "out.mp4" }; },
  );
  assert.equal(reused, false);
  assert.equal(calls, 2, "stale (deleted-file) checkpoint must be redone, not reused");
});

test("idempotency: re-running a fully-complete pipeline is a no-op", async () => {
  const { store } = memStore();
  const stages = ["transcription", "planning", "render", "deliver"];
  let calls = 0;
  const runAll = async () => {
    const ck = await openCheckpoints({ tenantId: 1, jobKey: "p", store, log: () => {} });
    for (const s of stages) {
      await ck.stage({ stage: s }, async () => { calls++; return { s }; });
    }
    return ck.summary();
  };
  await runAll();
  assert.equal(calls, 4, "first pass runs every stage once");
  const summary = await runAll();
  assert.equal(calls, 4, "second pass reuses everything — zero new fn calls");
  assert.equal(summary.completed, 4);
  assert.equal(summary.failed, 0);
});

test("openCheckpoints.stage threads tenant/job and reuses across opens", async () => {
  const { store } = memStore();
  let calls = 0;
  const ck1 = await openCheckpoints({ tenantId: 7, jobKey: "weekly", store, log: () => {} });
  const r1 = await ck1.stage({ stage: "transcription" }, async () => { calls++; return { n: 3 }; });
  assert.equal(r1.reused, false);
  // Fresh open (simulates a separate process / retry) sees the persisted state.
  const ck2 = await openCheckpoints({ tenantId: 7, jobKey: "weekly", store, log: () => {} });
  assert.equal(ck2.reused("transcription"), true);
  assert.deepEqual(ck2.artifact("transcription"), { n: 3 });
  const r2 = await ck2.stage({ stage: "transcription" }, async () => { calls++; return { n: 99 }; });
  assert.equal(r2.reused, true);
  assert.equal(calls, 1);
  assert.deepEqual(r2.result, { n: 3 });
  // Tenant isolation: a different tenant under the same job key sees nothing.
  const ckOther = await openCheckpoints({ tenantId: 8, jobKey: "weekly", store, log: () => {} });
  assert.equal(ckOther.reused("transcription"), false);
});

test("summarize counts completed vs failed", () => {
  const m = buildManifest([
    { stage: "a", unitKey: "", status: "completed", artifact: {}, attempts: 1 },
    { stage: "b", unitKey: "u1", status: "completed", artifact: {}, attempts: 1 },
    { stage: "b", unitKey: "u2", status: "failed", artifact: {}, error: "e", attempts: 1 },
  ]);
  assert.deepEqual(summarize(m), { completed: 2, failed: 1, total: 3 });
});
