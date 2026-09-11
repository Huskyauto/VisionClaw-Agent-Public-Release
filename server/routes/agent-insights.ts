// =============================================================================
// R125+146 — Agent Insights routes (read-only observability surfaces)
//
// Three product surfaces recommended by the 2026-08 product review, all built
// on data the platform ALREADY records — no new instrumentation:
//   1. /api/agent-insights/scorecards      — per-agent track record
//        activity + success from agent_activity, REAL cost from
//        agent_cost_ledger, quality from step_rewards, approvals summary
//   2. /api/agent-insights/capability-map  — goals→capabilities→agents→tools
//        live capability registry + personas + per-role tool policy edges
//   3. /api/agent-insights/runs(/:id)      — workflow replay (read-only)
//        plans.plan_json steps + execution_log + step_rewards, redacted
//
// All endpoints are tenant-scoped reads. Replay NEVER re-executes anything.
// Output text passes through capForReplay (redactSecrets + email/phone/
// bearer/cookie/connection-string/PII patterns) + hard char caps before leaving.
// =============================================================================
import type { Express, Request, Response } from "express";
import { db } from "../db";
import { sql } from "drizzle-orm";
import { capForReplay as cap, isStepResultEntry } from "../lib/replay-sanitize";

interface Deps {
  authMiddleware: any;
  /** Task-124 platform-admin predicate (tenant 1 only) — gates policy-edge exposure. */
  isPlatformAdmin: (req: any) => boolean;
}

function resolveTenantId(req: any): number | null {
  const t = Number(req.tenantId ?? req.user?.tenantId);
  return Number.isInteger(t) && t > 0 ? t : null;
}

