#!/usr/bin/env tsx
/**
 * scripts/render-worker-smoketest.ts — end-to-end smoketest for the Railway
 * render worker (R110.19). Builds a tiny 2-scene video out of generated test
 * images + silent audio, ships it to the worker, polls until done, downloads
 * the result, and validates the MP4 with the local ffprobe.
 *
 * Reads RENDER_URL + RENDER_ACCESS_KEY from the environment. Run AFTER you
 * deploy the worker to Railway and set both env vars in Replit Secrets.
 *
 * Usage:
 *   npx tsx scripts/render-worker-smoketest.ts
 *
 * Exit codes:
 *   0  — round-trip succeeded, output validated
 *   1  — env vars missing
 *   2  — health check failed
 *   3  — submit / poll / download failed
 *   4  — output validation failed (file missing, too small, no streams)
 */

import { execFileSync } from "child_process";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { getFfmpegPath, getFfprobePath } from "../server/lib/ffmpeg-paths";

const RENDER_URL = (process.env.RENDER_URL || "").replace(/\/+$/, "");
const RENDER_ACCESS_KEY = process.env.RENDER_ACCESS_KEY || "";

if (!RENDER_URL || !RENDER_ACCESS_KEY) {
  console.error("[smoketest] RENDER_URL and RENDER_ACCESS_KEY must be set in env");
  console.error("[smoketest] RENDER_URL=", RENDER_URL || "(empty)");
  console.error("[smoketest] RENDER_ACCESS_KEY=", RENDER_ACCESS_KEY ? "(set)" : "(empty)");
  process.exit(1);
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "render-smoketest-"));
console.log(`[smoketest] tmp dir: ${tmp}`);
console.log(`[smoketest] target: ${RENDER_URL}`);

function ffmpeg(args: string[], timeoutMs = 30_000): void {
  execFileSync(getFfmpegPath(), ["-y", ...args], { timeout: timeoutMs, stdio: "pipe" });
}

function bakeScene(idx: number, color: string, durSec: number): { imagePath: string; audioPath: string } {
  const imagePath = path.join(tmp, `scene_${idx}.png`);
  const audioPath = path.join(tmp, `scene_${idx}.mp3`);
  ffmpeg([
    "-f", "lavfi", "-i", `color=c=${color}:s=1280x720:d=1`,
    "-vf", `drawtext=text='Scene ${idx + 1}':fontsize=120:fontcolor=white:x=(w-text_w)/2:y=(h-text_h)/2`,
    "-frames:v", "1", imagePath,
  ]);
  ffmpeg([
    "-f", "lavfi", "-i", `anullsrc=channel_layout=stereo:sample_rate=44100`,
    "-t", String(durSec), "-c:a", "libmp3lame", "-b:a", "128k", audioPath,
  ]);
  return { imagePath, audioPath };
}

