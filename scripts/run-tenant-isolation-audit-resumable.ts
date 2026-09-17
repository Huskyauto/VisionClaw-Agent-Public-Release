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
import { spawnSync } from "node:child_process";

// A larger bounded slice reduces restart overhead and the window in which a
// harmless code/config change can invalidate a checkpoint, while retaining a
// hard cap and exit-7 resume semantics.
const sliceChunks = boundedInt(process.env.AUDIT_SLICE_CHUNKS, 20, 1, 20);
const maxSlices = boundedInt(process.env.AUDIT_MAX_SLICES, 4, 1, 32);

function boundedInt(raw: string | undefined, fallback: number, min: number, max: number): number {
  const n = Number(raw);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.floor(n))) : fallback;
}

function runSlice(): number {
  const result = spawnSync("npx", ["tsx", "scripts/tenant-isolation-audit.ts"], {
    stdio: "inherit",
    env: {
      ...process.env,
      AUDIT_SLICE_CHUNKS: String(sliceChunks),
      ALLOW_METERED_LLM: process.env.AUDIT_RUNNER_ALLOW_METERED === "1" ? "1" : "0",
      TENANT_AUDIT_ENQUEUE_FIXES: "0",
      JURY_AUTOAPPLY: "0",
    },
  });
  if (result.error) {
    console.error(`[tenant-audit-resumable] child failed to start: ${result.error.message}`);
    return 3;
  }
  return result.status ?? 3;
}

for (let slice = 1; slice <= maxSlices; slice++) {
  console.log(`[tenant-audit-resumable] starting bounded slice ${slice}/${maxSlices} (${sliceChunks} chunks max)`);
  const code = runSlice();
  console.log(`[tenant-audit-resumable] slice ${slice}/${maxSlices} exited ${code}`);
  if (code !== 7) process.exit(code);
}

console.error(`[tenant-audit-resumable] slice cap reached (${maxSlices}); checkpoint remains for the next run`);
process.exit(7);