// R60 — Operator inbox API for agent_jobs.
//
// Read-only listing + manual cancel/retry controls. These routes surface
// job metadata (payloads, results, errors) that can contain cross-tenant
// data, so they require BOTH platform admin tenant AND isAdmin flag.
//
// R74.13k (whole-app review LENS A) — standardized on the canonical
// `requirePlatformAdmin` helper from server/auth.ts. Was: local copy that
// imported `ADMIN_TENANT_ID` directly + re-implemented the gate. Drift from
// the helper-injection pattern used by every other extracted route module
// risked silent authz divergence if the canonical gate ever changed.
//
// UI counterpart (future round): /operator page.
import type { Express, Request, Response } from "express";
import {
  listJobs,
  getJobStats,
  retryJob,
  cancelJob,
} from "../job-queue";
import { getRegisteredKinds } from "../job-worker";

type Deps = {
  authMiddleware: any;
  requirePlatformAdmin: (req: Request, res: Response) => boolean;
};

/** Normalize thrown values so `.message` access doesn't swallow context. */
function errMsg(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === "string") return e;
  try { return JSON.stringify(e); } catch { return String(e); }
}

export function registerAgentJobsRoutes(app: Express, deps: Deps) {
  const { authMiddleware, requirePlatformAdmin } = deps;

  app.get("/api/admin/agent-jobs", authMiddleware, async (req: Request, res: Response) => {
    if (!requirePlatformAdmin(req, res)) return;
    try {
      const status = req.query.status as string | undefined;
      const kind = req.query.kind as string | undefined;
      const limit = Math.min(parseInt(String(req.query.limit)) || 100, 500);
      const offset = Math.max(parseInt(String(req.query.offset)) || 0, 0);
      const statuses = status ? (status.split(",") as any[]) : undefined;
      const jobs = await listJobs({ status: statuses as any, kind, limit, offset });
      res.json({ jobs, count: jobs.length });
    } catch (e: unknown) { res.status(500).json({ error: errMsg(e) }); }
  });

  app.get("/api/admin/agent-jobs/stats", authMiddleware, async (req: Request, res: Response) => {
    if (!requirePlatformAdmin(req, res)) return;
    try {
      const [stats, kinds] = await Promise.all([
        getJobStats(),
        Promise.resolve(getRegisteredKinds()),
      ]);
      res.json({ stats, registeredKinds: kinds });
    } catch (e: unknown) { res.status(500).json({ error: errMsg(e) }); }
  });

  app.post("/api/admin/agent-jobs/:id/retry", authMiddleware, async (req: Request, res: Response) => {
    if (!requirePlatformAdmin(req, res)) return;
    try {
      const id = parseInt(String(req.params.id), 10);
      if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });
      await retryJob(id);
      res.json({ success: true, id });
    } catch (e: unknown) { res.status(500).json({ error: errMsg(e) }); }
  });

  app.post("/api/admin/agent-jobs/:id/cancel", authMiddleware, async (req: Request, res: Response) => {
    if (!requirePlatformAdmin(req, res)) return;
    try {
      const id = parseInt(String(req.params.id), 10);
      if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });
      await cancelJob(id);
      res.json({ success: true, id });
    } catch (e: unknown) { res.status(500).json({ error: errMsg(e) }); }
  });
}
