import type { Express } from "express";
import { db } from "../db";
import { sql } from "drizzle-orm";

interface Deps {
  authMiddleware: any;
  requirePlatformAdmin: (req: any, res: any) => boolean;
}

const COST_PER_MIN_USD: Record<string, number> = {
  powerful: 0.030,
  balanced: 0.010,
  fast: 0.005,
};

export function registerPersonaCostRoutes(app: Express, deps: Deps) {
  app.get("/api/admin/persona-cost", deps.authMiddleware, async (req: any, res) => {
    if (!deps.requirePlatformAdmin(req, res)) return;
    const tenantId = req.tenantId || req.user?.tenantId;
    const windowDays = Math.max(1, Math.min(90, Number(req.query.windowDays) || 30));
    try {
      const personasResult: any = await db.execute(sql`
        SELECT id, name, role, emoji, cost_tier, is_active
        FROM personas
        ORDER BY id ASC
      `);
      const personas: any[] = (personasResult as any).rows || personasResult;

      const activityResult: any = await db.execute(sql`
        SELECT
          persona_id,
          persona_name,
          COUNT(*)::int AS activity_count,
          COUNT(DISTINCT conversation_id)::int AS conversation_count,
          COUNT(*) FILTER (WHERE status IN ('completed','done','idle'))::int AS completed_count,
          COUNT(*) FILTER (WHERE status IN ('failed','error'))::int AS failed_count,
          COALESCE(SUM(EXTRACT(EPOCH FROM (COALESCE(completed_at, NOW()) - started_at))), 0)::float AS total_duration_seconds,
          MAX(started_at) AS last_active_at
        FROM agent_activity
        WHERE tenant_id = ${tenantId}
          AND started_at > NOW() - (${windowDays} || ' days')::interval
        GROUP BY persona_id, persona_name
      `);
      const activities: any[] = (activityResult as any).rows || activityResult;
      const byPersonaId = new Map<number, any>();
      for (const a of activities) {
        if (a.persona_id != null) byPersonaId.set(Number(a.persona_id), a);
      }

      const perPersona = personas.map((p: any) => {
        const a = byPersonaId.get(p.id) || {};
        const minutes = Number(a.total_duration_seconds || 0) / 60;
        const ratePerMin = COST_PER_MIN_USD[p.cost_tier as string] ?? COST_PER_MIN_USD.balanced;
        const estCostUsd = +(minutes * ratePerMin).toFixed(4);
        const total = Number(a.activity_count || 0);
        const completed = Number(a.completed_count || 0);
        const failed = Number(a.failed_count || 0);
        const successRate = total > 0 ? +((completed / total) * 100).toFixed(1) : null;
        return {
          id: p.id,
          name: p.name,
          role: p.role,
          emoji: p.emoji || '🤖',
          costTier: p.cost_tier,
          isActive: p.is_active,
          activityCount: total,
          conversationCount: Number(a.conversation_count || 0),
          completedCount: completed,
          failedCount: failed,
          successRate,
          totalMinutes: +minutes.toFixed(2),
          estCostUsd,
          ratePerMinUsd: ratePerMin,
          lastActiveAt: a.last_active_at || null,
        };
      });

      const totals = perPersona.reduce((acc, p) => {
        acc.activities += p.activityCount;
        acc.conversations += p.conversationCount;
        acc.minutes += p.totalMinutes;
        acc.estCostUsd += p.estCostUsd;
        return acc;
      }, { activities: 0, conversations: 0, minutes: 0, estCostUsd: 0 });
      totals.minutes = +totals.minutes.toFixed(2);
      totals.estCostUsd = +totals.estCostUsd.toFixed(4);

      res.json({
        tenantId,
        windowDays,
        computedAt: new Date().toISOString(),
        rateCard: COST_PER_MIN_USD,
        totals,
        personas: perPersona,
      });
    } catch (e: any) {
      console.error('[persona-cost] error', e);
      res.status(500).json({ error: e.message });
    }
  });
}
