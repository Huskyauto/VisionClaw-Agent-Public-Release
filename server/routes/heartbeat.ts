import { type Express, type Request, type Response } from "express";
import { db } from "../db";
import { sql } from "drizzle-orm";
import { storage } from "../storage";
import { insertHeartbeatTaskSchema } from "@shared/schema";
import { ADMIN_TENANT_ID } from "../tenant-utils";
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
    const tenantId = getTenantFromRequest(req);
    if (!tenantId) return res.status(401).json({ error: "Unauthorized" });
    const taskId = parseInt(req.params.id as string);
    const task = await storage.getHeartbeatTask(taskId);
    // Tenant-scoped: an admin session may only approve tasks in its own tenant.
    if (!task || Number((task as any).tenantId) !== tenantId) return res.status(404).json({ error: "Task not found" });
    const nextRun = new Date(Date.now() + 30_000);
    await db.execute(sql`
      UPDATE heartbeat_tasks
      SET approval_status = 'approved', enabled = true, next_run_at = ${nextRun}
      WHERE id = ${taskId} AND tenant_id = ${tenantId}
    `);
    console.log(`[heartbeat] Task "${task.name}" (#${taskId}) APPROVED`);
    res.json({ success: true, message: `Task "${task.name}" approved and scheduled` });
  });

  app.post("/api/heartbeat/tasks/:id/reject", async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const tenantId = getTenantFromRequest(req);
    if (!tenantId) return res.status(401).json({ error: "Unauthorized" });
    const taskId = parseInt(req.params.id as string);
    const task = await storage.getHeartbeatTask(taskId);
    // Tenant-scoped: an admin session may only reject tasks in its own tenant.
    if (!task || Number((task as any).tenantId) !== tenantId) return res.status(404).json({ error: "Task not found" });
    await db.execute(sql`
      UPDATE heartbeat_tasks
      SET approval_status = 'rejected', enabled = false
      WHERE id = ${taskId} AND tenant_id = ${tenantId}
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

  // ─── IdeaBrowser weekly-scenario on-demand trigger ─────────────────
  // Bob 2026-07-21: manual "Run now" button in the Projects → IdeaBrowser
  // folder. Deliberately does NOT spawn the script itself — it pulls the
  // existing maintenance_script task's next_run_at to now so the heartbeat
  // tick picks it up with ALL the normal machinery (prod dist/*.cjs bundle
  // preference, claim semantics preventing double-runs, timeout, self-repair
  // telemetry, heartbeat log). Admin-only: this consumes real LLM spend.
  const SCENARIO_KEY = "ideabrowser-weekly-scenario";

  const getScenarioTask = async () => {
    // Hard-scoped to the ADMIN tenant: maintenance_script rows are system rows
    // seeded under ADMIN_TENANT_ID. Without this predicate, another tenant
    // could create a same-key row (higher id wins) and the run-now UPDATE
    // would flip THEIR row to approved+enabled — an approval-queue bypass.
    const result = await db.execute(sql`
      SELECT id, tenant_id, name, enabled, approval_status, last_run_at, next_run_at
      FROM heartbeat_tasks
      WHERE type = 'maintenance_script'
        AND tenant_id = ${ADMIN_TENANT_ID}
        AND TRIM(COALESCE(prompt_content, '')) = ${SCENARIO_KEY}
      ORDER BY id DESC LIMIT 1
    `);
    const task = ((result as any).rows || [])[0] as
      | { id: number; tenant_id: number; name: string; enabled: boolean; approval_status: string | null; last_run_at: string | null; next_run_at: string | null }
      | undefined;
    // Defensive invariant: never hand back (and never mutate) a non-admin row.
    if (task && Number(task.tenant_id) !== ADMIN_TENANT_ID) return undefined;
    return task;
  };

  app.get("/api/ideabrowser/scenario/status", async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const task = await getScenarioTask();
    if (!task) return res.status(404).json({ error: "Scenario task not seeded yet" });
    const logResult = await db.execute(sql`
      SELECT status, created_at, duration_ms FROM heartbeat_logs
      WHERE task_id = ${task.id} ORDER BY id DESC LIMIT 1
    `);
    const lastLog = ((logResult as any).rows || [])[0] || null;
    const nextAt = task.next_run_at ? new Date(task.next_run_at).getTime() : null;
    res.json({
      taskId: task.id,
      enabled: task.enabled,
      lastRunAt: task.last_run_at,
      nextRunAt: task.next_run_at,
      queued: nextAt !== null && nextAt <= Date.now() + 60_000,
      lastRunStatus: lastLog?.status ?? null,
      lastRunFinishedAt: lastLog?.created_at ?? null,
    });
  });

  app.post("/api/ideabrowser/scenario/run-now", async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const task = await getScenarioTask();
    if (!task) return res.status(404).json({ error: "Scenario task not seeded yet — restart the app to seed it" });
    const nextAt = task.next_run_at ? new Date(task.next_run_at).getTime() : null;
    if (nextAt !== null && nextAt <= Date.now() + 60_000) {
      return res.json({ success: true, alreadyQueued: true, taskId: task.id, message: "A run is already queued — it starts on the next heartbeat tick" });
    }
    // Re-enable + re-approve in the same statement: if the task self-heal
    // disabled it, a manual run-now is an explicit operator intent to run.
    await db.execute(sql`
      UPDATE heartbeat_tasks
      SET next_run_at = NOW(), enabled = true, approval_status = 'approved'
      WHERE id = ${task.id} AND tenant_id = ${ADMIN_TENANT_ID}
    `);
    console.log(`[heartbeat] IdeaBrowser scenario manual run-now queued (task #${task.id})`);
    res.json({ success: true, alreadyQueued: false, taskId: task.id, message: "Run queued — starts on the next heartbeat tick (within ~1 minute)" });
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
