// ─────────────────────────────────────────────────────────────────────────────
// Venture Discovery Loop — owner-only HTTP surface (2026-06-17).
//
// Every endpoint resolves tenantId from the AUTHENTICATED SESSION (never the
// body) and refuses any non-owner tenant (403). The loop itself defaults to
// dry-run and is hard-capped; these routes are the HITL control plane:
//   POST   /api/venture-discovery/start              start a run
//   GET    /api/venture-discovery                     list runs
//   GET    /api/venture-discovery/:id/status          run status
//   GET    /api/venture-discovery/:id/results         full per-stage results
//   POST   /api/venture-discovery/:id/approve-next-stage   execute + advance one stage
//   POST   /api/venture-discovery/:id/export          export json|markdown
// ─────────────────────────────────────────────────────────────────────────────

import { Router, type Request, type Response } from "express";
import { getTenantFromRequest } from "../auth";
import { ownerTenantId } from "../agentic/autonomous-budget";
import { ventureStartSchema, ventureExportSchema } from "../validation";
import * as repo from "../venture-discovery/repo";
import { startRun, approveNextStage, renderMarkdown, STAGES } from "../venture-discovery/loop";

export const ventureDiscoveryRouter = Router();

/** Owner-only: resolve the session tenant and confirm it's the owner tenant. */
function ownerTenantOrNull(req: Request): number | null {
  const tenantId = getTenantFromRequest(req);
  if (tenantId == null || tenantId !== ownerTenantId()) return null;
  return tenantId;
}

ventureDiscoveryRouter.post("/start", async (req: Request, res: Response) => {
  const tenantId = ownerTenantOrNull(req);
  if (tenantId == null) return res.status(403).json({ error: "owner_only" });
  const parsed = ventureStartSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid_body", details: parsed.error.flatten() });
  const run = await startRun({
    tenantId,
    objective: parsed.data.objective,
    dryRun: parsed.data.dryRun,
    createdBy: String(getTenantFromRequest(req) ?? "owner"),
  });
  res.status(201).json({ run, stages: STAGES });
});

ventureDiscoveryRouter.get("/", async (req: Request, res: Response) => {
  const tenantId = ownerTenantOrNull(req);
  if (tenantId == null) return res.status(403).json({ error: "owner_only" });
  res.json({ runs: await repo.listRuns(tenantId) });
});

ventureDiscoveryRouter.get("/:id/status", async (req: Request, res: Response) => {
  const tenantId = ownerTenantOrNull(req);
  if (tenantId == null) return res.status(403).json({ error: "owner_only" });
  const id = parseInt(String(req.params.id), 10);
  if (!Number.isFinite(id)) return res.status(400).json({ error: "bad_id" });
  const run = await repo.getRun(tenantId, id);
  if (!run) return res.status(404).json({ error: "not_found" });
  res.json({ run, stages: STAGES });
});

ventureDiscoveryRouter.get("/:id/results", async (req: Request, res: Response) => {
  const tenantId = ownerTenantOrNull(req);
  if (tenantId == null) return res.status(403).json({ error: "owner_only" });
  const id = parseInt(String(req.params.id), 10);
  if (!Number.isFinite(id)) return res.status(400).json({ error: "bad_id" });
  const results = await repo.getRunResults(tenantId, id);
  if (!results) return res.status(404).json({ error: "not_found" });
  res.json(results);
});

ventureDiscoveryRouter.post("/:id/approve-next-stage", async (req: Request, res: Response) => {
  const tenantId = ownerTenantOrNull(req);
  if (tenantId == null) return res.status(403).json({ error: "owner_only" });
  const id = parseInt(String(req.params.id), 10);
  if (!Number.isFinite(id)) return res.status(400).json({ error: "bad_id" });
  const result = await approveNextStage(tenantId, id);
  if (!result.ok) {
    const code = result.error === "run_not_found" ? 404 : result.error === "budget_exceeded" ? 402 : 409;
    return res.status(code).json(result);
  }
  res.json(result);
});

ventureDiscoveryRouter.post("/:id/export", async (req: Request, res: Response) => {
  const tenantId = ownerTenantOrNull(req);
  if (tenantId == null) return res.status(403).json({ error: "owner_only" });
  const id = parseInt(String(req.params.id), 10);
  if (!Number.isFinite(id)) return res.status(400).json({ error: "bad_id" });
  const parsed = ventureExportSchema.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: "invalid_body", details: parsed.error.flatten() });
  const results = await repo.getRunResults(tenantId, id);
  if (!results) return res.status(404).json({ error: "not_found" });
  const format = parsed.data.format ?? "json";
  if (format === "markdown") {
    res.setHeader("Content-Type", "text/markdown; charset=utf-8");
    return res.send(renderMarkdown(results));
  }
  res.json(results);
});