async function main() {
  console.log("[smoketest] step 1/5: ffmpeg health check (local) — baking 2 test scenes");
  const scene0 = bakeScene(0, "darkblue", 2.0);
  const scene1 = bakeScene(1, "darkred", 2.0);

  console.log("[smoketest] step 2/5: GET /healthz");
  const health = await fetch(`${RENDER_URL}/healthz`);
  if (!health.ok) {
    console.error(`[smoketest] /healthz returned ${health.status}`);
    process.exit(2);
  }
  const healthBody = await health.json();
  console.log(`[smoketest]   ok — ffmpeg=${healthBody.ffmpeg?.slice(0, 60)}, queue=${JSON.stringify(healthBody.queue)}`);

  console.log("[smoketest] step 3/5: POST /v1/render");
  const manifest = {
    resolution: "1280x720",
    fps: 30,
    transition: "fade",
    crossfadeMs: 400,
    outputName: "smoketest.mp4",
    scenes: [{ durationSec: 2.0 }, { durationSec: 2.0 }],
  };
  const form = new FormData();
  form.append("manifest", JSON.stringify(manifest));
  form.append("scene_0_image", new Blob([new Uint8Array(fs.readFileSync(scene0.imagePath))]), "scene_0.png");
  form.append("scene_0_audio", new Blob([new Uint8Array(fs.readFileSync(scene0.audioPath))]), "scene_0.mp3");
  form.append("scene_1_image", new Blob([new Uint8Array(fs.readFileSync(scene1.imagePath))]), "scene_1.png");
  form.append("scene_1_audio", new Blob([new Uint8Array(fs.readFileSync(scene1.audioPath))]), "scene_1.mp3");

  const submit = await fetch(`${RENDER_URL}/v1/render`, {
    method: "POST",
    headers: { Authorization: `Bearer ${RENDER_ACCESS_KEY}` },
    body: form,
  });
  if (!submit.ok) {
    const body = await submit.text().catch(() => "");
    console.error(`[smoketest] submit failed: HTTP ${submit.status} ${body.slice(0, 400)}`);
    process.exit(3);
  }
  const { jobId } = await submit.json() as { jobId: string };
  console.log(`[smoketest]   ok — jobId=${jobId}`);

  console.log("[smoketest] step 4/5: poll /v1/render/:id until done");
  const startedAt = Date.now();
  let final: any = null;
  while (Date.now() - startedAt < 5 * 60 * 1000) {
    await new Promise((r) => setTimeout(r, 2000));
    const r = await fetch(`${RENDER_URL}/v1/render/${jobId}`, { headers: { Authorization: `Bearer ${RENDER_ACCESS_KEY}` } });
    const j = await r.json() as { status: string; error?: string; durationSec?: number; sizeBytes?: number };
    process.stdout.write(`.`);
    if (j.status === "failed") {
      console.error(`\n[smoketest] job failed: ${j.error}`);
      process.exit(3);
    }
    if (j.status === "done") { final = j; break; }
  }
  if (!final) {
    console.error(`\n[smoketest] poll timed out after 5min`);
    process.exit(3);
  }
  const elapsedSec = ((Date.now() - startedAt) / 1000).toFixed(1);
  console.log(`\n[smoketest]   ok — done in ${elapsedSec}s, ${final.sizeBytes} bytes, ${final.durationSec}s output`);

  console.log("[smoketest] step 5/5: download + validate");
  const dl = await fetch(`${RENDER_URL}/v1/render/${jobId}/download`, { headers: { Authorization: `Bearer ${RENDER_ACCESS_KEY}` } });
  if (!dl.ok) { console.error(`[smoketest] download HTTP ${dl.status}`); process.exit(3); }
  const buf = Buffer.from(await dl.arrayBuffer());
  const localPath = path.join(tmp, "smoketest.mp4");
  fs.writeFileSync(localPath, buf);
  if (buf.length < 1024) { console.error(`[smoketest] downloaded file suspiciously small: ${buf.length} bytes`); process.exit(4); }
  try {
    const probeOut = execFileSync(getFfprobePath(), [
      "-v", "error", "-show_entries", "stream=codec_type,codec_name,duration",
      "-of", "default=noprint_wrappers=1", localPath,
    ], { encoding: "utf-8", timeout: 30_000 });
    console.log(`[smoketest]   ok — ffprobe streams:\n${probeOut.split("\n").map((l) => "    " + l).join("\n").trimEnd()}`);
    const hasVideo = /codec_type=video/.test(probeOut);
    const hasAudio = /codec_type=audio/.test(probeOut);
    if (!hasVideo || !hasAudio) {
      console.error(`[smoketest] missing streams: video=${hasVideo} audio=${hasAudio}`);
      process.exit(4);
    }
  } catch (err: any) {
    console.error(`[smoketest] ffprobe failed: ${err.message}`);
    process.exit(4);
  }

  console.log(`\n[smoketest] ✅ ALL CHECKS PASSED — render worker is healthy and producing valid MP4s.`);
  console.log(`[smoketest]    output kept at: ${localPath}`);
}

main().catch((err) => {
  console.error(`[smoketest] fatal: ${err?.message || err}`);
  process.exit(3);
});
