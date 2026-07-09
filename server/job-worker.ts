// R60 — Job worker: drains the agent_jobs queue.
//
// One worker per process. Every `TICK_MS`, atomically claims up to BATCH_SIZE
// due jobs (status=pending, next_run_at<=now), runs their handlers, and
// calls completeJob / failJob based on outcome. Also reclaims any jobs
// whose lease expired (worker crashed mid-flight → reclaimed automatically
// on next tick).
//
// Handlers are registered in this file's HANDLERS map. Adding a new job
// kind means:
//   1. enqueueJob("my_kind", {...}) at the call site
//   2. registerJobHandler("my_kind", async (job) => {...}) in HANDLERS below
import {
  claimDueJobs,
  completeJob,
  failJob,
  reclaimExpiredLeases,
  type AgentJob,
} from "./job-queue";

type JobHandler = (job: AgentJob) => Promise<Record<string, any> | void>;

const HANDLERS = new Map<string, JobHandler>();

/** Register a handler for a job kind. Idempotent — replaces existing. */
export function registerJobHandler(kind: string, fn: JobHandler): void {
  HANDLERS.set(kind, fn);
}

export function getRegisteredKinds(): string[] {
  return Array.from(HANDLERS.keys());
}

const TICK_MS = 2000;
const BATCH_SIZE = 8;
const LEASE_MS = 5 * 60_000; // 5 minutes — handlers longer than this are suspect
const RECLAIM_EVERY_N_TICKS = 30; // Every minute, sweep expired leases.
const MAX_IN_FLIGHT = 32; // Cap on concurrent handler executions across all kinds.

let tickTimer: NodeJS.Timeout | null = null;
let tickCount = 0;
let inFlight = 0;
let tickLock = false; // Guards the claim/reclaim DB calls only — not handlers.

/** Normalize any thrown value (Error, string, object, undefined) into a
 *  stable message string. Prevents `err.message` undefined degrading logs. */
function normalizeError(err: unknown): string {
  if (err instanceof Error) {
    const stack = err.stack?.split("\n").slice(0, 5).join("\n");
    return stack ? `${err.message}\n${stack}` : err.message;
  }
  if (typeof err === "string") return err;
  try { return JSON.stringify(err); } catch { return String(err); }
}

async function runOneJob(job: AgentJob): Promise<void> {
  inFlight++;
  try {
    const handler = HANDLERS.get(job.kind);
    if (!handler) {
      console.warn(`[job-worker] No handler registered for kind="${job.kind}" (job #${job.id}) — failing`);
      await failJob(job.id, job.attempts, `No handler registered for kind="${job.kind}"`);
      return;
    }
    try {
      // R94 SECURITY — wrap handler in AsyncLocalStorage tenant context so
      // any LLM calls made inside the handler bill the right tenant via the
      // singleton replitOpenai client (which now reads currentTenantId()).
      const { withTenantContext } = await import("./lib/tenant-context");
      const result = job.tenantId != null
        ? await withTenantContext(
            { tenantId: job.tenantId, source: "background-job" },
            () => handler(job),
          )
        : await handler(job);
      // Pass job.attempts for lease fencing — if our lease expired and the
      // job was reclaimed on attempts+1, our completeJob write will no-op.
      await completeJob(job.id, job.attempts, result ?? null);
    } catch (err: unknown) {
      const msg = normalizeError(err);
      console.error(`[job-worker] Job #${job.id} (${job.kind}) failed attempt ${job.attempts}: ${msg.split("\n")[0]}`);
      await failJob(job.id, job.attempts, msg);
    }
  } finally {
    inFlight--;
  }
}

