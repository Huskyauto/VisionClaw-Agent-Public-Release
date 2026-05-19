// R111 — Video jobs REST API. Powers /jobs dashboard + chat heartbeat banner.
// All routes are tenant-scoped. The DB table `video_jobs` is the queryable
// mirror of disk state (data/video-jobs/<jobId>/state.json) — disk remains
// the source of truth for chapter MP4s, this is the read path for the UI.

import type { Express, Request, Response } from "express";
import { eq, and, desc, inArray } from "drizzle-orm";
import { db } from "../db";
import { videoJobs } from "@shared/schema";
import { requestCancel } from "../video-job-runner";

type Helpers = {
  authMiddleware: any;
  getTenantFromRequest: (req: Request) => number | null;
};

const ACTIVE_STATUSES = ["queued", "rendering", "ready_to_concat", "concating"] as const;

function jobIdParamOk(s: string): boolean {
  return typeof s === "string" && /^vj_[a-z0-9_]{8,80}$/.test(s);
}

export function registerVideoJobRoutes(app: Express, helpers: Helpers) {
  const { authMiddleware, getTenantFromRequest } = helpers;

  // Active jobs only — used by chat heartbeat banner (polled every 5s).
  app.get("/api/video-jobs/active", authMiddleware, async (req, res) => {
    try {
      const tenantId = getTenantFromRequest(req);
      if (!tenantId) return res.status(403).json({ error: "Tenant required" });
      const rows = await db.select().from(videoJobs)
        .where(and(eq(videoJobs.tenantId, tenantId), inArray(videoJobs.status, ACTIVE_STATUSES as any)))
        .orderBy(desc(videoJobs.updatedAt))
        .limit(20);
      res.json({ data: rows });
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
      res.json({ data: rows });
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
      res.json({ data: rows[0] });
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
}
