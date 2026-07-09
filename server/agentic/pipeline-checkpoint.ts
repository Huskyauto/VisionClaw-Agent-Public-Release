/**
 * pipeline-checkpoint.ts — Resume & reconstitution (Task #53).
 *
 * "Repair it and keep moving, don't re-render everything again."
 *
 * A long multi-stage job (BWB weekly recap: discovery → transcription →
 * planning → per-scene image bake → render → stitch → deliver) persists each
 * stage/unit's output durably AS IT COMPLETES. When the job fails partway and
 * is retried, it loads the manifest of completed work, REUSES every finished
 * stage/unit's artifact, REPAIRS only the first incomplete/failed unit, and
 * continues forward — instead of throwing away good work and re-running the
 * whole script from scratch.
 *
 * Design goals:
 *   - Idempotent: safe to re-run any number of times; a fully-complete job is a
 *     no-op that reuses everything.
 *   - Per-unit repair: a stage can be split into UNITS (e.g. one unit per scene
 *     image) so a single failed unit is re-done while its siblings are reused.
 *   - Ghost-safe: a checkpoint that points at a file artifact is only reused if
 *     a caller-supplied `verify` confirms the file still exists (a deleted file
 *     ⇒ redo, never reuse a ghost — the "memory names a file = claim it existed
 *     when written" lesson).
 *   - Loud: logs exactly what it REUSEd vs REDID.
 *
 * The DB-backed store lives behind a tiny `CheckpointStore` interface so the
 * pure resume/repair logic is unit-testable with an in-memory store (no DB, no
 * LLM, no shell — same pattern as repo-surgeon.ts).
 */

import { logSilentCatch } from "../lib/silent-catch";

export type StageStatus = "completed" | "failed";

export interface StageCheckpoint {
  stage: string;
  unitKey: string;
  status: StageStatus;
  artifact: any;
  artifactPath?: string | null;
  error?: string | null;
  attempts: number;
}

/** In-memory view of one job's persisted checkpoints, keyed by stage+unit. */
export type Manifest = Map<string, StageCheckpoint>;

/** Persistence boundary. The DB-backed impl is `dbCheckpointStore()`; tests
 * inject an in-memory one. */
export interface CheckpointStore {
  load(tenantId: number, jobKey: string): Promise<StageCheckpoint[]>;
  upsert(rec: {
    tenantId: number;
    jobKey: string;
    stage: string;
    unitKey: string;
    status: StageStatus;
    artifact: any;
    artifactPath?: string | null;
    error?: string | null;
  }): Promise<void>;
}

/** Stable composite key for the manifest map. NUL separator can't appear in a
 * stage/unit name, so it can never collide. */
export function ckptKey(stage: string, unitKey = ""): string {
  return `${stage}\u0000${unitKey}`;
}

export function buildManifest(rows: StageCheckpoint[]): Manifest {
  const m: Manifest = new Map();
  for (const r of rows) {
    m.set(ckptKey(r.stage, r.unitKey || ""), {
      stage: r.stage,
      unitKey: r.unitKey || "",
      status: r.status,
      artifact: r.artifact ?? {},
      artifactPath: r.artifactPath ?? null,
      error: r.error ?? null,
      attempts: r.attempts ?? 1,
    });
  }
  return m;
}

export function isUnitComplete(m: Manifest, stage: string, unitKey = ""): boolean {
  return m.get(ckptKey(stage, unitKey))?.status === "completed";
}

export function getArtifact<T = any>(m: Manifest, stage: string, unitKey = ""): T | undefined {
  const c = m.get(ckptKey(stage, unitKey));
  return c && c.status === "completed" ? (c.artifact as T) : undefined;
}

/**
 * Resume detection: given the canonical ordered list of stages, return the
 * first one that is NOT completed at the stage level (unit_key=''). Returns
 * null when every stage is complete (the whole job is done).
 */
export function firstIncompleteStage(m: Manifest, orderedStages: string[]): string | null {
  for (const s of orderedStages) {
    if (!isUnitComplete(m, s, "")) return s;
  }
  return null;
}

export function summarize(m: Manifest): { completed: number; failed: number; total: number } {
  let completed = 0;
  let failed = 0;
  for (const c of m.values()) {
    if (c.status === "completed") completed++;
    else if (c.status === "failed") failed++;
  }
  return { completed, failed, total: m.size };
}

