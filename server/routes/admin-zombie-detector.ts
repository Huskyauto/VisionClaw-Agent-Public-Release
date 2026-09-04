import type { Express, Request, Response } from "express";
import { db } from "../db";
import { sql } from "drizzle-orm";

type Helpers = {
  authMiddleware: any;
  getTenantFromRequest: (req: Request) => number | null;
  isAdminRequest: (req: Request) => boolean;
  ADMIN_TENANT_ID: number;
};

const CACHE_TTL_MS = 60_000;
let cache: { ts: number; payload: any } | null = null;

export function registerZombieDetectorRoutes(app: Express, h: Helpers) {
  app.get("/api/admin/zombie-detector", h.authMiddleware, async (req: Request, res: Response) => {
    try {
      const tenantId = h.getTenantFromRequest(req);
      if (tenantId !== h.ADMIN_TENANT_ID || !h.isAdminRequest(req)) {
        return res.status(403).json({ error: "Admin access required" });
      }
      const windowDays = Math.min(365, Math.max(7, parseInt(String(req.query.windowDays || "30"), 10) || 30));
      const cacheKey = windowDays;
      if (cache && Date.now() - cache.ts < CACHE_TTL_MS && cache.payload.windowDays === cacheKey) {
        res.setHeader("X-Cache", "HIT");
        return res.json(cache.payload);
      }

      // R125+13.8+sec round 2 (architect MEDIUM re-closed): SET LOCAL only
      // works inside a transaction, AND with a pg.Pool a bare `SET ...` lands
      // on whichever connection the pool hands you — risking either no
      // effect (different conn for the heavy query) or leakage (timeout
      // pinned on a connection later reused for unrelated requests).
      // Fix: wrap the heavy block in db.transaction() so SET LOCAL is
      // both effective AND scoped to that one connection for that one txn.
      const txnResult = await db.transaction(async (tx) => {
        await tx.execute(sql`SET LOCAL statement_timeout = '15s'`);
      const toolsRes: any = await tx.execute(sql`
        WITH used AS (
          SELECT tool_name, MAX(started_at) AS last_used, COUNT(*) AS calls
          FROM agent_trace_spans
          WHERE tool_name IS NOT NULL
            AND started_at > NOW() - (${windowDays}::int * INTERVAL '1 day')
          GROUP BY tool_name
        )
        SELECT c.name, c.description, c.category, u.last_used, COALESCE(u.calls, 0) AS calls
        FROM capabilities c
        LEFT JOIN used u ON u.tool_name = c.name
        WHERE c.kind = 'tool' AND c.is_active = true
        ORDER BY u.last_used NULLS FIRST, c.name
      `);
      const toolRows = (toolsRes as any).rows || toolsRes;

      const personasRes: any = await tx.execute(sql`
        WITH used AS (
          SELECT persona_id, MAX(updated_at) AS last_used, COUNT(*) AS conversations
          FROM conversations
          WHERE persona_id IS NOT NULL
            AND updated_at > NOW() - (${windowDays}::int * INTERVAL '1 day')
          GROUP BY persona_id
        )
        SELECT p.id, p.name, p.role, p.is_active, u.last_used, COALESCE(u.conversations, 0) AS conversations
        FROM personas p
        LEFT JOIN used u ON u.persona_id = p.id
        WHERE p.is_active = true
        ORDER BY u.last_used NULLS FIRST, p.name
      `);
      const personaRows = (personasRes as any).rows || personasRes;

      const capsRes: any = await tx.execute(sql`
        SELECT kind, name, description, category, last_seen_at
        FROM capabilities
        WHERE is_active = true AND kind <> 'tool' AND kind <> 'agent'
        ORDER BY last_seen_at NULLS FIRST, name
      `);
      const capRows = (capsRes as any).rows || capsRes;

      const now = Date.now();
      const daysSince = (d: any) => {
        if (!d) return null;
        const t = new Date(d).getTime();
        if (isNaN(t)) return null;
        return Math.round((now - t) / 86400000);
      };

      const tools = toolRows.map((r: any) => ({
        name: r.name,
        description: r.description || null,
        category: r.category || null,
        lastUsed: r.last_used || null,
        daysSince: daysSince(r.last_used),
        calls: Number(r.calls || 0),
        isZombie: !r.last_used,
      }));

      const personas = personaRows.map((r: any) => ({
        id: r.id,
        name: r.name,
        role: r.role || null,
        lastUsed: r.last_used || null,
        daysSince: daysSince(r.last_used),
        conversations: Number(r.conversations || 0),
        isZombie: !r.last_used,
      }));

      const capabilities = capRows.map((r: any) => ({
        kind: r.kind,
        name: r.name,
        description: r.description || null,
        category: r.category || null,
        lastSeen: r.last_seen_at || null,
      }));

      const payload = {
        generatedAt: new Date().toISOString(),
        windowDays,
        summary: {
          totalTools: tools.length,
          zombieTools: tools.filter((t: any) => t.isZombie).length,
          totalPersonas: personas.length,
          zombiePersonas: personas.filter((p: any) => p.isZombie).length,
          totalCapabilities: capabilities.length,
        },
        tools,
        personas,
        capabilities,
      };

        return payload;
      });
      cache = { ts: Date.now(), payload: txnResult };
      res.setHeader("X-Cache", "MISS");
      res.json(txnResult);
    } catch (err: any) {
      console.error("[zombie-detector] error:", err?.message || err);
      res.status(500).json({ error: "zombie detector failed", message: err?.message });
    }
  });
}
