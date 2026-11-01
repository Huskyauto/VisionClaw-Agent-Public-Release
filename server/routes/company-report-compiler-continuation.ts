import type { Express, Request, Response, RequestHandler } from "express";
import { sql } from "drizzle-orm";
import { z } from "zod";
import type { db as DefaultDb } from "../db";
import { compilerContinuationPlan } from "../lib/company-report-compiler-continuation";

export async function loadCompilerContinuationChildren(database: Pick<typeof DefaultDb, "execute">, parent: any, lock = false) {
  const ids = [...new Set(Object.values(parent.payload?.state?.reports || {}).map((r: any) => r.jobId)
    .filter(id => Number.isSafeInteger(id) && id > 0))];
  if (!ids.length) return [];
  const result: any = await database.execute(sql`SELECT id,tenant_id,kind,status,attempts,payload FROM agent_jobs
    WHERE id IN (${sql.join(ids.map(id => sql`${id}`), sql`,`)}) AND tenant_id=${1}
      AND kind='business_report_review' ${lock ? sql`FOR UPDATE` : sql``}`);
  return result.rows || result;
}

export function registerCompilerContinuation(app: Express, helpers: {
  authMiddleware: RequestHandler; requireAdmin(req: Request, res: Response): Promise<number | null>;
}, db: typeof DefaultDb, configuration: () => { ready: boolean; issues: string[] }) {
  const body = z.object({ snapshot: z.string().regex(/^[a-f0-9]{64}$/), acceptResearchCost: z.literal(true) }).strict();
  app.post("/api/admin/company-report-packages/:id/continue-reviewed", helpers.authMiddleware, async (req, res) => {
    const tenant = await helpers.requireAdmin(req, res); if (tenant !== 1) return;
    const approval = body.safeParse(req.body);
    if (!/^[1-9]\d{0,9}$/.test(String(req.params.id)) || !approval.success)
      return res.status(400).json({ error: "Refresh this package and explicitly approve continuing its saved reviews." });
    if (process.env.REPORT_EVIDENCE_HANDOFFS_DISABLED === "1")
      return res.status(503).json({ error: "Report generation is stopped." });
    try {
      const childIds = await db.transaction(async tx => {
        await tx.execute(sql`SELECT pg_advisory_xact_lock(812805,${tenant})`);
        const result: any = await tx.execute(sql`SELECT id,tenant_id,kind,status,attempts,payload FROM agent_jobs
          WHERE id=${Number(req.params.id)} AND tenant_id=${tenant} AND kind='company_report_package' FOR UPDATE`);
        const parent = (result.rows || result)[0];
        if (!parent) return null;
        const previous = parent.payload.reviewCompilerContinuation;
        if (previous?.subject === approval.data.snapshot && ["pending", "running"].includes(parent.status))
          return previous.childIds;
        const active: any = await tx.execute(sql`SELECT id FROM agent_jobs WHERE tenant_id=${tenant}
          AND kind='company_report_package' AND status IN ('pending','running') LIMIT 1`);
        if ((active.rows || active).length) return null;
        const children = await loadCompilerContinuationChildren(tx, parent, true);
        const plan = compilerContinuationPlan(parent, children);
        if (!plan.available || plan.snapshot !== approval.data.snapshot) return null;
        if (!configuration().ready) return null;
        const approvedAt = new Date().toISOString(), payload = structuredClone(parent.payload);
        for (const childId of plan.childIds) {
          const child = children.find((row: any) => row.id === childId)!;
          const next = structuredClone(child.payload), prior = structuredClone(next.state);
          next.state.phase = "wait_muse"; delete next.state.stopReason;
          next.packageCompilerContinuationHistory = [...(next.packageCompilerContinuationHistory || []),
            { state: prior, subject: plan.snapshot, approvedAt }];
          const updated: any = await tx.execute(sql`UPDATE agent_jobs SET payload=${JSON.stringify(next)}::jsonb,
            status='pending',error=NULL,failure_class=NULL,lease_until=NULL,next_run_at=NOW(),completed_at=NULL,
            max_attempts=attempts+1600 WHERE id=${childId} AND tenant_id=${tenant}
            AND kind='business_report_review' AND status='failed_terminal' RETURNING id`);
          if (!(updated.rows || updated).length) throw new Error("Continuation child fence lost");
          const report = Object.values(payload.state.reports).find((r: any) => r.jobId === childId) as any;
          report.status = "pending"; delete report.error;
        }
        payload.state.phase = "reviewing"; delete payload.state.error;
        payload.reviewCompilerContinuation = { subject: plan.snapshot, childIds: plan.childIds, approvedAt };
        const updated: any = await tx.execute(sql`UPDATE agent_jobs SET payload=${JSON.stringify(payload)}::jsonb,
          status='pending',error=NULL,failure_class=NULL,lease_until=NULL,next_run_at=NOW(),completed_at=NULL,
          max_attempts=attempts+1600 WHERE id=${parent.id} AND tenant_id=${tenant}
          AND kind='company_report_package' RETURNING id`);
        if (!(updated.rows || updated).length) throw new Error("Continuation parent fence lost");
        return plan.childIds;
      });
      if (!childIds) return res.status(409).json({ error: "Saved reviews changed or cannot be continued safely. Refresh and inspect; nothing was retried." });
      res.status(202).json({ id: Number(req.params.id), childIds, status: "pending" });
    } catch { res.status(503).json({ error: "Continuation could not be confirmed. Refresh status before trying again." }); }
  });
}
