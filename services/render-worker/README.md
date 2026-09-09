# VisionClaw Render Worker

Stateless ffmpeg render microservice for the VisionClaw video pipeline. Designed to be deployed on Railway (Docker) so that heavy video assembly never competes with the main app's web server for CPU/memory/disk.

**Why this exists:** The main app's in-process ffmpeg pipeline kept hitting Nix snapshot corruption (R110.16/R110.17) and cold-start preflight thrash (R110.18). A dedicated Docker container with apt-installed ffmpeg permanently exits both classes of bug.

## Contract

The worker is intentionally narrow: it does **only** the ffmpeg stitch step. The main app pre-bakes images and TTS audio (it already does this), then ships the bytes to the worker. The worker has zero LLM/DB secrets — only a single `RENDER_ACCESS_KEY` shared bearer token.

### Endpoints

- `GET /healthz` — `{ ok, ffmpeg, queue: { active, pending, total }, uptimeSec }`
- `POST /v1/render` — multipart/form-data
  - `manifest`: JSON string `{ resolution: "1920x1080", fps: 30, transition: "fade", crossfadeMs: 500, outputName: "intro.mp4", scenes: [{ durationSec: 4.2 }, ...] }`
  - `scene_N_image`: PNG/JPG file (required, one per scene)
  - `scene_N_audio`: MP3/WAV file (optional)
  - Returns `202 { jobId, status, pollUrl }`
- `GET /v1/render/:id` — `{ jobId, status: queued|running|done|failed, error?, durationSec?, sizeBytes?, downloadUrl? }`
- `GET /v1/render/:id/download` — streams the final MP4 (only when status=done)

All `/v1/*` endpoints require `Authorization: Bearer ${RENDER_ACCESS_KEY}`.

## Environment

- `PORT` (default 8080)
- `RENDER_ACCESS_KEY` (required unless `RENDER_REQUIRE_AUTH=false`)
- `RENDER_CONCURRENCY` (default 2 — max parallel ffmpeg jobs)
- `RENDER_MAX_UPLOAD_BYTES` (default 500MB)
- `RENDER_JOB_TTL_MS` (default 2h — when to GC finished jobs)
- `WORK_DIR` (default /tmp/render-jobs)
- `FFMPEG_PATH` / `FFPROBE_PATH` (default: PATH lookup)

## Deploy to Railway

1. **Create a new service in your existing Railway project.**
   - Source: same GitHub repo as main app
   - Root directory: `services/render-worker`
   - Builder: Dockerfile (auto-detected)
2. **Set env vars on the Railway service:**
   - `RENDER_ACCESS_KEY` = generate a long random string (e.g. `openssl rand -hex 32`)
3. **Set the same vars in the main Replit app:**
   - `RENDER_URL` = the Railway service's public URL (e.g. `https://visionclaw-render.up.railway.app`)
   - `RENDER_ACCESS_KEY` = same value as above
4. **Verify:** `curl ${RENDER_URL}/healthz` should return `{ ok: true, ffmpeg: "ffmpeg version ..." }`.
5. The main app auto-detects when both env vars are set and routes video stitching to the worker. If the worker is down or unreachable, it falls back to the in-process pipeline.

## When you get home — quick checklist

Two paths, pick whichever is faster.

### Path A — auto-deploy script (~2 min total)

```bash
# 1. Railway dashboard → Account Settings → Tokens → Create Token "VisionClaw Agent"
# 2. Paste it into Replit Secrets as RAILWAY_API_TOKEN_2
#    (do NOT touch the existing RAILWAY_API_TOKEN — that's reserved for Camofox)
# 3. Run:
npx tsx scripts/railway-deploy-render-worker.ts

# 4. Script prints the RENDER_ACCESS_KEY and tells you exactly which 2 Replit
#    Secrets to set (RENDER_URL and RENDER_ACCESS_KEY). Copy them in.
# 5. Smoketest:
npx tsx scripts/render-worker-smoketest.ts
```

### Path B — manual UI flow (~3-5 min, no token needed)

1. Railway dashboard → existing project → **+ New** → **GitHub Repo** → select VisionClaw repo
2. Settings → **Root Directory** = `services/render-worker` → Save
3. Settings → Variables → add `RENDER_ACCESS_KEY` = output of `openssl rand -hex 32`
4. Wait for build (~3 min) → Settings → Networking → **Generate Domain**
5. In Replit Secrets, add:
   - `RENDER_URL` = the Railway domain
   - `RENDER_ACCESS_KEY` = same value as step 3
6. `npx tsx scripts/render-worker-smoketest.ts` to verify

Either way, once both Replit secrets are set, Felix's next video routes through the worker automatically. If anything goes wrong, the in-process R110.18 fallback kicks in — no breakage.

## Local dev

```bash
cd services/render-worker
npm install
RENDER_REQUIRE_AUTH=false npm run dev
curl http://localhost:8080/healthz
```

## Sizing

For VisionClaw's typical workload (12-scene long-form @ 1080p / 30fps):
- 1 vCPU, 2GB RAM → ~3 min/video, single concurrency
- **2 vCPU, 4GB RAM → ~90s/video, RENDER_CONCURRENCY=2** (recommended starting size)
- 4 vCPU, 8GB RAM → ~45s/video, RENDER_CONCURRENCY=4

Railway pricing for 2vCPU/4GB hobby plan: ~$10–20/month depending on uptime.

## Security posture

- No DB / LLM / cloud-storage secrets — single bearer token only
- Helmet enabled, x-powered-by disabled
- Input upload size capped (default 500MB), file count capped (200)
- Output paths are sanitized (no traversal); job working dirs are isolated under `WORK_DIR/<uuid>/`
- Jobs expire after `RENDER_JOB_TTL_MS` and their files are GC'd
