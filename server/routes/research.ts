import { type Express, type Request, type Response } from "express";
import { db } from "../db";
import { sql } from "drizzle-orm";
import { z } from "zod";

// ─── Zod schemas for mutation bodies (72h-review remediation: research
// POST/PUT routes previously destructured req.body unvalidated) ──────────
const programCreateSchema = z.object({
  name: z.string().trim().min(1).max(300),
  objective: z.string().trim().min(1).max(5000),
  constraints: z.string().max(5000).optional(),
  metrics: z.string().max(5000).optional(),
  explorationStrategy: z.enum(["balanced", "conservative", "aggressive"]).optional(),
  model: z.string().max(120).optional(),
  maxExperimentsPerSession: z.number().int().min(1).max(200).optional(),
  personaId: z.number().int().positive().nullish(),
});
const programUpdateSchema = programCreateSchema.partial().extend({
  isActive: z.boolean().optional(),
});
const sessionStartSchema = z.object({
  programId: z.number().int().positive(),
});
const scheduleCreateSchema = z.object({
  name: z.string().trim().min(1).max(300),
  cronExpression: z.string().trim().min(1).max(100),
  timezone: z.string().max(80).optional(),
  programId: z.number().int().positive().nullish(),
  runAll: z.boolean().optional(),
});
const scheduleUpdateSchema = scheduleCreateSchema.partial().extend({
  isEnabled: z.boolean().optional(),
});
function parseBody<T>(schema: z.ZodType<T>, req: Request, res: Response): T | null {
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request body", details: parsed.error.issues.map(i => `${i.path.join(".")}: ${i.message}`) });
    return null;
  }
  return parsed.data;
}

type ResearchHelpers = {
  getTenantFromRequest: (req: Request) => number | null;
  requirePlatformAdmin: (req: Request, res: Response) => boolean;
};

/**
 * Round 60+ Stage 6: Research engine routes extracted from server/routes.ts
 * (~430 LOC removed). All 16 research routes — pure move with zero behavior
 * change. Routes are scattered in the monolith between treasury (9824-9847),
 * admin (10004-10188), and register-calls (10273-10281); those interlopers
 * stay in routes.ts and were left untouched.
 *
 * The local `computeNextRun` cron-next helper used by /schedules POST/PUT was
 * private to routes.ts and only used by these two routes — moved inline here.
 */
function computeNextRun(cronExpr: string, _timezone: string): Date {
  try {
    const parts = cronExpr.trim().split(/\s+/);
    if (parts.length !== 5) return new Date(Date.now() + 86400000);
    const [minute, hour] = parts;
    const now = new Date();
    const next = new Date(now);
    next.setHours(parseInt(hour) || 2, parseInt(minute) || 0, 0, 0);
    if (next <= now) next.setDate(next.getDate() + 1);
    return next;
  } catch {
    return new Date(Date.now() + 86400000);
  }
}

