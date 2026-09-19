// VisionClaw Render Worker HTTP client (R110.19).
// Modeled on server/camofox-tool.ts. The main app pre-bakes scene images and
// TTS audio (already does this), then ships the bytes to the Railway worker
// for ffmpeg stitching. Worker has ZERO LLM/DB secrets.
//
// If RENDER_URL or RENDER_ACCESS_KEY is missing, isRenderWorkerConfigured()
// returns false and callers fall back to the in-process pipeline.
//
// If the worker is configured but unreachable / errors mid-render, callers
// fall back to in-process. The worker is an optimization, not a hard dep.

import * as fs from "fs";
import * as path from "path";

const RENDER_URL = (process.env.RENDER_URL || "").replace(/\/+$/, "");
const RENDER_ACCESS_KEY = process.env.RENDER_ACCESS_KEY || "";
const RENDER_REQUIRE_AUTH = (process.env.RENDER_REQUIRE_AUTH ?? "true") !== "false";
const HEALTH_CACHE_TTL_MS = 60_000;
const POLL_INTERVAL_MS = 2_000;
const POLL_TIMEOUT_MS = 15 * 60 * 1000;

let healthCache: { ok: boolean; checkedAt: number } | null = null;

// R110.20 — explicit kill-switch independent of URL/key presence. Defaults
// to DISABLED. Bob has to set RENDER_WORKER_ENABLED=true to opt in. This
// prevents stale RENDER_URL/RENDER_ACCESS_KEY env vars from silently
// reactivating the dormant Railway path after R110.20 promoted bundled
// ffmpeg-static to the primary pipeline.
const RENDER_WORKER_ENABLED = (process.env.RENDER_WORKER_ENABLED || "false").toLowerCase() === "true";

export function isRenderWorkerConfigured(): boolean {
  if (!RENDER_WORKER_ENABLED) return false;
  if (!RENDER_URL) return false;
  if (RENDER_REQUIRE_AUTH && !RENDER_ACCESS_KEY) return false;
  return true;
}

export async function isRenderWorkerHealthy(): Promise<boolean> {
  if (!isRenderWorkerConfigured()) return false;
  if (healthCache && Date.now() - healthCache.checkedAt < HEALTH_CACHE_TTL_MS) return healthCache.ok;
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 5_000);
    const r = await fetch(`${RENDER_URL}/healthz`, { signal: ctrl.signal });
    clearTimeout(t);
    const ok = r.ok;
    healthCache = { ok, checkedAt: Date.now() };
    return ok;
  } catch (_err) {
    healthCache = { ok: false, checkedAt: Date.now() };
    return false;
  }
}

export interface RenderSceneSpec {
  imagePath: string;
  audioPath?: string;
  durationSec: number;
}

export interface RenderJobSpec {
  scenes: RenderSceneSpec[];
  resolution: string;
  fps: number;
  transition: "fade" | "wipeleft" | "wiperight" | "slideleft" | "slideright" | "none";
  crossfadeMs: number;
  outputName: string;
}

export interface RenderJobResult {
  outputPath: string;
  durationSec?: number;
  sizeBytes?: number;
}

function authHeaders(): Record<string, string> {
  return RENDER_ACCESS_KEY ? { Authorization: `Bearer ${RENDER_ACCESS_KEY}` } : {};
}

export async function submitRenderJob(spec: RenderJobSpec, localOutputDir: string): Promise<RenderJobResult> {
  if (!isRenderWorkerConfigured()) throw new Error("render worker not configured (RENDER_URL / RENDER_ACCESS_KEY)");
  for (const scene of spec.scenes) {
    if (!fs.existsSync(scene.imagePath)) throw new Error(`scene image missing: ${scene.imagePath}`);
    if (scene.audioPath && !fs.existsSync(scene.audioPath)) throw new Error(`scene audio missing: ${scene.audioPath}`);
  }

  const manifest = {
    resolution: spec.resolution,
    fps: spec.fps,
    transition: spec.transition,
    crossfadeMs: spec.crossfadeMs,
    outputName: spec.outputName,
    scenes: spec.scenes.map((s) => ({ durationSec: s.durationSec, hasAudio: !!s.audioPath })),
  };

  const form = new FormData();
  form.append("manifest", JSON.stringify(manifest));
  for (let i = 0; i < spec.scenes.length; i++) {
    const scene = spec.scenes[i];
    const imgBytes = fs.readFileSync(scene.imagePath);
    form.append(`scene_${i}_image`, new Blob([new Uint8Array(imgBytes)]), path.basename(scene.imagePath));
    if (scene.audioPath) {
      const audBytes = fs.readFileSync(scene.audioPath);
      form.append(`scene_${i}_audio`, new Blob([new Uint8Array(audBytes)]), path.basename(scene.audioPath));
    }
  }

  const submitResp = await fetch(`${RENDER_URL}/v1/render`, {
    method: "POST",
    headers: authHeaders(),
    body: form,
  });
  if (!submitResp.ok) {
    const body = await submitResp.text().catch(() => "");
    throw new Error(`render worker rejected job: HTTP ${submitResp.status} ${body.slice(0, 300)}`);
  }
  const submitJson = (await submitResp.json()) as { jobId: string; status: string };
  const jobId = submitJson.jobId;

  const startedAt = Date.now();
  while (Date.now() - startedAt < POLL_TIMEOUT_MS) {
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    const statusResp = await fetch(`${RENDER_URL}/v1/render/${jobId}`, { headers: authHeaders() });
    if (!statusResp.ok) throw new Error(`render worker poll failed: HTTP ${statusResp.status}`);
    const status = (await statusResp.json()) as {
      status: "queued" | "running" | "done" | "failed";
      error?: string;
      durationSec?: number;
      sizeBytes?: number;
      downloadUrl?: string;
    };
    if (status.status === "failed") throw new Error(`render worker job failed: ${status.error || "unknown"}`);
    if (status.status === "done") {
      fs.mkdirSync(localOutputDir, { recursive: true });
      const localOut = path.join(localOutputDir, spec.outputName);
      const dlResp = await fetch(`${RENDER_URL}/v1/render/${jobId}/download`, { headers: authHeaders() });
      if (!dlResp.ok) throw new Error(`render worker download failed: HTTP ${dlResp.status}`);
      const buf = Buffer.from(await dlResp.arrayBuffer());
      fs.writeFileSync(localOut, buf);
      return { outputPath: localOut, durationSec: status.durationSec, sizeBytes: status.sizeBytes };
    }
  }
  throw new Error(`render worker job ${jobId} timed out after ${POLL_TIMEOUT_MS / 1000}s`);
}
