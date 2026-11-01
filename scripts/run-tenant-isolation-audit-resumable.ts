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
import { setTimeout as delay } from "node:timers/promises";

// The flat-rate source probe took ~75 seconds. Twenty such chunks can exceed
// the existing 20-minute process deadline; eight leave room for bounded retries.
// 48 × 8 admits 384 chunks for the present 325-chunk corpus. This is capacity,
// not proof of completed coverage or an availability guarantee.
const sliceChunks = boundedInt(process.env.AUDIT_SLICE_CHUNKS, 8, 1, 20);
const maxSlices = boundedInt(process.env.AUDIT_MAX_SLICES, 48, 1, 64);

function boundedInt(raw: string | undefined, fallback: number, min: number, max: number): number {
  const n = Number(raw);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.floor(n))) : fallback;
}

function runSlice(): Promise<number> {
  return new Promise((done) => {
    const child = spawn("npx", ["tsx", "scripts/tenant-isolation-audit.ts"], {
      stdio: "inherit",
      detached: true, // own process group so a timed-out npx cannot leave tsx running
      env: {
        ...process.env,
        AUDIT_SLICE_CHUNKS: String(sliceChunks),
        ALLOW_METERED_LLM: process.env.AUDIT_RUNNER_ALLOW_METERED === "1" ? "1" : "0",
        TENANT_AUDIT_ENQUEUE_FIXES: "0",
        JURY_AUTOAPPLY: "0",
      },
    });
    let timedOut = false;
    const deadline = setTimeout(() => {
      timedOut = true;
      console.error("[tenant-audit-resumable] slice exceeded 20 minutes; stopping its process group");
      if (child.pid) {
        try { process.kill(-child.pid, "SIGKILL"); }
        catch { child.kill("SIGKILL"); }
      }
    }, 20 * 60_000);
    deadline.unref();
    child.once("error", (err) => {
      clearTimeout(deadline);
      console.error(`[tenant-audit-resumable] child failed to start: ${err.message}`);
      done(3);
    });
    child.once("close", (code) => {
      clearTimeout(deadline);
      done(timedOut ? 8 : code ?? 3);
    });
  });
}

export async function runAuditSlices(deps: {
  acquire?: typeof tryAcquireHeavyWorkLane;
  slice?: () => Promise<number>;
  limit?: number;
  recover?: (outage: number) => Promise<void>;
} = {}): Promise<number> {
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
    let outages = 0;
    for (let slice = 1; slice <= limit; slice++) {
      console.log(`[tenant-audit-resumable] starting bounded slice ${slice}/${limit} (${sliceChunks} chunks max)`);
      const code = await (deps.slice ?? runSlice)();
      console.log(`[tenant-audit-resumable] slice ${slice}/${limit} exited ${code}`);
      if (code === 8) {
        outages++;
        if (slice === limit) return 8;
        await release(); release = null;
        const ms = Math.min(3600_000, 300_000 * 2 ** Math.min(4, outages - 1));
        console.warn(`[tenant-audit-resumable] provider recovery in ${ms / 60_000} minutes; saved units retained`);
        await (deps.recover ? deps.recover(outages) : delay(ms));
        release = await (deps.acquire ?? tryAcquireHeavyWorkLane)("tenant isolation audit recovery");
        if (!release) return 7;
        continue;
      }
      if (code !== 7) return code;
      outages = 0;
    }
    console.error(`[tenant-audit-resumable] slice cap reached (${limit}); checkpoint remains for the next run`);
    return 7;
  } finally {
    if (release) await release();
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runAuditSlices().then(
    (code) => { process.exitCode = code; },
    (err) => {
      console.error(`[tenant-audit-resumable] controller failed: ${err.message}`);
      process.exitCode = 5;
    },
  );
}