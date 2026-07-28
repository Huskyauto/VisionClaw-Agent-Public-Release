// R74.13t — Stage 16 of routes.ts decomposition.
// 15 routes for the crewAI-inspired Crews + Flows engine:
// /api/crews (POST create, GET list), /api/crews/:id (GET, PATCH, DELETE),
// /api/crews/:id/agents (POST), /api/crews/:id/tasks (POST),
// /api/crews/:id/kickoff (POST), /api/crews/:id/runs (GET);
// /api/flows (POST create, GET list), /api/flows/:id/steps (POST, GET),
// /api/flows/:id/kickoff (POST), /api/flows/:id (DELETE).
// Gating preserved verbatim from monolith: WRITE routes (POST/PATCH/DELETE)
// hard-gated via `requirePlatformAdmin` because crews/flows touch the
// agent-execution engine and tenant isolation isn't enforced at the engine
// layer. READ routes (GET /api/crews, GET /api/crews/:id, GET /api/crews/:id/runs,
// GET /api/flows, GET /api/flows/:id/steps) are tenant-authenticated only via
// `authMiddleware` — any signed-in tenant can list/inspect crew + flow
// definitions. Architect's R74.13t HIGH-2 finding flagged this as a gating
// regression but verification against pre-extraction routes.ts (HEAD~4 L9021,
// 9031, 9119, 9151, 9172) confirmed it is the original behavior. If reads
// should also be admin-only, gate both here AND audit the original tenant-admin
// surface that may rely on the current pattern. Dynamic imports of ../crews-engine kept.
// Extracted verbatim from server/routes.ts L9008-L9203.
import type { Express, Request, Response } from "express";

type CrewsFlowsHelpers = {
  authMiddleware: any;
  getTenantFromRequest: (req: Request) => number | null;
  requirePlatformAdmin: (req: Request, res: Response) => boolean;
};

