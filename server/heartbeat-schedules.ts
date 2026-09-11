import { db } from "./db";
import { sql } from "drizzle-orm";
import { getNextCronRun } from "./cron-utils";

const AUTO_MEMORIZE_INTERVAL_MS = 6 * 60 * 60 * 1000;
const AUTO_MEMORIZE_RETRY_BACKOFF_MS = 5 * 60 * 1000;
let lastAutoMemorizeAttemptAt = 0;

/**
 * The heartbeat is the only platform-worker owner of the cross-tenant sweep.
 * It enumerates tenant IDs (metadata only) and delegates all content-bearing
 * work to auto-memorize's tenant-bound public API.
 */
export async function maybeRunAutoMemorizeFromHeartbeat(): Promise<{
  success: boolean;
  tenantsProcessed: number;
  lessonsStored: number;
  error?: string;
} | null> {
  const now = Date.now();
  if (now - lastAutoMemorizeAttemptAt < AUTO_MEMORIZE_INTERVAL_MS) return null;
  // Failures retry in five minutes rather than silently deferring a tenant's
  // unresolved batch for the full six-hour cadence.
  lastAutoMemorizeAttemptAt = now - (AUTO_MEMORIZE_INTERVAL_MS - AUTO_MEMORIZE_RETRY_BACKOFF_MS);
  try {
    const tenantResult: any = await db.execute(sql`
      SELECT DISTINCT tenant_id
      FROM messages
      WHERE tenant_id IS NOT NULL AND tenant_id > 0
      ORDER BY tenant_id ASC
    `);
    const { runAutoMemorizeForTenant } = await import("./auto-memorize");
    let tenantsProcessed = 0;
    let lessonsStored = 0;
    const errors: string[] = [];
    for (const row of tenantResult.rows ?? []) {
      const tenantId = Number(row.tenant_id);
      if (!Number.isInteger(tenantId) || tenantId <= 0) continue;
      const result = await runAutoMemorizeForTenant(tenantId);
      tenantsProcessed++;
      lessonsStored += result.lessonsStored;
      if (!result.success) errors.push(`tenant ${tenantId}: ${result.error || "unknown failure"}`);
    }
    if (errors.length) {
      const error = errors.join("; ").slice(0, 1000);
      console.error(`[heartbeat] Auto-memorize sweep failed: ${error}`);
      return { success: false, tenantsProcessed, lessonsStored, error };
    }
    lastAutoMemorizeAttemptAt = Date.now();
    return { success: true, tenantsProcessed, lessonsStored };
  } catch (e: any) {
    const error = e?.message || String(e);
    console.error("[heartbeat] Auto-memorize sweep crashed:", error);
    return { success: false, tenantsProcessed: 0, lessonsStored: 0, error };
  }
}

export async function checkResearchSchedules() {
  try {
    const result = await db.execute(sql`
      SELECT * FROM research_schedules
      WHERE is_enabled = true AND next_run_at IS NOT NULL AND next_run_at <= NOW()
    `);
    const rows = (result as any).rows || result;
    if (!rows || rows.length === 0) return;
    const { startResearchSession } = await import("./research-engine");
    const { getNextCronRun } = await import("./cron-utils");
    for (const sched of rows) {
      let didStart = false;
      let concurrencyRejected = false;
      try {
        if (sched.run_all) {
          // R55.A: do NOT await session completion — would block heartbeat for up to 30min/session.
          // Sessions self-manage via the research-engine's MAX_CONCURRENT_SESSIONS gate + experiment scheduler.
          // If concurrency-rejected, the 2-min retry below will pick them up next tick.
          const programs = await db.execute(sql`SELECT id FROM research_programs WHERE tenant_id = ${sched.tenant_id} AND is_active = true`);
          const pRows = (programs as any).rows || programs;
          let started = 0;
          let rejected = 0;
          for (let pi = 0; pi < pRows.length; pi++) {
            const r = await startResearchSession({ programId: pRows[pi].id, tenantId: sched.tenant_id });
            if (r.sessionId && !r.error) {
              started++;
              didStart = true;
            } else if (r.error?.includes("Concurrency limit")) {
              rejected++;
            }
          }
          // R55.A: if ANY were rejected, retry this schedule in 2min (don't burn the slot just because some made it through).
          if (rejected > 0) concurrencyRejected = true;
          console.log(`[research-schedule] "${sched.name}" run-all: started ${started}/${pRows.length} sessions (rejected ${rejected})`);
        } else if (sched.program_id) {
          const r = await startResearchSession({ programId: sched.program_id, tenantId: sched.tenant_id });
          if (r.sessionId && !r.error) {
            didStart = true;
            console.log(`[research-schedule] "${sched.name}" started session ${r.sessionId}`);
          } else {
            if (r.error?.includes("Concurrency limit")) concurrencyRejected = true;
            console.warn(`[research-schedule] "${sched.name}" failed: ${r.error}`);
          }
        }

        // R55: Only advance to true next-cron-occurrence if a session actually started.
        // If concurrency-rejected, retry in 2 minutes (do not burn the slot for 24h).
        // If other error, advance via cron to avoid infinite tight loop.
        let nextDate: Date;
        if (concurrencyRejected) {
          nextDate = new Date(Date.now() + 2 * 60 * 1000);
          await db.execute(sql`
            UPDATE research_schedules SET next_run_at = ${nextDate}
            WHERE id = ${sched.id} AND tenant_id = ${sched.tenant_id}
          `);
        } else if (didStart) {
          nextDate = getNextCronRun(sched.cron_expression);
          await db.execute(sql`
            UPDATE research_schedules SET last_run_at = NOW(), next_run_at = ${nextDate}
            WHERE id = ${sched.id} AND tenant_id = ${sched.tenant_id}
          `);
        } else {
          nextDate = getNextCronRun(sched.cron_expression);
          await db.execute(sql`
            UPDATE research_schedules SET next_run_at = ${nextDate}
            WHERE id = ${sched.id} AND tenant_id = ${sched.tenant_id}
          `);
        }
      } catch (e: any) {
        console.error(`[research-schedule] Error running "${sched.name}":`, e.message);
        try {
          const recoveryNext = getNextCronRun(sched.cron_expression);
          await db.execute(sql`
            UPDATE research_schedules SET next_run_at = ${recoveryNext}
            WHERE id = ${sched.id} AND tenant_id = ${sched.tenant_id}
          `);
        } catch (recoveryErr) {
          // Loud — silent failure here means a recurring research schedule
          // could go permanently dark (next_run_at never advances) and the
          // owner only finds out via a "no autoresearch in 3 days" report.
          console.warn(`[heartbeat] Failed to advance next_run_at for schedule ${sched.id}:`, (recoveryErr as Error)?.message);
        }
      }
    }
  } catch (e: any) {
    if (e.message?.includes("does not exist")) return;
    throw e;
  }
}

