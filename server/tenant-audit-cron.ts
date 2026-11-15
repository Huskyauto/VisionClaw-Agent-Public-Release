import { sql } from "drizzle-orm";
import { db } from "./db";
import { enqueueUniqueJob } from "./job-queue";
import { isProductionRuntime } from "./lib/runtime-env";
import { auditScheduleDecision, auditCarryForward, isCompleteAuditReport, TENANT_AUDIT_JOB_KIND } from "./lib/tenant-audit-schedule-policy";
import { computeTenantAuditEvidenceHash } from "../scripts/lib/tenant-audit-evidence-hash";
import { recordAuditNotice } from "./lib/tenant-audit-notices";

const rows = (r: any): any[] => r.rows ?? r;
let timer: NodeJS.Timeout | undefined;
let checking = false;
let lastNotice: string | undefined;

/** Durable weekly campaigns retain progress; the runner admits one daily batch. */
export async function checkTenantAuditSchedule(): Promise<void> {
  if (checking) return;
  checking = true;
  try {
    const sourceHash = computeTenantAuditEvidenceHash();
    const jobs = rows(await db.execute(sql`SELECT id,status,created_at,next_run_at,
      payload->>'window' AS window, payload->>'auditProgressAt' AS progress_at,
      payload->'auditReport'->>'evidenceHash' AS evidence_hash,
      payload->'auditReport'->>'degraded' AS degraded,
      payload->'auditReport'->'coverage' AS coverage, result->>'exitCode' AS exit_code
      FROM agent_jobs
      WHERE tenant_id=1 AND kind=${TENANT_AUDIT_JOB_KIND} ORDER BY id DESC LIMIT 10`));
    const decision = auditScheduleDecision(new Date(), jobs.map(j => ({
      status: j.status, createdAt: new Date(j.created_at).toISOString(),
      nextRunAt: j.next_run_at ? new Date(j.next_run_at).toISOString() : undefined,
      window: j.window, progressAt: j.progress_at, sourceHash: j.evidence_hash,
      findingsRequireAttention: [4, 6].includes(Number(j.exit_code)),
      complete: isCompleteAuditReport({ degraded: j.degraded === "false" ? false : true, coverage: j.coverage }),
    })), sourceHash);
    if (decision.enqueue) {
      // Only load the large retained state when rotating a campaign, not each
      // minute. The child independently validates exact-input cache evidence.
      const retained = rows(await db.execute(sql`SELECT payload FROM agent_jobs
        WHERE tenant_id=1 AND kind=${TENANT_AUDIT_JOB_KIND}
        ORDER BY id DESC LIMIT 1`))[0]?.payload;
      await enqueueUniqueJob(TENANT_AUDIT_JOB_KIND,
        `tenant-audit:${decision.window}:${sourceHash}`,
        { ...auditCarryForward(retained), tenantId: 1, window: decision.window, sourceHash },
        { tenantId: 1, maxAttempts: 2048 });
    }
    await recordAuditNotice(decision, sourceHash, {
      execute: query => db.execute(query),
      transaction: work => db.transaction(async tx => work(query => tx.execute(query))),
    });
    const notice = `${decision.window}:${sourceHash}:${decision.warning}`;
    if (decision.warning && notice !== lastNotice) {
      if (decision.warning === "batch_scheduled")
        console.info("[tenant-audit-scheduler] Daily batch scheduled; weekly coverage remains incomplete");
      else console.warn(`[tenant-audit-scheduler] ${decision.warning}; coverage is not cleared`);
    }
    lastNotice = notice;
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
  console.log("[tenant-audit-scheduler] Armed: weekly UTC campaign, one bounded batch per day; freshness checks do not dispatch models");
}
