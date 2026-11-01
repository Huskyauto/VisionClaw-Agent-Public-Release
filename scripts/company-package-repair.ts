/** Owner-operated development runbook. Inspect is read-only by default.
 * --approve is an explicit bounded continuation, NEVER publication or contact. */
import { db } from "../server/db";
import { sql } from "drizzle-orm";
import { packageRepairPlan, approvePackageRepair } from "../server/lib/company-package-repair";
import { loadCompilerContinuationChildren } from "../server/routes/company-report-compiler-continuation";
import { packageConfiguration } from "../server/lib/company-report-preflight";

async function main() {
  const args = process.argv.slice(2);
  const id = Number(args[0]);
  if (!Number.isSafeInteger(id) || id <= 0 || args.some((a, i) => i > 0 && a !== "--approve"))
    throw new Error("Usage: company-package-repair.ts PARENT_ID [--approve]");
  const result = await db.transaction(async tx => {
    const approve = args.includes("--approve");
    if (approve) await tx.execute(sql`SELECT pg_advisory_xact_lock(812805,1)`);
    const found: any = await tx.execute(sql`SELECT id,tenant_id,kind,status,attempts,payload FROM agent_jobs
      WHERE id=${id} AND tenant_id=1 AND kind='company_report_package' ${approve ? sql`FOR UPDATE` : sql``}`);
    const parent = (found.rows || found)[0];
    if (!parent) throw new Error("Owner package not found");
    const children = await loadCompilerContinuationChildren(tx, parent, approve);
    const plan = packageRepairPlan(parent, children, 150);
    if (!approve) return { ...plan, configuration: packageConfiguration() };
    if (process.env.REPORT_EVIDENCE_HANDOFFS_DISABLED === "1" || !packageConfiguration().ready)
      throw new Error("Package configuration is not ready");
    const busy: any = await tx.execute(sql`SELECT id FROM agent_jobs WHERE tenant_id=1
      AND kind='company_report_package' AND status IN ('pending','running') LIMIT 1`);
    if ((busy.rows || busy).length) throw new Error("A package is already active");
    const repaired = approvePackageRepair(parent, children, {
      snapshot: plan.snapshot, modelBudgetUsd: 150, confirmAdditionalPaidWork: true,
    });
    for (const child of repaired.children) await tx.execute(sql`UPDATE agent_jobs SET
      payload=${JSON.stringify(child.payload)}::jsonb,status='pending',error=NULL,lease_until=NULL,
      next_run_at=NOW(),completed_at=NULL,max_attempts=attempts+1600
      WHERE id=${child.id} AND tenant_id=1 AND kind='business_report_review'`);
    await tx.execute(sql`UPDATE agent_jobs SET payload=${JSON.stringify(repaired.payload)}::jsonb,
      status='pending',error=NULL,lease_until=NULL,next_run_at=NOW(),completed_at=NULL,max_attempts=attempts+1600
      WHERE id=${id} AND tenant_id=1 AND kind='company_report_package'`);
    return { approved: true, id, modelBudgetUsd: 150, maximumCompletionUsd: plan.maximumCompletionUsd };
  });
  console.log(JSON.stringify(result, null, 2));
}
main().then(() => process.exit(0)).catch(error => {
  console.error(error instanceof Error ? error.message : "Package repair failed"); process.exit(1);
});