export function registerCrewsFlowsRoutes(app: Express, helpers: CrewsFlowsHelpers) {
  const { authMiddleware, getTenantFromRequest, requirePlatformAdmin } = helpers;

  // ─── Crews & Flows Engine (crewAI-inspired) ──────────────────────────

  app.post("/api/crews", authMiddleware, async (req, res) => {
    if (!requirePlatformAdmin(req, res)) return;
    try {
      const { createCrew } = await import("../crews-engine");
      const tenantId = getTenantFromRequest(req);
      if (!tenantId) return res.status(403).json({ error: "Tenant required" });
      const result = await createCrew({ tenantId, ...req.body });
      res.json(result);
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  app.get("/api/crews", authMiddleware, async (req, res) => {
    try {
      const { listCrews } = await import("../crews-engine");
      const tenantId = getTenantFromRequest(req);
      if (!tenantId) return res.status(403).json({ error: "Tenant required" });
      const crews = await listCrews(tenantId);
      res.json({ crews });
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  app.get("/api/crews/:id", authMiddleware, async (req, res) => {
    try {
      const { getCrewWithDetails } = await import("../crews-engine");
      const tenantId = getTenantFromRequest(req);
      if (!tenantId) return res.status(403).json({ error: "Tenant required" });
      const details = await getCrewWithDetails(parseInt(req.params.id as string), tenantId);
      if (!details) return res.status(404).json({ error: "Crew not found" });
      res.json(details);
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  app.patch("/api/crews/:id", authMiddleware, async (req, res) => {
    if (!requirePlatformAdmin(req, res)) return;
    try {
      const { updateCrew } = await import("../crews-engine");
      const tenantId = getTenantFromRequest(req);
      if (!tenantId) return res.status(403).json({ error: "Tenant required" });
      const result = await updateCrew(parseInt(req.params.id as string), tenantId, req.body);
      res.json(result);
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  app.delete("/api/crews/:id", authMiddleware, async (req, res) => {
    if (!requirePlatformAdmin(req, res)) return;
    try {
      const { deleteCrew } = await import("../crews-engine");
      const tenantId = getTenantFromRequest(req);
      if (!tenantId) return res.status(403).json({ error: "Tenant required" });
      const result = await deleteCrew(parseInt(req.params.id as string), tenantId);
      res.json(result);
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  app.post("/api/crews/:id/agents", authMiddleware, async (req, res) => {
    if (!requirePlatformAdmin(req, res)) return;
    try {
      const { addCrewAgent } = await import("../crews-engine");
      const tenantId = getTenantFromRequest(req);
      if (!tenantId) return res.status(403).json({ error: "Tenant required" });
      const result = await addCrewAgent({ crewId: parseInt(req.params.id as string), tenantId, ...req.body });
      res.json(result);
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  app.delete("/api/crew-agents/:id", authMiddleware, async (req, res) => {
    if (!requirePlatformAdmin(req, res)) return;
    try {
      const { removeCrewAgent } = await import("../crews-engine");
      const tenantId = getTenantFromRequest(req);
      if (!tenantId) return res.status(403).json({ error: "Tenant required" });
      const result = await removeCrewAgent(parseInt(req.params.id as string), tenantId);
      res.json(result);
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  app.post("/api/crews/:id/tasks", authMiddleware, async (req, res) => {
    if (!requirePlatformAdmin(req, res)) return;
    try {
      const { addCrewTask } = await import("../crews-engine");
      const tenantId = getTenantFromRequest(req);
      if (!tenantId) return res.status(403).json({ error: "Tenant required" });
      const result = await addCrewTask({ crewId: parseInt(req.params.id as string), tenantId, ...req.body });
      res.json(result);
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  app.delete("/api/crew-tasks/:id", authMiddleware, async (req, res) => {
    if (!requirePlatformAdmin(req, res)) return;
    try {
      const { removeCrewTask } = await import("../crews-engine");
      const tenantId = getTenantFromRequest(req);
      if (!tenantId) return res.status(403).json({ error: "Tenant required" });
      const result = await removeCrewTask(parseInt(req.params.id as string), tenantId);
      res.json(result);
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  app.post("/api/crews/:id/kickoff", authMiddleware, async (req, res) => {
    if (!requirePlatformAdmin(req, res)) return;
    try {
      const { kickoffCrew } = await import("../crews-engine");
      const tenantId = getTenantFromRequest(req);
      if (!tenantId) return res.status(403).json({ error: "Tenant required" });
      const result = await kickoffCrew(parseInt(req.params.id as string), tenantId, req.body.inputs || {});
      res.json(result);
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  app.get("/api/crews/:id/runs", authMiddleware, async (req, res) => {
    try {
      const { listCrewRuns } = await import("../crews-engine");
      const tenantId = getTenantFromRequest(req);
      if (!tenantId) return res.status(403).json({ error: "Tenant required" });
      const runs = await listCrewRuns(parseInt(req.params.id as string), tenantId);
      res.json({ runs });
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  app.get("/api/crew-runs/:id", authMiddleware, async (req, res) => {
    try {
      const { getCrewRun } = await import("../crews-engine");
      const tenantId = getTenantFromRequest(req);
      if (!tenantId) return res.status(403).json({ error: "Tenant required" });
      const run = await getCrewRun(parseInt(req.params.id as string), tenantId);
      if (!run) return res.status(404).json({ error: "Run not found" });
      res.json(run);
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  app.post("/api/flows", authMiddleware, async (req, res) => {
    if (!requirePlatformAdmin(req, res)) return;
    try {
      const { createFlow } = await import("../crews-engine");
      const tenantId = getTenantFromRequest(req);
      if (!tenantId) return res.status(403).json({ error: "Tenant required" });
      const result = await createFlow({ tenantId, ...req.body });
      res.json(result);
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  app.get("/api/flows", authMiddleware, async (req, res) => {
    try {
      const { listFlows } = await import("../crews-engine");
      const tenantId = getTenantFromRequest(req);
      if (!tenantId) return res.status(403).json({ error: "Tenant required" });
      const flows = await listFlows(tenantId);
      res.json({ flows });
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  app.post("/api/flows/:id/steps", authMiddleware, async (req, res) => {
    if (!requirePlatformAdmin(req, res)) return;
    try {
      const { addFlowStep } = await import("../crews-engine");
      const tenantId = getTenantFromRequest(req);
      if (!tenantId) return res.status(403).json({ error: "Tenant required" });
      const result = await addFlowStep({ flowId: parseInt(req.params.id as string), tenantId, ...req.body });
      res.json(result);
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  app.get("/api/flows/:id/steps", authMiddleware, async (req, res) => {
    try {
      const { listFlowSteps } = await import("../crews-engine");
      const tenantId = getTenantFromRequest(req);
      if (!tenantId) return res.status(403).json({ error: "Tenant required" });
      const steps = await listFlowSteps(parseInt(req.params.id as string), tenantId);
      res.json({ steps });
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  app.post("/api/flows/:id/kickoff", authMiddleware, async (req, res) => {
    if (!requirePlatformAdmin(req, res)) return;
    try {
      const { kickoffFlow } = await import("../crews-engine");
      const tenantId = getTenantFromRequest(req);
      if (!tenantId) return res.status(403).json({ error: "Tenant required" });
      const result = await kickoffFlow(parseInt(req.params.id as string), tenantId, req.body.inputs || {});
      res.json(result);
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  app.delete("/api/flows/:id", authMiddleware, async (req, res) => {
    if (!requirePlatformAdmin(req, res)) return;
    try {
      const { deleteFlow } = await import("../crews-engine");
      const tenantId = getTenantFromRequest(req);
      if (!tenantId) return res.status(403).json({ error: "Tenant required" });
      const result = await deleteFlow(parseInt(req.params.id as string), tenantId);
      res.json(result);
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

}
