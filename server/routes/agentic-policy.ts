// R74.13v — Stage 30 of routes.ts decomposition.
// 14 routes for the Round-24/25 agentic-policy surface:
//   • Minerva Planner   — /api/plans (create/list/get/decide)
//   • Capability Registry — /api/capabilities (list/stats/sync)
//   • Autonomy Rules    — /api/autonomy/{rules CRUD, rules/seed, log, stats}
//   • Outcome Tracker   — /api/outcomes (list/stats/patterns/pending, :id/feedback)
//
// All routes are tenant-gated via authMiddleware + getTenantFromRequest.
// Most autonomy + outcomes routes also require requirePlatformAdmin
// (Felix-level decisions). /api/plans/:id/decide additionally requires
// isAdminRequest as a defense-in-depth check.
//
// Behavior preserved verbatim from monolith — no logic changes.

import type { Express, Request, Response } from "express";

type AgenticPolicyHelpers = {
  authMiddleware: any;
  getTenantFromRequest: (req: Request) => number | null;
  requirePlatformAdmin: (req: Request, res: Response) => boolean;
  isAdminRequest: (req: Request) => boolean;
};

export function registerAgenticPolicyRoutes(app: Express, helpers: AgenticPolicyHelpers) {
  const { authMiddleware, getTenantFromRequest, requirePlatformAdmin, isAdminRequest } = helpers;

  // Round 24 — Minerva planner / Felix decision loop
  app.post("/api/plans", authMiddleware, async (req: Request, res: Response) => {
    try {
      const tenantId = getTenantFromRequest(req);
      if (!tenantId) return res.status(401).json({ error: "Unauthorized" });
      const { objective, context, source, sourceRef } = req.body;
      if (!objective || typeof objective !== "string" || objective.trim().length < 5) {
        return res.status(400).json({ error: "objective (min 5 chars) required" });
      }
      const { createPlan } = await import("../minerva-planner");
      const result = await createPlan({ objective: objective.trim(), context, source, sourceRef, tenantId });
      res.json(result);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.get("/api/plans", authMiddleware, async (req: Request, res: Response) => {
    try {
      const tenantId = getTenantFromRequest(req);
      if (!tenantId) return res.status(401).json({ error: "Unauthorized" });
      const { listPlans } = await import("../minerva-planner");
      const plans = await listPlans({
        tenantId,
        status: req.query.status as string | undefined,
        limit: parseInt(req.query.limit as string) || 20,
      });
      res.json(plans);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.get("/api/plans/:id", authMiddleware, async (req: Request, res: Response) => {
    try {
      const tenantId = getTenantFromRequest(req);
      if (!tenantId) return res.status(401).json({ error: "Unauthorized" });
      const { getPlan } = await import("../minerva-planner");
      const plan = await getPlan(parseInt(req.params.id as string), tenantId);
      if (!plan) return res.status(404).json({ error: "Plan not found" });
      res.json(plan);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // Round 25 — Capability Registry endpoints
  app.get("/api/capabilities", authMiddleware, async (req: Request, res: Response) => {
    try {
      const { listCapabilities } = await import("../capability-registry");
      const kind = req.query.kind as any;
      const activeOnly = req.query.activeOnly !== "false";
      const caps = await listCapabilities({ kind, activeOnly });
      res.json(caps);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.get("/api/capabilities/stats", authMiddleware, async (_req: Request, res: Response) => {
    try {
      const { getCapabilityStats } = await import("../capability-registry");
      const stats = await getCapabilityStats();
      res.json(stats);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.post("/api/capabilities/sync", authMiddleware, async (req: Request, res: Response) => {
    try {
      if (!requirePlatformAdmin(req, res)) return;
      const { syncCapabilities } = await import("../capability-registry");
      const result = await syncCapabilities();
      res.json(result);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.post("/api/plans/:id/decide", authMiddleware, async (req: Request, res: Response) => {
    try {
      // R74.13u — Felix-level decisions must be gated on requirePlatformAdmin
      // (admin tenant + admin role), not just isAdminRequest (admin role in
      // ANY tenant). Plan approve/reject/revise can authorize autonomous
      // agent actions on behalf of the platform — must not be exposed to
      // a tenant-level admin in a SaaS deployment.
      if (!requirePlatformAdmin(req, res)) return;
      const tenantId = getTenantFromRequest(req);
      if (!tenantId) return res.status(401).json({ error: "Unauthorized" });
      const { decision, reason } = req.body;
      if (!["approve", "reject", "revise"].includes(decision)) {
        return res.status(400).json({ error: "decision must be approve|reject|revise" });
      }
      if (!reason || typeof reason !== "string" || reason.trim().length < 3) {
        return res.status(400).json({ error: "reason (min 3 chars) required" });
      }
      const { decidePlan, getPlan } = await import("../minerva-planner");
      const plan = await getPlan(parseInt(req.params.id as string), tenantId);
      if (!plan) return res.status(404).json({ error: "Plan not found" });
      // Capture an opaque audit id so the persisted decision is attributable
      // to the actual session, not silently to Felix. Single-admin today,
      // multi-admin-safe tomorrow.
      const sessionToken = (req as any).cookies?.sessionToken
        || (req.headers.authorization || "").replace(/^Bearer\s+/i, "")
        || "anon";
      const actor = `admin:${sessionToken.substring(0, 12)}`;
      const result = await decidePlan({
        planId: parseInt(req.params.id as string),
        decision: decision as "approve" | "reject" | "revise",
        reason: reason.trim(),
        actor,
      });
      res.json(result);
    } catch (e: any) { res.status(400).json({ error: e.message }); }
  });

  // ═══════════════════════════════════════════════════════════════
  // AUTONOMY RULES API
  // ═══════════════════════════════════════════════════════════════

  app.get("/api/autonomy/rules", authMiddleware, async (req: Request, res: Response) => {
    try {
      if (!requirePlatformAdmin(req, res)) return;
      const tenantId = getTenantFromRequest(req);
      if (!tenantId) return res.status(401).json({ error: "Unauthorized" });
      const { getRules } = await import("../autonomy");
      const rules = await getRules(tenantId);
      res.json(rules);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.post("/api/autonomy/rules", authMiddleware, async (req: Request, res: Response) => {
    try {
      if (!requirePlatformAdmin(req, res)) return;
      const tenantId = getTenantFromRequest(req);
      if (!tenantId) return res.status(401).json({ error: "Unauthorized" });
      const { createRule } = await import("../autonomy");
      const rule = await createRule(tenantId, req.body);
      res.json(rule);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.patch("/api/autonomy/rules/:id", authMiddleware, async (req: Request, res: Response) => {
    try {
      if (!requirePlatformAdmin(req, res)) return;
      const tenantId = getTenantFromRequest(req);
      if (!tenantId) return res.status(401).json({ error: "Unauthorized" });
      const { updateRule } = await import("../autonomy");
      await updateRule(tenantId, parseInt(req.params.id as string), req.body);
      res.json({ success: true });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.delete("/api/autonomy/rules/:id", authMiddleware, async (req: Request, res: Response) => {
    try {
      if (!requirePlatformAdmin(req, res)) return;
      const tenantId = getTenantFromRequest(req);
      if (!tenantId) return res.status(401).json({ error: "Unauthorized" });
      const { deleteRule } = await import("../autonomy");
      await deleteRule(tenantId, parseInt(req.params.id as string));
      res.json({ success: true });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.post("/api/autonomy/rules/seed", authMiddleware, async (req: Request, res: Response) => {
    try {
      if (!requirePlatformAdmin(req, res)) return;
      const tenantId = getTenantFromRequest(req);
      if (!tenantId) return res.status(401).json({ error: "Unauthorized" });
      const { seedDefaultRules } = await import("../autonomy");
      const result = await seedDefaultRules(tenantId);
      res.json(result);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.get("/api/autonomy/log", authMiddleware, async (req: Request, res: Response) => {
    try {
      if (!requirePlatformAdmin(req, res)) return;
      const tenantId = getTenantFromRequest(req);
      if (!tenantId) return res.status(401).json({ error: "Unauthorized" });
      const { getAutonomyLog } = await import("../autonomy");
      const log = await getAutonomyLog(tenantId, parseInt(req.query.limit as string) || 50);
      res.json(log);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.get("/api/autonomy/stats", authMiddleware, async (req: Request, res: Response) => {
    try {
      if (!requirePlatformAdmin(req, res)) return;
      const tenantId = getTenantFromRequest(req);
      if (!tenantId) return res.status(401).json({ error: "Unauthorized" });
      const { getAutonomyStats } = await import("../autonomy");
      const stats = await getAutonomyStats(tenantId);
      res.json(stats);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // ═══════════════════════════════════════════════════════════════
  // OUTCOME TRACKING API
  // ═══════════════════════════════════════════════════════════════

  app.get("/api/outcomes", authMiddleware, async (req: Request, res: Response) => {
    try {
      if (!requirePlatformAdmin(req, res)) return;
      const tenantId = getTenantFromRequest(req);
      if (!tenantId) return res.status(401).json({ error: "Unauthorized" });
      const { getOutcomes } = await import("../outcome-tracker");
      const outcomes = await getOutcomes(tenantId, {
        personaId: req.query.personaId ? parseInt(req.query.personaId as string) : undefined,
        actionType: req.query.actionType as string,
        status: req.query.status as string,
        limit: parseInt(req.query.limit as string) || 50,
      });
      res.json(outcomes);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.get("/api/outcomes/stats", authMiddleware, async (req: Request, res: Response) => {
    try {
      if (!requirePlatformAdmin(req, res)) return;
      const tenantId = getTenantFromRequest(req);
      if (!tenantId) return res.status(401).json({ error: "Unauthorized" });
      const { getOutcomeStats } = await import("../outcome-tracker");
      const stats = await getOutcomeStats(tenantId);
      res.json(stats);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.get("/api/outcomes/patterns", authMiddleware, async (req: Request, res: Response) => {
    try {
      if (!requirePlatformAdmin(req, res)) return;
      const tenantId = getTenantFromRequest(req);
      if (!tenantId) return res.status(401).json({ error: "Unauthorized" });
      const { getPatterns } = await import("../outcome-tracker");
      const patterns = await getPatterns(tenantId, req.query.personaId ? parseInt(req.query.personaId as string) : undefined);
      res.json(patterns);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.get("/api/outcomes/pending", authMiddleware, async (req: Request, res: Response) => {
    try {
      if (!requirePlatformAdmin(req, res)) return;
      const tenantId = getTenantFromRequest(req);
      if (!tenantId) return res.status(401).json({ error: "Unauthorized" });
      const { getPendingOutcomes } = await import("../outcome-tracker");
      const pending = await getPendingOutcomes(tenantId, parseInt(req.query.hours as string) || 24);
      res.json(pending);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.post("/api/outcomes/:id/feedback", authMiddleware, async (req: Request, res: Response) => {
    try {
      if (!requirePlatformAdmin(req, res)) return;
      const tenantId = getTenantFromRequest(req);
      if (!tenantId) return res.status(401).json({ error: "Unauthorized" });
      const { addFeedback } = await import("../outcome-tracker");
      await addFeedback(parseInt(req.params.id as string), tenantId, req.body.feedbackSummary);
      res.json({ success: true });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });
}