export function registerAgentInsightsRoutes(app: Express, deps: Deps) {
  // ---------------------------------------------------------------------------
  // 1) Agent scorecards
  // ---------------------------------------------------------------------------
  app.get("/api/agent-insights/scorecards", deps.authMiddleware, async (req: any, res: Response) => {
    const tenantId = resolveTenantId(req);
    if (!tenantId) return res.status(400).json({ error: "No tenant context" });
    const windowDays = Math.max(1, Math.min(90, Number(req.query.windowDays) || 30));
    try {
      const personasResult: any = await db.execute(sql`
        SELECT id, name, role, emoji, cost_tier, is_active FROM personas ORDER BY id ASC
      `);
      const personas: any[] = personasResult.rows || personasResult;

      const [activityResult, costResult, qualityResult, approvalsResult]: any[] = await Promise.all([
        db.execute(sql`
          SELECT persona_id, persona_name,
                 COUNT(*)::int AS activity_count,
                 COUNT(DISTINCT conversation_id)::int AS conversation_count,
                 COUNT(*) FILTER (WHERE status IN ('completed','done','idle'))::int AS completed_count,
                 COUNT(*) FILTER (WHERE status IN ('failed','error'))::int AS failed_count,
                 MAX(started_at) AS last_active_at
          FROM agent_activity
          WHERE tenant_id = ${tenantId}
            AND started_at > NOW() - (${windowDays} || ' days')::interval
          GROUP BY persona_id, persona_name
        `),
        db.execute(sql`
          SELECT persona_id,
                 COUNT(*)::int AS call_count,
                 COALESCE(SUM(NULLIF(cost_usd,'')::numeric), 0)::float AS total_cost_usd,
                 COALESCE(SUM(tokens_in), 0)::bigint AS tokens_in,
                 COALESCE(SUM(tokens_out), 0)::bigint AS tokens_out
          FROM agent_cost_ledger
          WHERE tenant_id = ${tenantId}
            AND created_at > NOW() - (${windowDays} || ' days')::interval
          GROUP BY persona_id
        `),
        db.execute(sql`
          SELECT agent,
                 COUNT(*)::int AS graded_steps,
                 AVG(score)::float AS avg_score
          FROM step_rewards
          WHERE tenant_id = ${tenantId}
            AND created_at > NOW() - (${windowDays} || ' days')::interval
            AND agent IS NOT NULL
          GROUP BY agent
        `),
        db.execute(sql`
          SELECT COUNT(*)::int AS total,
                 COUNT(*) FILTER (WHERE status = 'approved')::int AS approved,
                 COUNT(*) FILTER (WHERE status = 'rejected')::int AS rejected,
                 COUNT(*) FILTER (WHERE status = 'pending')::int AS pending,
                 COUNT(*) FILTER (WHERE status = 'expired')::int AS expired
          FROM agent_approvals
          WHERE tenant_id = ${tenantId}
            AND requested_at > NOW() - (${windowDays} || ' days')::interval
        `),
      ]);

      const activityByPersona = new Map<number, any>();
      for (const a of activityResult.rows || activityResult) {
        if (a.persona_id != null) activityByPersona.set(Number(a.persona_id), a);
      }
      const costByPersona = new Map<number, any>();
      for (const c of costResult.rows || costResult) {
        if (c.persona_id != null) costByPersona.set(Number(c.persona_id), c);
      }
      // step_rewards.agent is a NAME string — match case-insensitively to persona name.
      const qualityByName = new Map<string, any>();
      for (const q of qualityResult.rows || qualityResult) {
        if (q.agent) qualityByName.set(String(q.agent).toLowerCase(), q);
      }
      const approvals = (approvalsResult.rows || approvalsResult)[0] || {};
      const decided = Number(approvals.approved || 0) + Number(approvals.rejected || 0);

      const scorecards = personas.map((p: any) => {
        const a = activityByPersona.get(p.id) || {};
        const c = costByPersona.get(p.id) || {};
        const q = qualityByName.get(String(p.name).toLowerCase()) || {};
        const total = Number(a.activity_count || 0);
        const completed = Number(a.completed_count || 0);
        const failed = Number(a.failed_count || 0);
        const tasksDone = completed;
        return {
          id: p.id,
          name: p.name,
          role: p.role,
          emoji: p.emoji || "🤖",
          costTier: p.cost_tier,
          isActive: p.is_active,
          activityCount: total,
          conversationCount: Number(a.conversation_count || 0),
          completedCount: completed,
          failedCount: failed,
          successRate: total > 0 ? +((completed / total) * 100).toFixed(1) : null,
          avgQualityScore: q.avg_score != null ? +Number(q.avg_score).toFixed(1) : null,
          gradedSteps: Number(q.graded_steps || 0),
          llmCallCount: Number(c.call_count || 0),
          totalCostUsd: +Number(c.total_cost_usd || 0).toFixed(4),
          avgCostPerTaskUsd: tasksDone > 0 && c.total_cost_usd
            ? +(Number(c.total_cost_usd) / tasksDone).toFixed(4)
            : null,
          tokensIn: Number(c.tokens_in || 0),
          tokensOut: Number(c.tokens_out || 0),
          lastActiveAt: a.last_active_at || null,
        };
      });

      res.json({
        tenantId,
        windowDays,
        computedAt: new Date().toISOString(),
        approvals: {
          total: Number(approvals.total || 0),
          approved: Number(approvals.approved || 0),
          rejected: Number(approvals.rejected || 0),
          pending: Number(approvals.pending || 0),
          expired: Number(approvals.expired || 0),
          approvalRate: decided > 0 ? +((Number(approvals.approved || 0) / decided) * 100).toFixed(1) : null,
        },
        scorecards,
      });
    } catch (e: any) {
      console.error("[agent-insights] scorecards error", e);
      res.status(500).json({ error: "Failed to compute scorecards" });
    }
  });

  // ---------------------------------------------------------------------------
  // 1b) Model-switch savings recommendations (Task 130 — ADVISORY, read-only)
  //     Real spend from agent_cost_ledger grouped by (tool_name, model);
  //     candidate rates are OBSERVED blended $/token from the same ledger;
  //     quality is observed per-executing-model from step_rewards.
  //     NOTHING here applies a switch — it only surfaces suggestions.
  // ---------------------------------------------------------------------------
  app.get("/api/agent-insights/model-switch-recommendations", deps.authMiddleware, async (req: any, res: Response) => {
    const tenantId = resolveTenantId(req);
    if (!tenantId) return res.status(400).json({ error: "No tenant context" });
    const windowDays = Math.max(1, Math.min(90, Number(req.query.windowDays) || 30));
    try {
      const { getModelSwitchRecommendations } = await import("../lib/model-switch-data");
      const recommendations = await getModelSwitchRecommendations(tenantId, windowDays);

      res.json({
        tenantId,
        windowDays,
        computedAt: new Date().toISOString(),
        advisory: true,
        recommendations,
      });
    } catch (e: any) {
      console.error("[agent-insights] model-switch-recommendations error", e);
      res.status(500).json({ error: "Failed to compute recommendations" });
    }
  });

  // ---------------------------------------------------------------------------
  // 2) Capability map — goals → capabilities → agents → tools
  // ---------------------------------------------------------------------------
  app.get("/api/agent-insights/capability-map", deps.authMiddleware, async (req: any, res: Response) => {
    // 72h-review HIGH — require tenant context like the sibling endpoints. The
    // persona/capability registry itself is global-by-design (publicly documented
    // product surface, same rows the scorecards endpoint returns), but the
    // per-role blocked-tool POLICY EDGES are platform internals: expose those
    // only to the platform admin; everyone else gets an empty edge list.
    const tenantId = resolveTenantId(req);
    if (!tenantId) return res.status(400).json({ error: "No tenant context" });
    const showPolicyEdges = deps.isPlatformAdmin(req);
    try {
      const { listCapabilities } = await import("../capability-registry");
      const { getPersonaBlockedTools } = await import("../tool-router");
      const [caps, personasResult]: any[] = await Promise.all([
        listCapabilities({ activeOnly: true }),
        db.execute(sql`SELECT id, name, role, emoji, is_active FROM personas WHERE is_active = true ORDER BY id ASC`),
      ]);
      const personas = (personasResult.rows || personasResult).map((p: any) => ({
        id: p.id,
        name: p.name,
        role: p.role,
        emoji: p.emoji || "🤖",
        blockedTools: showPolicyEdges ? Array.from(getPersonaBlockedTools(String(p.role || ""))) : [],
      }));
      res.json({
        computedAt: new Date().toISOString(),
        capabilityCount: caps.length,
        capabilities: caps.map((c: any) => ({
          id: c.id,
          kind: c.kind,
          name: c.name,
          category: c.category || null,
          description: c.description,
          lastSeenAt: c.lastSeenAt || c.last_seen_at || null,
        })),
        personas,
      });
    } catch (e: any) {
      console.error("[agent-insights] capability-map error", e);
      res.status(500).json({ error: "Failed to load capability map" });
    }
  });

  // ---------------------------------------------------------------------------
  // 3) Workflow replay — list + detail (STRICTLY read-only)
  // ---------------------------------------------------------------------------
  app.get("/api/agent-insights/runs", deps.authMiddleware, async (req: any, res: Response) => {
    const tenantId = resolveTenantId(req);
    if (!tenantId) return res.status(400).json({ error: "No tenant context" });
    const limit = Math.max(1, Math.min(100, Number(req.query.limit) || 40));
    try {
      const result: any = await db.execute(sql`
        SELECT id, objective, source, status,
               COALESCE(jsonb_array_length(plan_json->'steps'), 0)::int AS planned_steps,
               COALESCE(jsonb_array_length(execution_log), 0)::int AS logged_steps,
               created_at, updated_at
        FROM plans
        WHERE tenant_id = ${tenantId}
        ORDER BY id DESC
        LIMIT ${limit}
      `);
      const rows = (result.rows || result).map((r: any) => ({
        id: r.id,
        objective: cap(r.objective, 300),
        source: r.source,
        status: r.status,
        plannedSteps: Number(r.planned_steps || 0),
        loggedSteps: Number(r.logged_steps || 0),
        createdAt: r.created_at,
        updatedAt: r.updated_at,
      }));
      res.json({ runs: rows });
    } catch (e: any) {
      console.error("[agent-insights] runs list error", e);
      res.status(500).json({ error: "Failed to list runs" });
    }
  });

  app.get("/api/agent-insights/runs/:id", deps.authMiddleware, async (req: any, res: Response) => {
    const tenantId = resolveTenantId(req);
    if (!tenantId) return res.status(400).json({ error: "No tenant context" });
    const planId = Number(req.params.id);
    if (!Number.isInteger(planId) || planId <= 0) return res.status(400).json({ error: "Invalid run id" });
    try {
      const result: any = await db.execute(sql`
        SELECT id, objective, source, status, plan_json, execution_log,
               planner_persona_id, ceo_decision, ceo_decision_reason,
               created_at, updated_at
        FROM plans
        WHERE id = ${planId} AND tenant_id = ${tenantId}
        LIMIT 1
      `);
      const row = (result.rows || result)[0];
      if (!row) return res.status(404).json({ error: "Run not found" });

      const rewardsResult: any = await db.execute(sql`
        SELECT step_index, agent, score, rationale, model, created_at
        FROM step_rewards
        WHERE tenant_id = ${tenantId} AND plan_id = ${planId}
        ORDER BY step_index ASC
      `);
      const rewardsByStep = new Map<number, any>();
      for (const r of rewardsResult.rows || rewardsResult) {
        rewardsByStep.set(Number(r.step_index), r);
      }

      const planJson = row.plan_json || {};
      const plannedSteps: any[] = Array.isArray(planJson.steps) ? planJson.steps : [];
      const log: any[] = Array.isArray(row.execution_log) ? row.execution_log : [];

      // Only real step-result entries — execution_log also carries lifecycle
      // events (execution.started/wave/replan) that must NOT become phantom steps.
      const steps = log.filter(isStepResultEntry).map((entry: any) => {
        const stepNo = Number(entry.step);
        const planned = plannedSteps.find((s: any) => Number(s.n) === stepNo) || {};
        // step_rewards.step_index is stored as the one-based step.n — exact match only.
        const reward = rewardsByStep.get(stepNo);
        return {
          step: stepNo,
          agent: entry.agent || planned.agent || null,
          task: cap(planned.task, 1200),
          tools: Array.isArray(planned.tools) ? planned.tools : (planned.tool ? [planned.tool] : []),
          model: entry.model || null,
          startedAt: entry.started_at || null,
          endedAt: entry.ended_at || null,
          durationMs: entry.durationMs ?? null,
          success: entry.success ?? null,
          summary: cap(entry.summary, 2000),
          output: cap(entry.output),
          notes: cap(entry.notes, 1200),
          error: cap(entry.error, 1200),
          qualityScore: reward ? Number(reward.score) : null,
          qualityRationale: reward ? cap(reward.rationale, 800) : null,
        };
      });

      // Planned-but-never-executed steps (run halted / rejected / in-flight)
      const executedNos = new Set(steps.map(s => s.step));
      const pendingSteps = plannedSteps
        .filter((s: any) => !executedNos.has(Number(s.n)))
        .map((s: any) => ({
          step: Number(s.n),
          agent: s.agent || null,
          task: cap(s.task, 1200),
          tools: Array.isArray(s.tools) ? s.tools : (s.tool ? [s.tool] : []),
          executed: false,
        }));

      res.json({
        id: row.id,
        objective: cap(row.objective, 2000),
        source: row.source,
        status: row.status,
        ceoDecision: row.ceo_decision || null,
        ceoDecisionReason: cap(row.ceo_decision_reason, 1200),
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        plannedStepCount: plannedSteps.length,
        executedStepCount: steps.length,
        steps,
        pendingSteps,
      });
    } catch (e: any) {
      console.error("[agent-insights] run detail error", e);
      res.status(500).json({ error: "Failed to load run" });
    }
  });
}
