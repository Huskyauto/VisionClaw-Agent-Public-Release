/**
 * Google Veo / "Gemini Omni Flash" video-clip generation adapter
 *
 * Backs Bob's request to "connect the video system to Gemini Omni Flash" — i.e.
 * the model family powering Google Flow (labs.google/fx/tools/flow). Flow itself
 * is a web UI and has no public API; the underlying model (Veo, Veo-3.x, and
 * whatever Google ships next under the "Omni Flash" name) IS reachable through
 * the `@google/genai` SDK via `ai.models.generateVideos` + the long-running
 * operations poll loop.
 *
 * Default model: `veo-3.1-generate-preview` (verified working against
 * /v1beta/models on a direct Google API key 2026-05-26; showdown report at
 * `data/video-model-comparison/showdown/report.md`).
 *
 * Override via env var when a newer model id becomes available:
 *   GEMINI_OMNI_FLASH_MODEL=veo-3.1-fast-generate-preview   (cheaper/faster)
 *   GEMINI_OMNI_FLASH_MODEL=veo-3.0-generate-001            (previous-gen GA)
 *
 * NOTE: "gemini-omni-flash" was a Bob-vocabulary placeholder; Google never
 * shipped that literal model id. Use the veo-3.x ids above.
 *
 * Gates:
 *   GEMINI_OMNI_FLASH_ENABLED=true                — feature flag (default OFF)
 *   GEMINI_OMNI_FLASH_MODEL=<model id>            — model override
 *   GEMINI_OMNI_FLASH_POLL_INTERVAL_MS=5000       — poll cadence
 *   GEMINI_OMNI_FLASH_TIMEOUT_MS=600000           — hard timeout (10 min)
 *
 * Auth: reuses AI_INTEGRATIONS_GEMINI_API_KEY (or GOOGLE_API_KEY).
 *
 * Failure mode: throws OmniFlashError. Callers MUST catch and fall back to the
 * still-image + Ken Burns path so a model rename or quota error never bricks a
 * render.
 *
 * Smoke test: `npx tsx scripts/smoke-gemini-omni-flash.ts "<prompt>"`
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { randomUUID } from "node:crypto";
import { GoogleGenAI } from "@google/genai";

export type OmniFlashAspect = "16:9" | "9:16" | "1:1";

export interface OmniFlashOptions {
  prompt: string;
  durationSec?: number;          // default 6, capped 1-10 per Veo limits
  aspectRatio?: OmniFlashAspect; // default 16:9
  outDir?: string;               // default os.tmpdir()
  /** Optional reference image (filesystem path or data URL) for image-to-video */
  referenceImagePath?: string;
  /** Override model id for this call (else env GEMINI_OMNI_FLASH_MODEL or default Veo) */
  modelOverride?: string;
  signal?: AbortSignal;
}

export interface OmniFlashResult {
  videoPath: string;
  mimeType: string;
  durationSec: number;
  modelUsed: string;
  latencyMs: number;
  pollAttempts: number;
}

export class OmniFlashError extends Error {
  readonly cause?: unknown;
  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = "OmniFlashError";
    this.cause = cause;
  }
}

// Top-tier Google video model as of May 2026 — Veo 3.1 preview line.
// Verified against /v1beta/models on a direct Google API key on 2026-05-26.
const DEFAULT_MODEL = "veo-3.1-generate-preview";

export function isOmniFlashEnabled(): boolean {
  return (process.env.GEMINI_OMNI_FLASH_ENABLED || "").toLowerCase() === "true";
}

export function getOmniFlashConfig() {
  const model = process.env.GEMINI_OMNI_FLASH_MODEL || DEFAULT_MODEL;
  // Prefer a DIRECT Google API key for Veo — the Replit modelfarm proxy at
  // AI_INTEGRATIONS_GEMINI_BASE_URL exposes image/text generation only and
  // returns INVALID_ENDPOINT for `:predictLongRunning`. When GOOGLE_API_KEY is
  // present (a real AIza... key), bypass the proxy.
  const direct = process.env.GOOGLE_API_KEY || "";
  const proxied = process.env.AI_INTEGRATIONS_GEMINI_API_KEY || "";
  const useDirect = !!direct;
  const apiKey = useDirect ? direct : proxied;
  const baseUrl = useDirect ? undefined : process.env.AI_INTEGRATIONS_GEMINI_BASE_URL;
  // R125+13.16+sec2 — clamp env-derived timing so a bad/empty env var can't
  // produce NaN (which would defeat the deadline check and hot-poll the API
  // every 0ms). parseInt("abc") → NaN; Number.isFinite guards both NaN and
  // ±Infinity. Bounds: 1s ≤ poll ≤ 30s, 30s ≤ timeout ≤ 15min.
  const pollIntervalMs = clampMs(process.env.GEMINI_OMNI_FLASH_POLL_INTERVAL_MS, 5000, 1000, 30_000);
  const timeoutMs = clampMs(process.env.GEMINI_OMNI_FLASH_TIMEOUT_MS, 600_000, 30_000, 900_000);
  return { model, apiKey, baseUrl, useDirect, pollIntervalMs, timeoutMs };
}

function clampMs(raw: string | undefined, fallback: number, min: number, max: number): number {
  const n = raw === undefined ? NaN : parseInt(raw, 10);
  const v = Number.isFinite(n) ? n : fallback;
  return Math.max(min, Math.min(max, v));
}

