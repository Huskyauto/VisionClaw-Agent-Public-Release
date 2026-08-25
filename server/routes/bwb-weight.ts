// ─────────────────────────────────────────────────────────────────────────────
// Built With Bob — weight tracker HTTP surface (owner-only).
//
// Backs the "Weight Tracking" card on the BWB project page (project 16). Bob
// weighs in Monday mornings; this lets him log the number any day with NO build
// triggered — the same DB row (`agent_settings`) the weekly recap reads as a
// supplied fact. Nothing is hardcoded; the recap always reads the latest value.
//
//   GET   /api/bwb/weight     current weight + staleness status
//   POST  /api/bwb/weight     log/update weight (currentWeight/totalLost/startWeight)
//
// Every endpoint resolves tenantId from the AUTHENTICATED SESSION (never the
// body) and refuses any non-owner tenant (403). CSRF + Zod validation are
// applied by the global middleware / validate() on the POST.
// ─────────────────────────────────────────────────────────────────────────────

import { Router, type Request, type Response } from "express";
import { getTenantFromRequest } from "../auth";
import { ownerTenantId } from "../agentic/autonomous-budget";
import { bwbWeightUpdateSchema } from "../validation";
import { getBwbWeightStatus, setBwbWeight } from "../lib/bwb-weight";

export const bwbWeightRouter = Router();

/** Owner-only: resolve the session tenant and confirm it's the owner tenant. */
function ownerTenantOrNull(req: Request): number | null {
  const tenantId = getTenantFromRequest(req);
  if (tenantId == null || tenantId !== ownerTenantId()) return null;
  return tenantId;
}

bwbWeightRouter.get("/", async (req: Request, res: Response) => {
  if (ownerTenantOrNull(req) == null) return res.status(403).json({ error: "owner_only" });
  const status = await getBwbWeightStatus();
  return res.json(status);
});

bwbWeightRouter.post("/", async (req: Request, res: Response) => {
  if (ownerTenantOrNull(req) == null) return res.status(403).json({ error: "owner_only" });
  const parsed = bwbWeightUpdateSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "invalid_body", details: parsed.error.flatten() });
  }
  await setBwbWeight(parsed.data);
  const status = await getBwbWeightStatus();
  return res.json(status);
});
