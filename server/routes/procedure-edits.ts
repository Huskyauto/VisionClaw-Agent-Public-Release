import { Router, type Request, type Response } from "express";
import {
  proposeProcedureEdit,
  listProcedureEdits,
  getProcedureEdit,
  reviewProcedureEdit,
  applyProcedureEdit,
  rollbackProcedureEdit,
  EDITABLE_SURFACES,
} from "../lib/aevo-meta-editor";
import { getTenantFromRequest, requirePlatformAdmin } from "../auth";
import {
  validate,
  procedureEditApplySchema,
  procedureEditProposeSchema,
  procedureEditReviewSchema,
  procedureEditRollbackSchema,
} from "../validation";

export const procedureEditsRouter = Router();

// Architect R115.4 review (MED): procedure-edit governance is HITL-gated and
// must NOT be reachable via `Bearer vc_` API keys. Otherwise a leaked vc_
// could propose / approve / apply / rollback playbook edits without the
// browser-session + CSRF gate. Mirrors the requireSessionAuth pattern in
// server/routes/mcp-server.ts (R113.7+sec MED-2).
procedureEditsRouter.use((req: Request, res: Response, next) => {
  const authHeader = String(req.headers.authorization || "");
  if (/^Bearer\s+vc_/i.test(authHeader)) {
    return res.status(403).json({
      ok: false,
      error: "Procedure-edit governance requires session auth (browser cookie or Replit OIDC). vc_* API keys are not accepted on this endpoint.",
    });
  }
  next();
});

procedureEditsRouter.get("/", async (req: Request, res: Response) => {
  try {
    const tenantId = getTenantFromRequest(req);
    if (!tenantId) return res.status(401).json({ error: "tenant_required" });
    const status = typeof req.query.status === "string" ? req.query.status : undefined;
    const targetId = typeof req.query.targetId === "string" ? req.query.targetId : undefined;
    const limit = req.query.limit ? Number(req.query.limit) : undefined;
    const rows = await listProcedureEdits({ tenantId, status, targetId, limit });
    res.json({ ok: true, edits: rows });
  } catch (e: any) {
    res.status(500).json({ error: e?.message || "list_failed" });
  }
});

procedureEditsRouter.get("/:id", async (req: Request, res: Response) => {
  try {
    const tenantId = getTenantFromRequest(req);
    if (!tenantId) return res.status(401).json({ error: "tenant_required" });
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: "invalid_id" });
    const row = await getProcedureEdit(id, tenantId);
    if (!row) return res.status(404).json({ error: "not_found" });
    res.json({ ok: true, edit: row });
  } catch (e: any) {
    res.status(500).json({ error: e?.message || "get_failed" });
  }
});

procedureEditsRouter.post("/propose", validate(procedureEditProposeSchema), async (req: Request, res: Response) => {
  try {
    const tenantId = getTenantFromRequest(req);
    if (!tenantId) return res.status(401).json({ error: "tenant_required" });
    const { targetKind, targetId, evidenceWindowDays } = req.body;
    // Zod gives shape; allowlist is the business rule.
    if (!(EDITABLE_SURFACES as readonly string[]).includes(String(targetKind))) {
      return res.status(400).json({ error: "targetKind not in allowlist", allowed: EDITABLE_SURFACES });
    }
    const result = await proposeProcedureEdit({
      tenantId,
      targetKind: targetKind as any,
      targetId,
      evidenceWindowDays: evidenceWindowDays ? Number(evidenceWindowDays) : undefined,
      proposedBy: "ui",
    });
    res.json(result);
  } catch (e: any) {
    res.status(500).json({ error: e?.message || "propose_failed" });
  }
});

procedureEditsRouter.patch("/:id", validate(procedureEditReviewSchema), async (req: Request, res: Response) => {
  try {
    const tenantId = getTenantFromRequest(req);
    if (!tenantId) return res.status(401).json({ error: "tenant_required" });
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: "invalid_id" });
    const { decision, note } = req.body;
    const reviewer =
      (req as any).user?.email || (req as any).user?.username || (req as any).user?.id || "ui";
    const result = await reviewProcedureEdit({
      editId: id,
      tenantId,
      decision,
      reviewedBy: String(reviewer),
      note: typeof note === "string" ? note : undefined,
    });
    res.json(result);
  } catch (e: any) {
    res.status(500).json({ error: e?.message || "review_failed" });
  }
});

// R114 +sec v8b (architect HIGH-1 closed, pass 2 tightened) — platform-admin
// guard at the route layer for destructive AEvo operations. Previously the
// routes only required tenant auth, then briefly required isAdminRequest. Both
// were too loose: data/output-skills/*.md is a SHARED/GLOBAL surface (every
// tenant reads the same playbooks), so any tenant-admin from any tenant could
// have rewritten Bob's playbooks. requirePlatformAdmin enforces (1) admin
// session AND (2) tenantId === ADMIN_TENANT_ID, matching the surface's blast
// radius. Tool-policy enforcement still fires on the agent path; this is the
// REST gate for the UI. propose + review (PATCH) stay at tenant-auth since
// they're queue-state changes, not file mutations.
procedureEditsRouter.post("/:id/apply", validate(procedureEditApplySchema), async (req: Request, res: Response) => {
  try {
    const tenantId = getTenantFromRequest(req);
    if (!tenantId) return res.status(401).json({ error: "tenant_required" });
    if (!requirePlatformAdmin(req, res)) return;
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: "invalid_id" });
    const result = await applyProcedureEdit({ editId: id, tenantId });
    res.json(result);
  } catch (e: any) {
    res.status(500).json({ error: e?.message || "apply_failed" });
  }
});

procedureEditsRouter.post("/:id/rollback", validate(procedureEditRollbackSchema), async (req: Request, res: Response) => {
  try {
    const tenantId = getTenantFromRequest(req);
    if (!tenantId) return res.status(401).json({ error: "tenant_required" });
    if (!requirePlatformAdmin(req, res)) return;
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: "invalid_id" });
    const reason = (req.body?.reason as string) || "manual_rollback";
    const result = await rollbackProcedureEdit({ editId: id, tenantId, reason });
    res.json(result);
  } catch (e: any) {
    res.status(500).json({ error: e?.message || "rollback_failed" });
  }
});