export interface RunStageParams<T> {
  tenantId: number;
  jobKey: string;
  stage: string;
  /** Omit / "" for a stage-level checkpoint; set for a per-unit repairable stage. */
  unitKey?: string;
  /** Confirm a reusable artifact is still valid (e.g. its file is still on
   * disk). Returns false ⇒ treat the checkpoint as stale and REDO. */
  verify?: (artifact: T, artifactPath: string | null) => boolean | Promise<boolean>;
  /** Pull a file path out of the produced result to persist for later `verify`. */
  artifactPathOf?: (result: T) => string | null;
  log?: (msg: string) => void;
}

/**
 * Core repair-and-continue primitive. If the stage/unit is already completed
 * (and still valid per `verify`), returns the persisted artifact WITHOUT
 * calling `fn` (`reused: true`). Otherwise runs `fn`, persists the result as a
 * completed checkpoint, and returns it (`reused: false`). On `fn` failure,
 * records a `failed` checkpoint (so the next resume re-runs exactly this unit)
 * and rethrows.
 *
 * The produced artifact MUST be JSON-serializable — store the path/metadata of
 * a media file, never its bytes.
 */
export async function runStage<T>(
  store: CheckpointStore,
  manifest: Manifest,
  params: RunStageParams<T>,
  fn: () => Promise<T>,
): Promise<{ result: T; reused: boolean }> {
  const unitKey = params.unitKey ?? "";
  const label = `${params.stage}${unitKey ? `/${unitKey}` : ""}`;
  const log = params.log ?? (() => {});
  const existing = manifest.get(ckptKey(params.stage, unitKey));

  if (existing && existing.status === "completed") {
    let valid = true;
    if (params.verify) {
      try {
        valid = await params.verify(existing.artifact as T, existing.artifactPath ?? null);
      } catch {
        valid = false;
      }
    }
    if (valid) {
      log(`REUSE ${label} (checkpoint hit, attempts=${existing.attempts})`);
      return { result: existing.artifact as T, reused: true };
    }
    log(`REDO  ${label} (checkpoint stale — artifact missing/invalid)`);
  } else if (existing && existing.status === "failed") {
    log(`REDO  ${label} (prior attempt failed: ${String(existing.error || "").slice(0, 120)})`);
  }

  try {
    const result = await fn();
    const artifactPath = params.artifactPathOf ? params.artifactPathOf(result) : null;
    await store.upsert({
      tenantId: params.tenantId,
      jobKey: params.jobKey,
      stage: params.stage,
      unitKey,
      status: "completed",
      artifact: result,
      artifactPath,
    });
    manifest.set(ckptKey(params.stage, unitKey), {
      stage: params.stage,
      unitKey,
      status: "completed",
      artifact: result,
      artifactPath: artifactPath ?? null,
      error: null,
      attempts: (existing?.attempts ?? 0) + 1,
    });
    log(`DONE  ${label} (persisted checkpoint)`);
    return { result, reused: false };
  } catch (err: any) {
    const message = String(err?.message || err).slice(0, 2000);
    try {
      await store.upsert({
        tenantId: params.tenantId,
        jobKey: params.jobKey,
        stage: params.stage,
        unitKey,
        status: "failed",
        artifact: existing?.artifact ?? {},
        artifactPath: existing?.artifactPath ?? null,
        error: message,
      });
      manifest.set(ckptKey(params.stage, unitKey), {
        stage: params.stage,
        unitKey,
        status: "failed",
        artifact: existing?.artifact ?? {},
        artifactPath: existing?.artifactPath ?? null,
        error: message,
        attempts: (existing?.attempts ?? 0) + 1,
      });
    } catch (_silentErr) { logSilentCatch("server/agentic/pipeline-checkpoint.ts", _silentErr); }
    log(`FAIL  ${label} — ${message.slice(0, 200)}`);
    throw err;
  }
}

/* ─────────────────────────── DB-backed store ─────────────────────────── */

