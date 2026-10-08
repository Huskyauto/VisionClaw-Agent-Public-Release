import type { AgentJob } from "../job-queue";
import type { VerifyResult } from "../proposal-verifier";

export const VERIFIER_JOB_KINDS = [
  "research_proposal_verification", "source_repair_verification",
] as const;
export const WORKER_SOURCE_MISMATCH = "Worker source baseline mismatch; synchronize source before verification";

export function verifierWorkerEnabled(value: unknown): boolean {
  return value === "1";
}

export function canStartVerifierWorker(
  memory: { maxBytes: number; currentBytes: number } | null, rss: number,
): boolean {
  return !!memory && Number.isSafeInteger(memory.maxBytes) && memory.maxBytes > 0
    && Number.isSafeInteger(memory.currentBytes) && memory.currentBytes >= 0
    && memory.maxBytes - memory.currentBytes >= 3 * 1024 ** 3
    && Number.isFinite(rss) && rss >= 0 && rss < 1200 * 1024 ** 2;
}

export interface VerifierWorkerDependencies {
  ready(): boolean;
  claim(): Promise<AgentJob[]>;
  verify(job: AgentJob, tenantId: number, proposalId: number): Promise<VerifyResult>;
  complete(job: AgentJob, result: VerifyResult): Promise<boolean>;
  defer(job: AgentJob): Promise<boolean>;
  fail(job: AgentJob, reason: string): Promise<void>;
  isDeferred(error: unknown): boolean;
  now(): number;
}

/** One awaited tick: callers must not overlap ticks or start unrelated handlers. */
export async function runBoundedVerifierTick(
  deps: VerifierWorkerDependencies,
): Promise<"unavailable" | "idle" | "completed" | "deferred" | "failed" | "fenced"> {
  try { if (!deps.ready()) return "unavailable"; } catch { return "unavailable"; }
  const jobs = await deps.claim();
  if (!jobs.length) return "idle";
  if (jobs.length !== 1) throw new Error("Verifier worker claim exceeded serial limit");
  const job = jobs[0];
  try {
    const tenantId = job.tenantId;
    const proposalId = Number(job.payload.proposalId);
    if (!(VERIFIER_JOB_KINDS as readonly string[]).includes(job.kind)
      || !Number.isSafeInteger(tenantId) || (tenantId as number) <= 0
      || !Number.isSafeInteger(proposalId) || proposalId <= 0
      || (job.payload.tenantId != null && job.payload.tenantId !== tenantId)) {
      throw new Error("Invalid persisted verifier job identity");
    }
    if (!job.leaseUntil || !Number.isFinite(job.leaseUntil.getTime())
      || job.leaseUntil.getTime() - deps.now() <= 30_000) {
      return await deps.defer(job) ? "deferred" : "fenced";
    }
    const result = await deps.verify(job, tenantId as number, proposalId);
    if (result.status === "skipped" && result.details === WORKER_SOURCE_MISMATCH) {
      return await deps.defer(job) ? "deferred" : "fenced";
    }
    return await deps.complete(job, result) ? "completed" : "fenced";
  } catch (error) {
    if (deps.isDeferred(error)) return await deps.defer(job) ? "deferred" : "fenced";
    await deps.fail(job, "Verifier worker did not complete; inspect bounded worker diagnostics");
    return "failed";
  }
}