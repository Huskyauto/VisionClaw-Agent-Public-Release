// R74.13v — Stage 34 of routes.ts decomposition (final stage of this round).
// 4 routes for the agent-channels surface:
//   • GET  /api/channels                   — list channels for tenant
//   • GET  /api/channels/unread            — per-persona unread counts
//   • GET  /api/channels/:channelId/messages — read messages from a channel
//   • POST /api/channels/messages          — post a new channel message
//
// All routes are tenant-gated via authMiddleware + getTenantFromRequest.
// Behavior preserved verbatim from monolith — no logic changes.

import type { Express, Request, Response } from "express";
import {
  getChannels,
  postMessage as postChannelMessage,
  readMessages as readChannelMessages,
  getUnreadCount,
} from "../agent-channels";

type ChannelsHelpers = {
  authMiddleware: any;
  getTenantFromRequest: (req: Request) => number | null;
};

export function registerChannelsRoutes(app: Express, helpers: ChannelsHelpers) {
  const { authMiddleware, getTenantFromRequest } = helpers;

  app.get("/api/channels", authMiddleware, async (req: Request, res: Response) => {
    try {
      const tenantId = getTenantFromRequest(req);
      if (!tenantId) return res.status(401).json({ error: "Unauthorized" });
      const channels = await getChannels(tenantId);
      res.json(channels);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.get("/api/channels/unread", authMiddleware, async (req: Request, res: Response) => {
    try {
      const tenantId = getTenantFromRequest(req);
      if (!tenantId) return res.status(401).json({ error: "Unauthorized" });
      const personaId = parseInt(req.query.personaId as string) || 1;
      const counts = await getUnreadCount(tenantId, personaId);
      res.json(counts);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.get("/api/channels/:channelId/messages", authMiddleware, async (req: Request, res: Response) => {
    try {
      const tenantId = getTenantFromRequest(req);
      if (!tenantId) return res.status(401).json({ error: "Unauthorized" });
      const messages = await readChannelMessages({
        tenantId,
        channelId: parseInt(req.params.channelId as string),
        limit: parseInt(req.query.limit as string) || 50,
      });
      res.json(messages);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.post("/api/channels/messages", authMiddleware, async (req: Request, res: Response) => {
    try {
      const tenantId = getTenantFromRequest(req);
      if (!tenantId) return res.status(401).json({ error: "Unauthorized" });
      const { channelName, content, messageType, metadata } = req.body;
      if (!channelName || !content) return res.status(400).json({ error: "channelName and content required" });
      const msg = await postChannelMessage({ tenantId, channelName, content, messageType, metadata });
      res.json(msg);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });
}