export function dbCheckpointStore(): CheckpointStore {
  return {
    async load(tenantId, jobKey) {
      const { ensurePipelineStageArtifactsTable } = await import("./pipeline-checkpoint-table");
      await ensurePipelineStageArtifactsTable();
      const { db } = await import("../db");
      const { sql } = await import("drizzle-orm");
      const res = await db.execute(sql`
        SELECT stage, unit_key, status, artifact, artifact_path, error, attempts
        FROM pipeline_stage_artifacts
        WHERE tenant_id = ${tenantId} AND job_key = ${jobKey}
      `);
      const rows = ((res as any).rows || res || []) as any[];
      return rows.map((r) => ({
        stage: r.stage,
        unitKey: r.unit_key ?? "",
        status: (r.status === "failed" ? "failed" : "completed") as StageStatus,
        artifact: r.artifact ?? {},
        artifactPath: r.artifact_path ?? null,
        error: r.error ?? null,
        attempts: Number(r.attempts) || 1,
      }));
    },
    async upsert(rec) {
      const { ensurePipelineStageArtifactsTable } = await import("./pipeline-checkpoint-table");
      await ensurePipelineStageArtifactsTable();
      const { db } = await import("../db");
      const { sql } = await import("drizzle-orm");
      // jsonb bound as a serialized literal — Drizzle's sql`` does not auto-cast
      // a JS object/array to jsonb (replit.md schema gotcha).
      const artifactJson = JSON.stringify(rec.artifact ?? {});
      await db.execute(sql`
        INSERT INTO pipeline_stage_artifacts
          (tenant_id, job_key, stage, unit_key, status, artifact, artifact_path, error, attempts, updated_at)
        VALUES
          (${rec.tenantId}, ${rec.jobKey}, ${rec.stage}, ${rec.unitKey}, ${rec.status},
           ${artifactJson}::jsonb, ${rec.artifactPath ?? null}, ${rec.error ?? null}, 1, NOW())
        ON CONFLICT (tenant_id, job_key, stage, unit_key)
        DO UPDATE SET
          status = EXCLUDED.status,
          artifact = EXCLUDED.artifact,
          artifact_path = EXCLUDED.artifact_path,
          error = EXCLUDED.error,
          attempts = pipeline_stage_artifacts.attempts + 1,
          updated_at = NOW()
      `);
    },
  };
}

export async function loadManifest(store: CheckpointStore, tenantId: number, jobKey: string): Promise<Manifest> {
  return buildManifest(await store.load(tenantId, jobKey));
}

export interface PipelineCheckpoints {
  manifest: Manifest;
  store: CheckpointStore;
  jobKey: string;
  tenantId: number;
  /** Run (or reuse) one stage/unit. See runStage. */
  stage<T>(
    params: Omit<RunStageParams<T>, "tenantId" | "jobKey">,
    fn: () => Promise<T>,
  ): Promise<{ result: T; reused: boolean }>;
  reused(stage: string, unitKey?: string): boolean;
  artifact<T = any>(stage: string, unitKey?: string): T | undefined;
  firstIncomplete(orderedStages: string[]): string | null;
  summary(): { completed: number; failed: number; total: number };
}

/**
 * Open the checkpoint manifest for a job and return a terse helper for wiring
 * stages into a script. Defaults to the DB-backed store.
 *
 *   const ck = await openCheckpoints({ tenantId: 1, jobKey: "bwb-weekly-2026-06-01" });
 *   const { result: transcripts } = await ck.stage({ stage: "transcription" }, () => extract(...));
 */
export async function openCheckpoints(opts: {
  tenantId: number;
  jobKey: string;
  store?: CheckpointStore;
  log?: (msg: string) => void;
}): Promise<PipelineCheckpoints> {
  const store = opts.store ?? dbCheckpointStore();
  const log = opts.log ?? ((m: string) => console.log(`[checkpoint:${opts.jobKey}] ${m}`));
  const manifest = await loadManifest(store, opts.tenantId, opts.jobKey);
  return {
    manifest,
    store,
    jobKey: opts.jobKey,
    tenantId: opts.tenantId,
    stage<T>(params: Omit<RunStageParams<T>, "tenantId" | "jobKey">, fn: () => Promise<T>) {
      return runStage<T>(store, manifest, { ...params, tenantId: opts.tenantId, jobKey: opts.jobKey, log: params.log ?? log }, fn);
    },
    reused(stage: string, unitKey = "") {
      return isUnitComplete(manifest, stage, unitKey);
    },
    artifact<T = any>(stage: string, unitKey = "") {
      return getArtifact<T>(manifest, stage, unitKey);
    },
    firstIncomplete(orderedStages: string[]) {
      return firstIncompleteStage(manifest, orderedStages);
    },
    summary() {
      return summarize(manifest);
    },
  };
}

/** Canonical stage order for the BWB weekly recap pipeline. Used by
 * firstIncompleteStage for resume detection + run-log reporting. */
export const BWB_WEEKLY_STAGES = [
  "discovery",
  "transcription",
  "planning",
  "image_bake",
  "render",
  "deliver",
] as const;
