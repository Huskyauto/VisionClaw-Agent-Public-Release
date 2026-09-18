// R74.13t — Stage 23 of routes.ts decomposition.
// 3 routes for the Agent Manager (mngr-inspired autonomous-agent control plane):
// POST /api/agents/autonomous, /api/agents/autonomous/{:id (DELETE),
// /:id/messages (GET)}. All hard-gated via `requirePlatformAdmin` (autonomous
// agents touch the global agent-manager singleton). Dynamic import of
// ../agent-manager kept inline (matches monolith style; avoids cold-start hit).
// Extracted verbatim from server/routes.ts L4886-L4953.
import type { Express, Request, Response } from "express";

type AgentManagerHelpers = {
  authMiddleware: any;
  getTenantFromRequest: (req: Request) => number | null;
  requirePlatformAdmin: (req: Request, res: Response) => boolean;
};

export function registerAgentManagerRoutes(app: Express, helpers: AgentManagerHelpers) {
  const { authMiddleware, getTenantFromRequest, requirePlatformAdmin } = helpers;

  // ─── Agent Manager (mngr-inspired) ───────────────────────────────────────

  app.post("/api/agents/autonomous", authMiddleware, async (req, res) => {
    if (!requirePlatformAdmin(req, res)) return;
    try {
      const { launchAutonomousConversation } = await import("../agent-manager");
      const tenantId = getTenantFromRequest(req);
      if (!tenantId) return res.status(403).json({ error: "Tenant resolution failed" });
      const task = typeof req.body?.task === "string" ? req.body.task.slice(0, 4000) : "";
      if (!task) return res.status(400).json({ error: "task is required (string, max 4000 chars)" });
      const personaId = typeof req.body?.personaId === "number" ? req.body.personaId : undefined;
      const model = typeof req.body?.model === "string" ? req.body.model : undefined;
      const result = await launchAutonomousConversation({ tenantId, task, personaId, model });
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/agents/autonomous", authMiddleware, async (req, res) => {
    if (!requirePlatformAdmin(req, res)) return;
    const { getAutonomousRunsByTenant } = await import("../agent-manager");
    const tenantId = getTenantFromRequest(req);
    if (!tenantId) return res.status(403).json({ error: "Tenant resolution failed" });
    res.json(getAutonomousRunsByTenant(tenantId));
  });

  app.get("/api/agents/autonomous/:runId", authMiddleware, async (req, res) => {
    if (!requirePlatformAdmin(req, res)) return;
    const { getAutonomousRun } = await import("../agent-manager");
    const tenantId = getTenantFromRequest(req);
    if (!tenantId) return res.status(403).json({ error: "Tenant resolution failed" });
    const run = getAutonomousRun((req.params.runId as string), tenantId);
    if (!run) return res.status(404).json({ error: "Run not found" });
    res.json(run);
  });

  app.post("/api/conversations/:id/fork", authMiddleware, async (req, res) => {
    if (!requirePlatformAdmin(req, res)) return;
    try {
      const { forkConversation } = await import("../agent-manager");
      const tenantId = getTenantFromRequest(req);
      if (!tenantId) return res.status(403).json({ error: "Tenant resolution failed" });
      const sourceId = parseInt(req.params.id as string);
      if (isNaN(sourceId) || sourceId <= 0) return res.status(400).json({ error: "Invalid conversation ID" });
      const messageLimit = typeof req.body?.messageLimit === "number" && req.body.messageLimit > 0 ? Math.min(req.body.messageLimit, 500) : undefined;
      const newTitle = typeof req.body?.newTitle === "string" ? req.body.newTitle.slice(0, 200) : undefined;
      const result = await forkConversation(sourceId, tenantId, { messageLimit, newTitle });
      if (!result.success) return res.status(400).json(result);
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/agents/status", authMiddleware, async (req, res) => {
    if (!requirePlatformAdmin(req, res)) return;
    try {
      const { getUnifiedAgentStatus } = await import("../agent-manager");
      const tenantId = getTenantFromRequest(req);
      if (!tenantId) return res.status(403).json({ error: "Tenant resolution failed" });
      const status = await getUnifiedAgentStatus(tenantId);
      res.json(status);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

}
