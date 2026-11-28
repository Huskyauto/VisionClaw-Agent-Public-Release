import type { Express, Request, Response } from "express";
import { ADMIN_TENANT_ID } from "../tenant-constants";
import { createStore } from "../daily-ai-insights/store";
import { ROOT, VERSION } from "../daily-ai-insights/core";
import { isProductionRuntime } from "../lib/runtime-env";

type Helpers = {
  authMiddleware: any; getTenantFromRequest(req: Request): number | null;
  isAdminRequest(req: Request): boolean;
};
export function registerDailyAiInsightsRoutes(app: Express, h: Helpers) {
  const owner = (req: Request, res: Response) => {
    if (h.getTenantFromRequest(req) !== ADMIN_TENANT_ID || !h.isAdminRequest(req)) {
      res.status(403).json({ error: "Platform owner access required" }); return false;
    }
    return true;
  };
  app.get("/api/admin/daily-ai-insights", h.authMiddleware, async (req, res) => {
    if (!owner(req, res)) return;
    try {
      const [state, smoke] = await Promise.all([
        createStore(ADMIN_TENANT_ID).read(), createStore(ADMIN_TENANT_ID, true).read(),
      ]);
      const production = isProductionRuntime();
      let liveEnabled: boolean | null = null;
      if (production) {
        const { db } = await import("../db");
        const { sql } = await import("drizzle-orm");
        const result: any = await db.execute(sql`SELECT id FROM heartbeat_tasks
          WHERE tenant_id=${ADMIN_TENANT_ID} AND type='maintenance_script'
          AND prompt_content='daily-ai-insights' AND enabled=true AND approval_status='approved' LIMIT 1`);
        liveEnabled = !state.paused && (result.rows ?? result).length === 1;
      }
      res.json({ root: ROOT, version: VERSION, schedule: "08:00 America/Chicago; DST-aware, five-minute dispatch window",
        mode: "report-only", runtime: production ? "production" : "development",
        activation: state.firstLiveScheduled ? "live_scheduled_run_observed" :
          production ? liveEnabled ? "enabled_live_no_scheduled_proof" : "production_loaded_not_enabled" :
            smoke.last?.status === "smoke_verified" ? "exercised_in_development_live_enablement_unknown" :
              "configured_in_development_publication_not_proven",
        liveEnabled, firstLiveScheduled: state.firstLiveScheduled ?? null,
        developmentSmoke: smoke.last ?? null,
        paused: state.paused, last: state.last ?? null, active: state.active ? {
          until: state.active.until, day: state.active.day, calls: state.active.calls, reviewId: state.active.reviewId,
        } : null, backlog: { knownFiles: state.cursor.pending.length, listingContinuations: state.cursor.folders.length,
          sweep: state.cursor.sweep }, uncertainInputs: state.uncertainInputs ?? [], errors: state.errors,
      });
    } catch { res.status(500).json({ error: "Daily review status unavailable" }); }
  });
  app.post("/api/admin/daily-ai-insights/pause", h.authMiddleware, async (req, res) => {
    if (!owner(req, res)) return;
    if (typeof req.body?.paused !== "boolean") return res.status(400).json({ error: "paused must be true or false" });
    try { await createStore(ADMIN_TENANT_ID).pause(req.body.paused); res.json({ paused: req.body.paused }); }
    catch { res.status(500).json({ error: "Pause could not be saved" }); }
  });
  app.get("/api/admin/daily-ai-insights/reviews/:id", h.authMiddleware, async (req, res) => {
    if (!owner(req, res)) return;
    try { res.json(await createStore(ADMIN_TENANT_ID).review(Number(req.params.id))); }
    catch { res.status(404).json({ error: "Review not found" }); }
  });
  app.post("/api/admin/daily-ai-insights/promote", h.authMiddleware, async (req, res) => {
    if (!owner(req, res)) return;
    const { reviewId, identity, evidenceHash } = req.body ?? {};
    if (!Number.isSafeInteger(reviewId) || reviewId <= 0 ||
        typeof identity !== "string" || !/^[a-f0-9]{64}$/.test(identity) ||
        typeof evidenceHash !== "string" || !/^[a-f0-9]{64}$/.test(evidenceHash)) {
      return res.status(400).json({ error: "Supply the saved reviewId, candidate identity and exact evidenceHash" });
    }
    try {
      const { promoteCandidate } = await import("../daily-ai-insights/handoff");
      const result = await promoteCandidate(ADMIN_TENANT_ID, reviewId, identity, evidenceHash);
      res.status(result.accepted ? 202 : 409).json(result);
    } catch { res.status(409).json({ error: "Promotion blocked; review must be delivered, unpaused and bound to exact candidate evidence" }); }
  });
}
