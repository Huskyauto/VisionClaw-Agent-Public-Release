import type { Express, Request, Response, RequestHandler } from "express";
import { listOwnerAlerts, readOwnerAlert } from "../lib/owner-alert-archive";
import { validAlertId } from "../lib/owner-alert-archive-core";

export interface OwnerAlertRoutePorts {
  authMiddleware: RequestHandler;
  requirePlatformAdmin(req: Request, res: Response): boolean;
  list: typeof listOwnerAlerts;
  read: typeof readOwnerAlert;
}
export function registerOwnerAlertRoutes(app: Express, supplied: Pick<OwnerAlertRoutePorts, "authMiddleware" | "requirePlatformAdmin"> & Partial<OwnerAlertRoutePorts>) {
  const ports: OwnerAlertRoutePorts = { list: listOwnerAlerts, read: readOwnerAlert, ...supplied };
  const owner: RequestHandler = (req, res, next) => {
    res.setHeader("Cache-Control", "private, no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    if (ports.requirePlatformAdmin(req, res)) next();
  };
  app.get("/api/admin/alert-logs", ports.authMiddleware, owner, async (req, res) => {
    const raw = req.query.page ?? "0";
    if (typeof raw !== "string" || !/^\d{1,3}$/.test(raw) || Number(raw) > 400)
      return res.status(400).json({ error: "Invalid page" });
    try { res.json(await ports.list(Number(raw))); }
    catch { res.status(503).json({ error: "Private alert archive unavailable. Details were not loaded; retry shortly." }); }
  });
  for (const download of [false, true]) {
    app.get(`/api/admin/alert-logs/:id${download ? "/download" : ""}`, ports.authMiddleware, owner, async (req, res) => {
      const id = req.params.id;
      if (typeof id !== "string" || !validAlertId(id)) return res.status(400).json({ error: "Invalid alert id" });
      try {
        const row = await ports.read(id);
        if (!row) return res.status(404).json({ error: "Alert not found" });
        if (download) {
          res.setHeader("Content-Disposition", `attachment; filename="alert-${row.id}.json"`);
          res.type("application/json").send(JSON.stringify(row, null, 2));
        } else res.json(row);
      } catch { res.status(503).json({ error: "Private alert details unavailable. Retry shortly." }); }
    });
  }
}
