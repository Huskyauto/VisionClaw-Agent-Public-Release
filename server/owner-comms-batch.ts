import { sql } from "drizzle-orm";
import { db } from "./db";
import { ownerTenantId } from "./agentic/autonomous-budget";
import { getBwbWeight } from "./lib/bwb-weight";
import { resolveOwnerEmail } from "./lib/owner-email";
import {
  ownerWeekDate, prepareOwnerCommsBatch,
  type OwnerCommsEvidence, type OwnerCommsSchedule,
} from "./lib/owner-comms-batch";

const SOURCE_JOBS = [
  "BWB Monday Weigh-In Nudge", "Owner Notification Digest (daily)",
  "IdeaBrowser Weekly Scenario (Mon)", "Revenue Mission Opportunity Scan (weekly)",
  "Wedge Lifecycle Update (Mon)",
];

/** Owner check precedes even the global singleton weight read. No source jobs mutate here. */
export async function loadOwnerCommsEvidence(tenantId: number, now: Date): Promise<OwnerCommsEvidence> {
  if (tenantId !== ownerTenantId()) throw new Error("Owner evidence requires the owner tenant");
  const cutoff = new Date(now.getTime() - 7 * 86_400_000).toISOString();
  const upper = now.toISOString();
  const week = ownerWeekDate(now);
  const [weight, jobs, notifications, wedges, legacy, weekly] = await Promise.all([
    getBwbWeight(),
    db.execute<{ name: string; status: string; created_at: Date; output: string }>(sql`
      SELECT DISTINCT ON (t.id) t.name, l.status, l.created_at, l.output
      FROM heartbeat_tasks t JOIN heartbeat_logs l ON l.task_id=t.id
      WHERE t.tenant_id=${tenantId} AND t.name IN (${sql.join(SOURCE_JOBS.map(name => sql`${name}`), sql`, `)})
        AND l.created_at >= ${cutoff}::timestamp AND l.created_at <= ${upper}::timestamp
      ORDER BY t.id, l.created_at DESC, l.id DESC
    `),
    db.execute<{ title: string; created_at: Date }>(sql`
      SELECT title, created_at FROM notifications
      WHERE tenant_id=${tenantId} AND is_read=false
        AND created_at >= ${cutoff}::timestamptz AND created_at <= ${upper}::timestamptz
      ORDER BY created_at DESC LIMIT 2
    `),
    db.execute<{ name: string; current_state: string }>(sql`
      SELECT name, current_state FROM projects
      WHERE tenant_id=${tenantId} AND 'wedge'=ANY(tags) AND status='active'
      ORDER BY updated_at DESC, id DESC LIMIT 10
    `),
    db.execute<{ count: number }>(sql`
      SELECT count(*)::int AS count FROM heartbeat_tasks
      WHERE tenant_id=${tenantId} AND name IN (${sql.join(SOURCE_JOBS.map(name => sql`${name}`), sql`, `)}) AND enabled=true
    `),
    db.execute<{
      id: number; created_at: Date; metadata: Record<string, unknown>;
      winner: string | null; winner_metadata: Record<string, unknown> | null;
    }>(sql`
      SELECT r.id,r.created_at,r.metadata,w.name AS winner,w.metadata AS winner_metadata
      FROM projects r LEFT JOIN projects w ON w.tenant_id=r.tenant_id
        AND w.id::text=r.metadata->>'winnerProjectId'
      WHERE r.tenant_id=${tenantId} AND r.metadata->>'kind'='ideabrowser-weekly-run'
        AND r.metadata->>'date'=${week}
        AND r.created_at >= ${cutoff}::timestamp AND r.created_at <= ${upper}::timestamp
      ORDER BY r.created_at DESC,r.id DESC LIMIT 1
    `),
  ]);
  let report: OwnerCommsEvidence["weekly"];
  const row = weekly.rows[0];
  if (row?.winner) {
    const m = row.metadata;
    const scenario = row.winner_metadata?.weeklyScenario as Record<string, unknown> | undefined;
    const priority = row.winner_metadata?.priority as Record<string, unknown> | undefined;
    const numbers = [m.expectedProfitUsd, m.successProbabilityPct, m.roi];
    if (!numbers.every(n => typeof n === "number" && Number.isFinite(n)) ||
        Number(m.successProbabilityPct) < 0 || Number(m.successProbabilityPct) > 100) {
      throw new Error("Owner batch weekly report has invalid numeric evidence");
    }
    report = {
      id: row.id, date: week, createdAt: new Date(row.created_at), winner: row.winner,
      expectedProfitUsd: m.expectedProfitUsd as number,
      successProbabilityPct: m.successProbabilityPct as number, roi: m.roi as number,
      verdict: typeof scenario?.verdict === "string" ? scenario.verdict : "Not recorded",
      confidence: typeof priority?.evidence_confidence === "string" ? priority.evidence_confidence : "Unknown",
    };
  }
  return {
    now, weight,
    jobs: jobs.rows.map(j => ({ name: j.name, status: j.status, createdAt: new Date(j.created_at), output: j.output || "" })),
    notifications: notifications.rows.map(n => ({ title: n.title, createdAt: new Date(n.created_at) })),
    wedges: wedges.rows.map(w => ({ name: w.name, currentState: w.current_state || "" })),
    legacyJobsEnabled: legacy.rows[0].count, weekly: report,
  };
}

export async function buildOwnerCommsBatch(job: OwnerCommsSchedule, now: Date) {
  return prepareOwnerCommsBatch(job, now, {
    ownerTenantId: ownerTenantId(), ownerEmail: resolveOwnerEmail(), load: loadOwnerCommsEvidence,
  });
}
