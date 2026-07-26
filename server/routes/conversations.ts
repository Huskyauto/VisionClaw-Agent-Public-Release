import type { Express, Request, Response, RequestHandler } from "express";
import { sql } from "drizzle-orm";
import { db } from "../db";
import { storage } from "../storage";
import { insertConversationSchema } from "@shared/schema";
import { logSilentCatch } from "../lib/silent-catch";
import { getModelForTierAsync } from "../providers";

type ConversationsHelpers = {
  getTenantFromRequest: (req: Request) => number | null;
  getTenantFromRequestAsync: (req: Request) => Promise<number | null>;
  ADMIN_TENANT_ID: number;
  isAdminRequest: (req: Request) => boolean;
  mutateLimiter: RequestHandler;
  validateModelForTenant: (modelId: string, tenantId: number) => Promise<boolean>;
};

export function registerConversationsRoutes(app: Express, helpers: ConversationsHelpers) {
  const {
    getTenantFromRequest,
    getTenantFromRequestAsync,
    ADMIN_TENANT_ID,
    isAdminRequest,
    mutateLimiter,
    validateModelForTenant,
  } = helpers;

  // ─── Conversations ───────────────────────────────────────
  app.get("/api/conversations", async (req: Request, res: Response) => {
    const limit = req.query.limit ? parseInt(req.query.limit as string) : 50;
    const offset = req.query.offset ? parseInt(req.query.offset as string) : 0;
    const tenantId = await getTenantFromRequestAsync(req);
    if (!tenantId) return res.status(401).json({ error: "Authentication required" });
    const result = await storage.getConversations(limit, offset, tenantId);
    console.log(`[conversations] GET tenant=${tenantId} total=${result.total} returned=${result.data.length}`);
    res.set("Cache-Control", "no-cache, no-store");
    res.json(result);
  });

  app.post("/api/conversations", async (req: Request, res: Response) => {
    const parsed = insertConversationSchema.partial().safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.message });

    const tenantId = getTenantFromRequest(req);
    if (!tenantId) return res.status(401).json({ error: "Authentication required" });
    const tenant = await storage.getTenant(tenantId);

    if (tenant && tenant.plan === "trial") {
      const { PLAN_LIMITS } = await import("../usage-metering");
      const trialLimits = PLAN_LIMITS.trial;
      if (trialLimits.conversationsPerMonth !== -1 && tenant.trialConversationsUsed >= tenant.trialMaxConversations) {
        return res.status(403).json({
          error: "Trial limit reached",
          trialExhausted: true,
          message: `You've used all ${tenant.trialMaxConversations} free conversations. Please upgrade to continue using VisionClaw.`,
          trialConversationsUsed: tenant.trialConversationsUsed,
          trialMaxConversations: tenant.trialMaxConversations,
        });
      }
    }

    const activePersona = await storage.getActivePersona();
    const settings = await storage.getSettings();

    let personaReasoningConfig: any = {};
    if (activePersona?.id) {
      try {
        const rcResult = await db.execute(sql`SELECT reasoning_config FROM personas WHERE id = ${activePersona.id}`);
        const rcRows = (rcResult as any).rows || rcResult;
        personaReasoningConfig = rcRows?.[0]?.reasoning_config || {};
      } catch (_silentErr) { logSilentCatch("server/routes/conversations.ts", _silentErr); }
    }

    let requestedModel = parsed.data.model || personaReasoningConfig.preferredModel || settings?.defaultModel || "gpt-5.6-sol";
    if (!parsed.data.model && personaReasoningConfig.reasoningTier && !personaReasoningConfig.preferredModel) {
      try {
        const tierModel = await getModelForTierAsync(personaReasoningConfig.reasoningTier);
        if (tierModel) requestedModel = tierModel;
      } catch (_silentErr) { logSilentCatch("server/routes/conversations.ts", _silentErr); }
    }
    const modelAllowed = await validateModelForTenant(requestedModel, tenantId);
    const finalModel = modelAllowed ? requestedModel : "deepseek/deepseek-v3.2";
    const conv = await storage.createConversation({
      title: parsed.data.title || "New Chat",
      model: finalModel,
      thinking: true,
      thinkingLevel: parsed.data.thinkingLevel || personaReasoningConfig.thinkingLevel || "auto",
      personaId: activePersona?.id ?? null,
      tenantId,
    });

    const projectId = req.body.projectId ? parseInt(String(req.body.projectId)) : null;
    if (projectId && !isNaN(projectId)) {
      try {
        const projCheck = await db.execute(sql`SELECT id FROM projects WHERE id = ${projectId} AND tenant_id = ${tenantId}`);
        const projRows = (projCheck as any).rows || projCheck;
        if (Array.isArray(projRows) && projRows.length > 0) {
          await db.execute(sql`UPDATE conversations SET project_id = ${projectId} WHERE id = ${conv.id}`);
          const exCheck = await db.execute(sql`SELECT id FROM project_conversations WHERE project_id = ${projectId} AND conversation_id = ${conv.id}`);
          const exRows = (exCheck as any).rows || exCheck;
          if (!Array.isArray(exRows) || exRows.length === 0) {
            await db.execute(sql`INSERT INTO project_conversations (project_id, conversation_id) VALUES (${projectId}, ${conv.id})`);
          }
          await db.execute(sql`UPDATE projects SET updated_at = CURRENT_TIMESTAMP WHERE id = ${projectId}`);
        }
      } catch (_silentErr) { logSilentCatch("server/routes/conversations.ts", _silentErr); }
    }

    if (tenant && tenant.plan === "trial") {
      await storage.incrementTenantTrialUsage(tenantId);
    }

    try {
      const { trackConversation } = await import("../usage-metering");
      await trackConversation(tenantId);
    } catch (_silentErr) { logSilentCatch("server/routes/conversations.ts", _silentErr); }

    res.status(201).json({ ...conv, projectId });
  });

  app.get("/api/conversations/trash", async (req: Request, res: Response) => {
    const tenantId = getTenantFromRequest(req);
    if (!tenantId) return res.status(401).json({ error: "Authentication required" });
    try {
      const { getDeletedConversations } = await import("../data-protection");
      const deleted = await getDeletedConversations(tenantId);
      res.json(deleted);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/conversations/:id", async (req: Request, res: Response) => {
    const id = parseInt(req.params.id as string);
    const tenantId = getTenantFromRequest(req);
    if (!tenantId) return res.status(401).json({ error: "Authentication required" });
    // Defense-in-depth: enforce tenant scope at SQL layer for non-admins so
    // even a missing in-handler ownership check cannot leak rows.
    const conv = isAdminRequest(req)
      ? await storage.getConversationUnscoped(id)
      : await storage.getConversation(id, tenantId);
    if (!conv) return res.status(404).json({ error: "Not found" });
    if (conv.tenantId !== tenantId && !isAdminRequest(req)) {
      return res.status(403).json({ error: "Access denied" });
    }
    const limit = Math.min(parseInt(req.query.limit as string) || 200, 500);
    const offset = Math.max(parseInt(req.query.offset as string) || 0, 0);
    const { messages: msgs, total: totalMessages } = await storage.getMessagesPaginated(id, limit, offset, conv.tenantId ?? tenantId);
    let linkedProject: { id: number; name: string; status: string } | null = null;
    try {
      const projResult = await db.execute(sql`
        SELECT p.id, p.name, p.status FROM projects p
        JOIN conversations c ON c.project_id = p.id
        WHERE c.id = ${id}
          AND c.tenant_id = ${tenantId}
          AND p.tenant_id = ${tenantId}
      `);
      const projRows = (projResult as any).rows || projResult;
      if (Array.isArray(projRows) && projRows.length > 0) {
        linkedProject = { id: projRows[0].id, name: projRows[0].name, status: projRows[0].status };
      }
    } catch (_silentErr) { logSilentCatch("server/routes/conversations.ts", _silentErr); }
    res.json({ ...conv, messages: msgs, totalMessages, linkedProject });
  });

  app.patch("/api/conversations/:id", mutateLimiter, async (req: Request, res: Response) => {
    const tenantId = getTenantFromRequest(req);
    if (!tenantId) return res.status(401).json({ error: "Authentication required" });
    const id = parseInt(req.params.id as string);
    const conv = isAdminRequest(req)
      ? await storage.getConversationUnscoped(id)
      : await storage.getConversation(id, tenantId);
    if (!conv) return res.status(404).json({ error: "Not found" });
    if (conv.tenantId !== tenantId && !isAdminRequest(req)) {
      return res.status(403).json({ error: "Access denied" });
    }
    const parsed = insertConversationSchema.partial().safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.message });
    const updateData = { ...parsed.data };
    if (updateData.model) {
      const modelAllowed = await validateModelForTenant(updateData.model, tenantId);
      if (!modelAllowed) {
        updateData.model = "deepseek/deepseek-v3.2";
      }
    }
    if (updateData.thinkingLevel !== undefined) {
      updateData.thinking = updateData.thinkingLevel !== "off";
    } else if (updateData.thinking !== undefined && updateData.thinkingLevel === undefined) {
      updateData.thinkingLevel = updateData.thinking ? "medium" : "off";
    }
    const updated = await storage.updateConversation(id, updateData, conv.tenantId ?? tenantId);
    if (!updated) return res.status(404).json({ error: "Not found" });
    res.json(updated);
  });

  app.delete("/api/conversations/:id", mutateLimiter, async (req: Request, res: Response) => {
    const tenantId = getTenantFromRequest(req);
    if (!tenantId) return res.status(401).json({ error: "Authentication required" });
    const id = parseInt(req.params.id as string);
    const conv = isAdminRequest(req)
      ? await storage.getConversationUnscoped(id)
      : await storage.getConversation(id, tenantId);
    if (!conv) return res.status(404).json({ error: "Not found" });
    if (conv.tenantId !== tenantId && !isAdminRequest(req)) {
      return res.status(403).json({ error: "Access denied" });
    }
    try {
      const projResult = await db.execute(sql`
        SELECT c.project_id FROM conversations c
        JOIN projects p ON p.id = c.project_id
        WHERE c.id = ${id} AND c.project_id IS NOT NULL
          AND p.tenant_id = ${conv.tenantId ?? tenantId}
      `);
      const projRows = (projResult as any).rows || projResult;
      if (Array.isArray(projRows) && projRows.length > 0 && projRows[0].project_id) {
        const projId = projRows[0].project_id;
        const msgs = await storage.getMessages(id, conv.tenantId ?? tenantId);
        if (msgs.length > 0) {
          const recentFirst = [...msgs].reverse();
          const summaryParts = recentFirst.slice(0, 60).map(m => {
            const text = typeof m.content === "string" ? m.content : "";
            const clean = text.replace(/<!--[\s\S]*?-->/g, "").trim();
            return clean.length > 10 ? `[${m.role}]: ${clean.slice(0, 200)}` : null;
          }).filter(Boolean);
          if (summaryParts.length > 0) {
            const note = `Archive of deleted conversation "${conv.title}" (${msgs.length} messages, ${new Date(conv.createdAt).toLocaleDateString()}):\n${summaryParts.reverse().join("\n")}`;
            await db.execute(sql`
              INSERT INTO project_notes (project_id, note, author)
              VALUES (${projId}, ${note.slice(0, 8000)}, ${'system:archive'})
            `);
            console.log(`[archive] Saved conversation summary (${summaryParts.length} entries) to project #${projId}`);
          }
        }
      }
    } catch (archiveErr) {
      console.error("[archive] Failed to save conversation summary — aborting deletion to prevent data loss:", archiveErr);
      return res.status(500).json({ error: "Failed to archive project-linked conversation. Deletion cancelled to prevent data loss." });
    }
    await storage.deleteConversation(id, tenantId);
    res.json({ success: true, message: "Conversation moved to trash. Recoverable for 30 days." });
  });

  app.post("/api/conversations/:id/recover", mutateLimiter, async (req: Request, res: Response) => {
    const tenantId = getTenantFromRequest(req);
    if (!tenantId) return res.status(401).json({ error: "Authentication required" });
    const id = parseInt(req.params.id as string);
    try {
      const { recoverConversation } = await import("../data-protection");
      const result = await recoverConversation(id, tenantId);
      if (!result.success) return res.status(404).json({ error: result.error });
      res.json({ success: true, message: "Conversation recovered" });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/conversations/:id/pending-deliveries", async (req: Request, res: Response) => {
    const tenantId = getTenantFromRequest(req);
    if (!tenantId) return res.status(401).json({ error: "Authentication required" });
    const convId = parseInt(req.params.id as string);
    try {
      const rows = await db.execute(sql`SELECT id, delivery_type, payload, created_at FROM pending_deliveries WHERE conversation_id = ${convId} AND tenant_id = ${tenantId} AND delivered = FALSE ORDER BY created_at DESC LIMIT 5`);
      res.json({ deliveries: ((rows as any).rows || []).map((r: any) => ({ id: r.id, type: r.delivery_type, payload: r.payload, createdAt: r.created_at })) });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/conversations/:id/acknowledge-delivery", mutateLimiter, async (req: Request, res: Response) => {
    const tenantId = getTenantFromRequest(req);
    if (!tenantId) return res.status(401).json({ error: "Authentication required" });
    const convId = parseInt(req.params.id as string);
    const { deliveryId } = req.body;
    try {
      if (deliveryId) {
        await db.execute(sql`UPDATE pending_deliveries SET delivered = TRUE WHERE id = ${deliveryId} AND conversation_id = ${convId} AND tenant_id = ${tenantId}`);
      } else {
        await db.execute(sql`UPDATE pending_deliveries SET delivered = TRUE WHERE conversation_id = ${convId} AND tenant_id = ${tenantId} AND delivered = FALSE`);
      }
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });
}
