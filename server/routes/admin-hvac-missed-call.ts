import type { Express, Request, Response } from "express";
import { db } from "../db";
import { sql } from "drizzle-orm";
import { calculateHvacOpportunity, hvacWorkspacePatchSchema, hvacWorkspaceRequestSchema } from "../lib/hvac-missed-call-recovery";

type Helpers = { authMiddleware: any; getTenantFromRequest: (req: Request) => number | null; isAdminRequest: (req: Request) => boolean; execute?: typeof db.execute };
const enabled = () => process.env.HVAC_MISSED_CALL_PRODUCT_ENABLED !== "0";
const canonical = (v: any): string => Array.isArray(v) ? `[${v.map(canonical).join(",")}]` : v && typeof v === "object" ? `{${Object.keys(v).sort().map(k => `${JSON.stringify(k)}:${canonical(v[k])}`).join(",")}}` : JSON.stringify(v);
const requestIdentity = (v: any, estimate: any) => canonical({ prospectName: v.prospectName, companyName: v.companyName, trade: v.trade, intake: v.intake, assumptions: v.assumptions, status: v.status, readiness: v.readiness, estimate });
export const serializeWorkspace = (r: any) => ({
  id: r.id, tenantId: r.tenant_id, idempotencyKey: r.idempotency_key, prospectName: r.prospect_name,
  companyName: r.company_name, trade: r.trade, intake: r.intake, assumptions: r.assumptions,
  estimate: r.estimate, status: r.status, readiness: r.readiness, createdAt: r.created_at, updatedAt: r.updated_at,
});

function guard(req: Request, res: Response, h: Helpers) {
  if (!enabled()) { res.status(404).json({ error: "product-disabled" }); return null; }
  const tenantId = h.getTenantFromRequest(req);
  if (!tenantId || !h.isAdminRequest(req)) { res.status(403).json({ error: "Admin access required" }); return null; }
  return tenantId;
}
function audit(action: string, tenantId: number, workspaceId: number, status: string) {
  console.info("[hvac-missed-call:audit]", { action, tenantId, workspaceId, status });
}

export function registerAdminHvacMissedCallRoutes(app: Express, h: Helpers) {
  const execute = h.execute || db.execute.bind(db);
  app.get("/api/admin/missed-call-recovery/workspaces", h.authMiddleware, async (req, res) => {
    const tenantId = guard(req, res, h); if (!tenantId) return;
    const result: any = await execute(sql`SELECT * FROM hvac_missed_call_workspaces WHERE tenant_id=${tenantId} ORDER BY updated_at DESC LIMIT 100`);
    res.json((result.rows || result).map(serializeWorkspace));
  });
  app.post("/api/admin/missed-call-recovery/workspaces", h.authMiddleware, async (req, res) => {
    const tenantId = guard(req, res, h); if (!tenantId) return;
    const parsed = hvacWorkspaceRequestSchema.safeParse(req.body); if (!parsed.success) return res.status(400).json({ error: "Invalid workspace", issues: parsed.error.issues });
    const v = parsed.data; const estimate = calculateHvacOpportunity(v.assumptions);
    const existing: any = await execute(sql`SELECT * FROM hvac_missed_call_workspaces WHERE tenant_id=${tenantId} AND idempotency_key=${v.idempotencyKey} LIMIT 1`);
    const prior = (existing.rows || existing)[0];
    if (prior) {
      if (requestIdentity({ prospectName: prior.prospect_name, companyName: prior.company_name, trade: prior.trade, intake: prior.intake, assumptions: prior.assumptions, status: prior.status, readiness: prior.readiness }, prior.estimate) !== requestIdentity(v, estimate)) return res.status(409).json({ error: "Idempotency key belongs to another workspace" });
      return res.status(200).json({ ...serializeWorkspace(prior), reused: true });
    }
    const result: any = await execute(sql`INSERT INTO hvac_missed_call_workspaces (tenant_id,idempotency_key,prospect_name,company_name,trade,intake,assumptions,estimate,status,readiness)
      VALUES (${tenantId},${v.idempotencyKey},${v.prospectName},${v.companyName},${v.trade},${JSON.stringify(v.intake)}::jsonb,${JSON.stringify(v.assumptions)}::jsonb,${JSON.stringify(estimate)}::jsonb,${v.status},${JSON.stringify(v.readiness)}::jsonb)
      ON CONFLICT (tenant_id,idempotency_key) DO NOTHING RETURNING *`);
    const row = (result.rows || result)[0];
    if (row) {
      audit("create", tenantId, row.id, row.status);
      return res.status(201).json({ ...serializeWorkspace(row), reused: false });
    }

    // A concurrent request won the unique-key race. Reconcile that durable row
    // instead of mutating it or retrying the insert.
    const raced: any = await execute(sql`SELECT * FROM hvac_missed_call_workspaces WHERE tenant_id=${tenantId} AND idempotency_key=${v.idempotencyKey} LIMIT 1`);
    const racedRow = (raced.rows || raced)[0];
    if (!racedRow) return res.status(409).json({ error: "Workspace creation conflicted; retry the read" });
    if (requestIdentity({ prospectName: racedRow.prospect_name, companyName: racedRow.company_name, trade: racedRow.trade, intake: racedRow.intake, assumptions: racedRow.assumptions, status: racedRow.status, readiness: racedRow.readiness }, racedRow.estimate) !== requestIdentity(v, estimate)) {
      return res.status(409).json({ error: "Idempotency key belongs to another workspace" });
    }
    return res.status(200).json({ ...serializeWorkspace(racedRow), reused: true });
  });
  app.patch("/api/admin/missed-call-recovery/workspaces/:id", h.authMiddleware, async (req, res) => {
    const tenantId = guard(req, res, h); if (!tenantId) return;
    const parsed = hvacWorkspacePatchSchema.safeParse(req.body); if (!parsed.success) return res.status(400).json({ error: "Invalid workspace", issues: parsed.error.issues });
    const v = parsed.data; const id = Number(req.params.id); if (!Number.isInteger(id)) return res.status(400).json({ error: "Invalid id" });
    const estimate = v.assumptions ? calculateHvacOpportunity(v.assumptions) : undefined;
    const result: any = await execute(sql`UPDATE hvac_missed_call_workspaces SET
      prospect_name=COALESCE(${v.prospectName ?? null},prospect_name), company_name=COALESCE(${v.companyName ?? null},company_name),
      trade=COALESCE(${v.trade ?? null},trade), intake=COALESCE(${v.intake ? JSON.stringify(v.intake) : null}::jsonb,intake),
      assumptions=COALESCE(${v.assumptions ? JSON.stringify(v.assumptions) : null}::jsonb,assumptions),
      estimate=COALESCE(${estimate ? JSON.stringify(estimate) : null}::jsonb,estimate), status=COALESCE(${v.status ?? null},status),
      readiness=COALESCE(${v.readiness ? JSON.stringify(v.readiness) : null}::jsonb,readiness), updated_at=CURRENT_TIMESTAMP
      WHERE id=${id} AND tenant_id=${tenantId} RETURNING *`);
    const row = (result.rows || result)[0]; if (!row) return res.status(404).json({ error: "Workspace not found" }); audit("update", tenantId, id, row.status); res.json(serializeWorkspace(row));
  });
}