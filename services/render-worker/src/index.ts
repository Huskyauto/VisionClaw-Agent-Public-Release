import express, { type Request, type Response } from "express";
import helmet from "helmet";
import multer from "multer";
import * as fs from "fs";
import * as path from "path";
import { execFileSync } from "child_process";
import { bearerAuth } from "./auth";
import { createJob, getJob, enqueue, queueDepth, QueueFullError } from "./queue";
import { renderManifest, type RenderManifest, type SceneInput } from "./render";

const PORT = parseInt(process.env.PORT || "8080", 10);
const WORK_DIR = process.env.WORK_DIR || "/tmp/render-jobs";
const MAX_UPLOAD_BYTES = parseInt(process.env.RENDER_MAX_UPLOAD_BYTES || String(500 * 1024 * 1024), 10);

fs.mkdirSync(WORK_DIR, { recursive: true });

const app = express();
app.use(helmet({ contentSecurityPolicy: false }));
app.disable("x-powered-by");

const upload = multer({
  dest: path.join(WORK_DIR, "_uploads"),
  limits: { fileSize: MAX_UPLOAD_BYTES, files: 200 },
});

let ffmpegVersion = "unknown";
try {
  ffmpegVersion = execFileSync(process.env.FFMPEG_PATH || "ffmpeg", ["-version"], { encoding: "utf-8", timeout: 10_000 })
    .split("\n")[0]
    .trim();
} catch (err: any) {
  console.error(`[boot] ffmpeg probe failed: ${err?.message || err}`);
}
console.log(`[boot] ffmpeg: ${ffmpegVersion}`);

app.get("/healthz", (_req: Request, res: Response) => {
  const q = queueDepth();
  res.json({ ok: true, ffmpeg: ffmpegVersion, queue: q, uptimeSec: Math.round(process.uptime()) });
});

app.post(
  "/v1/render",
  bearerAuth,
  upload.any(),
  (req: Request, res: Response): void => {
    const files = (req.files as Express.Multer.File[]) || [];
    const manifestField = req.body && req.body.manifest;
    const manifestFile = files.find((f) => f.fieldname === "manifest");
    const manifestRaw: string | undefined = typeof manifestField === "string"
      ? manifestField
      : Array.isArray(manifestField) && typeof manifestField[0] === "string"
        ? manifestField[0]
        : manifestFile
          ? fs.readFileSync(manifestFile.path, "utf-8")
          : undefined;
    if (!manifestRaw) {
      res.status(400).json({ error: "missing 'manifest' field (JSON string in form body)" });
      return;
    }
    let manifest: RenderManifest & { scenes: Array<{ durationSec: number; hasAudio?: boolean }> };
    try {
      manifest = JSON.parse(String(manifestRaw));
    } catch (err: any) {
      res.status(400).json({ error: `manifest is not valid JSON: ${err?.message || err}` });
      return;
    }
    if (!manifest.scenes || !Array.isArray(manifest.scenes) || manifest.scenes.length === 0) {
      res.status(400).json({ error: "manifest.scenes must be a non-empty array" });
      return;
    }

    const job = createJob();
    const jobDir = path.join(WORK_DIR, job.id);
    fs.mkdirSync(jobDir, { recursive: true });

    const sceneInputs: SceneInput[] = [];
    for (let i = 0; i < manifest.scenes.length; i++) {
      const imageFile = files.find((f) => f.fieldname === `scene_${i}_image`);
      if (!imageFile) {
        res.status(400).json({ error: `missing required file 'scene_${i}_image'` });
        return;
      }
      const audioFile = files.find((f) => f.fieldname === `scene_${i}_audio`);
      const ext = (path.extname(imageFile.originalname || "") || ".png").toLowerCase().replace(/[^a-z0-9.]/g, "") || ".png";
      const imageDest = path.join(jobDir, `scene_${i}_image${ext}`);
      fs.renameSync(imageFile.path, imageDest);
      let audioDest: string | undefined;
      if (audioFile) {
        const aext = (path.extname(audioFile.originalname || "") || ".mp3").toLowerCase().replace(/[^a-z0-9.]/g, "") || ".mp3";
        audioDest = path.join(jobDir, `scene_${i}_audio${aext}`);
        fs.renameSync(audioFile.path, audioDest);
      }
      sceneInputs.push({
        imagePath: imageDest,
        audioPath: audioDest,
        durationSec: Number(manifest.scenes[i].durationSec) || 3,
      });
    }

    const fullManifest: RenderManifest = {
      jobId: job.id,
      resolution: manifest.resolution || "1920x1080",
      fps: manifest.fps || 30,
      transition: manifest.transition || "fade",
      crossfadeMs: manifest.crossfadeMs ?? 500,
      outputName: manifest.outputName || `render_${job.id}.mp4`,
    };

    try {
      enqueue(job, () => renderManifest(fullManifest, sceneInputs, jobDir));
    } catch (err) {
      if (err instanceof QueueFullError) {
        try { fs.rmSync(jobDir, { recursive: true, force: true }); } catch (_e) { /* ignore */ }
        res.status(429).set("Retry-After", "30").json({ error: err.message, queueDepth: err.depth, queueCap: err.cap });
        return;
      }
      throw err;
    }
    res.status(202).json({ jobId: job.id, status: job.status, pollUrl: `/v1/render/${job.id}` });
  },
);

