// R74.13u — Stage 28 of routes.ts decomposition.
// 6 routes for runtime stats / sessions / health:
//   /api/health, /api/stats, /api/sessions (GET list, /:sessionKey/history GET,
//   /send POST), /api/tool-audit.
// Mixed gating preserved verbatim from monolith:
//  • /api/health + /api/stats — tenant-only (any authenticated tenant)
//  • /api/sessions/* — requirePlatformAdmin (process-global session lookup)
//  • /api/tool-audit — uses the raw `tenantId === ADMIN_TENANT_ID && isAdminRequest`
//    pattern (NOT the requirePlatformAdmin wrapper) so monitoring scripts that
//    rely on the exact "Tool audit telemetry is platform-wide" error message
//    continue to work.
// /api/stats does drizzle queries via dynamic db import; preserved exactly.
// Extracted verbatim from server/routes.ts L6207-L6340.
import type { Express, Request, Response } from "express";
import { storage } from "../storage";
import { conversations, messages } from "@shared/schema";
import { getModelForTierAsync, TIER_COST_ESTIMATES } from "../providers";

type StatsHelpers = {
  authMiddleware: any;
  getTenantFromRequest: (req: Request) => number | null;
  requirePlatformAdmin: (req: Request, res: Response) => boolean;
  isAdminRequest: (req: Request) => boolean;
  ADMIN_TENANT_ID: number;
};

