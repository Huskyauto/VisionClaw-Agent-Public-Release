import type { Express, Request, Response } from "express";
import { sql, eq, and, desc } from "drizzle-orm";
import { db } from "../db";
import { notifications } from "@shared/schema";
import { validate, inboxReadSchema, inboxStarSchema } from "../validation";

type InboxNotificationsHelpers = {
  authMiddleware: any;
  getTenantFromRequest: (req: Request) => number | null;
  getTenantFromRequestAsync: (req: Request) => Promise<number | null>;
};

export function registerInboxNotificationsRoutes(app: Express, helpers: InboxNotificationsHelpers) {
  const { authMiddleware, getTenantFromRequest, getTenantFromRequestAsync } = helpers;

  // ─── Inbox (AgentMail-backed email surface) ──────────────────────────
  app.get("/api/inbox", async (req: Request, res: Response) => {
    const tenantId = await getTenantFromRequestAsync(req);
    if (!tenantId) return res.status(401).json({ error: "Not authenticated" });
    res.set("Cache-Control", "no-cache, no-store, must-revalidate");
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit as string) || 20));
    const offset = (page - 1) * limit;
    const filter = req.query.filter as string || "all";
    const direction = req.query.direction as string || "inbound";

    try {
      const filterCondition = filter === "unread"
        ? sql`AND is_read = FALSE`
        : filter === "starred"
          ? sql`AND is_starred = TRUE`
          : sql``;

      const dirCondition = direction === "outbound" ? sql`AND direction = 'outbound'` : sql`AND direction = 'inbound'`;

      const countResult = await db.execute(
        sql`SELECT COUNT(*) as total FROM inbox_messages WHERE tenant_id = ${tenantId} ${dirCondition} ${filterCondition}`
      );
      const total = parseInt(((countResult as any).rows || countResult)?.[0]?.total || "0");

      const messagesResult = await db.execute(
        sql`SELECT id, message_id, from_address, to_address, subject, LEFT(body_text, 200) as preview, received_at, is_read, is_starred, thread_id, direction
         FROM inbox_messages WHERE tenant_id = ${tenantId} ${dirCondition} ${filterCondition}
         ORDER BY received_at DESC
         LIMIT ${limit} OFFSET ${offset}`
      );
      const messages = ((messagesResult as any).rows || messagesResult) || [];

      res.json({ messages, total, page, limit, totalPages: Math.ceil(total / limit) });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.get("/api/inbox/info", async (req: Request, res: Response) => {
    const tenantId = await getTenantFromRequestAsync(req);
    if (!tenantId) return res.status(401).json({ error: "Not authenticated" });
    try {
      const result = await db.execute(
        sql`SELECT agentmail_inbox_id, agentmail_email FROM tenants WHERE id = ${tenantId} LIMIT 1`
      );
      const tenant = ((result as any).rows || result)?.[0];
      if (!tenant) return res.status(404).json({ error: "Tenant not found" });
      if (tenant.agentmail_inbox_id && tenant.agentmail_email) {
        return res.json({ email: tenant.agentmail_email, inboxId: tenant.agentmail_inbox_id, provisioned: true });
      }
      try {
        const { getOrCreateTenantInbox } = await import("../email");
        const inbox = await getOrCreateTenantInbox(tenantId);
        res.json({ email: inbox.email, inboxId: inbox.inboxId, provisioned: true });
      } catch (provErr: any) {
        res.json({ email: null, inboxId: null, provisioned: false, reason: "Inbox limit reached — contact admin" });
      }
    } catch (e: any) { res.status(500).json({ error: e.message, provisioned: false }); }
  });

  app.get("/api/inbox/unread-count", async (req: Request, res: Response) => {
    const tenantId = await getTenantFromRequestAsync(req);
    if (!tenantId) return res.status(401).json({ error: "Not authenticated" });
    res.set("Cache-Control", "no-cache, no-store, must-revalidate");
    try {
      const result = await db.execute(
        sql`SELECT COUNT(*) as count FROM inbox_messages WHERE tenant_id = ${tenantId} AND is_read = FALSE AND direction = 'inbound'`
      );
      const count = parseInt(((result as any).rows || result)?.[0]?.count || "0");
      res.json({ count });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.get("/api/inbox/:id", async (req: Request, res: Response) => {
    const tenantId = await getTenantFromRequestAsync(req);
    if (!tenantId) return res.status(401).json({ error: "Not authenticated" });
    res.set("Cache-Control", "no-cache, no-store, must-revalidate");
    const msgId = parseInt(req.params.id as string);
    try {
      const result = await db.execute(
        sql`SELECT * FROM inbox_messages WHERE id = ${msgId} AND tenant_id = ${tenantId}`
      );
      const msg = ((result as any).rows || result)?.[0];
      if (!msg) return res.status(404).json({ error: "Message not found" });

      if (!msg.is_read) {
        await db.execute(sql`UPDATE inbox_messages SET is_read = TRUE WHERE id = ${msg.id}`);
        msg.is_read = true;
      }
      res.json(msg);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.patch("/api/inbox/:id/read", validate(inboxReadSchema), async (req: Request, res: Response) => {
    const tenantId = await getTenantFromRequestAsync(req);
    if (!tenantId) return res.status(401).json({ error: "Not authenticated" });
    const isRead = req.body.is_read;
    const msgId = parseInt(req.params.id as string);
    try {
      await db.execute(
        sql`UPDATE inbox_messages SET is_read = ${isRead} WHERE id = ${msgId} AND tenant_id = ${tenantId}`
      );
      res.json({ ok: true });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.patch("/api/inbox/:id/star", validate(inboxStarSchema), async (req: Request, res: Response) => {
    const tenantId = await getTenantFromRequestAsync(req);
    if (!tenantId) return res.status(401).json({ error: "Not authenticated" });
    const isStarred = req.body.is_starred;
    const msgId = parseInt(req.params.id as string);
    try {
      await db.execute(
        sql`UPDATE inbox_messages SET is_starred = ${isStarred} WHERE id = ${msgId} AND tenant_id = ${tenantId}`
      );
      res.json({ ok: true });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.post("/api/inbox/mark-all-read", async (req: Request, res: Response) => {
    const tenantId = await getTenantFromRequestAsync(req);
    if (!tenantId) return res.status(401).json({ error: "Not authenticated" });
    try {
      const result = await db.execute(
        sql`UPDATE inbox_messages SET is_read = TRUE WHERE tenant_id = ${tenantId} AND is_read = FALSE`
      );
      res.json({ ok: true, updated: (result as any).rowCount || 0 });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.delete("/api/inbox/:id", async (req: Request, res: Response) => {
    const tenantId = await getTenantFromRequestAsync(req);
    if (!tenantId) return res.status(401).json({ error: "Not authenticated" });
    const msgId = parseInt(req.params.id as string);
    try {
      await db.execute(
        sql`DELETE FROM inbox_messages WHERE id = ${msgId} AND tenant_id = ${tenantId}`
      );
      res.json({ ok: true });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // ═══════════════════════════════════════════════════════════════
  // NOTIFICATIONS
  // ═══════════════════════════════════════════════════════════════
  app.get("/api/notifications", authMiddleware, async (req: Request, res: Response) => {
    try {
      const tenantId = getTenantFromRequest(req);
      if (!tenantId) return res.status(403).json({ error: "Tenant required" });
      const limit = parseInt(String(req.query.limit)) || 50;
      const unreadOnly = req.query.unread === "true";
      let query = db.select().from(notifications)
        .where(unreadOnly
          ? and(eq(notifications.tenantId, tenantId), eq(notifications.isRead, false))
          : eq(notifications.tenantId, tenantId))
        .orderBy(desc(notifications.createdAt))
        .limit(limit);
      const rows = await query;
      res.json(rows);
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  app.get("/api/notifications/count", authMiddleware, async (req: Request, res: Response) => {
    try {
      const tenantId = getTenantFromRequest(req);
      if (!tenantId) return res.status(403).json({ error: "Tenant required" });
      const result = await db.select({ count: sql<number>`count(*)` })
        .from(notifications)
        .where(and(eq(notifications.tenantId, tenantId), eq(notifications.isRead, false)));
      res.json({ unread: Number(result[0]?.count || 0) });
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  app.patch("/api/notifications/:id/read", authMiddleware, async (req: Request, res: Response) => {
    try {
      const tenantId = getTenantFromRequest(req);
      if (!tenantId) return res.status(403).json({ error: "Tenant required" });
      await db.update(notifications)
        .set({ isRead: true })
        .where(and(eq(notifications.id, parseInt(req.params.id as string)), eq(notifications.tenantId, tenantId)));
      res.json({ success: true });
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  app.post("/api/notifications/mark-all-read", authMiddleware, async (req: Request, res: Response) => {
    try {
      const tenantId = getTenantFromRequest(req);
      if (!tenantId) return res.status(403).json({ error: "Tenant required" });
      await db.update(notifications)
        .set({ isRead: true })
        .where(and(eq(notifications.tenantId, tenantId), eq(notifications.isRead, false)));
      res.json({ success: true });
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  app.delete("/api/notifications/:id", authMiddleware, async (req: Request, res: Response) => {
    try {
      const tenantId = getTenantFromRequest(req);
      if (!tenantId) return res.status(403).json({ error: "Tenant required" });
      await db.delete(notifications)
        .where(and(eq(notifications.id, parseInt(req.params.id as string)), eq(notifications.tenantId, tenantId)));
      res.json({ success: true });
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });
}