/**
 * Generate a single video clip via Veo (or whichever model id is configured).
 *
 * Uses the SDK's long-running-operation pattern:
 *   1. POST generateVideos → returns an operation handle
 *   2. Poll operations.getVideosOperation until `done: true`
 *   3. Download the resulting video bytes via ai.files.download
 */
export async function generateOmniFlashClip(opts: OmniFlashOptions): Promise<OmniFlashResult> {
  if (!isOmniFlashEnabled()) {
    throw new OmniFlashError("Gemini Omni Flash / Veo adapter is disabled — set GEMINI_OMNI_FLASH_ENABLED=true");
  }
  const cfg = getOmniFlashConfig();
  const model = opts.modelOverride || cfg.model;
  if (!cfg.apiKey) {
    throw new OmniFlashError("Missing AI_INTEGRATIONS_GEMINI_API_KEY (or GOOGLE_API_KEY)");
  }

  const durationSec = Math.max(1, Math.min(10, opts.durationSec ?? 6));
  const aspectRatio: OmniFlashAspect = opts.aspectRatio ?? "16:9";
  const outDir = opts.outDir || os.tmpdir();
  fs.mkdirSync(outDir, { recursive: true });

  // When GOOGLE_API_KEY is present, hit Google directly (Veo's
  // :predictLongRunning is not on the modelfarm proxy). Otherwise fall back to
  // the proxy path used by the image integration.
  const ai = cfg.useDirect
    ? new GoogleGenAI({ apiKey: cfg.apiKey })
    : new GoogleGenAI({ apiKey: cfg.apiKey, httpOptions: { apiVersion: "", baseUrl: cfg.baseUrl } });

  const request: any = {
    model,
    prompt: opts.prompt,
    config: {
      aspectRatio,
      durationSeconds: durationSec,
      numberOfVideos: 1,
    },
  };

  // Optional image-to-video reference
  if (opts.referenceImagePath) {
    const ref = opts.referenceImagePath;
    if (ref.startsWith("data:")) {
      const m = ref.match(/^data:([^;]+);base64,(.+)$/);
      if (m) request.image = { imageBytes: m[2], mimeType: m[1] };
    } else if (fs.existsSync(ref)) {
      const data = fs.readFileSync(ref).toString("base64");
      const mimeType = ref.toLowerCase().endsWith(".png") ? "image/png" : "image/jpeg";
      request.image = { imageBytes: data, mimeType };
    }
  }

  const t0 = Date.now();
  let operation: any;
  try {
    operation = await ai.models.generateVideos(request);
  } catch (e: any) {
    throw new OmniFlashError(`generateVideos failed (model=${model}): ${e?.message || e}`, e);
  }

  // Poll loop
  let pollAttempts = 0;
  const deadline = t0 + cfg.timeoutMs;
  while (!operation?.done) {
    if (opts.signal?.aborted) throw new OmniFlashError("aborted");
    if (Date.now() > deadline) {
      throw new OmniFlashError(`Veo operation timed out after ${cfg.timeoutMs}ms (model=${model}, op=${operation?.name})`);
    }
    await sleep(cfg.pollIntervalMs);
    pollAttempts++;
    try {
      operation = await ai.operations.getVideosOperation({ operation });
    } catch (e: any) {
      throw new OmniFlashError(`operations.getVideosOperation failed (op=${operation?.name}): ${e?.message || e}`, e);
    }
  }

  if (operation.error) {
    throw new OmniFlashError(`Veo operation error: ${JSON.stringify(operation.error).slice(0, 500)}`);
  }

  const videos = operation.response?.generatedVideos || operation.response?.videos || [];
  const first = videos[0];
  if (!first) {
    throw new OmniFlashError(`Veo operation completed but no videos returned. Response keys: [${Object.keys(operation.response || {}).join(", ")}]`);
  }

  const fileObj = first.video || first;
  const ext = (fileObj.mimeType || "video/mp4").includes("webm") ? "webm" : "mp4";
  const videoPath = path.join(outDir, `veo-${randomUUID()}.${ext}`);

  try {
    // SDK exposes ai.files.download which handles the signed URI + auth
    await ai.files.download({ file: fileObj, downloadPath: videoPath });
  } catch (e: any) {
    // Fall back to manual fetch if the file has a public uri.
    // R125+13.16+sec — architect MEDIUM: API key was previously appended as a
    // ?key= URL param, which can leak into CDN/proxy access logs, redirect
    // chains, and exception cause-traces. Send via x-goog-api-key header
    // instead — same auth model the SDK uses internally.
    const uri = fileObj.uri || fileObj.fileUri;
    if (uri) {
      const res = await fetch(uri, { headers: { "x-goog-api-key": cfg.apiKey } });
      if (!res.ok) {
        throw new OmniFlashError(`Veo video download failed: HTTP ${res.status}`, e);
      }
      const buf = Buffer.from(await res.arrayBuffer());
      fs.writeFileSync(videoPath, buf);
    } else {
      throw new OmniFlashError(`Veo video download failed and no fallback uri: ${e?.message || e}`, e);
    }
  }

  return {
    videoPath,
    mimeType: fileObj.mimeType || "video/mp4",
    durationSec,
    modelUsed: model,
    latencyMs: Date.now() - t0,
    pollAttempts,
  };
}

function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)); }
