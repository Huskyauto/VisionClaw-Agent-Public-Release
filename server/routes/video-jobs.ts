// R111 — Video jobs REST API. Powers /jobs dashboard + chat heartbeat banner.
// All routes are tenant-scoped. The DB table `video_jobs` is the queryable
// mirror of disk state (data/video-jobs/<jobId>/state.json) — disk remains
// the source of truth for chapter MP4s, this is the read path for the UI.

import type { Express, Request, Response } from "express";
import { logSilentCatch } from "../lib/silent-catch";
import { eq, and, desc, inArray, or, gt } from "drizzle-orm";
import fs from "fs";
import path from "path";
import { db } from "../db";
import { videoJobs } from "@shared/schema";
import { requestCancel } from "../video-job-runner";
import { signVideoDownloadUrl, verifyVideoDownloadSig } from "../upload-signing";

type Helpers = {
  authMiddleware: any;
  getTenantFromRequest: (req: Request) => number | null;
};

const ACTIVE_STATUSES = ["queued", "rendering", "ready_to_concat", "concating"] as const;

function jobIdParamOk(s: string): boolean {
  return typeof s === "string" && /^vj_[a-z0-9_]{8,80}$/.test(s);
}

// Shape a DB row for the client: drop the on-disk `finalFilePath` (server path
// leak) and, for finished jobs whose final MP4 is on disk, attach freshly
// signed self-hosted Watch (inline) + Download (attachment) URLs. These power
// the /jobs dashboard buttons and the chat heartbeat banner's "Watch" tile.
function toClientRow(row: any, tenantId: number) {
  const { finalFilePath, ...safe } = row;
  let finalWatchUrl: string | null = null;
  let finalDownloadUrl: string | null = null;
  if (row.status === "done" && finalFilePath) {
    try {
      finalWatchUrl = signVideoDownloadUrl(row.jobId, tenantId, true);
      finalDownloadUrl = signVideoDownloadUrl(row.jobId, tenantId, false);
    } catch (_silentErr) { logSilentCatch("server/routes/video-jobs.ts", _silentErr); }
  }
  return { ...safe, finalWatchUrl, finalDownloadUrl };
}