async function tick(): Promise<void> {
  // tickLock only guards the claim DB round-trip, NOT handler execution.
  // This lets a slow handler keep running while new batches are claimed and
  // dispatched — critical for queue liveness. In-flight is capped via MAX_IN_FLIGHT.
  if (tickLock) return;
  tickLock = true;
  try {
    tickCount++;
    if (tickCount % RECLAIM_EVERY_N_TICKS === 0) {
      const n = await reclaimExpiredLeases();
      if (n > 0) console.log(`[job-worker] Reclaimed ${n} expired-lease job${n === 1 ? "" : "s"}`);
    }
    // Back off if we're near the in-flight cap. Keeps the DB from being
    // hammered with claims for jobs we can't run anyway.
    if (inFlight >= MAX_IN_FLIGHT) return;
    const headroom = MAX_IN_FLIGHT - inFlight;
    const claimSize = Math.min(BATCH_SIZE, headroom);
    const jobs = await claimDueJobs(claimSize, LEASE_MS);
    if (jobs.length === 0) return;
    // Fire-and-track: dispatch handlers without awaiting. runOneJob
    // maintains its own error boundary + inFlight counter. The next tick
    // can claim fresh work immediately — no slow-handler global stall.
    for (const j of jobs) {
      runOneJob(j).catch((e) => console.error("[job-worker] runOneJob outer error:", normalizeError(e)));
    }
  } catch (err: unknown) {
    console.error("[job-worker] Tick error:", normalizeError(err));
  } finally {
    tickLock = false;
  }
}

/** Start the worker loop. Idempotent — safe to call multiple times. */
export function startJobWorker(): void {
  if (tickTimer) return;
  console.log(`[job-worker] Started (tick=${TICK_MS}ms, batch=${BATCH_SIZE}, lease=${LEASE_MS}ms, handlers=${HANDLERS.size})`);
  // Run an immediate reclaim tick at boot to rescue any running-but-crashed
  // jobs from the previous process.
  reclaimExpiredLeases()
    .then((n) => { if (n > 0) console.log(`[job-worker] Boot reclaim: ${n} expired job(s) re-queued`); })
    .catch((e: unknown) => console.error("[job-worker] Boot reclaim failed:", normalizeError(e)));
  tickTimer = setInterval(() => { tick().catch((e: unknown) => console.error("[job-worker] Unhandled tick error:", normalizeError(e))); }, TICK_MS);
  if ((tickTimer as any).unref) (tickTimer as any).unref();
}

/** Stop the worker loop (used in tests / graceful shutdown). */
export function stopJobWorker(): void {
  if (tickTimer) {
    clearInterval(tickTimer);
    tickTimer = null;
  }
}

// ─── Handler registrations ──────────────────────────────────────────────
// Register all job handlers below. Each handler lives here so adding a new
// kind is one edit: enqueueJob at the call site + registerJobHandler here.

registerJobHandler("research_code_proposal", async (job) => {
  const { sessionId, tenantId, model, programName, hypothesis, result, approach, score, mapping, personaId } = job.payload;
  const { generateCodeProposal } = await import("./research-engine");
  // Reconstruct the minimal ActiveSession shape generateCodeProposal reads
  // (session.sessionId, session.tenantId, session.model). All 3 come from
  // the payload — the in-memory activeSessions Map won't survive restart,
  // which is precisely why we persist them here.
  const session = { sessionId, tenantId, model } as any;
  const proposalId = await generateCodeProposal(
    session,
    programName,
    hypothesis,
    result,
    approach,
    score,
    mapping,
    personaId,
  );
  return { proposalId: proposalId ?? null };
});

registerJobHandler("research_digest", async (job) => {
  const { tenantId } = job.payload;
  const re = await import("./research-engine");
  // Preserve the original setTimeout semantics: skip digest generation if
  // new research sessions started while we were waiting. The queue replaces
  // the setTimeout's durability gap, not its "only-when-quiet" condition.
  if (re.getActiveSessionCount() > 0) {
    return { skipped: true, reason: "active_sessions", activeCount: re.getActiveSessionCount() };
  }
  const digest = await re.generateResearchDigest(tenantId);
  return {
    success: digest.success,
    findingCount: digest.findingCount,
    proposalCount: digest.proposalCount,
    digestPath: digest.digestPath,
    driveUrl: digest.driveUrl ?? null,
  };
});