app.get("/v1/render/:id", bearerAuth, (req: Request, res: Response): void => {
  const job = getJob(String(req.params.id));
  if (!job) {
    res.status(404).json({ error: "job not found (may have been GC'd; jobs expire after RENDER_JOB_TTL_MS)" });
    return;
  }
  res.json({
    jobId: job.id,
    status: job.status,
    error: job.error,
    durationSec: job.durationSec,
    sizeBytes: job.sizeBytes,
    downloadUrl: job.status === "done" ? `/v1/render/${job.id}/download` : undefined,
  });
});

app.get("/v1/render/:id/download", bearerAuth, (req: Request, res: Response): void => {
  const job = getJob(String(req.params.id));
  if (!job) {
    res.status(404).json({ error: "job not found" });
    return;
  }
  if (job.status !== "done" || !job.outputPath || !fs.existsSync(job.outputPath)) {
    res.status(409).json({ error: `job not ready (status=${job.status})` });
    return;
  }
  res.setHeader("Content-Type", "video/mp4");
  res.setHeader("Content-Length", String(fs.statSync(job.outputPath).size));
  res.setHeader("Accept-Ranges", "bytes");
  fs.createReadStream(job.outputPath).pipe(res);
});

app.use((err: any, _req: Request, res: Response, _next: any) => {
  console.error(`[server] error: ${err?.message || err}`);
  res.status(500).json({ error: String(err?.message || err).slice(0, 500) });
});

const server = app.listen(PORT, () => {
  console.log(`[boot] visionclaw-render-worker listening on :${PORT} (work_dir=${WORK_DIR})`);
});

// R110.19 architect-NIT fix: graceful shutdown. Railway sends SIGTERM on
// every redeploy; without this, in-flight ffmpeg jobs are hard-killed and
// active HTTP connections drop mid-response. We give the server up to 25s
// to drain (Railway's grace window is 30s) before forcing exit. Active
// ffmpeg children will still be SIGKILL'd when the process exits, but the
// 2h TTL GC + main-app fallback handle any orphan jobs cleanly.
function shutdown(signal: string): void {
  console.log(`[shutdown] received ${signal}; draining HTTP server (max 25s)`);
  const forceExit = setTimeout(() => {
    console.warn(`[shutdown] drain timed out; forcing exit`);
    process.exit(1);
  }, 25_000);
  forceExit.unref();
  server.close((err) => {
    if (err) {
      console.error(`[shutdown] server.close error: ${err.message}`);
      process.exit(1);
    }
    console.log(`[shutdown] HTTP server closed cleanly`);
    process.exit(0);
  });
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
