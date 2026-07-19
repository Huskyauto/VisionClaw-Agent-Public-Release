// R74.13t — Stage 17 of routes.ts decomposition.
// 7 routes for the Watchlist Monitoring API:
// /api/watchlist (GET list, POST create), /api/watchlist/:id (PATCH, DELETE),
// /api/watchlist/alerts (GET), /api/watchlist/alerts/:id/acknowledge (POST),
// /api/watchlist/scan (POST). All routes platform-admin-gated.
// Extracted verbatim from server/routes.ts L8698-L8781.
import type { Express, Request, Response } from "express";

type WatchlistHelpers = {
  authMiddleware: any;
  getTenantFromRequest: (req: Request) => number | null;
  requirePlatformAdmin: (req: Request, res: Response) => boolean;
};

export function registerWatchlistRoutes(app: Express, helpers: WatchlistHelpers) {
  const { authMiddleware, getTenantFromRequest, requirePlatformAdmin } = helpers;

  // ═══════════════════════════════════════════════════════════════
  // WATCHLIST MONITORING API
  // ═══════════════════════════════════════════════════════════════

  app.get("/api/watchlist", authMiddleware, async (req: Request, res: Response) => {
    try {
      if (!requirePlatformAdmin(req, res)) return;
      const tenantId = getTenantFromRequest(req);
      if (!tenantId) return res.status(401).json({ error: "Unauthorized" });
      const { getWatchlistItems } = await import("../watchlist");
      const items = await getWatchlistItems(tenantId);
      res.json(items);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.post("/api/watchlist", authMiddleware, async (req: Request, res: Response) => {
    try {
      if (!requirePlatformAdmin(req, res)) return;
      const tenantId = getTenantFromRequest(req);
      if (!tenantId) return res.status(401).json({ error: "Unauthorized" });
      const { addWatchlistItem } = await import("../watchlist");
      const item = await addWatchlistItem({ tenantId, ...req.body });
      res.json(item);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.patch("/api/watchlist/:id", authMiddleware, async (req: Request, res: Response) => {
    try {
      if (!requirePlatformAdmin(req, res)) return;
      const tenantId = getTenantFromRequest(req);
      if (!tenantId) return res.status(401).json({ error: "Unauthorized" });
      const { updateWatchlistItem } = await import("../watchlist");
      await updateWatchlistItem(tenantId, parseInt(req.params.id as string), req.body);
      res.json({ success: true });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.delete("/api/watchlist/:id", authMiddleware, async (req: Request, res: Response) => {
    try {
      if (!requirePlatformAdmin(req, res)) return;
      const tenantId = getTenantFromRequest(req);
      if (!tenantId) return res.status(401).json({ error: "Unauthorized" });
      const { removeWatchlistItem } = await import("../watchlist");
      await removeWatchlistItem(tenantId, parseInt(req.params.id as string));
      res.json({ success: true });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.get("/api/watchlist/alerts", authMiddleware, async (req: Request, res: Response) => {
    try {
      if (!requirePlatformAdmin(req, res)) return;
      const tenantId = getTenantFromRequest(req);
      if (!tenantId) return res.status(401).json({ error: "Unauthorized" });
      const { getAlerts } = await import("../watchlist");
      const alerts = await getAlerts(tenantId, {
        watchlistItemId: req.query.itemId ? parseInt(req.query.itemId as string) : undefined,
        acknowledged: req.query.acknowledged === "true" ? true : req.query.acknowledged === "false" ? false : undefined,
        limit: parseInt(req.query.limit as string) || 50,
      });
      res.json(alerts);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.post("/api/watchlist/alerts/:id/acknowledge", authMiddleware, async (req: Request, res: Response) => {
    try {
      if (!requirePlatformAdmin(req, res)) return;
      const tenantId = getTenantFromRequest(req);
      if (!tenantId) return res.status(401).json({ error: "Unauthorized" });
      const { acknowledgeAlert } = await import("../watchlist");
      await acknowledgeAlert(tenantId, parseInt(req.params.id as string), req.body.personaId);
      res.json({ success: true });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.post("/api/watchlist/scan", authMiddleware, async (req: Request, res: Response) => {
    try {
      if (!requirePlatformAdmin(req, res)) return;
      const tenantId = getTenantFromRequest(req);
      if (!tenantId) return res.status(401).json({ error: "Unauthorized" });
      const { scanDueWatchlistItems } = await import("../watchlist");
      const result = await scanDueWatchlistItems(tenantId);
      res.json(result);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });
}
