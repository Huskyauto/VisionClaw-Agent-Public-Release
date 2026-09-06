// Routes-split Tier 1 — inline admin + account endpoints extracted from
// server/routes.ts. Two register functions preserve original registration
// positions (both post-gate; every route carries explicit authMiddleware):
//   registerAdminExtraRoutes — tenants/fork, halt/resume-background,
//     system-state, risk-classes, ecosystem-health, decline-events,
//     self-initiatives list+decide
//   registerAccountRoutes — deletion-summary, schedule-deletion,
//     cancel-deletion, DELETE /api/account
// Pure move — zero behavior change (no-fix-during-refactor rule).
import { type Express, type Request, type Response } from "express";
import { storage } from "../storage";
import { validate, selfInitiativeDecideSchema } from "../validation";

type AdminExtraHelpers = {
  authMiddleware: any;
  requirePlatformAdmin: (req: Request, res: Response) => boolean;
  getTenantFromRequest: (req: Request) => number | null;
};

export function registerAdminExtraRoutes(app: Express, helpers: AdminExtraHelpers) {
  const { authMiddleware, requirePlatformAdmin, getTenantFromRequest } = helpers;

  // ─── Tenant config-forking ─────────────────────────────────
  // Provision a NEW tenant pre-loaded with a SOURCE tenant's configuration
  // (voice, governance, tool policies, persona overrides, automation
  // schedules, …) but NEVER its data or memory. Owner/platform-admin only.
  app.post("/api/admin/tenants/fork", authMiddleware, async (req, res) => {
    if (!requirePlatformAdmin(req, res)) return;
    try {
      const { forkTenantSchema } = await import("../validation");
      const parsed = forkTenantSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: "invalid body", details: parsed.error.flatten() });
      }
      const { sourceTenantId, name, email, plan } = parsed.data;
      const { forkTenant } = await import("../tenant-fork");
      const result = await forkTenant(sourceTenantId, { name, email, plan });
      res.json(result);
    } catch (err: any) {
      // Body validation already returned 400 above; anything thrown here is an
      // internal/runtime failure (DB, transaction abort) — surface it as 500 so
      // it isn't miscategorised as client error in logs/alerting.
      console.error(`[tenant-fork] internal failure: ${err?.message || err}`);
      res.status(500).json({ error: err?.message || "fork failed" });
    }
  });

  app.post("/api/admin/halt-background", authMiddleware, async (req, res) => {
    if (!requirePlatformAdmin(req, res)) return;
    try {
      const { setBackgroundHalted } = await import("../lib/system-state");
      const halted = req.body?.halted !== false; // default true
      const reason = (req.body?.reason || "manual").toString().slice(0, 200);
      const state = setBackgroundHalted(halted, { reason, actor: `admin:${getTenantFromRequest(req) || "?"}` });
      res.json({ ok: true, state });
    } catch (e: any) {
      res.status(500).json({ error: e?.message || "halt failed" });
    }
  });

  app.post("/api/admin/resume-background", authMiddleware, async (req, res) => {
    if (!requirePlatformAdmin(req, res)) return;
    try {
      const { setBackgroundHalted } = await import("../lib/system-state");
      const state = setBackgroundHalted(false, { actor: `admin:${getTenantFromRequest(req) || "?"}` });
      res.json({ ok: true, state });
    } catch (e: any) {
      res.status(500).json({ error: e?.message || "resume failed" });
    }
  });

  app.get("/api/admin/system-state", authMiddleware, async (req, res) => {
    if (!requirePlatformAdmin(req, res)) return;
    try {
      const [{ getSystemState }, { poolStats }] = await Promise.all([
        import("../lib/system-state"),
        import("../lib/concurrency-pool"),
      ]);
      res.json({ system: getSystemState(), concurrency: poolStats() });
    } catch (e: any) {
      res.status(500).json({ error: e?.message || "state read failed" });
    }
  });

  app.get("/api/admin/risk-classes", authMiddleware, async (req, res) => {
    if (!requirePlatformAdmin(req, res)) return;
    try {
      const { listToolRiskClasses } = await import("../safety/destructive-tool-policy");
      res.json({ tools: listToolRiskClasses() });
    } catch (e: any) {
      res.status(500).json({ error: e?.message || "risk-class list failed" });
    }
  });

  // R98.25 — MNEMA Nugget 6: ecosystem-health dashboard.
  // Returns the 4 health indicators (diversity, coverage, contradiction
  // density, freshness median) for the caller's tenant. Admin-gated because
  // it leaks structural counts about another tenant's memory ecosystem if a
  // bad actor could pivot the tenantId param — we always read the caller's
  // tenant from the auth session, never from a query param.
  app.get("/api/admin/ecosystem-health", authMiddleware, async (req: any, res) => {
    if (!requirePlatformAdmin(req, res)) return;
    try {
      const tenantId = req.tenantId || req.user?.tenantId;
      if (!tenantId) return res.status(400).json({ error: "no tenant in session" });
      const { computeEcosystemHealth } = await import("../lib/ecosystem-health");
      const health = await computeEcosystemHealth(tenantId);
      if (!health) return res.status(500).json({ error: "compute failed" });
      res.json(health);
    } catch (e: any) {
      console.error("[ecosystem-health] compute failed:", e?.message || e);
      res.status(500).json({ error: "ecosystem-health compute failed" });
    }
  });

  // Recent decline events for the same dashboard panel. Tenant-scoped.
  app.get("/api/admin/decline-events", authMiddleware, async (req: any, res) => {
    if (!requirePlatformAdmin(req, res)) return;
    try {
      const tenantId = req.tenantId || req.user?.tenantId;
      if (!tenantId) return res.status(400).json({ error: "no tenant in session" });
      const limit = Math.min(200, Math.max(1, parseInt(String(req.query.limit || "50"), 10) || 50));
      const { db } = await import("../db");
      const { sql } = await import("drizzle-orm");
      const result = await db.execute(sql`
        SELECT id, persona_id, conversation_id, source, reason, detail, tool_name, flagged_categories, created_at
        FROM decline_events
        WHERE tenant_id = ${tenantId}
        ORDER BY id DESC
        LIMIT ${limit}
      `);
      const rows = (result as any).rows || result;
      res.json({ events: rows, count: rows.length });
    } catch (e: any) {
      res.status(500).json({ error: e?.message || "decline-events read failed" });
    }
  });

  // ─── Self-Directed Initiatives (the "intention engine") — HITL review ─────
  // The platform's self-originated goal-formation loop persists initiatives it
  // proposes unprompted; the owner reviews + commits/dismisses them here.
  // GET  /api/admin/self-initiatives           — list (tenant-scoped, ?status=)
  // POST /api/admin/self-initiatives/:id/decide — { decision: "approve"|"dismiss" }
  app.get("/api/admin/self-initiatives", authMiddleware, async (req: any, res) => {
    if (!requirePlatformAdmin(req, res)) return;
    try {
      const tenantId = req.tenantId || req.user?.tenantId;
      if (!tenantId) return res.status(400).json({ error: "no tenant in session" });
      const limit = Math.min(200, Math.max(1, parseInt(String(req.query.limit || "50"), 10) || 50));
      const status = req.query.status ? String(req.query.status) : null;
      const { db } = await import("../db");
      const { sql } = await import("drizzle-orm");
      const result = status
        ? await db.execute(sql`
            SELECT id, title, rationale, category, evidence, confidence, risk, estimated_value, status, source_model, decided_at, decided_by, created_at
            FROM self_initiatives
            WHERE tenant_id = ${tenantId} AND status = ${status}
            ORDER BY id DESC LIMIT ${limit}`)
        : await db.execute(sql`
            SELECT id, title, rationale, category, evidence, confidence, risk, estimated_value, status, source_model, decided_at, decided_by, created_at
            FROM self_initiatives
            WHERE tenant_id = ${tenantId}
            ORDER BY id DESC LIMIT ${limit}`);
      const rows = (result as any).rows || result;
      res.json({ initiatives: rows, count: rows.length });
    } catch (e: any) {
      res.status(500).json({ error: e?.message || "self-initiatives read failed" });
    }
  });

  app.post("/api/admin/self-initiatives/:id/decide", authMiddleware, validate(selfInitiativeDecideSchema), async (req: any, res) => {
    if (!requirePlatformAdmin(req, res)) return;
    try {
      const tenantId = req.tenantId || req.user?.tenantId;
      if (!tenantId) return res.status(400).json({ error: "no tenant in session" });
      const id = parseInt(String(req.params.id), 10);
      if (!Number.isFinite(id)) return res.status(400).json({ error: "invalid id" });
      const decision = req.body.decision as "approve" | "dismiss";
      const newStatus = decision === "approve" ? "approved" : "dismissed";
      const decidedBy = req.user?.email || req.user?.username || "owner";
      const { db } = await import("../db");
      const { sql } = await import("drizzle-orm");
      // Tenant-scoped UPDATE; RETURNING gates the response on a real owned row.
      const result = await db.execute(sql`
        UPDATE self_initiatives
        SET status = ${newStatus}, decided_at = now(), decided_by = ${decidedBy}
        WHERE id = ${id} AND tenant_id = ${tenantId} AND status = 'surfaced'
        RETURNING id, status`);
      const rows = (result as any).rows || result;
      if (!rows || rows.length === 0) {
        return res.status(404).json({ error: "initiative not found, not yours, or already decided" });
      }
      res.json({ ok: true, id, status: newStatus });
    } catch (e: any) {
      res.status(500).json({ error: e?.message || "self-initiative decide failed" });
    }
  });
}

