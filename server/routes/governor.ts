// R74.13t — Stage 15 of routes.ts decomposition.
// 12 routes for the Process Governor (governance scoring + framework management
// + model-update review): /api/governor/{status,evaluate,rules[/:id],actions,
// frameworks[/:id],scan/governance,scan/models,model-updates[/:id]}.
// All routes are gated by `requirePlatformAdmin` (governance is global state).
// Extracted verbatim from server/routes.ts L8783-L8954.
// Dynamic imports of ../process-governor and ../quarterly-intelligence kept
// inside each route — same pattern as the monolith.
import type { Express, Request, Response } from "express";
import { db } from "../db";
import { sql } from "drizzle-orm";

type GovernorHelpers = {
  authMiddleware: any;
  getTenantFromRequest: (req: Request) => number | null;
  requirePlatformAdmin: (req: Request, res: Response) => boolean;
};

export function registerGovernorRoutes(app: Express, helpers: GovernorHelpers) {
  const { authMiddleware, getTenantFromRequest, requirePlatformAdmin } = helpers;

  app.get("/api/governor/status", authMiddleware, async (req: Request, res: Response) => {
    try {
      if (!requirePlatformAdmin(req, res)) return;
      const tenantId = getTenantFromRequest(req);
      if (!tenantId) return res.status(401).json({ error: "Unauthorized" });
      const { getGovernorStatus } = await import("../process-governor");
      const status = await getGovernorStatus(tenantId);
      res.json(status);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.post("/api/governor/evaluate", authMiddleware, async (req: Request, res: Response) => {
    try {
      if (!requirePlatformAdmin(req, res)) return;
      const tenantId = getTenantFromRequest(req);
      if (!tenantId) return res.status(401).json({ error: "Unauthorized" });
      const dryRun = req.body?.dryRun === true;
      const { evaluateProcesses } = await import("../process-governor");
      const report = await evaluateProcesses(tenantId, dryRun);
      res.json(report);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.get("/api/governor/rules", authMiddleware, async (req: Request, res: Response) => {
    try {
      if (!requirePlatformAdmin(req, res)) return;
      const tenantId = getTenantFromRequest(req);
      if (!tenantId) return res.status(401).json({ error: "Unauthorized" });
      const { getRules } = await import("../process-governor");
      const rules = await getRules(tenantId);
      res.json(rules);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.patch("/api/governor/rules/:id", authMiddleware, async (req: Request, res: Response) => {
    try {
      if (!requirePlatformAdmin(req, res)) return;
      const tenantId = getTenantFromRequest(req);
      if (!tenantId) return res.status(401).json({ error: "Unauthorized" });
      const ruleId = parseInt(req.params.id as string);
      const { updateRule } = await import("../process-governor");
      const updated = await updateRule(tenantId, ruleId, req.body);
      res.json({ success: updated });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.get("/api/governor/actions", authMiddleware, async (req: Request, res: Response) => {
    try {
      if (!requirePlatformAdmin(req, res)) return;
      const tenantId = getTenantFromRequest(req);
      if (!tenantId) return res.status(401).json({ error: "Unauthorized" });
      const { getActionHistory } = await import("../process-governor");
      const actions = await getActionHistory(tenantId);
      res.json(actions);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.get("/api/governor/frameworks", authMiddleware, async (req: Request, res: Response) => {
    try {
      if (!requirePlatformAdmin(req, res)) return;
      const tenantId = getTenantFromRequest(req);
      if (!tenantId) return res.status(401).json({ error: "Unauthorized" });
      const result = await db.execute(sql`
        SELECT * FROM governance_frameworks WHERE tenant_id = ${tenantId} ORDER BY status ASC, name ASC
      `);
      res.json((result as any).rows || result);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.patch("/api/governor/frameworks/:id", authMiddleware, async (req: Request, res: Response) => {
    try {
      if (!requirePlatformAdmin(req, res)) return;
      const tenantId = getTenantFromRequest(req);
      if (!tenantId) return res.status(401).json({ error: "Unauthorized" });
      const fwId = parseInt(req.params.id as string);
      if (isNaN(fwId)) return res.status(400).json({ error: "Invalid framework ID" });
      const { review_notes, next_review_date, status, key_principles, rules_informed } = req.body;
      const validStatuses = ["active", "superseded", "archived"];
      if (status && !validStatuses.includes(status)) return res.status(400).json({ error: "Invalid status" });
      if (key_principles && !Array.isArray(key_principles)) return res.status(400).json({ error: "key_principles must be an array" });
      if (rules_informed && !Array.isArray(rules_informed)) return res.status(400).json({ error: "rules_informed must be an array" });
      await db.execute(sql`
        UPDATE governance_frameworks SET
          updated_at = NOW(),
          last_reviewed = NOW(),
          review_notes = COALESCE(${review_notes !== undefined ? review_notes : null}, review_notes),
          next_review_date = COALESCE(${next_review_date ? new Date(next_review_date).toISOString() : null}::timestamptz, next_review_date),
          status = COALESCE(${status || null}, status),
          key_principles = COALESCE(${key_principles ? JSON.stringify(key_principles) : null}::jsonb, key_principles),
          rules_informed = COALESCE(${rules_informed ? JSON.stringify(rules_informed) : null}::jsonb, rules_informed)
        WHERE id = ${fwId} AND tenant_id = ${tenantId}
      `);
      const result = await db.execute(sql`SELECT * FROM governance_frameworks WHERE id = ${fwId} AND tenant_id = ${tenantId}`);
      res.json(((result as any).rows || result)[0]);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.post("/api/governor/frameworks", authMiddleware, async (req: Request, res: Response) => {
    try {
      if (!requirePlatformAdmin(req, res)) return;
      const tenantId = getTenantFromRequest(req);
      if (!tenantId) return res.status(401).json({ error: "Unauthorized" });
      const { name, organization, version, source_url, category, description, key_principles, rules_informed, next_review_date, review_notes } = req.body;
      if (!name || !organization || !version || !category || !description) {
        return res.status(400).json({ error: "name, organization, version, category, and description are required" });
      }
      const validCategories = ["government_standard", "industry_framework", "corporate_governance"];
      if (!validCategories.includes(category)) return res.status(400).json({ error: "Invalid category" });
      if (key_principles && !Array.isArray(key_principles)) return res.status(400).json({ error: "key_principles must be an array" });
      if (rules_informed && !Array.isArray(rules_informed)) return res.status(400).json({ error: "rules_informed must be an array" });
      const reviewDate = next_review_date ? new Date(next_review_date).toISOString() : new Date(Date.now() + 180 * 86400000).toISOString();
      const result = await db.execute(sql`
        INSERT INTO governance_frameworks (tenant_id, name, organization, version, source_url, category, description, key_principles, rules_informed, next_review_date, review_notes)
        VALUES (${tenantId}, ${name}, ${organization}, ${version}, ${source_url || null}, ${category}, ${description},
                ${JSON.stringify(key_principles || [])}::jsonb, ${JSON.stringify(rules_informed || [])}::jsonb,
                ${reviewDate}::timestamptz, ${review_notes || null})
        RETURNING *
      `);
      res.json(((result as any).rows || result)[0]);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.post("/api/governor/scan/governance", authMiddleware, async (req: Request, res: Response) => {
    try {
      if (!requirePlatformAdmin(req, res)) return;
      const tenantId = getTenantFromRequest(req);
      if (!tenantId) return res.status(401).json({ error: "Unauthorized" });
      const { runGovernanceResearchScan } = await import("../quarterly-intelligence");
      const result = await runGovernanceResearchScan(tenantId);
      res.json(result);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.post("/api/governor/scan/models", authMiddleware, async (req: Request, res: Response) => {
    try {
      if (!requirePlatformAdmin(req, res)) return;
      const tenantId = getTenantFromRequest(req);
      if (!tenantId) return res.status(401).json({ error: "Unauthorized" });
      const { runModelRegistryRefresh } = await import("../quarterly-intelligence");
      const result = await runModelRegistryRefresh(tenantId);
      res.json(result);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.get("/api/governor/model-updates", authMiddleware, async (req: Request, res: Response) => {
    try {
      if (!requirePlatformAdmin(req, res)) return;
      const tenantId = getTenantFromRequest(req);
      if (!tenantId) return res.status(401).json({ error: "Unauthorized" });
      const result = await db.execute(sql`
        SELECT * FROM model_registry_updates WHERE tenant_id = ${tenantId} ORDER BY created_at DESC LIMIT 50
      `);
      res.json((result as any).rows || result);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.patch("/api/governor/model-updates/:id", authMiddleware, async (req: Request, res: Response) => {
    try {
      if (!requirePlatformAdmin(req, res)) return;
      const tenantId = getTenantFromRequest(req);
      if (!tenantId) return res.status(401).json({ error: "Unauthorized" });
      const updateId = parseInt(req.params.id as string);
      if (isNaN(updateId)) return res.status(400).json({ error: "Invalid ID" });
      const { status } = req.body;
      if (!["applied", "dismissed"].includes(status)) return res.status(400).json({ error: "Status must be 'applied' or 'dismissed'" });
      await db.execute(sql`
        UPDATE model_registry_updates SET status = ${status}, applied_at = NOW()
        WHERE id = ${updateId} AND tenant_id = ${tenantId}
      `);
      res.json({ success: true });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });
}