/**
 * Runs the heartbeat's non-task scheduled workers in their established tick
 * order. The task dispatcher remains in heartbeat.ts; this keeps the scheduler
 * integrations together without changing their registration or call cadence.
 */
export async function runHeartbeatScheduledWork(tickCount: number): Promise<void> {
  const errorMessage = (error: unknown) => error instanceof Error ? error.message : String(error);

  // Recurring messages — natural-language scheduled deliveries (WhatsApp/SMS/Telegram/email)
  try {
    const { runDueScheduledMessages } = await import("./recurring-messages");
    const r = await runDueScheduledMessages();
    if (r.fired > 0 || r.errors > 0) console.log(`[heartbeat] Recurring messages: fired=${r.fired} errors=${r.errors}`);
  } catch (e) {
    console.error("[heartbeat] Recurring messages tick failed:", errorMessage(e));
  }

  // R113.5 — Scheduled social posts (multi-platform fan-out: X / LinkedIn / IG / FB / YouTube).
  // Row-locked via SELECT ... FOR UPDATE SKIP LOCKED so concurrent ticks can't double-publish.
  try {
    const { runDueScheduledPosts } = await import("./lib/scheduled-post-runner");
    const sp = await runDueScheduledPosts();
    if (sp.picked > 0) {
      console.log(`[heartbeat] Scheduled posts: picked=${sp.picked} sent=${sp.sent} partial=${sp.partial} failed=${sp.failed} retried=${sp.retried} errors=${sp.errors}`);
    }
  } catch (e) {
    console.error("[heartbeat] Scheduled posts tick failed:", errorMessage(e));
  }

  // Auto-memorize — the heartbeat owns the cross-tenant worker sweep. It
  // discovers only tenant IDs here; each content query stays tenant-bound.
  maybeRunAutoMemorizeFromHeartbeat()
    .then((r) => {
      if (r?.success && r.lessonsStored > 0) {
        console.log(`[heartbeat] Auto-memorize: tenants=${r.tenantsProcessed} stored=${r.lessonsStored}`);
      }
    })
    .catch((e: unknown) => console.error("[heartbeat] Auto-memorize tick failed:", errorMessage(e)));

  // Felix Autonomous Loop — every 4h during waking hours (R74.13w). Throttled
  // internally (4h interval, wake-hours gate, monthly cost cap, kill switch).
  // Dry-run mode hard-coded for first 14 days. Fire-and-forget.
  import("./felix-loop")
    .then(({ maybeRunFelixLoop }) => maybeRunFelixLoop())
    .then((r) => {
      if (r && !r.skipped && (r.proposalsDrafted || r.error)) {
        console.log(`[heartbeat] Felix Loop run #${r.runId}: ${r.proposalsDrafted ?? 0} proposals (${r.mode}) ${r.error ? "ERROR: " + r.error : ""}`);
      }
    })
    .catch((e: unknown) => console.error("[heartbeat] Felix Loop tick failed:", errorMessage(e)));

  // R125+14 — Durable sleep/wake. Scan every tick (row-locked, cheap) so day-spanning
  // follow-up sequences resume on time. Emits agent.wake → routed by the event-bus.
  try {
    const { runDueWakes } = await import("./agentic/wake-scheduler");
    const w = await runDueWakes();
    if (w.failed) console.error(`[heartbeat] Wake scheduler FAILED (DB/claim outage) — due wakes may be MISSED this tick`);
    else if (w.fired > 0 || w.errors > 0) console.log(`[heartbeat] Wake schedules: fired=${w.fired} errors=${w.errors}`);
  } catch (e) {
    console.error("[heartbeat] Wake scheduler tick failed:", errorMessage(e));
  }

}
