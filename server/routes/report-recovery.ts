import type { Express, Request, Response, RequestHandler } from "express";
import { z } from "zod";
import { resumeUnspentPaidReport } from "../lib/business-report-recovery";

export function registerReportRecoveryRoute(app: Express, helpers: {
  authMiddleware: RequestHandler;
  requireAdmin: (req: Request, res: Response) => Promise<number | null>;
  recovered: (operatorId: string) => void;
}, resume = resumeUnspentPaidReport) {
  app.post("/api/admin/business-report/:operatorId/resume-unspent", helpers.authMiddleware,
    async (req: Request, res: Response) => {
      const tenantId = await helpers.requireAdmin(req, res);
      if (tenantId === null) return;
      const operator = z.string().uuid().safeParse(req.params.operatorId);
      if (!operator.success) return res.status(400).json({ error: "Valid report job ID required." });
      try {
        const result = await resume(tenantId, operator.data);
        helpers.recovered(operator.data);
        res.json(result);
      } catch {
        res.status(409).json({ error: "Recovery refused: report must be an unexpired, unspent approved Aldon draft with no prior recovery or jury result." });
      }
    });
}