export function registerStatsRoutes(app: Express, helpers: StatsHelpers) {
  const { authMiddleware, getTenantFromRequest, requirePlatformAdmin, isAdminRequest, ADMIN_TENANT_ID } = helpers;

  // ─── Stats ─────────────────────────────────────────────────
  app.get("/api/health", authMiddleware, async (req: Request, res: Response) => {
    try {
      const tenantId = getTenantFromRequest(req);
      if (!tenantId) return res.status(401).json({ error: "Authentication required" });
      const { getLastHealthReport, runHealthChecks } = await import("../health-monitor");
      const { getWatchdogStats } = await import("../stability-watchdog");
      const { getPoolStats } = await import("../db");
      const { getVirtualPortStats } = await import("../virtual-ports");
      const forceRefresh = req.query.refresh === "true";
      const report = forceRefresh ? await runHealthChecks() : (getLastHealthReport() || await runHealthChecks());
      res.json({ ...report, watchdog: getWatchdogStats(), pool: getPoolStats(), virtualPorts: getVirtualPortStats() });
    } catch (err: any) {
      res.status(500).json({ error: "Health check failed: " + err.message });
    }
  });

  app.get("/api/stats", async (req, res) => {
    const tenantId = getTenantFromRequest(req);
    if (!tenantId) return res.status(401).json({ error: "Authentication required" });

    const { db } = await import("../db");
    const { sql: s } = await import("drizzle-orm");
    const [[convCount], [msgCount], activePersona, allPersonas, allTasks] = await Promise.all([
      db.select({ count: s<number>`count(*)::int` }).from(conversations).where(s`${conversations.tenantId} = ${tenantId}`),
      db.select({ count: s<number>`count(*)::int` }).from(messages).where(s`${messages.conversationId} IN (SELECT id FROM conversations WHERE tenant_id = ${tenantId})`),
      storage.getActivePersona(),
      storage.getPersonas(),
      storage.getHeartbeatTasks(undefined, tenantId),
    ]);
    const memResult = await storage.getMemoryEntries(activePersona?.id, 1, 0, tenantId);

    const tierBreakdown: Record<string, { personas: string[]; model: string; estimatedCostPer1kTasks: number }> = {};
    for (const tier of ["fast", "balanced", "powerful", "reasoning"] as const) {
      const tierPersonas = allPersonas.filter(p => p.costTier === tier);
      const model = await getModelForTierAsync(tier);
      const costs = TIER_COST_ESTIMATES[tier];
      const avgTokensPerTask = 2000;
      const costPer1k = ((avgTokensPerTask * costs.inputPer1M) + (avgTokensPerTask * costs.outputPer1M)) / 1000;
      tierBreakdown[tier] = {
        personas: tierPersonas.map(p => p.name),
        model,
        estimatedCostPer1kTasks: Math.round(costPer1k * 100) / 100,
      };
    }

    const enabledTasks = allTasks.filter(t => t.enabled);
    const powerfulIfAllPowerful = enabledTasks.length * (TIER_COST_ESTIMATES.powerful.inputPer1M + TIER_COST_ESTIMATES.powerful.outputPer1M) * 2000 / 1_000_000;
    const withTiering = enabledTasks.reduce((sum, t) => {
      const persona = t.personaId ? allPersonas.find(p => p.id === t.personaId) : null;
      const tier = persona?.costTier || "balanced";
      const costs = TIER_COST_ESTIMATES[tier as keyof typeof TIER_COST_ESTIMATES] || TIER_COST_ESTIMATES.balanced;
      return sum + (costs.inputPer1M + costs.outputPer1M) * 2000 / 1_000_000;
    }, 0);

    res.json({
      totalConversations: convCount.count,
      totalMessages: msgCount.count,
      totalMemories: memResult.total,
      activePersona: activePersona?.name || null,
      status: "online",
      uptime: process.uptime(),
      costRouting: {
        tierBreakdown,
        enabledTaskCount: enabledTasks.length,
        estimatedSavingsPercent: powerfulIfAllPowerful > 0 ? Math.round((1 - withTiering / powerfulIfAllPowerful) * 100) : 0,
        estimatedCostPerRunAllPowerful: Math.round(powerfulIfAllPowerful * 10000) / 10000,
        estimatedCostPerRunWithTiering: Math.round(withTiering * 10000) / 10000,
      },
    });
  });

  app.get("/api/sessions", authMiddleware, async (req: Request, res: Response) => {
    if (!requirePlatformAdmin(req, res)) return;
    try {
      const { sessionsList } = await import("../sessions");
      const kinds = req.query.kinds ? String(req.query.kinds).split(",") : undefined;
      const limit = req.query.limit ? parseInt(String(req.query.limit)) : undefined;
      const activeMinutes = req.query.activeMinutes ? parseInt(String(req.query.activeMinutes)) : undefined;
      const messageLimit = req.query.messageLimit ? parseInt(String(req.query.messageLimit)) : undefined;
      const _adminTid = getTenantFromRequest(req);
      if (!_adminTid) return res.status(401).json({ error: "Authentication required" });
      const sessions = await sessionsList({ kinds, limit, activeMinutes, messageLimit, tenantId: _adminTid });
      res.json({ sessions });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/sessions/:sessionKey/history", authMiddleware, async (req: Request, res: Response) => {
    if (!requirePlatformAdmin(req, res)) return;
    try {
      const { sessionsHistory } = await import("../sessions");
      const limit = req.query.limit ? parseInt(String(req.query.limit)) : undefined;
      const includeTools = req.query.includeTools === "true";
      const _adminTid = getTenantFromRequest(req);
      if (!_adminTid) return res.status(401).json({ error: "Authentication required" });
      const messages = await sessionsHistory({ sessionKey: (req.params.sessionKey as string), limit, includeTools, tenantId: _adminTid });
      res.json({ messages });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/sessions/send", authMiddleware, async (req: Request, res: Response) => {
    if (!requirePlatformAdmin(req, res)) return;
    try {
      const { sessionsSend } = await import("../sessions");
      const { sessionKey, message } = req.body;
      if (!sessionKey || !message) {
        return res.status(400).json({ error: "sessionKey and message are required" });
      }
      const _adminTid = getTenantFromRequest(req);
      if (!_adminTid) return res.status(401).json({ error: "Authentication required" });
      const result = await sessionsSend({ sessionKey, message, sourcePersonaName: "api", tenantId: _adminTid });
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/tool-audit", async (req: Request, res: Response) => {
    const tenantId = getTenantFromRequest(req);
    if (tenantId !== ADMIN_TENANT_ID || !isAdminRequest(req)) {
      return res.status(403).json({ error: "Admin access required. Tool audit telemetry is platform-wide." });
    }
    try {
      const { getRecentMutations, getMutationStats } = await import("../tool-mutation");
      const recent = getRecentMutations(50);
      const stats = getMutationStats();
      res.json({ recent, stats });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });
}
