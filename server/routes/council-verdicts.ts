// R115 — Council verdict REST surface. Tenant-scoped read + request + final-
// decision recording. No admin gate needed: the Council never writes outside
// its own table, and procedure-edit access is already tenant-scoped via
// getProcedureEdit.
//
// Routes:
//   POST /api/council-verdicts/request/:editId   — fan out to 3 lineages, store + return verdict
//   GET  /api/council-verdicts/by-edit/:editId   — latest verdict for an edit (UI panel)
//   POST /api/council-verdicts/:id/final         — record Bob's final decision (track record)
//   GET  /api/council-verdicts/track-record      — aggregate agreement stats

import { Router, type Request, type Response } from "express";
import {
  requestCouncilReview,
  getLatestCouncilVerdict,
  recordFinalDecision,
  getCouncilTrackRecord,
} from "../lib/external-review-council";
import { getTenantFromRequest } from "../auth";
import { validate, councilFinalDecisionSchema, emptyBodySchema } from "../validation";

export const councilVerdictsRouter = Router();

// Architect R115.4 review (MED): council verdicts inform procedure-edit
// governance decisions. The full chain (request review → record final
// decision) must NOT be reachable via `Bearer vc_` API keys — same posture
// as procedure-edits. Mirrors the requireSessionAuth pattern in
// server/routes/mcp-server.ts (R113.7+sec MED-2).
councilVerdictsRouter.use((req: Request, res: Response, next) => {
  const authHeader = String(req.headers.authorization || "");
  if (/^Bearer\s+vc_/i.test(authHeader)) {
    return res.status(403).json({
      ok: false,
      error: "Council verdict surface requires session auth (browser cookie or Replit OIDC). vc_* API keys are not accepted on this endpoint.",
    });
  }
  next();
});

councilVerdictsRouter.post("/request/:editId", validate(emptyBodySchema), async (req: Request, res: Response) => {
  try {
    const tenantId = getTenantFromRequest(req);
    if (!tenantId) return res.status(401).json({ error: "tenant_required" });
    const editId = Number(req.params.editId);
    if (!Number.isInteger(editId) || editId <= 0) return res.status(400).json({ error: "invalid_edit_id" });
    const result = await requestCouncilReview({ editId, tenantId });
    res.json(result);
  } catch (e: any) {
    res.status(500).json({ error: e?.message || "council_review_failed" });
  }
});

councilVerdictsRouter.get("/by-edit/:editId", async (req: Request, res: Response) => {
  try {
    const tenantId = getTenantFromRequest(req);
    if (!tenantId) return res.status(401).json({ error: "tenant_required" });
    const editId = Number(req.params.editId);
    if (!Number.isInteger(editId) || editId <= 0) return res.status(400).json({ error: "invalid_edit_id" });
    const row = await getLatestCouncilVerdict(editId, tenantId);
    res.json({ ok: true, verdict: row || null });
  } catch (e: any) {
    res.status(500).json({ error: e?.message || "get_failed" });
  }
});

councilVerdictsRouter.post("/:id/final", validate(councilFinalDecisionSchema), async (req: Request, res: Response) => {
  try {
    const tenantId = getTenantFromRequest(req);
    if (!tenantId) return res.status(401).json({ error: "tenant_required" });
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: "invalid_id" });
    const { finalDecision } = req.body;
    const decidedBy = (req as any).user?.email || (req as any).user?.username || (req as any).user?.id || "ui";
    const result = await recordFinalDecision({
      verdictId: id,
      tenantId,
      finalDecision,
      decidedBy: String(decidedBy),
    });
    res.json(result);
  } catch (e: any) {
    res.status(500).json({ error: e?.message || "record_failed" });
  }
});

councilVerdictsRouter.get("/track-record", async (req: Request, res: Response) => {
  try {
    const tenantId = getTenantFromRequest(req);
    if (!tenantId) return res.status(401).json({ error: "tenant_required" });
    const limit = req.query.limit ? Math.min(500, Number(req.query.limit)) : 100;
    const record = await getCouncilTrackRecord(tenantId, limit);
    res.json({ ok: true, ...record });
  } catch (e: any) {
    res.status(500).json({ error: e?.message || "track_record_failed" });
  }
});
