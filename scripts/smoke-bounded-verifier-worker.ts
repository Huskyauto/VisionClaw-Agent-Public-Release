// Explicit offline smoke: real production child/compiler and kernel accounting,
// all DB/HTTP mocked; no customer jobs, production writes, or source mutation.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import path from "node:path";
import { existsSync } from "node:fs";
import { __verifyProposalIsolatedForTest, type ProposalVerifierRuntime } from "../server/lib/proposal-verifier-process";
import { readEffectiveVerifierMemory } from "../server/lib/verifier-memory-source";
import { canStartVerifierWorker, runBoundedVerifierTick } from "../server/lib/bounded-verifier-worker";
import { readBoundedKernelText } from "../server/lib/bounded-kernel-text";

function oomCounts() {
  const text = readBoundedKernelText("/sys/fs/cgroup/memory.events");
  const counts = ["oom", "oom_kill"].map(key => {
    const match = text.match(new RegExp(`^${key} ([0-9]+)$`, "m"));
    const value = match ? Number(match[1]) : NaN;
    assert.ok(Number.isSafeInteger(value) && value >= 0, "Smoke requires readable OOM counters");
    return value;
  });
  return counts;
}

async function main() {
  const before = readEffectiveVerifierMemory();
  assert.ok(before, "Smoke requires real finite kernel accounting");
  const oomBefore = oomCounts();
  let peak = before.currentBytes;
  const runtime: ProposalVerifierRuntime = {
    acquireLane: async () => async () => {},
    production: true, childBundleExists: existsSync,
    rss: () => process.memoryUsage().rss,
    now: Date.now, setTimer: setTimeout, clearTimer: clearTimeout,
    readCgroupMemory: () => {
      const memory = readEffectiveVerifierMemory();
      if (memory) peak = Math.max(peak, memory.currentBytes);
      return memory;
    },
    spawn: (command, args, options) => {
      const child = spawn(command, [
        "--require", path.resolve("tests/fixtures/verifier-offline-pg.cjs"), ...args,
      ], { ...options, env: { ...options.env, DATABASE_URL: "postgres://offline.invalid/offline",
        VERIFIER_OFFLINE_DRIFT: args.includes("999998") ? "1" : "0" } });
      child.stderr?.on("data", chunk => {
        // Expose only the fixture's fixed counters, never other child stderr.
        const counts = String(chunk).match(/^OFFLINE_PG_COUNTS:\d+:\d+$/m)?.[0];
        if (counts) console.log(counts);
      });
      return child;
    },
  };
  const result = await __verifyProposalIsolatedForTest(999999, 777, runtime, undefined, { strictSourceBase: true });
  assert.equal(result.status, "failed");
  assert.match(result.details, /TS2322/);
  const after = readEffectiveVerifierMemory();
  assert.ok(after);
  let deferred = false;
  const mismatch = await runBoundedVerifierTick({
    ready: () => canStartVerifierWorker(readEffectiveVerifierMemory(), process.memoryUsage().rss),
    now: Date.now,
    claim: async () => [{
      id: 999997, kind: "source_repair_verification", attempts: 1, tenantId: 777,
      payload: { tenantId: 777, proposalId: 999998 }, leaseUntil: new Date(Date.now() + 300_000),
    } as any],
    verify: (job, tenantId, proposalId) => __verifyProposalIsolatedForTest(
      proposalId, tenantId, runtime, job.leaseUntil!.getTime(), { strictSourceBase: true },
    ),
    complete: async () => { throw new Error("Source mismatch must never complete"); },
    defer: async job => { assert.equal(job.tenantId, 777); assert.equal(job.attempts, 1); deferred = true; return true; },
    fail: async () => { throw new Error("Source mismatch must preserve attempts"); },
    isDeferred: () => false,
  });
  assert.equal(mismatch, "deferred");
  assert.equal(deferred, true);
  assert.deepEqual(oomCounts(), oomBefore, "No OOM counter may increase during the local smoke");
  console.log(JSON.stringify({
    localOnly: true, realCompilerRejectedInvalidPatch: true, database: "offline",
    finiteLimitGiB: Number((before.maxBytes / 1024 ** 3).toFixed(2)),
    observedPeakAggregateGiB: Number((peak / 1024 ** 3).toFixed(2)),
    observedAggregateGrowthGiB: Number(((peak - before.currentBytes) / 1024 ** 3).toFixed(2)),
    reservePreserved: before.maxBytes - peak >= 512 * 1024 ** 2,
    strictSourceMismatchDeferredWithoutWrite: true,
    oomCountersUnchanged: true,
    noProductionParityClaim: true,
  }));
  const { pool } = await import("../server/db");
  await pool.end();
}
void main().catch(error => {
  // All child input and SQL in this smoke are offline fixtures; protocol
  // failures carry only fixed parent messages, never retained child stderr.
  console.error("Bounded offline smoke failed:", error instanceof Error ? error.message.slice(0, 800) : "unknown failure");
  process.exitCode = 1;
});