import { type Express, type Request, type Response } from "express";
import { db } from "../db";
import { sql } from "drizzle-orm";
import { storage } from "../storage";
import { insertHeartbeatTaskSchema } from "@shared/schema";
import {
  startHeartbeat,
  stopHeartbeat,
  isHeartbeatRunning,
  delegateTaskFromChat,
} from "../heartbeat";

type HeartbeatHelpers = {
  getTenantFromRequest: (req: Request) => number | null;
  requireAdmin: (req: Request, res: Response) => boolean;
  requirePlatformAdmin: (req: Request, res: Response) => boolean;
};

/**
 * Round 60+ Stage 4: Heartbeat routes extracted from server/routes.ts (~165 LOC
 * removed from the monolith). Pure move — zero behavior change. The 13 routes
 * cover task CRUD, approve/reject queue, run logs, status, start/stop, and
 * cross-persona delegation. Companion fixes for createHeartbeatTask default
 * approval status + getDueHeartbeatTasks COALESCE removal already shipped in
 * R74.13h (server/storage.ts). The /api/heartbeat/pending COALESCE here is
 * intentionally preserved for now — the fail-safe direction (NULL → not-pending
 * → not surfaced as approval-required) matches the spirit of R74.13h.
 */
export function registerHeartbeatRoutes(app: Express, helpers: HeartbeatHelpers) {
  const { getTenantFromRequest, requireAdmin, requirePlatformAdmin } = helpers;

  // ─── Heartbeat tasks CRUD ──────────────────────────────────────────
  app.get("/api/heartbeat/tasks", async (req, res) => {
    const tenantId = getTenantFromRequest(req);
    if (!tenantId) return res.status(401).json({ error: "Unauthorized" });
    const personaId = req.query.personaId ? parseInt(req.query.personaId as string) : undefined;
    res.json(await storage.getHeartbeatTasks(personaId, tenantId));
  });

  app.post("/api/heartbeat/tasks", async (req, res) => {
    const tenantId = getTenantFromRequest(req);
    if (!tenantId) return res.status(401).json({ error: "Unauthorized" });
    const parsed = insertHeartbeatTaskSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.message });
    // R74.13k — D-HIGH fix from whole-app review. The R74.13h fix made
    // createHeartbeatTask DEFAULT to approval_status='pending', but kept an
    // override channel `(data as any).approvalStatus` for system callers that
    // do INSERT-then-explicit-pending. The user-facing route was passing
    // req.body straight through, so a client could submit
    // `approvalStatus: 'approved'` and skip the queue entirely. Strip it
    // here so user-created tasks ALWAYS land as pending; system callers that
    // legitimately need an override go through storage directly.
    const { approvalStatus: _stripped, ...safeData } = parsed.data as any;
    const task = await storage.createHeartbeatTask({ ...safeData, tenantId });
    res.status(201).json(task);
  });

  app.patch("/api/heartbeat/tasks/:id", async (req, res) => {
    const tenantId = getTenantFromRequest(req);
    if (!tenantId) return res.status(401).json({ error: "Unauthorized" });
    const parsed = insertHeartbeatTaskSchema.partial().safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.message });
    // R74.13k F2-followup — close the PATCH-side approval bypass. Original F2
    // stripped approvalStatus from POST /api/heartbeat/tasks but PATCH still
    // accepted the partial schema with approvalStatus → a tenant could create
    // a pending task and immediately PATCH approvalStatus='approved' to skip
    // the queue. Same destructure-omit pattern: dedicated approve/reject
    // routes (POST /:id/approve, POST /:id/reject) are the only paths that
    // can mutate approval state.
    const { approvalStatus: _stripped, ...safeData } = parsed.data as any;
    const task = await storage.updateHeartbeatTask(parseInt(req.params.id as string), safeData, tenantId);
    if (!task) return res.status(404).json({ error: "Task not found" });
    res.json(task);
  });

  app.delete("/api/heartbeat/tasks/:id", async (req, res) => {
    const tenantId = getTenantFromRequest(req);
    if (!tenantId) return res.status(401).json({ error: "Unauthorized" });
    await storage.deleteHeartbeatTask(parseInt(req.params.id as string), tenantId);
    res.status(204).send();
  });

  // ─── Approval queue ────────────────────────────────────────────────
  app.get("/api/heartbeat/pending", async (req, res) => {
    const tenantId = getTenantFromRequest(req);
    if (!tenantId) return res.status(401).json({ error: "Unauthorized" });
    const result = await db.execute(sql`
      SELECT * FROM heartbeat_tasks
      WHERE COALESCE(approval_status, 'approved') = 'pending'
        AND tenant_id = ${tenantId}
      ORDER BY created_at DESC
    `);
    res.json((result as any).rows || []);
  });

  app.post("/api/heartbeat/tasks/:id/approve", async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const taskId = parseInt(req.params.id as string);
    const task = await storage.getHeartbeatTask(taskId);
    if (!task) return res.status(404).json({ error: "Task not found" });
    const nextRun = new Date(Date.now() + 30_000);
    await db.execute(sql`
      UPDATE heartbeat_tasks
      SET approval_status = 'approved', enabled = true, next_run_at = ${nextRun}
      WHERE id = ${taskId}
    `);
    console.log(`[heartbeat] Task "${task.name}" (#${taskId}) APPROVED`);
    res.json({ success: true, message: `Task "${task.name}" approved and scheduled` });
  });

  app.post("/api/heartbeat/tasks/:id/reject", async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const taskId = parseInt(req.params.id as string);
    const task = await storage.getHeartbeatTask(taskId);
    if (!task) return res.status(404).json({ error: "Task not found" });
    await db.execute(sql`
      UPDATE heartbeat_tasks
      SET approval_status = 'rejected', enabled = false
      WHERE id = ${taskId}
    `);
    console.log(`[heartbeat] Task "${task.name}" (#${taskId}) REJECTED`);
    res.json({ success: true, message: `Task "${task.name}" rejected` });
  });

  // ─── Logs + status ─────────────────────────────────────────────────
  app.get("/api/heartbeat/logs", async (req, res) => {
    if (!requirePlatformAdmin(req, res)) return;
    const limit = req.query.limit ? parseInt(req.query.limit as string) : 50;
    const personaId = req.query.personaId ? parseInt(req.query.personaId as string) : undefined;
    res.json(await storage.getHeartbeatLogs(limit, personaId));
  });

  app.get("/api/heartbeat/status", async (req, res) => {
    if (!requirePlatformAdmin(req, res)) return;
    const [tasks, recentLogs, personas] = await Promise.all([
      storage.getHeartbeatTasks(),
      storage.getHeartbeatLogs(5),
      storage.getPersonas(),
    ]);
    const enabledCount = tasks.filter((t) => t.enabled).length;
    const tasksByPersona = new Map<number, { total: number; enabled: number }>();
    for (const t of tasks) {
      if (t.personaId) {
        const entry = tasksByPersona.get(t.personaId) || { total: 0, enabled: 0 };
        entry.total++;
        if (t.enabled) entry.enabled++;
        tasksByPersona.set(t.personaId, entry);
      }
    }
    const agentSummary = personas.map((p) => {
      const entry = tasksByPersona.get(p.id) || { total: 0, enabled: 0 };
      return {
        id: p.id,
        name: p.name,
        role: p.role,
        icon: p.icon,
        totalTasks: entry.total,
        enabledTasks: entry.enabled,
        isActive: p.isActive,
      };
    });
    const systemTasks = tasks.filter((t) => !t.personaId);
    res.json({
      running: isHeartbeatRunning(),
      totalTasks: tasks.length,
      enabledTasks: enabledCount,
      systemTasks: systemTasks.length,
      agents: agentSummary,
      recentLogs,
    });
  });

  app.get("/api/heartbeat/logs/:id/output", async (req, res) => {
    const tenantId = getTenantFromRequest(req);
    if (!tenantId) return res.status(401).json({ error: "Unauthorized" });
    try {
      const id = parseInt(req.params.id as string);
      if (isNaN(id)) return res.status(400).json({ error: "Invalid ID" });
      const result = await db.execute(
        sql`SELECT hl.id, hl.output FROM heartbeat_logs hl
            JOIN heartbeat_tasks ht ON hl.task_id = ht.id
            WHERE hl.id = ${id} AND ht.tenant_id = ${tenantId}`
      );
      const rows = (result as any).rows || result;
      if (!rows.length) return res.status(404).json({ error: "Log not found" });
      res.json({ id: rows[0].id, output: rows[0].output });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ─── Lifecycle + delegation ────────────────────────────────────────
  app.post("/api/heartbeat/start", async (req, res) => {
    if (!requirePlatformAdmin(req, res)) return;
    startHeartbeat();
    res.json({ running: true });
  });

  app.post("/api/heartbeat/stop", async (req, res) => {
    if (!requirePlatformAdmin(req, res)) return;
    stopHeartbeat();
    res.json({ running: false });
  });

  app.post("/api/heartbeat/delegate", async (req, res) => {
    const tenantId = getTenantFromRequest(req);
    if (!tenantId) return res.status(401).json({ error: "Unauthorized" });
    const { fromPersonaId, targetPersona, taskName, description, prompt, schedule, model } = req.body;
    if (!targetPersona || !taskName || !prompt) {
      return res.status(400).json({ error: "targetPersona, taskName, and prompt are required" });
    }
    const result = await delegateTaskFromChat(
      fromPersonaId || null,
      targetPersona,
      taskName,
      description || "",
      prompt,
      schedule || "once",
      model || "gpt-5-mini",
      tenantId
    );
    if (result.success) {
      res.status(201).json(result);
    } else {
      res.status(400).json(result);
    }
  });
}
