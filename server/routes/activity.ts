// R74.13v — Stage 33 of routes.ts decomposition.
// 1 route — GET /api/activity — paginated tenant-scoped activity log read with
// optional actorType + action filters. Tenant-gated; no admin requirement.
//
// Behavior preserved verbatim from monolith — no logic changes.

import type { Express, Request, Response } from "express";
import { eq, and, desc, sql } from "drizzle-orm";
import { db } from "../db";
import { activityLog } from "@shared/schema";

type ActivityHelpers = {
  authMiddleware: any;
  getTenantFromRequest: (req: Request) => number | null;
};

export function registerActivityRoutes(app: Express, helpers: ActivityHelpers) {
  const { authMiddleware, getTenantFromRequest } = helpers;

  // ═══════════════════════════════════════════════════════════════
  // ACTIVITY LOG
  // ═══════════════════════════════════════════════════════════════
  app.get("/api/activity", authMiddleware, async (req, res) => {
    try {
      const tenantId = getTenantFromRequest(req);
      if (!tenantId) return res.status(403).json({ error: "Tenant required" });
      const limit = Math.min(parseInt(String(req.query.limit)) || 50, 200);
      const offset = parseInt(String(req.query.offset)) || 0;
      const actorType = req.query.actorType as string | undefined;
      const action = req.query.action as string | undefined;
      const conditions = [eq(activityLog.tenantId, tenantId)];
      if (actorType) conditions.push(eq(activityLog.actorType, actorType));
      if (action) conditions.push(eq(activityLog.action, action));
      const rows = await db.select().from(activityLog)
        .where(and(...conditions))
        .orderBy(desc(activityLog.createdAt))
        .limit(limit).offset(offset);
      const countResult = await db.select({ count: sql<number>`count(*)` })
        .from(activityLog).where(and(...conditions));
      res.json({ data: rows, total: Number(countResult[0]?.count || 0) });
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });
}
