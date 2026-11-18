import { sql } from "drizzle-orm";
import { db } from "../db";
import { type AgentJob } from "../job-queue";
import { legionBackgroundEnabled, legionProduction, legionRuntimeReady } from "./runtime";
import { readLegionRunbook, LEGION_RUNBOOKS } from "./runbook-source";
import { compileLegionRunbook } from "./runbook";
import { checkLocalCapacity, surfaceLocalEnabled } from "./local-provider-runtime";
import { localHostedFallbackEnabled } from "./runbook-hosted";
import { LEGION_RUNBOOK_JOB, SURFACE_RULE_JOB, runLocalRunbookJob } from "./nightly-policy";
import { localParallelEnabled, withLocalPriority } from "./local-slots";
import { compileSimpleRunbookRule } from "./simple-runbook-rule";
import { queueLocalMaintenance } from "./maintenance";

export const legionNightlyEnabled = () => legionBackgroundEnabled() && process.env.LEGION_NIGHTLY_ENABLED === "1";
const environment = () => legionProduction() ? "production" : "development";
const rows = <T>(value: unknown) => ((value as { rows?: T[] }).rows ?? value) as T[];
let checking = false;
let bootTimer: ReturnType<typeof setTimeout> | undefined;
let timer: ReturnType<typeof setInterval> | undefined;

/** Queue at most three sources × two task classes/night. Unchanged successes cost zero
 * model calls. The date key also caps repeated edits within a development day. */
export async function checkLegionNightlySchedule(now = new Date()) {
  if (checking || !legionNightlyEnabled()) return;
  checking = true;
  try {
    for (const [index, sourcePath] of LEGION_RUNBOOKS.entries()) {
      const parallel = localParallelEnabled() && surfaceLocalEnabled();
      const ids = await queueLocalMaintenance(sourcePath, "overnight", parallel ? "both" : "lenovo", now, index * 120_000);
      if (ids.length) console.log(`[legion-nightly] screened runbook jobs queued/reused: ${ids.join(",")}`);
    }
  } finally { checking = false; }
}

export async function handleLegionRunbookJob(job: AgentJob) {
  const simple = job.kind === SURFACE_RULE_JOB;
  const enabled = () => (job.payload.priority === "daytime" ? localParallelEnabled() : legionNightlyEnabled()) &&
    (!simple || (localParallelEnabled() && surfaceLocalEnabled()));
  return withLocalPriority(job.payload.priority === "daytime" ? "daytime" : "overnight", () => runLocalRunbookJob(job, {
    enabled, ready: legionRuntimeReady, environment,
    hostedEnabled: localHostedFallbackEnabled,
    read: readLegionRunbook, compile: simple ? compileSimpleRunbookRule : compileLegionRunbook,
    health: () => checkLocalCapacity(undefined, simple),
  }, simple ? SURFACE_RULE_JOB : LEGION_RUNBOOK_JOB));
}

/** Pre-generation capacity only; keep attempt identity monotonic and refuse an
 * expired/replaced claim. Never use this after actual generation has started. */
export async function deferLegionRunbookJob(job: AgentJob) {
  if (job.tenantId !== 1 || ![LEGION_RUNBOOK_JOB, SURFACE_RULE_JOB].includes(job.kind)) throw new Error("Invalid local deferral scope");
  const delay = job.payload.priority === "daytime" ? "10 seconds" : "15 minutes";
  const result = rows<{ id: number }>(await db.execute(sql`
    UPDATE agent_jobs SET status='pending', next_run_at=now()+${delay}::interval,
      lease_until=NULL, error='Waiting for inference admission or enabled provider capacity',
      max_attempts=max_attempts+1
    WHERE id=${job.id} AND tenant_id=1 AND kind=${job.kind}
      AND status='running' AND attempts=${job.attempts} AND lease_until>now()
    RETURNING id`));
  return result.length === 1;
}

export function startLegionNightlyScheduler() {
  if (timer || !legionNightlyEnabled()) return;
  const check = () => { void checkLegionNightlySchedule().catch(() =>
    console.warn("[legion-nightly] schedule check failed; no untracked work dispatched")); };
  bootTimer = setTimeout(check, 60_000);
  bootTimer.unref();
  timer = setInterval(check, 15 * 60_000);
  timer.unref();
  console.log("[legion-nightly] armed: 02:00 America/Chicago with catch-up; screened sources and opt-in provider recovery");
}
export function stopLegionNightlyScheduler() {
  if (bootTimer) clearTimeout(bootTimer);
  if (timer) clearInterval(timer);
  bootTimer = undefined;
  timer = undefined;
}
