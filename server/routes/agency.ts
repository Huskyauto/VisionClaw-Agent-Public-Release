// R60 — Agency domain routes extracted from server/routes.ts (Stage 2 of R59).
// 16 routes: trust scores, express lanes, proactive, evaluators, environmental,
// collective intelligence, auto-tuner. All routes preserve exact behavior from
// the original monolith (auth middleware, tenant scoping, admin gates).
import type { Express, Request, Response } from "express";
import { validate, trustEventSchema, expressLaneCheckSchema } from "../validation";

type Deps = {
  authMiddleware: any;
  getTenantFromRequest: (req: Request) => number | null;
  isAdminRequest: (req: Request) => boolean;
  requirePlatformAdmin: (req: Request, res: Response) => boolean;
};

export function registerAgencyRoutes(app: Express, deps: Deps) {
  // R74.13s SECURITY — auto-tuner override + reset are process-global control
  // plane (affect every tenant's tuned parameters). They were upgraded from
  // `isAdminRequest` (weak header check) to `requirePlatformAdmin` (header +
  // ADMIN_TENANT_ID session). Other agency admin gates stay on `isAdminRequest`
  // since they're tenant-admin-callable, not platform-global.
  const { authMiddleware, getTenantFromRequest, isAdminRequest, requirePlatformAdmin } = deps;

  app.get("/api/agency/trust-scores", authMiddleware, async (req: Request, res: Response) => {
    try {
      const tenantId = getTenantFromRequest(req);
      if (!tenantId) return res.status(401).json({ error: "Authentication required" });
      const personaId = req.query.personaId ? parseInt(req.query.personaId as string) : undefined;
      const { getAllTrustScores } = await import("../trust-engine");
      const scores = await getAllTrustScores(tenantId, personaId);
      res.json(scores);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.post("/api/agency/trust-scores/initialize", authMiddleware, async (req: Request, res: Response) => {
    try {
      const tenantId = getTenantFromRequest(req);
      if (!tenantId) return res.status(401).json({ error: "Authentication required" });
      const { initializeTrustScores } = await import("../trust-engine");
      await initializeTrustScores(tenantId);
      res.json({ success: true });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.post("/api/agency/trust-scores/event", authMiddleware, validate(trustEventSchema), async (req: Request, res: Response) => {
    try {
      const tenantId = getTenantFromRequest(req);
      if (!tenantId) return res.status(401).json({ error: "Authentication required" });
      const { personaId, event, reason } = req.body;
      const { recordTrustEvent } = await import("../trust-engine");
      const results = await recordTrustEvent(tenantId, personaId, event, reason);
      res.json(results);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.get("/api/agency/express-lanes", authMiddleware, async (_req: Request, res: Response) => {
    try {
      const { getApprovedLanes } = await import("../express-lanes");
      res.json(getApprovedLanes());
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.post("/api/agency/express-lanes/check", authMiddleware, validate(expressLaneCheckSchema), async (req: Request, res: Response) => {
    try {
      const tenantId = getTenantFromRequest(req);
      if (!tenantId) return res.status(401).json({ error: "Authentication required" });
      const { fromPersonaId, toPersonaId, workType } = req.body;
      const { checkExpressLaneEligibility } = await import("../express-lanes");
      const result = await checkExpressLaneEligibility(tenantId, fromPersonaId, toPersonaId, workType);
      res.json(result);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.get("/api/agency/proactive/:personaId", authMiddleware, async (req: Request, res: Response) => {
    try {
      const tenantId = getTenantFromRequest(req);
      if (!tenantId) return res.status(401).json({ error: "Authentication required" });
      const personaId = parseInt(req.params.personaId as string);
      const { getAvailablePAB, getTriggersForPersona, getProactiveQualityStats } = await import("../proactive-engine");
      const [pab, triggers, quality] = await Promise.all([
        getAvailablePAB(tenantId, personaId),
        Promise.resolve(getTriggersForPersona(personaId)),
        getProactiveQualityStats(tenantId, personaId),
      ]);
      res.json({ pab, triggers, quality });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.get("/api/agency/evaluators", authMiddleware, async (req: Request, res: Response) => {
    try {
      const tenantId = getTenantFromRequest(req);
      if (!tenantId) return res.status(401).json({ error: "Authentication required" });
      const { runAllEvaluators } = await import("../evaluators");
      const results = await runAllEvaluators(tenantId);
      res.json(results);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.get("/api/agency/environmental/schedule", authMiddleware, async (_req: Request, res: Response) => {
    try {
      const { getScanSchedule } = await import("../environmental-awareness");
      res.json(getScanSchedule());
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.get("/api/agency/environmental/signals", authMiddleware, async (req: Request, res: Response) => {
    try {
      const level = req.query.level as string | undefined;
      const { getRecentSignals } = await import("../environmental-awareness");
      res.json(getRecentSignals(level as any));
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.get("/api/agency/collective-intelligence", authMiddleware, async (req: Request, res: Response) => {
    try {
      const tenantId = getTenantFromRequest(req);
      if (!tenantId) return res.status(401).json({ error: "Authentication required" });
      const { getProtocolUsage } = await import("../collective-intelligence");
      const usage = getProtocolUsage(tenantId);
      res.json({ usage });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.get("/api/agency/auto-tuner/status", authMiddleware, async (_req: Request, res: Response) => {
    try {
      const { getAutoTunerStatus } = await import("../auto-tuner");
      res.json(getAutoTunerStatus());
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.get("/api/agency/auto-tuner/config", authMiddleware, async (_req: Request, res: Response) => {
    try {
      const { getCurrentConfig } = await import("../auto-tuner");
      res.json(getCurrentConfig());
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.get("/api/agency/auto-tuner/history", authMiddleware, async (_req: Request, res: Response) => {
    try {
      const { getTuningHistory } = await import("../auto-tuner");
      res.json(getTuningHistory());
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.post("/api/agency/auto-tuner/run", authMiddleware, async (req: Request, res: Response) => {
    try {
      const tenantId = getTenantFromRequest(req);
      if (!tenantId) return res.status(401).json({ error: "Authentication required" });
      const { runTuningCycle } = await import("../auto-tuner");
      const snapshot = await runTuningCycle(tenantId);
      res.json(snapshot);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.post("/api/agency/auto-tuner/override", authMiddleware, async (req: Request, res: Response) => {
    if (!requirePlatformAdmin(req, res)) return;
    try {
      const { path, value } = req.body;
      if (!path || typeof path !== "string" || typeof value !== "number" || !Number.isFinite(value)) {
        return res.status(400).json({ error: "path (string) and value (finite number) are required" });
      }
      const { overrideParameter } = await import("../auto-tuner");
      const success = overrideParameter(path, value);
      if (!success) return res.status(400).json({ error: `Invalid parameter path: ${path}` });
      res.json({ success: true, path, value });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.post("/api/agency/auto-tuner/reset", authMiddleware, async (req: Request, res: Response) => {
    if (!requirePlatformAdmin(req, res)) return;
    try {
      const { resetToDefaults } = await import("../auto-tuner");
      const config = resetToDefaults();
      res.json({ success: true, config });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });
}
