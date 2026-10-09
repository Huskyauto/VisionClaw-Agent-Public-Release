import { Router, type Request, type Response, type NextFunction } from "express";
import { getTenantFromRequest, isAdminRequest } from "../auth";
import { ownerTenantId } from "../agentic/autonomous-budget";
import { listIncomeOpportunities } from "../lib/income-opportunities";

export const incomeOpportunitiesRouter = Router();

incomeOpportunitiesRouter.get("/", async (req: Request, res: Response, next: NextFunction) => {
  const tenantId = getTenantFromRequest(req);
  if (tenantId == null || tenantId !== ownerTenantId() || !isAdminRequest(req)) {
    return res.status(403).json({ error: "owner_only" });
  }
  try {
    res.json({ opportunities: await listIncomeOpportunities(tenantId) });
  } catch (error) {
    next(error);
  }
});