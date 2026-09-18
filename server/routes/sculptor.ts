// R74.13t — Stage 24 of routes.ts decomposition.
// 5 routes for the Sculptor (parallel agent-sessions runner — spawns N
// concurrent agent sessions with isolated tools and aggregates results).
// /api/sculptor/sessions (POST create), /api/sculptor/sessions/{:id (GET, DELETE),
// /:id/messages (GET, POST)}. All hard-gated via `requirePlatformAdmin`
// (Sculptor spawns N parallel sessions and is process-global capacity-limited).
// Dynamic import of ../sculptor kept inline.
// Extracted verbatim from server/routes.ts L4954-L5050.
import type { Express, Request, Response } from "express";

type SculptorHelpers = {
  authMiddleware: any;
  getTenantFromRequest: (req: Request) => number | null;
  requirePlatformAdmin: (req: Request, res: Response) => boolean;
};

export function registerSculptorRoutes(app: Express, helpers: SculptorHelpers) {
  const { authMiddleware, getTenantFromRequest, requirePlatformAdmin } = helpers;

  // ─── Sculptor (Parallel Agent Sessions) ─────────────────────────────

  app.post("/api/sculptor/sessions", authMiddleware, async (req, res) => {
    if (!requirePlatformAdmin(req, res)) return;
    try {
      const { createAgentSession } = await import("../sculptor");
      const tenantId = getTenantFromRequest(req);
      if (!tenantId) return res.status(403).json({ error: "Tenant resolution failed" });
      const task = typeof req.body?.task === "string" ? req.body.task.slice(0, 4000) : "";
      if (!task) return res.status(400).json({ error: "task is required" });
      const title = typeof req.body?.title === "string" ? req.body.title.slice(0, 200) : undefined;
      const plan = Array.isArray(req.body?.plan) ? req.body.plan.filter((s: any) => typeof s === "string").slice(0, 20) : undefined;
      const personaId = typeof req.body?.personaId === "number" ? req.body.personaId : undefined;
      const model = typeof req.body?.model === "string" ? req.body.model : undefined;
      const result = await createAgentSession({ tenantId, title: title || task.slice(0, 80), task, plan, personaId, model });
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/sculptor/parallel", authMiddleware, async (req, res) => {
    if (!requirePlatformAdmin(req, res)) return;
    try {
      const { launchParallelSessions } = await import("../sculptor");
      const tenantId = getTenantFromRequest(req);
      if (!tenantId) return res.status(403).json({ error: "Tenant resolution failed" });
      const task = typeof req.body?.task === "string" ? req.body.task.slice(0, 4000) : "";
      if (!task) return res.status(400).json({ error: "task is required" });
      const variants = Array.isArray(req.body?.variants) ? req.body.variants.slice(0, 5) : [];
      if (variants.length < 2) return res.status(400).json({ error: "At least 2 variants required for parallel sessions" });
      const plan = Array.isArray(req.body?.plan) ? req.body.plan.filter((s: any) => typeof s === "string").slice(0, 20) : undefined;
      const result = await launchParallelSessions({ tenantId, task, plan, variants });
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/sculptor/sessions", authMiddleware, async (req, res) => {
    if (!requirePlatformAdmin(req, res)) return;
    try {
      const { listSessions } = await import("../sculptor");
      const tenantId = getTenantFromRequest(req);
      if (!tenantId) return res.status(403).json({ error: "Tenant resolution failed" });
      const status = typeof req.query.status === "string" ? req.query.status : undefined;
      const comparisonGroup = typeof req.query.group === "string" ? req.query.group : undefined;
      const sessions = await listSessions(tenantId, { status, comparisonGroup });
      res.json(sessions);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/sculptor/compare/:group", authMiddleware, async (req, res) => {
    if (!requirePlatformAdmin(req, res)) return;
    try {
      const { compareSessionResults } = await import("../sculptor");
      const tenantId = getTenantFromRequest(req);
      if (!tenantId) return res.status(403).json({ error: "Tenant resolution failed" });
      const result = await compareSessionResults((req.params.group as string), tenantId);
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/sculptor/review/:id", authMiddleware, async (req, res) => {
    if (!requirePlatformAdmin(req, res)) return;
    try {
      const { reviewSessionWork } = await import("../sculptor");
      const tenantId = getTenantFromRequest(req);
      if (!tenantId) return res.status(403).json({ error: "Tenant resolution failed" });
      const sessionId = parseInt(req.params.id as string);
      if (isNaN(sessionId) || sessionId <= 0) return res.status(400).json({ error: "Invalid session ID" });
      const result = await reviewSessionWork(sessionId, tenantId);
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/sculptor/replay/:id", authMiddleware, async (req, res) => {
    if (!requirePlatformAdmin(req, res)) return;
    try {
      const { getSessionReplay } = await import("../sculptor");
      const tenantId = getTenantFromRequest(req);
      if (!tenantId) return res.status(403).json({ error: "Tenant resolution failed" });
      const sessionId = parseInt(req.params.id as string);
      if (isNaN(sessionId) || sessionId <= 0) return res.status(400).json({ error: "Invalid session ID" });
      const result = await getSessionReplay(sessionId, tenantId);
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

}
