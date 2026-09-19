import { randomUUID } from "crypto";

export type JobStatus = "queued" | "running" | "done" | "failed";

export interface Job {
  id: string;
  status: JobStatus;
  outputPath?: string;
  error?: string;
  createdAt: number;
  startedAt?: number;
  finishedAt?: number;
  durationSec?: number;
  sizeBytes?: number;
}

const MAX_CONCURRENT = parseInt(process.env.RENDER_CONCURRENCY || "2", 10);
const MAX_QUEUE_DEPTH = parseInt(process.env.RENDER_MAX_QUEUE_DEPTH || "50", 10);
const JOB_TTL_MS = parseInt(process.env.RENDER_JOB_TTL_MS || String(2 * 60 * 60 * 1000), 10);

const jobs = new Map<string, Job>();
const pending: Array<{ job: Job; runner: () => Promise<{ outputPath: string; durationSec?: number; sizeBytes?: number }> }> = [];
let active = 0;

export class QueueFullError extends Error {
  constructor(public readonly depth: number, public readonly cap: number) {
    super(`render queue full: ${depth}/${cap} pending — try again later`);
    this.name = "QueueFullError";
  }
}

export function createJob(): Job {
  const id = randomUUID();
  const job: Job = { id, status: "queued", createdAt: Date.now() };
  jobs.set(id, job);
  return job;
}

export function getJob(id: string): Job | undefined {
  return jobs.get(id);
}

// R110.19 architect-HIGH fix: bounded queue. A burst of submissions used to
// grow `pending` indefinitely AND each pending job holds its uploaded scene
// files on disk — guaranteed to OOM / fill /tmp on a small Railway instance
// before any job finishes. Reject with 429 once the cap is reached so the
// caller can back off (and the main app's R110.18 in-process fallback can
// pick up the slack).
export function enqueue(job: Job, runner: () => Promise<{ outputPath: string; durationSec?: number; sizeBytes?: number }>): void {
  if (pending.length >= MAX_QUEUE_DEPTH) {
    throw new QueueFullError(pending.length, MAX_QUEUE_DEPTH);
  }
  pending.push({ job, runner });
  drain();
}

export function queueDepth(): { active: number; pending: number; total: number } {
  return { active, pending: pending.length, total: jobs.size };
}

function drain(): void {
  while (active < MAX_CONCURRENT && pending.length > 0) {
    const { job, runner } = pending.shift()!;
    active++;
    job.status = "running";
    job.startedAt = Date.now();
    runner()
      .then((result) => {
        job.status = "done";
        job.outputPath = result.outputPath;
        job.durationSec = result.durationSec;
        job.sizeBytes = result.sizeBytes;
      })
      .catch((err: any) => {
        job.status = "failed";
        job.error = String(err?.message || err).slice(0, 1000);
        console.error(`[queue] job ${job.id} failed: ${job.error}`);
      })
      .finally(() => {
        job.finishedAt = Date.now();
        active--;
        setImmediate(drain);
      });
  }
}

setInterval(() => {
  const cutoff = Date.now() - JOB_TTL_MS;
  for (const [id, job] of jobs.entries()) {
    if ((job.finishedAt || job.createdAt) < cutoff) {
      jobs.delete(id);
    }
  }
}, 5 * 60 * 1000).unref();