export function registerResearchRoutes(app: Express, helpers: ResearchHelpers) {
  const { getTenantFromRequest, requirePlatformAdmin } = helpers;

  // ─── Programs ─────────────────────────────────────────────
  app.get("/api/research/programs", async (req, res) => {
    const tenantId = getTenantFromRequest(req);
    if (!tenantId) return res.status(401).json({ error: "Unauthorized" });
    try {
      const result = await db.execute(sql`
        SELECT rp.*, p.name as persona_name FROM research_programs rp
        LEFT JOIN personas p ON p.id = rp.persona_id
        WHERE rp.tenant_id = ${tenantId} ORDER BY rp.updated_at DESC
      `);
      res.json((result as any).rows || result);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.post("/api/research/programs", async (req, res) => {
    const tenantId = getTenantFromRequest(req);
    if (!tenantId) return res.status(401).json({ error: "Unauthorized" });
    try {
      const body = parseBody(programCreateSchema, req, res);
      if (!body) return;
      const { name, objective, constraints, metrics, explorationStrategy, model, maxExperimentsPerSession, personaId } = body;
      const result = await db.execute(sql`
        INSERT INTO research_programs (tenant_id, persona_id, name, objective, constraints, metrics, exploration_strategy, model, max_experiments_per_session)
        VALUES (${tenantId}, ${personaId || null}, ${name.trim()}, ${objective.trim()}, ${constraints || ""}, ${metrics || ""}, ${explorationStrategy || "balanced"}, ${model || "deepseek/deepseek-v3.2"}, ${maxExperimentsPerSession || 20})
        RETURNING *
      `);
      res.json(((result as any).rows || result)[0]);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.put("/api/research/programs/:id", async (req, res) => {
    const tenantId = getTenantFromRequest(req);
    if (!tenantId) return res.status(401).json({ error: "Unauthorized" });
    try {
      const id = parseInt(req.params.id as string);
      const body = parseBody(programUpdateSchema, req, res);
      if (!body) return;
      const { name, objective, constraints, metrics, explorationStrategy, model, maxExperimentsPerSession, personaId, isActive } = body;
      const result = await db.execute(sql`
        UPDATE research_programs SET
          name = COALESCE(${name || null}, name),
          objective = COALESCE(${objective || null}, objective),
          constraints = COALESCE(${constraints ?? null}, constraints),
          metrics = COALESCE(${metrics ?? null}, metrics),
          exploration_strategy = COALESCE(${explorationStrategy || null}, exploration_strategy),
          model = COALESCE(${model || null}, model),
          max_experiments_per_session = COALESCE(${maxExperimentsPerSession || null}, max_experiments_per_session),
          persona_id = COALESCE(${personaId || null}, persona_id),
          is_active = COALESCE(${isActive ?? null}, is_active),
          updated_at = NOW()
        WHERE id = ${id} AND tenant_id = ${tenantId}
        RETURNING *
      `);
      const rows = (result as any).rows || result;
      if (!rows[0]) return res.status(404).json({ error: "Not found" });
      res.json(rows[0]);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.delete("/api/research/programs/:id", async (req, res) => {
    const tenantId = getTenantFromRequest(req);
    if (!tenantId) return res.status(401).json({ error: "Unauthorized" });
    try {
      const id = parseInt(req.params.id as string);
      await db.execute(sql`DELETE FROM research_programs WHERE id = ${id} AND tenant_id = ${tenantId}`);
      res.json({ success: true });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // ─── Sessions ─────────────────────────────────────────────
  app.post("/api/research/sessions/start", async (req, res) => {
    const tenantId = getTenantFromRequest(req);
    if (!tenantId) return res.status(401).json({ error: "Unauthorized" });
    try {
      const body = parseBody(sessionStartSchema, req, res);
      if (!body) return;
      const { programId } = body;
      const { startResearchSession } = await import("../research-engine");
      const result = await startResearchSession({ programId, tenantId });
      if (result.error) return res.status(400).json({ error: result.error });
      res.json({ sessionId: result.sessionId, status: "running" });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.post("/api/research/sessions/:id/stop", async (req, res) => {
    const tenantId = getTenantFromRequest(req);
    if (!tenantId) return res.status(401).json({ error: "Unauthorized" });
    try {
      const id = parseInt(req.params.id as string);
      if (isNaN(id)) return res.status(400).json({ error: "Invalid session ID" });
      const ownership = await db.execute(sql`SELECT id FROM research_sessions WHERE id = ${id} AND tenant_id = ${tenantId}`);
      const ownerRows = (ownership as any).rows || ownership;
      if (!ownerRows.length) return res.status(404).json({ error: "Session not found" });
      const { stopResearchSession } = await import("../research-engine");
      await stopResearchSession(id);
      res.json({ success: true });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.get("/api/research/sessions", async (req, res) => {
    const tenantId = getTenantFromRequest(req);
    if (!tenantId) return res.status(401).json({ error: "Unauthorized" });
    try {
      const result = await db.execute(sql`
        SELECT rs.*, rp.name as program_name FROM research_sessions rs
        JOIN research_programs rp ON rp.id = rs.program_id
        WHERE rs.tenant_id = ${tenantId} ORDER BY rs.started_at DESC LIMIT 50
      `);
      const { getActiveSessions } = await import("../research-engine");
      const active = getActiveSessions();
      const rows = (result as any).rows || result;
      const enriched = (Array.isArray(rows) ? rows : []).map((r: any) => ({
        ...r,
        isLive: active.has(r.id),
      }));
      res.json(enriched);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.get("/api/research/sessions/:id", async (req, res) => {
    const tenantId = getTenantFromRequest(req);
    if (!tenantId) return res.status(401).json({ error: "Unauthorized" });
    try {
      const id = parseInt(req.params.id as string);
      if (isNaN(id)) return res.status(400).json({ error: "Invalid session ID" });
      const ownership = await db.execute(sql`SELECT id FROM research_sessions WHERE id = ${id} AND tenant_id = ${tenantId}`);
      const ownerRows = (ownership as any).rows || ownership;
      if (!ownerRows.length) return res.status(404).json({ error: "Session not found" });
      const { getResearchSessionStatus } = await import("../research-engine");
      const session = await getResearchSessionStatus(id, tenantId);
      if (!session) return res.status(404).json({ error: "Not found" });
      const experiments = await db.execute(sql`
        SELECT * FROM research_experiments WHERE session_id = ${id} AND tenant_id = ${tenantId} ORDER BY created_at ASC
      `);
      res.json({ session, experiments: (experiments as any).rows || experiments });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.post("/api/research/sessions/start-all", async (req, res) => {
    const tenantId = getTenantFromRequest(req);
    if (!tenantId) return res.status(401).json({ error: "Unauthorized" });
    try {
      const result = await db.execute(sql`SELECT id FROM research_programs WHERE tenant_id = ${tenantId} AND is_active = true`);
      const rows = (result as any).rows || result;
      if (!rows.length) return res.status(400).json({ error: "No active programs" });
      const { startResearchSession } = await import("../research-engine");
      const results: any[] = [];
      for (let i = 0; i < rows.length; i++) {
        if (i > 0) await new Promise(r => setTimeout(r, 15000));
        const r = await startResearchSession({ programId: rows[i].id, tenantId });
        results.push({ programId: rows[i].id, sessionId: r.sessionId, error: r.error });
      }
      const started = results.filter(r => r.sessionId).length;
      const failed = results.filter(r => r.error).length;
      res.json({ started, failed, results, staggered: true });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // ─── Experiments / Stats ──────────────────────────────────
  app.get("/api/research/experiments", async (req, res) => {
    const tenantId = getTenantFromRequest(req);
    if (!tenantId) return res.status(401).json({ error: "Unauthorized" });
    try {
      const result = await db.execute(sql`
        SELECT re.*, rp.name as program_name FROM research_experiments re
        JOIN research_programs rp ON rp.id = re.program_id
        WHERE re.tenant_id = ${tenantId} ORDER BY re.created_at DESC LIMIT 100
      `);
      res.json((result as any).rows || result);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.get("/api/research/stats", async (req, res) => {
    const tenantId = getTenantFromRequest(req);
    if (!tenantId) return res.status(401).json({ error: "Unauthorized" });
    try {
      const { getActiveSessionCount } = await import("../research-engine");
      const [programs, sessions, experiments] = await Promise.all([
        db.execute(sql`SELECT COUNT(*) as count FROM research_programs WHERE tenant_id = ${tenantId}`),
        db.execute(sql`SELECT COUNT(*) as total, COUNT(CASE WHEN status = 'running' THEN 1 END) as active FROM research_sessions WHERE tenant_id = ${tenantId}`),
        db.execute(sql`SELECT COUNT(*) as total, COUNT(CASE WHEN status = 'keep' THEN 1 END) as kept, COUNT(CASE WHEN status = 'discard' THEN 1 END) as discarded FROM research_experiments WHERE tenant_id = ${tenantId}`),
      ]);
      const pRows = (programs as any).rows || programs;
      const sRows = (sessions as any).rows || sessions;
      const eRows = (experiments as any).rows || experiments;
      res.json({
        programs: parseInt(pRows[0]?.count || "0"),
        totalSessions: parseInt(sRows[0]?.total || "0"),
        activeSessions: getActiveSessionCount(),
        totalExperiments: parseInt(eRows[0]?.total || "0"),
        experimentsKept: parseInt(eRows[0]?.kept || "0"),
        experimentsDiscarded: parseInt(eRows[0]?.discarded || "0"),
      });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // ─── Schedules ────────────────────────────────────────────
  app.get("/api/research/schedules", async (req, res) => {
    const tenantId = getTenantFromRequest(req);
    if (!tenantId) return res.status(401).json({ error: "Unauthorized" });
    try {
      const result = await db.execute(sql`
        SELECT rs.*, rp.name as program_name FROM research_schedules rs
        LEFT JOIN research_programs rp ON rp.id = rs.program_id
        WHERE rs.tenant_id = ${tenantId} ORDER BY rs.created_at DESC
      `);
      res.json((result as any).rows || result);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.post("/api/research/schedules", async (req, res) => {
    const tenantId = getTenantFromRequest(req);
    if (!tenantId) return res.status(401).json({ error: "Unauthorized" });
    try {
      const body = parseBody(scheduleCreateSchema, req, res);
      if (!body) return;
      const { name, cronExpression, timezone, programId, runAll } = body;
      const nextRun = computeNextRun(cronExpression, timezone || "America/Chicago");
      const result = await db.execute(sql`
        INSERT INTO research_schedules (tenant_id, program_id, name, cron_expression, timezone, run_all, next_run_at)
        VALUES (${tenantId}, ${programId || null}, ${name}, ${cronExpression}, ${timezone || "America/Chicago"}, ${runAll || false}, ${nextRun})
        RETURNING *
      `);
      res.json(((result as any).rows || result)[0]);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.put("/api/research/schedules/:id", async (req, res) => {
    const tenantId = getTenantFromRequest(req);
    if (!tenantId) return res.status(401).json({ error: "Unauthorized" });
    try {
      const id = parseInt(req.params.id as string);
      const body = parseBody(scheduleUpdateSchema, req, res);
      if (!body) return;
      const { name, cronExpression, timezone, programId, runAll, isEnabled } = body;
      const nextRun = cronExpression ? computeNextRun(cronExpression, timezone || "America/Chicago") : null;
      const result = await db.execute(sql`
        UPDATE research_schedules SET
          name = COALESCE(${name}, name),
          cron_expression = COALESCE(${cronExpression}, cron_expression),
          timezone = COALESCE(${timezone}, timezone),
          program_id = ${programId ?? null},
          run_all = COALESCE(${runAll}, run_all),
          is_enabled = COALESCE(${isEnabled}, is_enabled),
          next_run_at = COALESCE(${nextRun}, next_run_at)
        WHERE id = ${id} AND tenant_id = ${tenantId}
        RETURNING *
      `);
      const rows = (result as any).rows || result;
      if (!rows.length) return res.status(404).json({ error: "Not found" });
      res.json(rows[0]);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.delete("/api/research/schedules/:id", async (req, res) => {
    const tenantId = getTenantFromRequest(req);
    if (!tenantId) return res.status(401).json({ error: "Unauthorized" });
    try {
      const id = parseInt(req.params.id as string);
      await db.execute(sql`DELETE FROM research_schedules WHERE id = ${id} AND tenant_id = ${tenantId}`);
      res.json({ success: true });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // ─── Digest ───────────────────────────────────────────────
  app.post("/api/research/digest", async (req, res) => {
    const tenantId = getTenantFromRequest(req);
    if (!tenantId) return res.status(401).json({ error: "Unauthorized" });
    if (!requirePlatformAdmin(req, res)) return;
    try {
      const { generateResearchDigest } = await import("../research-engine");
      const result = await generateResearchDigest(tenantId);
      res.json(result);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });
}
