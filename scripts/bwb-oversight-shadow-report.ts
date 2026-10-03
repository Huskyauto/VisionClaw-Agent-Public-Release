/**
 * Tenant-scoped, read-only report for Built With Bob oversight shadow events.
 *
 * Usage:
 *   npx tsx scripts/bwb-oversight-shadow-report.ts --tenant 1 [--days 30]
 */
import { db, pool } from "../server/db";
import { sql } from "drizzle-orm";
import {
  isBwbShadowObservationAuthoritative,
  isBwbShadowRunEvidenceReady,
  missingBwbShadowEvents,
  parseBwbShadowObservation,
} from "../server/lib/bwb-oversight-shadow";

function requiredPositiveInt(flag: string): number {
  const index = process.argv.indexOf(flag);
  const value = Number(index >= 0 ? process.argv[index + 1] : NaN);
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${flag} requires a positive integer`);
  }
  return value;
}

function optionalDays(): number {
  const index = process.argv.indexOf("--days");
  if (index < 0) return 30;
  const value = Number(process.argv[index + 1]);
  return Number.isSafeInteger(value) && value > 0 && value <= 365 ? value : 30;
}

type Observation = {
  jobId?: string;
  event?: string;
  stage?: string;
  observedAt?: string;
  reviewLatencyMs?: number;
  approved?: boolean;
};

async function main() {
  const tenantId = requiredPositiveInt("--tenant");
  const days = optionalDays();
  const [jobResult, eventResult] = await Promise.all([
    db.execute(sql`
    WITH recent_jobs AS (
      SELECT job_id, created_at, completed_at, status
      FROM video_jobs
      WHERE tenant_id = ${tenantId}
        AND spec->>'kind' = 'bwb_weekly_recap'
        AND created_at > now() - make_interval(days => ${days}::int)
      ORDER BY created_at DESC
      LIMIT 50
    )
    SELECT
      jobs.job_id AS verified_job_id,
      jobs.created_at AS job_created_at,
      jobs.completed_at AS job_completed_at,
      jobs.status AS job_status,
      aa.id AS approval_id,
      aa.status AS approval_status,
      aa.requested_at AS approval_requested_at,
      aa.decided_at AS approval_decided_at,
      aa.context->>'jobId' AS approval_job_id,
      aa.context->>'kind' AS approval_kind
    FROM recent_jobs jobs
    LEFT JOIN LATERAL (
      SELECT id, status, requested_at, decided_at, context
      FROM agent_approvals
      WHERE tenant_id = ${tenantId}
        AND context->>'kind' = 'bwb-weekly'
        AND context->>'jobId' = jobs.job_id
      ORDER BY requested_at DESC
      LIMIT 1
    ) aa ON true
    ORDER BY jobs.created_at ASC
  `),
    db.execute(sql`
      SELECT data, created_at
      FROM event_log
      WHERE tenant_id = ${tenantId}
        AND event_type = 'bwb_oversight_shadow'
        AND status = 'shadow'
        AND created_at > now() - make_interval(days => ${days}::int)
      ORDER BY created_at DESC
      LIMIT 250
    `),
  ]);
  const rows: any[] = (jobResult as any).rows || jobResult;
  const eventRows: any[] = ((eventResult as any).rows || eventResult).reverse();
  const runs = new Map<string, {
    events: Observation[];
    createdAt?: Date;
    completedAt?: Date;
    status?: string;
    approvalStatus?: string;
    approvalId?: number;
    approvalJobId?: string;
    approvalKind?: string;
    approvalRequestedAt?: Date;
    approvalDecidedAt?: Date;
  }>();
  let invalidRows = 0;
  let uncorroboratedRows = 0;
  for (const row of rows) {
    const jobId = String(row.verified_job_id || "");
    if (!jobId) continue;
    const run = runs.get(jobId) ?? {
      events: [],
      createdAt: row.job_created_at ? new Date(row.job_created_at) : undefined,
      completedAt: row.job_completed_at ? new Date(row.job_completed_at) : undefined,
      status: row.job_status || undefined,
      approvalStatus: row.approval_status || undefined,
      approvalId: row.approval_id == null ? undefined : Number(row.approval_id),
      approvalJobId: row.approval_job_id || undefined,
      approvalKind: row.approval_kind || undefined,
      approvalRequestedAt: row.approval_requested_at ? new Date(row.approval_requested_at) : undefined,
      approvalDecidedAt: row.approval_decided_at ? new Date(row.approval_decided_at) : undefined,
    };
    runs.set(jobId, run);
  }
  for (const row of eventRows) {
    let raw: unknown = row.data;
    try {
      if (typeof raw === "string") raw = JSON.parse(raw);
    } catch {
      invalidRows++;
      continue;
    }
    const data = parseBwbShadowObservation(raw);
    if (!data) {
      invalidRows++;
      continue;
    }
    const run = runs.get(data.jobId);
    if (!run) {
      uncorroboratedRows++;
      continue;
    }
    const authority = {
      videoJobId: data.jobId,
      videoStatus: run.status,
      videoCreatedAt: run.createdAt,
      videoCompletedAt: run.completedAt,
      approval: run.approvalId == null ? null : {
        id: run.approvalId,
        jobId: run.approvalJobId,
        kind: run.approvalKind,
        status: run.approvalStatus,
        requestedAt: run.approvalRequestedAt,
        decidedAt: run.approvalDecidedAt,
      },
    };
    if (!isBwbShadowObservationAuthoritative(data, authority)) {
      uncorroboratedRows++;
      continue;
    }
    const previous = run.events.at(-1);
    if (previous?.event === data.event && previous?.stage === data.stage) continue;
    run.events.push(data);
  }

  console.log(`\n=== Built With Bob oversight shadow (${days} day(s), tenant ${tenantId}) ===`);
  if (runs.size === 0) {
    console.log("No weekly recap jobs yet in this window.");
    console.log("Evidence verdict: NOT STARTED — no value conclusion is possible.");
    return;
  }

  let complete = 0;
  let decisions = 0;
  let telemetryCompleteDecidedRuns = 0;
  const reviewLatencies: number[] = [];
  for (const [jobId, run] of runs) {
    const events = run.events;
    const decisionObserved = events.some((event) => event.event === "approval_decided");
    const decisionMade = run.approvalStatus === "approved" || run.approvalStatus === "rejected";
    const reviewLatencyMs = decisionMade && run.approvalRequestedAt && run.approvalDecidedAt
      ? Math.max(0, run.approvalDecidedAt.getTime() - run.approvalRequestedAt.getTime())
      : undefined;
    const stages = [...new Set(events.map((event) => event.stage).filter(Boolean))];
    const missingEvents = missingBwbShadowEvents(events as any, run.status, run.approvalStatus);
    const terminalStatus = run.status === "done" || run.status === "failed";
    if (terminalStatus && run.completedAt) complete++;
    if (decisionMade) decisions++;
    if (isBwbShadowRunEvidenceReady({
      events: events as any,
      videoStatus: run.status,
      completedAt: run.completedAt,
      approvalStatus: run.approvalStatus,
    })) {
      telemetryCompleteDecidedRuns++;
    }
    if (typeof reviewLatencyMs === "number") reviewLatencies.push(reviewLatencyMs);
    const buildMs = run.createdAt && run.completedAt
      ? run.completedAt.getTime() - run.createdAt.getTime()
      : null;
    console.log(`\nRun ${jobId}`);
    console.log(`  Timeline: ${stages.join(" → ") || "no classified stages"}`);
    console.log(`  Build outcome: ${run.status === "done" ? "completed" : run.status === "failed" ? "failed" : "pending"}`);
    console.log(`  Build duration: ${buildMs != null && buildMs >= 0 ? `${(buildMs / 60_000).toFixed(1)} min` : "unavailable"}`);
    console.log(`  Human decision: ${decisionMade ? run.approvalStatus : "not decided yet"}`);
    console.log(`  Decision telemetry observed: ${decisionObserved ? "yes" : "no"}`);
    console.log(`  Review latency: ${typeof reviewLatencyMs === "number" ? `${(reviewLatencyMs / 60_000).toFixed(1)} min` : "unavailable"}`);
    console.log(`  Retry phases observed: ${events.filter((event) => event.stage === "retrying").length}`);
    console.log(`  Missing required telemetry: ${missingEvents.join(", ") || "none"}`);
    console.log("  Evidence inspection: unavailable in the current email approval flow (not inferred)");
  }

  const averageReviewMinutes = reviewLatencies.length
    ? reviewLatencies.reduce((sum, value) => sum + value, 0) / reviewLatencies.length / 60_000
    : null;
  console.log("\n--- Experiment summary ---");
  console.log(`Runs observed: ${runs.size}`);
  console.log(`Complete build timelines: ${complete}/${runs.size}`);
  console.log(`Human decisions observed: ${decisions}/${runs.size}`);
  console.log(`Decided runs with complete telemetry: ${telemetryCompleteDecidedRuns}/${decisions}`);
  console.log(`Invalid rows excluded: ${invalidRows}`);
  console.log(`Uncorroborated rows excluded: ${uncorroboratedRows}`);
  console.log(`Average review latency: ${averageReviewMinutes == null ? "unavailable" : `${averageReviewMinutes.toFixed(1)} min`}`);
  if (runs.size < 3 || decisions < 3) {
    console.log("Evidence verdict: PRELIMINARY — fewer than 3 decided recaps; do not change the workflow yet.");
  } else if (telemetryCompleteDecidedRuns < 3 || invalidRows > 0 || uncorroboratedRows > 0) {
    console.log("Evidence verdict: INCONCLUSIVE — authoritative outcomes exist, but the measurement lane is incomplete or contains excluded rows.");
  } else {
    console.log("Evidence verdict: READY FOR REVIEW — compare latency, overrides, failures, and missing evidence across runs before adding friction or canaries.");
  }
}

main()
  .catch((error) => {
    console.error("[bwb-oversight-shadow-report] failed:", error?.message || error);
    process.exitCode = 1;
  })
  .finally(() => pool.end());