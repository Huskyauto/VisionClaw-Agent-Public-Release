// R74.13t — Stage 25 of routes.ts decomposition.
// 6 routes for the Lobster pipeline runner: /api/lobster/workflows
// (GET list, POST save, /:name GET, /:name DELETE), /api/lobster/run (POST),
// /api/lobster/resume (POST).
//
// SECURITY (R74.13u-sec): hard-gated with `requirePlatformAdmin` (which checks
// BOTH `tenantId === ADMIN_TENANT_ID` AND `isAdminRequest(req)`). Lobster runs
// arbitrary shell commands (server/lobster.ts:356) and injects ADMIN_TENANT_ID
// into tool args by default, so the soft `isAdminRequest`-only gate previously
// in place would let any tenant whose user record had `isAdmin=true` execute
// host commands in the admin tenant's context. Replaced verbatim handler
// bodies with platform-admin-gated versions on 2026-04-27 audit.
import type { Express, Request, Response } from "express";
import { runLobster, saveWorkflow, deleteWorkflow } from "../lobster";

type LobsterHelpers = {
  authMiddleware: any;
  requirePlatformAdmin: (req: Request, res: Response) => boolean;
};

export function registerLobsterRoutes(app: Express, helpers: LobsterHelpers) {
  const { authMiddleware, requirePlatformAdmin } = helpers;

  // ─── Lobster Workflows ─────────────────────────────────────

  app.get("/api/lobster/workflows", authMiddleware, async (req, res) => {
    if (!requirePlatformAdmin(req, res)) return;
    const result = await runLobster({ action: "list" });
    res.json(result);
  });

  app.get("/api/lobster/workflows/:name", authMiddleware, async (req, res) => {
    if (!requirePlatformAdmin(req, res)) return;
    const result = await runLobster({ action: "get", workflowId: req.params.name as string });
    res.json(result);
  });

  app.post("/api/lobster/workflows", authMiddleware, async (req, res) => {
    if (!requirePlatformAdmin(req, res)) return;
    const { name, content } = req.body;
    if (!name || !content) return res.status(400).json({ error: "name and content required" });
    const result = saveWorkflow(name, content);
    if (!result.ok) return res.status(400).json(result);
    res.json(result);
  });

  app.delete("/api/lobster/workflows/:name", authMiddleware, async (req, res) => {
    if (!requirePlatformAdmin(req, res)) return;
    const result = deleteWorkflow((req.params.name as string));
    if (!result.ok) return res.status(400).json(result);
    res.json(result);
  });

  app.post("/api/lobster/run", authMiddleware, async (req, res) => {
    if (!requirePlatformAdmin(req, res)) return;
    try {
      const result = await runLobster({
        action: "run",
        pipeline: req.body.pipeline,
        argsJson: req.body.argsJson,
        timeoutMs: req.body.timeoutMs,
        maxStdoutBytes: req.body.maxStdoutBytes,
      });
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  app.post("/api/lobster/resume", authMiddleware, async (req, res) => {
    if (!requirePlatformAdmin(req, res)) return;
    try {
      const result = await runLobster({
        action: "resume",
        token: req.body.token,
        approve: req.body.approve ?? true,
      });
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

}