type AccountHelpers = {
  authMiddleware: any;
  getTenantFromRequest: (req: Request) => number | null;
};

export function registerAccountRoutes(app: Express, helpers: AccountHelpers) {
  const { authMiddleware, getTenantFromRequest } = helpers;

  app.get("/api/account/deletion-summary", authMiddleware, async (req: Request, res: Response) => {
    try {
      const tenantId = getTenantFromRequest(req);
      if (!tenantId) return res.status(401).json({ error: "Authentication required" });

      const { db: database } = await import("../db");
      const { sql: s } = await import("drizzle-orm");

      const [convResult] = (await database.execute(s`SELECT count(*)::int as count FROM conversations WHERE tenant_id = ${tenantId}`)).rows as any[];
      const [msgResult] = (await database.execute(s`SELECT count(*)::int as count FROM messages WHERE conversation_id IN (SELECT id FROM conversations WHERE tenant_id = ${tenantId})`)).rows as any[];
      const [memResult] = (await database.execute(s`SELECT count(*)::int as count FROM memory_entries WHERE tenant_id = ${tenantId}`)).rows as any[];
      const [fileResult] = (await database.execute(s`SELECT count(*)::int as count, COALESCE(sum(size), 0)::bigint as total_size FROM file_storage WHERE tenant_id = ${tenantId}`)).rows as any[];
      const [knowledgeResult] = (await database.execute(s`SELECT count(*)::int as count FROM agent_knowledge WHERE tenant_id = ${tenantId}`)).rows as any[];
      const [toolResult] = (await database.execute(s`SELECT count(*)::int as count FROM custom_tools WHERE tenant_id = ${tenantId}`)).rows as any[];
      const [keyResult] = (await database.execute(s`SELECT count(*)::int as count FROM provider_keys WHERE tenant_id = ${tenantId}`)).rows as any[];
      const [tenantRow] = (await database.execute(s`SELECT account_status, deletion_scheduled_at FROM tenants WHERE id = ${tenantId}`)).rows as any[];

      res.json({
        conversations: convResult?.count || 0,
        messages: msgResult?.count || 0,
        memories: memResult?.count || 0,
        files: fileResult?.count || 0,
        fileStorageBytes: parseInt(fileResult?.total_size || "0"),
        knowledgeEntries: knowledgeResult?.count || 0,
        customTools: toolResult?.count || 0,
        apiKeys: keyResult?.count || 0,
        accountStatus: tenantRow?.account_status || "active",
        deletionScheduledAt: tenantRow?.deletion_scheduled_at || null,
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/account/schedule-deletion", authMiddleware, async (req: Request, res: Response) => {
    try {
      const tenantId = getTenantFromRequest(req);
      if (!tenantId) return res.status(401).json({ error: "Authentication required" });
      if (tenantId === 1) return res.status(403).json({ error: "Admin account cannot be deleted" });

      const { db: database } = await import("../db");
      const { sql: s } = await import("drizzle-orm");

      const deletionDate = new Date();
      deletionDate.setDate(deletionDate.getDate() + 30);

      await database.execute(s`UPDATE tenants SET account_status = 'pending_deletion', deletion_scheduled_at = ${deletionDate.toISOString()}::timestamp WHERE id = ${tenantId}`);

      const tenant = await storage.getTenant(tenantId);
      if (tenant?.email) {
        const { sendAccountDeletionScheduledEmail } = await import("../email-notifications");
        await sendAccountDeletionScheduledEmail(tenant.email, tenant.name, deletionDate);
      }

      console.log(`[account] Tenant ${tenantId} scheduled for deletion on ${deletionDate.toISOString()}`);
      res.json({
        success: true,
        deletionScheduledAt: deletionDate.toISOString(),
        message: `Account scheduled for permanent deletion on ${deletionDate.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}. You have 30 days to download your data or cancel.`,
      });
    } catch (err: any) {
      console.error("[account] Schedule deletion error:", err.message);
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/account/cancel-deletion", authMiddleware, async (req: Request, res: Response) => {
    try {
      const tenantId = getTenantFromRequest(req);
      if (!tenantId) return res.status(401).json({ error: "Authentication required" });

      const { db: database } = await import("../db");
      const { sql: s } = await import("drizzle-orm");

      await database.execute(s`UPDATE tenants SET account_status = 'active', deletion_scheduled_at = NULL WHERE id = ${tenantId}`);

      console.log(`[account] Tenant ${tenantId} cancelled account deletion`);
      res.json({ success: true, message: "Account deletion cancelled. Your account is active again." });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.delete("/api/account", authMiddleware, async (req: Request, res: Response) => {
    try {
      const tenantId = getTenantFromRequest(req);
      if (!tenantId) return res.status(401).json({ error: "Authentication required" });
      if (tenantId === 1) return res.status(403).json({ error: "Admin account cannot be deleted" });

      const { db: database } = await import("../db");
      const { sql: s } = await import("drizzle-orm");

      const [tenant] = (await database.execute(s`SELECT account_status, deletion_scheduled_at FROM tenants WHERE id = ${tenantId}`)).rows as any[];
      if (tenant?.account_status !== "pending_deletion") {
        return res.status(400).json({ error: "Account must be scheduled for deletion first. Use the 30-day grace period process." });
      }

      const scheduledDate = new Date(tenant.deletion_scheduled_at);
      const now = new Date();
      if (now < scheduledDate) {
        const daysRemaining = Math.ceil((scheduledDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
        return res.status(400).json({ error: `Deletion grace period has not expired. ${daysRemaining} days remaining. Data will be permanently deleted on ${scheduledDate.toLocaleDateString()}.` });
      }

      await database.execute(s`DELETE FROM messages WHERE conversation_id IN (SELECT id FROM conversations WHERE tenant_id = ${tenantId})`);
      await database.execute(s`DELETE FROM conversations WHERE tenant_id = ${tenantId}`);
      await database.execute(s`DELETE FROM memory_entries WHERE tenant_id = ${tenantId}`);
      await database.execute(s`DELETE FROM daily_notes WHERE tenant_id = ${tenantId}`);
      await database.execute(s`DELETE FROM agent_knowledge WHERE tenant_id = ${tenantId}`);
      await database.execute(s`DELETE FROM custom_tools WHERE tenant_id = ${tenantId}`);
      await database.execute(s`DELETE FROM experiments WHERE tenant_id = ${tenantId}`);
      await database.execute(s`DELETE FROM file_storage WHERE tenant_id = ${tenantId}`);
      await database.execute(s`DELETE FROM tenant_persona_names WHERE tenant_id = ${tenantId}`);
      await database.execute(s`DELETE FROM heartbeat_tasks WHERE tenant_id = ${tenantId}`);
      await database.execute(s`DELETE FROM tenant_provider_keys WHERE tenant_id = ${tenantId}`);
      await database.execute(s`DELETE FROM auth_sessions WHERE tenant_id = ${tenantId}`);
      await database.execute(s`DELETE FROM tenants WHERE id = ${tenantId}`);

      console.log(`[account] Tenant ${tenantId} permanently deleted after grace period`);
      res.json({ success: true, message: "Account and all associated data have been permanently deleted." });
    } catch (err: any) {
      console.error("[account] Deletion error:", err.message);
      res.status(500).json({ error: "Failed to delete account: " + err.message });
    }
  });
}
