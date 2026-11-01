import { sql } from "drizzle-orm";
import { db } from "./db";
import { enqueueUniqueJob } from "./job-queue";
import { isProductionRuntime } from "./lib/runtime-env";
import { auditScheduleDecision, isCompleteAuditReport, TENANT_AUDIT_JOB_KIND } from "./lib/tenant-audit-schedule-policy";
import { computeTenantAuditEvidenceHash } from "../scripts/lib/tenant-audit-evidence-hash";
import { recordAuditNotice } from "./lib/tenant-audit-notices";

const rows = (r: any): any[] => r.rows ?? r;
let timer: NodeJS.Timeout | undefined;
let checking = false;

/** Durable jobs are the due-window ledger; boot/redeploy cannot reset the day. */
export async function checkTenantAuditSchedule(): Promise<void> {
  if (checking) return;
  checking = true;
  try {
    const sourceHash = computeTenantAuditEvidenceHash();
    const jobs = rows(await db.execute(sql`SELECT id,status,created_at,
      payload->>'window' AS window, payload->>'auditProgressAt' AS progress_at,
      payload->'auditReport'->>'evidenceHash' AS evidence_hash,
      payload->'auditReport'->>'degraded' AS degraded,
      payload->'auditReport'->'coverage' AS coverage, result->>'exitCode' AS exit_code
      FROM agent_jobs
      WHERE tenant_id=1 AND kind=${TENANT_AUDIT_JOB_KIND} ORDER BY id DESC LIMIT 10`));
    const decision = auditScheduleDecision(new Date(), jobs.map(j => ({
      status: j.status, createdAt: new Date(j.created_at).toISOString(),
      window: j.window, progressAt: j.progress_at, sourceHash: j.evidence_hash,
      findingsRequireAttention: [4, 6].includes(Number(j.exit_code)),
      complete: isCompleteAuditReport({ degraded: j.degraded === "false" ? false : true, coverage: j.coverage }),
    })), sourceHash);
    if (decision.enqueue) await enqueueUniqueJob(TENANT_AUDIT_JOB_KIND,
      `tenant-audit:${decision.window}:${sourceHash}`, { tenantId: 1, window: decision.window, sourceHash },
      { tenantId: 1, maxAttempts: 2048 });
    await recordAuditNotice(decision, sourceHash, {
      execute: query => db.execute(query),
      transaction: work => db.transaction(async tx => work(query => tx.execute(query))),
    });
    if (decision.warning) {
      console.warn(`[tenant-audit-scheduler] ${decision.warning}; coverage is not cleared`);
    }
  } finally { checking = false; }
}

export function startTenantAuditScheduler(): void {
  // The workspace workflow is for explicit/manual runs. Only the always-on
  // production VM owns recurrence; development restarts must not buy audits.
  if (timer || !isProductionRuntime() || process.env.TENANT_AUDIT_SCHEDULE_ENABLED === "0") return;
  const check = () => { checkTenantAuditSchedule().catch(error =>
    console.error("[tenant-audit-scheduler] due/freshness check failed", error)); };
  timer = setInterval(check, 60_000);
  timer.unref();
  check();
  console.log("[tenant-audit-scheduler] Armed: UTC daily durable job, minute-by-minute freshness checks");
}
