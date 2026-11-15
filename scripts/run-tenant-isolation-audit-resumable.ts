#!/usr/bin/env tsx
/**
 * Bounded controller for the whole-repository tenant-isolation audit.
 *
 * The audit itself deliberately exits 7 after a clean partial slice. This
 * controller turns that state into a resumable workflow: it starts the next
 * slice, preserves the checkpoint, and stops on any real failure. The slice
 * and total-runtime caps prevent this from becoming an unbounded scheduler
 * process.
 */
import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { tryAcquireHeavyWorkLane } from "../server/lib/heavy-work-lane";

// A controller invocation never waits through multi-hour provider cooldowns.
// Partial work stays checkpointed and non-green for a later scheduled retry.
const TOTAL_RUN_BUDGET_MS = 10 * 60_000;
const MAX_SLICE_MS = 20 * 60_000;
const sliceChunks = boundedInt(process.env.AUDIT_SLICE_CHUNKS, 8, 1, 20);
const maxSlices = boundedInt(process.env.AUDIT_MAX_SLICES, 48, 1, 64);
let activeChildPid: number | undefined;

// Covers hung lock admission/cleanup too, not just model calls. Exiting closes
// the PostgreSQL session; kill the detached child group before exiting.
function installControllerDeadline() {
  return setTimeout(() => {
    console.error("[tenant-audit-resumable] controller deadline reached; checkpoint retained");
    if (activeChildPid) {
      try { process.kill(-activeChildPid, "SIGKILL"); }
      catch { /* The process group may already have exited. */ }
    }
    process.exit(9); // Scheduling timeout is not provider exhaustion.
  }, TOTAL_RUN_BUDGET_MS);
}

function boundedInt(raw: string | undefined, fallback: number, min: number, max: number): number {
  const n = Number(raw);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.floor(n))) : fallback;
}

function runSlice(timeoutMs: number): Promise<number> {
  return new Promise((done) => {
    const child = spawn("npx", ["tsx", "scripts/tenant-isolation-audit.ts"], {
      stdio: "inherit",
      detached: true, // own process group so a timed-out npx cannot leave tsx running
      env: {
        ...process.env,
        AUDIT_SLICE_CHUNKS: String(sliceChunks),
        AUDIT_DEADLINE_AT: String(Date.now() + timeoutMs - 5_000),
        ALLOW_METERED_LLM: process.env.AUDIT_RUNNER_ALLOW_METERED === "1" ? "1" : "0",
        TENANT_AUDIT_ENQUEUE_FIXES: "0",
        JURY_AUTOAPPLY: "0",
      },
    });
    activeChildPid = child.pid;
    let timedOut = false;
    const deadline = setTimeout(() => {
      timedOut = true;
      console.error(`[tenant-audit-resumable] slice exceeded ${timeoutMs}ms; stopping its process group`);
      if (child.pid) {
        try { process.kill(-child.pid, "SIGKILL"); }
        catch { child.kill("SIGKILL"); }
      }
    }, timeoutMs);
    deadline.unref();
    child.once("error", (err) => {
      clearTimeout(deadline);
      if (activeChildPid === child.pid) activeChildPid = undefined;
      console.error(`[tenant-audit-resumable] child failed to start: ${err.message}`);
      done(3);
    });
    child.once("close", (code) => {
      clearTimeout(deadline);
      if (activeChildPid === child.pid) activeChildPid = undefined;
      done(timedOut ? 9 : code ?? 3);
    });
  });
}

export async function runAuditSlices(deps: {
  acquire?: typeof tryAcquireHeavyWorkLane;
  slice?: () => Promise<number>;
  limit?: number;
  budgetMs?: number;
  now?: () => number;
} = {}): Promise<number> {
  const now = deps.now ?? Date.now;
  const startedAt = now();
  const budgetMs = Math.min(TOTAL_RUN_BUDGET_MS, Math.max(1_000, deps.budgetMs ?? TOTAL_RUN_BUDGET_MS));
  let release: (() => Promise<void>) | null = null;
  try {
    release = await (deps.acquire ?? tryAcquireHeavyWorkLane)("tenant isolation audit");
  } catch (err: any) {
    console.warn(`[tenant-audit-resumable] Heavy lane unavailable: ${err.message}; checkpoint retained`);
    return 7;
  }
  if (!release) {
    console.warn("[tenant-audit-resumable] Heavy lane busy or heap high; checkpoint retained");
    return 7; // Partial/deferred is never green.
  }
  try {
    const limit = deps.limit ?? maxSlices;
    for (let slice = 1; slice <= limit; slice++) {
      const remainingMs = budgetMs - (now() - startedAt);
      if (remainingMs <= 0) {
        console.warn("[tenant-audit-resumable] total run budget exhausted; checkpoint retained");
        return 7;
      }
      const sliceTimeoutMs = Math.min(MAX_SLICE_MS, remainingMs);
      console.log(`[tenant-audit-resumable] starting bounded slice ${slice}/${limit} (${sliceChunks} chunks max; ${sliceTimeoutMs}ms remaining)`);
      const code = await (deps.slice ?? (() => runSlice(sliceTimeoutMs)))();
      console.log(`[tenant-audit-resumable] slice ${slice}/${limit} exited ${code}`);
      if (code === 8) {
        console.warn("[tenant-audit-resumable] provider recovery deferred; checkpoint retained");
        return 8;
      }
      if (code === 9) return 7; // Retain progress and continue promptly, no provider backoff.
      if (code !== 7) return code;
      if (budgetMs - (now() - startedAt) < 75_000) return 7;
    }
    console.error(`[tenant-audit-resumable] slice cap reached (${limit}); checkpoint remains for the next run`);
    return 7;
  } finally {
    if (release) await release();
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const deadline = installControllerDeadline();
  runAuditSlices().then(
    (code) => { process.exitCode = code; },
    (err) => {
      console.error(`[tenant-audit-resumable] controller failed: ${err.message}`);
      process.exitCode = 5;
    },
  ).finally(() => clearTimeout(deadline));
}