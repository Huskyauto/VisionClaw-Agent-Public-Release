import { setTimeout as sleep } from "node:timers/promises";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { readEffectiveVerifierMemory } from "../server/lib/verifier-memory-source";
import {
  canStartVerifierWorker, runBoundedVerifierTick, verifierWorkerEnabled,
} from "../server/lib/bounded-verifier-worker";

async function main(): Promise<void> {
  // A worker must use production admission even during a development smoke.
  if (process.env.NODE_ENV !== "production"
    || !verifierWorkerEnabled(process.env.PROPOSAL_VERIFIER_EXTERNAL_WORKER)) {
    throw new Error("Worker requires production mode and exact external-worker opt-in");
  }
  const requiredInputs = [
    "dist/proposal-verifier-child.cjs", "dist/lib.d.ts", "dist/lib.es5.d.ts",
    "tsconfig.json", "package-lock.json", "server", "shared", "client/src",
  ].map(name => resolve(process.cwd(), name));
  const ready = () => canStartVerifierWorker(readEffectiveVerifierMemory(), process.memoryUsage().rss)
    && requiredInputs.every(name => existsSync(name));
  if (!ready()) throw new Error("Worker cannot establish finite memory headroom");
  const queue = await import("../server/job-queue");
  const { verifyProposalIsolated } = await import("../server/lib/proposal-verifier-process");
  const { HeavyWorkDeferred } = await import("../server/lib/heavy-work-lane");
  const { withTenantContext } = await import("../server/lib/tenant-context");
  let stopping = false;
  process.once("SIGTERM", () => { stopping = true; });
  process.once("SIGINT", () => { stopping = true; });
  let ticks = 0;
  let lastState: Awaited<ReturnType<typeof runBoundedVerifierTick>> | undefined;
  console.info("[verifier-worker] bounded serial worker started");
  while (!stopping && verifierWorkerEnabled(process.env.PROPOSAL_VERIFIER_EXTERNAL_WORKER)) {
    try {
      const state = await runBoundedVerifierTick({
        ready,
        claim: async () => {
          if (ticks++ % 6 === 0) await queue.reclaimExpiredLeases("only-verifier");
          return queue.claimDueJobs(1, 300_000, "only-verifier");
        },
        now: Date.now,
        isDeferred: error => error instanceof HeavyWorkDeferred,
        verify: (job, tenantId, proposalId) => withTenantContext(
          { tenantId, source: "background-job" },
          () => verifyProposalIsolated(proposalId, tenantId, job.leaseUntil!.getTime(), { strictSourceBase: true }),
        ),
        complete: (job, result) => queue.completeJob(job.id, job.attempts, job.tenantId, result),
        defer: job => queue.deferJobForHeavyLane(job.id, job.attempts, job.tenantId!, 120_000),
        fail: (job, reason) => queue.failJob(job.id, job.attempts, reason),
      });
      if (state !== lastState) {
        console.info(`[verifier-worker] state=${state}`);
        lastState = state;
      }
    } catch {
      // Never expose connection strings or customer proposal contents in logs.
      console.error("[verifier-worker] tick failed; existing leases remain fenced");
    }
    if (!stopping) await sleep(10_000);
  }
  const { pool } = await import("../server/db");
  await pool.end();
}

void main().catch(() => {
  console.error("[verifier-worker] startup failed; verify mode, accounting, assets and database provisioning");
  process.exitCode = 1;
});