import type { Express, Request } from "express";
import { db } from "../db";
import { sql } from "drizzle-orm";

type AuthHelpers = {
  getTenantFromRequest: (req: Request) => number | null;
  isAdminRequest: (req: Request) => boolean;
};

const VALID_STATUSES = [
  "approved",
  "rejected",
  "applied",
  "pending",
  "ready",
  "needs_review",
  "failed",
  "reverted",
];

export function registerCodeProposalsRoutes(app: Express, helpers: AuthHelpers) {
  const { getTenantFromRequest, isAdminRequest } = helpers;

  app.get("/api/research/code-proposals", async (req, res) => {
    const tenantId = getTenantFromRequest(req);
    if (!tenantId) return res.status(401).json({ error: "Unauthorized" });
    try {
      const status = req.query.status as string | undefined;
      const result = status
        ? await db.execute(
            sql`SELECT * FROM code_proposals WHERE tenant_id = ${tenantId} AND status = ${status} ORDER BY created_at DESC LIMIT 50`,
          )
        : await db.execute(
            sql`SELECT * FROM code_proposals WHERE tenant_id = ${tenantId} ORDER BY created_at DESC LIMIT 50`,
          );
      res.json(((result as any).rows || result) || []);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get("/api/research/code-proposals/:id", async (req, res) => {
    const tenantId = getTenantFromRequest(req);
    if (!tenantId) return res.status(401).json({ error: "Unauthorized" });
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) return res.status(400).json({ error: "Invalid proposal ID" });
      const result = await db.execute(
        sql`SELECT * FROM code_proposals WHERE id = ${id} AND tenant_id = ${tenantId}`,
      );
      const rows = (result as any).rows || result;
      if (!rows.length) return res.status(404).json({ error: "Not found" });
      res.json(rows[0]);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.patch("/api/research/code-proposals/:id", async (req, res) => {
    const tenantId = getTenantFromRequest(req);
    if (!tenantId) return res.status(401).json({ error: "Unauthorized" });
    if (!isAdminRequest(req)) return res.status(403).json({ error: "Admin access required" });
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) return res.status(400).json({ error: "Invalid proposal ID" });
      const { status, reviewed_by } = req.body;
      if (!VALID_STATUSES.includes(status)) {
        return res.status(400).json({ error: "Invalid status" });
      }
      const now = new Date().toISOString();
      const result = await db.execute(sql`
        UPDATE code_proposals SET
          status = ${status},
          reviewed_by = ${reviewed_by || "admin"},
          reviewed_at = ${now}::timestamp
        WHERE id = ${id} AND tenant_id = ${tenantId}
        RETURNING *
      `);
      const rows = (result as any).rows || result;
      if (!rows.length) return res.status(404).json({ error: "Not found" });
      res.json(rows[0]);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/research/code-proposals/:id/apply", async (req, res) => {
    const tenantId = getTenantFromRequest(req);
    if (!tenantId) return res.status(401).json({ error: "Unauthorized" });
    if (!isAdminRequest(req)) return res.status(403).json({ error: "Admin access required" });
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) return res.status(400).json({ error: "Invalid proposal ID" });
      const { safeApplyProposal } = await import("../research-engine");
      const result = await safeApplyProposal(id, tenantId);
      // Round 25.2 (architect-flagged): business-rule failures used to return 200 with
      // {success:false}, which made the UI toast "Applied" on rejection. Now non-success
      // returns 400 so react-query mutations throw and show the real error.
      if (!result.success) {
        return res.status(400).json({ ...result, error: result.error || `Apply rejected at stage "${result.stage}"` });
      }
      res.json(result);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/research/code-proposals/:id/revert", async (req, res) => {
    const tenantId = getTenantFromRequest(req);
    if (!tenantId) return res.status(401).json({ error: "Unauthorized" });
    if (!isAdminRequest(req)) return res.status(403).json({ error: "Admin access required" });
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) return res.status(400).json({ error: "Invalid proposal ID" });
      const { revertProposal } = await import("../research-engine");
      const result: any = await revertProposal(id, tenantId);
      if (result && result.success === false) {
        return res.status(400).json({ ...result, error: result.error || "Revert rejected" });
      }
      res.json(result);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });
}