export function registerVideoJobRoutes(app: Express, helpers: Helpers) {
  const { authMiddleware, getTenantFromRequest } = helpers;

  // Active jobs + recently-terminal (last 30 min) — used by chat heartbeat
  // banner (polled every 5s). R124: surfacing recently-done jobs gives Bob the
  // clickable "ready, click to watch" tile that used to live at the bottom of
  // the chat as a final-link card. R125+46: also surface recently-FAILED jobs —
  // previously a failed job left ACTIVE_STATUSES and silently vanished from the
  // banner on the next poll, so Bob "lost" the progress card with no idea why
  // (the BWB weekly recap fail-closed case). Now a failed job shows a red tile
  // with its reason instead of disappearing. The banner dismisses terminal
  // (done/failed) tiles per-user via localStorage once clicked.
  app.get("/api/video-jobs/active", authMiddleware, async (req, res) => {
    try {
      const tenantId = getTenantFromRequest(req);
      if (!tenantId) return res.status(403).json({ error: "Tenant required" });
      const recentCutoff = new Date(Date.now() - 30 * 60 * 1000);
      const rows = await db.select().from(videoJobs)
        .where(and(
          eq(videoJobs.tenantId, tenantId),
          or(
            inArray(videoJobs.status, ACTIVE_STATUSES as any),
            and(eq(videoJobs.status, "done"), gt(videoJobs.updatedAt, recentCutoff)),
            and(eq(videoJobs.status, "failed"), gt(videoJobs.updatedAt, recentCutoff)),
          ),
        ))
        .orderBy(desc(videoJobs.updatedAt))
        .limit(20);
      res.json({ data: rows.map((r) => toClientRow(r, tenantId)) });
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // Full history — paginated, used by /jobs dashboard.
  app.get("/api/video-jobs", authMiddleware, async (req, res) => {
    try {
      const tenantId = getTenantFromRequest(req);
      if (!tenantId) return res.status(403).json({ error: "Tenant required" });
      const limit = Math.min(parseInt(String(req.query.limit)) || 50, 200);
      const offset = parseInt(String(req.query.offset)) || 0;
      const rows = await db.select().from(videoJobs)
        .where(eq(videoJobs.tenantId, tenantId))
        .orderBy(desc(videoJobs.createdAt))
        .limit(limit).offset(offset);
      res.json({ data: rows.map((r) => toClientRow(r, tenantId)) });
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // Single job — used by deep links from chat ("Job: vj_xxx" → click).
  app.get("/api/video-jobs/:jobId", authMiddleware, async (req, res) => {
    try {
      const tenantId = getTenantFromRequest(req);
      if (!tenantId) return res.status(403).json({ error: "Tenant required" });
      const jobId = String(req.params.jobId);
      if (!jobIdParamOk(jobId)) return res.status(400).json({ error: "Invalid job_id format" });
      const rows = await db.select().from(videoJobs)
        .where(and(eq(videoJobs.jobId, jobId), eq(videoJobs.tenantId, tenantId)))
        .limit(1);
      if (rows.length === 0) return res.status(404).json({ error: "Job not found" });
      res.json({ data: toClientRow(rows[0], tenantId) });
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // Cancel — sets the cancel flag; runner observes at next chapter boundary.
  app.post("/api/video-jobs/:jobId/cancel", authMiddleware, async (req, res) => {
    try {
      const tenantId = getTenantFromRequest(req);
      if (!tenantId) return res.status(403).json({ error: "Tenant required" });
      const jobId = String(req.params.jobId);
      if (!jobIdParamOk(jobId)) return res.status(400).json({ error: "Invalid job_id format" });
      const ok = await requestCancel(jobId, tenantId);
      if (!ok) return res.status(404).json({ error: "Job not found, not owned, or already finished" });
      res.json({ ok: true, message: "Cancel requested. Runner will stop after the in-flight chapter completes." });
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // R112.13 — Force-cancel. Immediately marks the job FAILED in the DB
  // regardless of runner state. The runner's in-flight ffmpeg/TTS may keep
  // running until it finishes its current op (we can't kill child processes
  // safely from here), but the UI clears NOW and no further chapters dispatch
  // because the runner's loop sees status != "rendering" on its next tick.
  app.post("/api/video-jobs/:jobId/force-cancel", authMiddleware, async (req, res) => {
    try {
      const tenantId = getTenantFromRequest(req);
      if (!tenantId) return res.status(403).json({ error: "Tenant required" });
      const jobId = String(req.params.jobId);
      if (!jobIdParamOk(jobId)) return res.status(400).json({ error: "Invalid job_id format" });
      const result = await db.update(videoJobs).set({
        status: "failed",
        cancelRequested: true,
        errorMessage: "Force-cancelled by user (R112.13)",
        completedAt: new Date(),
        updatedAt: new Date(),
      }).where(and(eq(videoJobs.jobId, jobId), eq(videoJobs.tenantId, tenantId))).returning({ jobId: videoJobs.jobId });
      if (result.length === 0) return res.status(404).json({ error: "Job not found or not owned" });
      res.json({ ok: true, message: "Job force-cancelled. The UI will clear immediately; any in-flight ffmpeg will finish its current operation then exit." });
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // Direct MP4 stream / download. INTENTIONALLY un-authMiddleware'd: a plain
  // `<a download>` or `<video src>` from the SPA can't carry the Bearer auth
  // header, so this route is auth-gate-exempt (allow-listed in isPublicPath)
  // and proves authorization via the HMAC signature minted by signVideoDownloadUrl
  // for the row's owning tenant. `?mode=inline` → Watch (plays in-browser);
  // `?mode=dl` → attachment download. Full Range support so the browser can
  // seek/scrub and resume. The on-disk MP4 (project-assets/<title>_<ts>.mp4)
  // is the source of truth — mirrors the instant-play self-hosted delivery rule.
  app.get("/api/video-jobs/:jobId/download", async (req: Request, res: Response) => {
    try {
      const jobId = String(req.params.jobId);
      if (!jobIdParamOk(jobId)) return res.status(400).json({ error: "Invalid job_id format" });
      const tid = parseInt(String(req.query.tid), 10);
      const mode = String(req.query.mode || "dl");
      const exp = parseInt(String(req.query.exp), 10);
      const sig = String(req.query.sig || "");
      if (!Number.isFinite(tid) || tid <= 0) return res.status(403).json({ error: "Invalid download link" });
      if (!verifyVideoDownloadSig(jobId, tid, mode, exp, sig)) {
        return res.status(403).json({ error: "Invalid or expired download link" });
      }

      const rows = await db.select().from(videoJobs)
        .where(and(eq(videoJobs.jobId, jobId), eq(videoJobs.tenantId, tid)))
        .limit(1);
      const job = rows[0];
      if (!job || !job.finalFilePath) return res.status(404).json({ error: "Video not available for download" });

      // Defense-in-depth: finalFilePath is server-trusted DB state, but still
      // confine the path to the workspace and require a .mp4 file. We resolve
      // symlinks via realpath and confine the REAL target (not just the lexical
      // path) so a symlinked *.mp4 inside cwd can't read through to an arbitrary
      // file outside the workspace.
      const cwd = path.resolve(process.cwd());
      const lexical = path.resolve(job.finalFilePath);
      if (!(lexical === cwd || lexical.startsWith(cwd + path.sep)) || !lexical.toLowerCase().endsWith(".mp4")) {
        return res.status(403).json({ error: "Forbidden" });
      }
      let resolved: string;
      try { resolved = await fs.promises.realpath(lexical); }
      catch { return res.status(404).json({ error: "Video file is no longer on disk" }); }
      if (!(resolved === cwd || resolved.startsWith(cwd + path.sep)) || !resolved.toLowerCase().endsWith(".mp4")) {
        return res.status(403).json({ error: "Forbidden" });
      }
      let stat: fs.Stats;
      try { stat = await fs.promises.stat(resolved); }
      catch { return res.status(404).json({ error: "Video file is no longer on disk" }); }
      if (!stat.isFile()) return res.status(404).json({ error: "Video file is no longer on disk" });

      const safeName = (String(job.title || "video").replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 60)) || "video";
      const disposition = mode === "inline" ? "inline" : "attachment";
      res.setHeader("Content-Type", "video/mp4");
      res.setHeader("Content-Disposition", `${disposition}; filename="${safeName}.mp4"`);
      res.setHeader("Accept-Ranges", "bytes");
      res.setHeader("Cache-Control", "private, max-age=600");

      const range = req.headers.range;
      if (range) {
        const m = /^bytes=(\d*)-(\d*)$/.exec(range);
        if (m && (m[1] || m[2])) {
          let start: number;
          let end: number;
          if (!m[1]) {
            // Suffix form `bytes=-N` → the LAST N bytes of the file.
            const suffix = parseInt(m[2], 10);
            if (!Number.isFinite(suffix) || suffix <= 0) {
              res.setHeader("Content-Range", `bytes */${stat.size}`);
              return res.status(416).end();
            }
            start = Math.max(0, stat.size - suffix);
            end = stat.size - 1;
          } else {
            start = parseInt(m[1], 10);
            end = m[2] ? parseInt(m[2], 10) : stat.size - 1;
            if (!Number.isFinite(start)) start = 0;
            if (!Number.isFinite(end) || end >= stat.size) end = stat.size - 1;
          }
          if (start > end || start >= stat.size || start < 0) {
            res.setHeader("Content-Range", `bytes */${stat.size}`);
            return res.status(416).end();
          }
          res.status(206);
          res.setHeader("Content-Range", `bytes ${start}-${end}/${stat.size}`);
          res.setHeader("Content-Length", String(end - start + 1));
          return fs.createReadStream(resolved, { start, end }).pipe(res);
        }
      }
      res.setHeader("Content-Length", String(stat.size));
      return fs.createReadStream(resolved).pipe(res);
    } catch (err: any) {
      // Public route — do NOT leak internal exception text to unauthenticated callers.
      console.error("[video-jobs/download] error:", err?.message || err);
      if (!res.headersSent) res.status(500).json({ error: "Internal server error" });
    }
  });
}
