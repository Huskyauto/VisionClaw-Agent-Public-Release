// R74.13s Stage 14 — Minds Engine routes extracted from server/routes.ts.
// 12 platform-admin routes for the Imbue simple_mind-inspired engine: minds
// CRUD + dashboard, tickets (create/list/delegate/verify/status), events,
// idle processing, and memory updates. All routes preserve exact behavior:
// authMiddleware → requirePlatformAdmin → getTenantFromRequest, with the
// minds-engine functions loaded via dynamic imports (matches the original
// monolith style and keeps the engine off the cold-start path).
import type { Express, Request, Response } from "express";
import { scanContextContent } from "../prompt-injection-scanner";

type MindsHelpers = {
  authMiddleware: any;
  getTenantFromRequest: (req: Request) => number | null;
  requirePlatformAdmin: (req: Request, res: Response) => boolean;
};

export function registerMindsRoutes(app: Express, helpers: MindsHelpers) {
  const { authMiddleware, getTenantFromRequest, requirePlatformAdmin } = helpers;

  app.post("/api/minds", authMiddleware, async (req, res) => {
    if (!requirePlatformAdmin(req, res)) return;
    try {
      const { createMind } = await import("../minds-engine");
      const tenantId = getTenantFromRequest(req);
      if (!tenantId) return res.status(403).json({ error: "Tenant resolution failed" });
      const name = typeof req.body?.name === "string" ? req.body.name.slice(0, 200) : "";
      if (!name) return res.status(400).json({ error: "name is required" });
      const purpose = typeof req.body?.purpose === "string" ? req.body.purpose.slice(0, 4000) : "";
      if (!purpose) return res.status(400).json({ error: "purpose is required" });
      const soul = typeof req.body?.soul === "string" ? req.body.soul.slice(0, 2000) : undefined;
      // R94 SECURITY — soul becomes the mind's system prompt; reject injection patterns.
      if (soul) {
        const scan = scanContextContent(soul, "mind.soul");
        if (!scan.clean) {
          return res.status(400).json({
            error: "Mind 'soul' field contains prompt-injection patterns. Remove or sanitize before saving.",
            findings: scan.findings,
          });
        }
      }
      const config = typeof req.body?.config === "object" ? req.body.config : undefined;
      const talkingPersonaId = typeof req.body?.talkingPersonaId === "number" ? req.body.talkingPersonaId : undefined;
      const thinkingPersonaId = typeof req.body?.thinkingPersonaId === "number" ? req.body.thinkingPersonaId : undefined;
      const maxConcurrentWorkers = typeof req.body?.maxConcurrentWorkers === "number" ? req.body.maxConcurrentWorkers : undefined;
      const result = await createMind({ tenantId, name, purpose, soul, config, talkingPersonaId, thinkingPersonaId, maxConcurrentWorkers });
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/minds", authMiddleware, async (req, res) => {
    if (!requirePlatformAdmin(req, res)) return;
    try {
      const { listMinds } = await import("../minds-engine");
      const tenantId = getTenantFromRequest(req);
      if (!tenantId) return res.status(403).json({ error: "Tenant resolution failed" });
      const minds = await listMinds(tenantId);
      res.json(minds);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/minds/:id", authMiddleware, async (req, res) => {
    if (!requirePlatformAdmin(req, res)) return;
    try {
      const { getMindDashboard } = await import("../minds-engine");
      const tenantId = getTenantFromRequest(req);
      if (!tenantId) return res.status(403).json({ error: "Tenant resolution failed" });
      const mindId = parseInt(req.params.id as string);
      if (isNaN(mindId) || mindId <= 0) return res.status(400).json({ error: "Invalid mind ID" });
      const dashboard = await getMindDashboard(mindId, tenantId);
      if (!dashboard.mind) return res.status(404).json({ error: "Mind not found" });
      res.json(dashboard);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.patch("/api/minds/:id", authMiddleware, async (req, res) => {
    if (!requirePlatformAdmin(req, res)) return;
    try {
      const { updateMind } = await import("../minds-engine");
      const tenantId = getTenantFromRequest(req);
      if (!tenantId) return res.status(403).json({ error: "Tenant resolution failed" });
      const mindId = parseInt(req.params.id as string);
      if (isNaN(mindId) || mindId <= 0) return res.status(400).json({ error: "Invalid mind ID" });
      // R94 SECURITY — scan soul update for injection patterns before persist.
      if (typeof req.body?.soul === "string" && req.body.soul.length > 0) {
        const scan = scanContextContent(req.body.soul, "mind.soul");
        if (!scan.clean) {
          return res.status(400).json({
            error: "Mind 'soul' field contains prompt-injection patterns. Remove or sanitize before saving.",
            findings: scan.findings,
          });
        }
      }
      const result = await updateMind(mindId, tenantId, {
        name: typeof req.body?.name === "string" ? req.body.name : undefined,
        purpose: typeof req.body?.purpose === "string" ? req.body.purpose : undefined,
        soul: typeof req.body?.soul === "string" ? req.body.soul : undefined,
        status: typeof req.body?.status === "string" ? req.body.status : undefined,
        config: typeof req.body?.config === "object" ? req.body.config : undefined,
        maxConcurrentWorkers: typeof req.body?.maxConcurrentWorkers === "number" ? req.body.maxConcurrentWorkers : undefined,
      });
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/minds/:id/tickets", authMiddleware, async (req, res) => {
    if (!requirePlatformAdmin(req, res)) return;
    try {
      const { createTicket } = await import("../minds-engine");
      const tenantId = getTenantFromRequest(req);
      if (!tenantId) return res.status(403).json({ error: "Tenant resolution failed" });
      const mindId = parseInt(req.params.id as string);
      if (isNaN(mindId) || mindId <= 0) return res.status(400).json({ error: "Invalid mind ID" });
      const title = typeof req.body?.title === "string" ? req.body.title.slice(0, 500) : "";
      if (!title) return res.status(400).json({ error: "title is required" });
      const description = typeof req.body?.description === "string" ? req.body.description.slice(0, 4000) : "";
      const acceptanceCriteria = typeof req.body?.acceptanceCriteria === "string" ? req.body.acceptanceCriteria.slice(0, 2000) : undefined;
      const priority = typeof req.body?.priority === "number" ? req.body.priority : undefined;
      const ticketType = typeof req.body?.ticketType === "string" ? req.body.ticketType.slice(0, 50) : undefined;
      const dependsOn = Array.isArray(req.body?.dependsOn) ? req.body.dependsOn.filter((n: any) => typeof n === "number") : undefined;
      const result = await createTicket({ mindId, tenantId, title, description, acceptanceCriteria, priority, ticketType, dependsOn });
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/minds/:id/tickets", authMiddleware, async (req, res) => {
    if (!requirePlatformAdmin(req, res)) return;
    try {
      const { listTickets } = await import("../minds-engine");
      const tenantId = getTenantFromRequest(req);
      if (!tenantId) return res.status(403).json({ error: "Tenant resolution failed" });
      const mindId = parseInt(req.params.id as string);
      if (isNaN(mindId) || mindId <= 0) return res.status(400).json({ error: "Invalid mind ID" });
      const status = typeof req.query.status === "string" ? req.query.status : undefined;
      const priority = typeof req.query.priority === "string" ? parseInt(req.query.priority) : undefined;
      const tickets = await listTickets(mindId, tenantId, { status, priority: isNaN(priority!) ? undefined : priority });
      res.json(tickets);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/minds/tickets/:id/delegate", authMiddleware, async (req, res) => {
    if (!requirePlatformAdmin(req, res)) return;
    try {
      const { delegateTicketToWorker } = await import("../minds-engine");
      const tenantId = getTenantFromRequest(req);
      if (!tenantId) return res.status(403).json({ error: "Tenant resolution failed" });
      const ticketId = parseInt(req.params.id as string);
      if (isNaN(ticketId) || ticketId <= 0) return res.status(400).json({ error: "Invalid ticket ID" });
      const personaId = typeof req.body?.personaId === "number" ? req.body.personaId : undefined;
      const model = typeof req.body?.model === "string" ? req.body.model : undefined;
      const result = await delegateTicketToWorker(ticketId, tenantId, { personaId, model });
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/minds/tickets/:id/verify", authMiddleware, async (req, res) => {
    if (!requirePlatformAdmin(req, res)) return;
    try {
      const { verifyTicketResult } = await import("../minds-engine");
      const tenantId = getTenantFromRequest(req);
      if (!tenantId) return res.status(403).json({ error: "Tenant resolution failed" });
      const ticketId = parseInt(req.params.id as string);
      if (isNaN(ticketId) || ticketId <= 0) return res.status(400).json({ error: "Invalid ticket ID" });
      const result = await verifyTicketResult(ticketId, tenantId);
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/minds/tickets/:id/status", authMiddleware, async (req, res) => {
    if (!requirePlatformAdmin(req, res)) return;
    try {
      const { updateTicketStatus } = await import("../minds-engine");
      const tenantId = getTenantFromRequest(req);
      if (!tenantId) return res.status(403).json({ error: "Tenant resolution failed" });
      const ticketId = parseInt(req.params.id as string);
      if (isNaN(ticketId) || ticketId <= 0) return res.status(400).json({ error: "Invalid ticket ID" });
      const status = typeof req.body?.status === "string" ? req.body.status : "";
      if (!status) return res.status(400).json({ error: "status is required" });
      const result = await updateTicketStatus(ticketId, tenantId, status);
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/minds/:id/events", authMiddleware, async (req, res) => {
    if (!requirePlatformAdmin(req, res)) return;
    try {
      const { emitEvent } = await import("../minds-engine");
      const tenantId = getTenantFromRequest(req);
      if (!tenantId) return res.status(403).json({ error: "Tenant resolution failed" });
      const mindId = parseInt(req.params.id as string);
      if (isNaN(mindId) || mindId <= 0) return res.status(400).json({ error: "Invalid mind ID" });
      const eventType = typeof req.body?.eventType === "string" ? req.body.eventType.slice(0, 100) : "";
      if (!eventType) return res.status(400).json({ error: "eventType is required" });
      const source = typeof req.body?.source === "string" ? req.body.source.slice(0, 200) : "user";
      const payload = typeof req.body?.payload === "object" ? req.body.payload : {};
      const result = await emitEvent({ mindId, tenantId, eventType, source, payload });
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/minds/:id/idle", authMiddleware, async (req, res) => {
    if (!requirePlatformAdmin(req, res)) return;
    try {
      const { processIdleCheck } = await import("../minds-engine");
      const tenantId = getTenantFromRequest(req);
      if (!tenantId) return res.status(403).json({ error: "Tenant resolution failed" });
      const mindId = parseInt(req.params.id as string);
      if (isNaN(mindId) || mindId <= 0) return res.status(400).json({ error: "Invalid mind ID" });
      const result = await processIdleCheck(mindId, tenantId);
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/minds/:id/memory", authMiddleware, async (req, res) => {
    if (!requirePlatformAdmin(req, res)) return;
    try {
      const { updateMemory } = await import("../minds-engine");
      const tenantId = getTenantFromRequest(req);
      if (!tenantId) return res.status(403).json({ error: "Tenant resolution failed" });
      const mindId = parseInt(req.params.id as string);
      if (isNaN(mindId) || mindId <= 0) return res.status(400).json({ error: "Invalid mind ID" });
      const key = typeof req.body?.key === "string" ? req.body.key.slice(0, 200) : "";
      if (!key) return res.status(400).json({ error: "key is required" });
      const value = req.body?.value;
      const result = await updateMemory(mindId, tenantId, key, value);
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });
}
