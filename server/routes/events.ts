/**
 * Events API routes — extracted from server/routes.ts (R59 monolith decomposition).
 *
 * Domain: server-side event bus (event log, types, emit, subscriptions, stats).
 * All event-bus exports that were ONLY used by these routes were moved here too.
 * `emitEvent` stays imported in routes.ts because non-events code paths use it
 * (delivery pipeline, conversation hooks, etc).
 */
import type { Express, Request, Response } from "express";
import {
  getEventTypes,
  getEventLog,
  getEventDetail,
  emitEvent,
  getEventSubscriptions,
  createEventSubscription,
  updateEventSubscription,
  deleteEventSubscription,
  getEventStats,
} from "../event-bus";

type EventsHelpers = {
  authMiddleware: any;
  getTenantFromRequest: (req: Request) => number | null;
  isAdminRequest: (req: Request) => boolean;
};

export function registerEventsRoutes(app: Express, helpers: EventsHelpers) {
  const { authMiddleware, getTenantFromRequest, isAdminRequest } = helpers;

  app.get("/api/events/types", authMiddleware, async (req: Request, res: Response) => {
    try {
      res.json(getEventTypes());
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.get("/api/events/log", authMiddleware, async (req: Request, res: Response) => {
    try {
      if (!isAdminRequest(req)) return res.status(403).json({ error: "Admin access required" });
      const tenantId = getTenantFromRequest(req);
      if (!tenantId) return res.status(401).json({ error: "Unauthorized" });
      const events = await getEventLog(tenantId, {
        eventType: req.query.type as string,
        status: req.query.status as string,
        limit: parseInt(req.query.limit as string) || 50,
        offset: parseInt(req.query.offset as string) || 0,
      });
      res.json(events);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.get("/api/events/log/:id", authMiddleware, async (req: Request, res: Response) => {
    try {
      const tenantId = getTenantFromRequest(req);
      if (!tenantId) return res.status(401).json({ error: "Unauthorized" });
      const event = await getEventDetail(tenantId, parseInt(req.params.id as string));
      if (!event) return res.status(404).json({ error: "Event not found" });
      res.json(event);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.post("/api/events/emit", authMiddleware, async (req: Request, res: Response) => {
    try {
      const tenantId = getTenantFromRequest(req);
      if (!tenantId) return res.status(401).json({ error: "Unauthorized" });
      const { type, source, data } = req.body;
      if (!type) return res.status(400).json({ error: "type required" });
      const eventId = await emitEvent({ type, source: source || "manual", tenantId, data });
      res.json({ eventId });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.get("/api/events/subscriptions", authMiddleware, async (req: Request, res: Response) => {
    try {
      if (!isAdminRequest(req)) return res.status(403).json({ error: "Admin access required" });
      const tenantId = getTenantFromRequest(req);
      if (!tenantId) return res.status(401).json({ error: "Unauthorized" });
      const subs = await getEventSubscriptions(tenantId);
      res.json(subs);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.post("/api/events/subscriptions", authMiddleware, async (req: Request, res: Response) => {
    try {
      if (!isAdminRequest(req)) return res.status(403).json({ error: "Admin access required" });
      const tenantId = getTenantFromRequest(req);
      if (!tenantId) return res.status(401).json({ error: "Unauthorized" });
      const sub = await createEventSubscription(tenantId, req.body);
      res.json(sub);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.patch("/api/events/subscriptions/:id", authMiddleware, async (req: Request, res: Response) => {
    try {
      if (!isAdminRequest(req)) return res.status(403).json({ error: "Admin access required" });
      const tenantId = getTenantFromRequest(req);
      if (!tenantId) return res.status(401).json({ error: "Unauthorized" });
      const sub = await updateEventSubscription(tenantId, parseInt(req.params.id as string), req.body);
      res.json(sub);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.delete("/api/events/subscriptions/:id", authMiddleware, async (req: Request, res: Response) => {
    try {
      if (!isAdminRequest(req)) return res.status(403).json({ error: "Admin access required" });
      const tenantId = getTenantFromRequest(req);
      if (!tenantId) return res.status(401).json({ error: "Unauthorized" });
      await deleteEventSubscription(tenantId, parseInt(req.params.id as string));
      res.json({ success: true });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.get("/api/events/stats", authMiddleware, async (req: Request, res: Response) => {
    try {
      if (!isAdminRequest(req)) return res.status(403).json({ error: "Admin access required" });
      const tenantId = getTenantFromRequest(req);
      if (!tenantId) return res.status(401).json({ error: "Unauthorized" });
      const stats = await getEventStats(tenantId);
      res.json(stats);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });
}
