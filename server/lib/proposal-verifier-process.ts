import { spawn as nodeSpawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { StringDecoder } from "node:string_decoder";
import { reportDiagnostic } from "./safe-diagnostic";
import { tryAcquireHeavyWorkLane, HeavyWorkDeferred } from "./heavy-work-lane";
import { readEffectiveVerifierMemory, summarizeUnavailableVerifierMemory } from "./verifier-memory-source";
import { sanitizeSpawnEnv } from "../safety/spawn-env-guard";
import type { VerifyResult } from "../proposal-verifier";

const CHILD_TIMEOUT_MS = 210_000;
const MAX_PROTOCOL_BYTES = 8 * 1024;
const MAX_PARENT_RSS_BYTES = 1_200 * 1024 * 1024;
// The 2 GiB verifier works on 4 GiB hosts; on an 8 GiB host, allow a 3 GiB
// heap only when the whole cgroup has room for it AND the web process.
const BASE_CHILD_HEAP_MB = 2048;
const LARGE_CHILD_HEAP_MB = 3072;
const LARGE_HOST_BYTES = 8 * 1024 ** 3;
// A 2 GiB compile grew cgroup usage by ~2.38 GiB. Reserve its growth, a
// 512 MiB running margin, and a burst allowance; the larger heap requires
// an extra 1.5 GiB of admission headroom, not merely a bigger host label.
const BASE_CHILD_START_HEADROOM_BYTES = 3 * 1024 ** 3;
const LARGE_CHILD_START_HEADROOM_BYTES = 4.5 * 1024 ** 3;
const CGROUP_MEMORY_RESERVE_BYTES = 512 * 1024 * 1024;
const CGROUP_MEMORY_POLL_MS = 250;
const RESULT_MARKER = "PROPOSAL_VERIFY_RESULT:";
const ADMISSION_LOG_INTERVAL_MS = 60_000;
type AdmissionReason = "parent_rss" | "lane_error" | "lane_unavailable" | "lane_lost"
  | "cgroup_unavailable" | "cgroup_headroom" | "cgroup_read_error" | "lease_expired";
const lastAdmissionLogAt = new Map<AdmissionReason, number>();

type ReleaseLane = () => Promise<void>;
type SpawnedChild = Pick<ChildProcess, "stdout" | "stderr" | "kill" | "on">;

export interface CgroupMemorySnapshot {
  currentBytes: number;
  maxBytes: number;
}

export interface ProposalVerifierRuntime {
  acquireLane: typeof tryAcquireHeavyWorkLane;
  spawn: (command: string, args: string[], options: { cwd: string; env: NodeJS.ProcessEnv; shell: false; stdio: ["ignore", "pipe", "pipe"] }) => SpawnedChild;
  now: () => number;
  setTimer: (callback: () => void, delayMs: number) => ReturnType<typeof setTimeout>;
  clearTimer: (timer: ReturnType<typeof setTimeout>) => void;
  rss: () => number;
  readCgroupMemory: () => CgroupMemorySnapshot | null;
  production: boolean;
  childBundleExists: (bundlePath: string) => boolean;
}

const defaultRuntime: ProposalVerifierRuntime = {
  acquireLane: tryAcquireHeavyWorkLane,
  spawn: (command, args, options) => nodeSpawn(command, args, options),
  now: Date.now,
  setTimer: (callback, delayMs) => setTimeout(callback, delayMs),
  clearTimer: (timer) => clearTimeout(timer),
  rss: () => process.memoryUsage().rss,
  readCgroupMemory: readEffectiveVerifierMemory,
  production: process.env.NODE_ENV === "production",
  childBundleExists: existsSync,
};

function cgroupMemoryHasReserve(
  memory: CgroupMemorySnapshot | null,
  requiredBytes = CGROUP_MEMORY_RESERVE_BYTES,
): boolean {
  if (memory === null) return true;
  if (!Number.isSafeInteger(memory.maxBytes) || memory.maxBytes <= 0
    || !Number.isSafeInteger(memory.currentBytes) || memory.currentBytes < 0) return false;
  return memory.maxBytes - memory.currentBytes >= requiredBytes;
}

function logAdmissionDeferral(
  reason: AdmissionReason,
  details: { rssBytes?: number; memory?: CgroupMemorySnapshot; requiredBytes?: number } = {},
): void {
  const now = Date.now();
  const last = lastAdmissionLogAt.get(reason);
  if (last !== undefined && now >= last && now - last < ADMISSION_LOG_INTERVAL_MS) return;
  try {
    let summary = `[proposal-verifier] admission deferred reason=${reason}`;
    if (details.rssBytes !== undefined && Number.isFinite(details.rssBytes) && details.rssBytes >= 0) {
      summary += ` parent_rss_mib=${Math.round(details.rssBytes / 1024 ** 2)} limit_mib=1200`;
    }
    const { memory, requiredBytes } = details;
    if (memory && Number.isSafeInteger(memory.maxBytes) && memory.maxBytes > 0
      && Number.isSafeInteger(memory.currentBytes) && memory.currentBytes >= 0
      && requiredBytes !== undefined) {
      summary += ` limit_gib=${(memory.maxBytes / 1024 ** 3).toFixed(2)}`
        + ` free_gib=${((memory.maxBytes - memory.currentBytes) / 1024 ** 3).toFixed(2)}`
        + ` required_gib=${(requiredBytes / 1024 ** 3).toFixed(2)}`;
    }
    if (reason === "cgroup_unavailable") {
      summary += ` ${summarizeUnavailableVerifierMemory()}`;
    }
    // No proposal/tenant IDs, error text, credentials or child diagnostics.
    console.warn(summary);
    lastAdmissionLogAt.set(reason, now);
  } catch {
    // Observability must never turn a capacity deferral into a failed job attempt.
    reportDiagnostic("[proposal-verifier] Admission diagnostic sink unavailable");
  }
}

function logChildObservation(
  event: "child_spawn_requested" | "child_result",
  heapMb: number,
  status?: VerifyResult["status"],
): void {
  try {
    // A spawn request is not proof of execution; a result is not proof that
    // the queue's fenced completion write succeeded. Neither logs identifiers.
    console.info(`[proposal-verifier] ${event} heap_mb=${heapMb}${status ? ` status=${status}` : ""}`);
  } catch {
    // Never change a verifier result or leave an already-started child orphaned.
    reportDiagnostic("[proposal-verifier] Child diagnostic sink unavailable");
  }
}

function getChildCommand(production: boolean, bundleExists: (p: string) => boolean, heapMb: number): { command: string; args: string[] } {
  if (production) {
    const bundlePath = path.resolve(process.cwd(), "dist/proposal-verifier-child.cjs");
    if (!bundleExists(bundlePath)) throw new Error("Proposal verifier child bundle is missing; refusing to verify in-process");
    return { command: process.execPath, args: [`--max-old-space-size=${heapMb}`, bundlePath] };
  }

  const tsxCli = path.resolve(process.cwd(), "node_modules/tsx/dist/cli.mjs");
  const sourcePath = path.resolve(process.cwd(), "scripts/proposal-verifier-child.ts");
  if (!bundleExists(tsxCli) || !bundleExists(sourcePath)) {
    throw new Error("Proposal verifier development runner is unavailable");
  }
  return { command: process.execPath, args: [`--max-old-space-size=${heapMb}`, tsxCli, sourcePath] };
}

function validVerifyResult(value: unknown): value is VerifyResult {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return (candidate.status === "passed" || candidate.status === "failed" || candidate.status === "skipped")
    && typeof candidate.details === "string"
    && Number.isFinite(candidate.durationMs)
    && (candidate.durationMs as number) >= 0;
}

async function verifyWithRuntime(
  proposalId: number,
  tenantId: number,
  runtime: ProposalVerifierRuntime,
  leaseDeadlineMs?: number,
  strictSourceBase = false,
): Promise<VerifyResult> {
  if (!Number.isSafeInteger(proposalId) || proposalId <= 0) {
    throw new Error("verifyProposalIsolated: proposalId must be a positive integer");
  }
  if (!Number.isSafeInteger(tenantId) || tenantId <= 0) {
    throw new Error("verifyProposalIsolated: tenantId must be a positive integer");
  }
  const parentRss = runtime.rss();
  if (!Number.isFinite(parentRss) || parentRss >= MAX_PARENT_RSS_BYTES) {
    logAdmissionDeferral("parent_rss", { rssBytes: parentRss });
    throw new HeavyWorkDeferred("proposal verification: parent RSS admission");
  }

  let release: ReleaseLane | null;
  let laneLost = false;
  let killActiveChild: (() => void) | null = null;
  try {
    // Forced on deliberately: proposal verification must remain cross-process
    // serialized even when the general discretionary-work switch is disabled.
    release = await runtime.acquireLane("proposal verification", {
      enabled: true,
      onLost: () => {
        laneLost = true;
        killActiveChild?.();
      },
    });
  } catch {
    logAdmissionDeferral("lane_error");
    throw new HeavyWorkDeferred("proposal verification");
  }
  if (!release) {
    // A null lane can mean lock contention OR its separate heap-fraction gate.
    logAdmissionDeferral("lane_unavailable");
    throw new HeavyWorkDeferred("proposal verification");
  }

  try {
    if (laneLost) {
      logAdmissionDeferral("lane_lost");
      throw new HeavyWorkDeferred("proposal verification: lane lock lost");
    }
    const acquiredRss = runtime.rss();
    if (!Number.isFinite(acquiredRss) || acquiredRss >= MAX_PARENT_RSS_BYTES) {
      logAdmissionDeferral("parent_rss", { rssBytes: acquiredRss });
      throw new HeavyWorkDeferred("proposal verification: parent RSS admission");
    }
    let childHeapMb = BASE_CHILD_HEAP_MB;
    try {
      const memory = runtime.readCgroupMemory();
      // A larger configured VM alone is not enough: only grant the larger
      // heap when real free cgroup headroom covers its worst-case growth.
      if (memory !== null
        && memory.maxBytes >= LARGE_HOST_BYTES
        && cgroupMemoryHasReserve(memory, LARGE_CHILD_START_HEADROOM_BYTES)) {
        childHeapMb = LARGE_CHILD_HEAP_MB;
      }
      if (memory === null && runtime.production) {
        logAdmissionDeferral("cgroup_unavailable");
        throw new HeavyWorkDeferred("proposal verification: cgroup memory admission");
      }
      const requiredBytes = childHeapMb === LARGE_CHILD_HEAP_MB
        ? LARGE_CHILD_START_HEADROOM_BYTES : BASE_CHILD_START_HEADROOM_BYTES;
      if (!cgroupMemoryHasReserve(memory, requiredBytes)) {
        logAdmissionDeferral("cgroup_headroom", { memory: memory ?? undefined, requiredBytes });
        throw new HeavyWorkDeferred("proposal verification: cgroup memory admission");
      }
    } catch (error) {
      if (error instanceof HeavyWorkDeferred) throw error;
      logAdmissionDeferral("cgroup_read_error");
      throw new HeavyWorkDeferred("proposal verification: cgroup memory admission unavailable");
    }
    // Leave time for child shutdown and fenced queue completion. Direct
    // callers without a queue lease retain the ordinary 210-second bound.
    const remainingMs = leaseDeadlineMs === undefined
      ? CHILD_TIMEOUT_MS
      : Math.min(CHILD_TIMEOUT_MS, leaseDeadlineMs - runtime.now() - 30_000);
    if (!Number.isFinite(remainingMs) || remainingMs <= 0) {
      logAdmissionDeferral("lease_expired");
      throw new HeavyWorkDeferred("proposal verification: job lease nearly expired");
    }
    const { command, args } = getChildCommand(runtime.production, runtime.childBundleExists, childHeapMb);
    args.push(String(proposalId), String(tenantId));
    if (strictSourceBase) args.push("--strict-source-base");
    const child = runtime.spawn(command, args, {
      cwd: process.cwd(),
      env: sanitizeSpawnEnv(process.env),
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    });
    killActiveChild = () => {
      try { child.kill("SIGKILL"); }
      catch { reportDiagnostic("[proposal-verifier] Child termination failed; close/error path remains authoritative"); }
    };
    logChildObservation("child_spawn_requested", childHeapMb);
    const result = await awaitChildResult(child, runtime, remainingMs, () => laneLost);
    logChildObservation("child_result", childHeapMb, result.status);
    return result;
  } finally {
    try {
      await release();
    } catch {
      // The verifier may already have durably persisted its outcome. A lock
      // unlock error must be visible, but must not cause a duplicate retry.
      console.error("[proposal-verifier] heavy-work lane release failed");
    }
  }
}

function awaitChildResult(
  child: SpawnedChild,
  runtime: ProposalVerifierRuntime,
  timeoutMs: number,
  isLaneLost: () => boolean,
): Promise<VerifyResult> {
  return new Promise((resolve, reject) => {
    const startedAt = runtime.now();
    let stdout = "";
    let stdoutBytes = 0;
    const stdoutDecoder = new StringDecoder("utf8");
    let protocolOverflow = false;
    let timedOut = false;
    let memoryLimitBreached = false;
    let childError = false;
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let memoryWatchTimer: ReturnType<typeof setTimeout> | undefined;

    const fail = (message: string) => {
      if (settled) return;
      settled = true;
      if (timer) runtime.clearTimer(timer);
      if (memoryWatchTimer) runtime.clearTimer(memoryWatchTimer);
      reject(new Error(message));
    };
    const terminate = () => {
      try { child.kill("SIGKILL"); }
      catch { childError = true; }
    };

    child.stdout?.on("data", (chunk: Buffer | string) => {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
      stdoutBytes += buffer.byteLength;
      if (stdoutBytes > MAX_PROTOCOL_BYTES) {
        protocolOverflow = true;
        terminate();
        return;
      }
      stdout += stdoutDecoder.write(buffer);
    });
    // Drain but never retain or expose child diagnostics; stderr may contain
    // secrets from database/client errors and is not part of the protocol.
    child.stderr?.on("data", () => {});
    child.on("error", () => {
      childError = true;
      terminate();
    });
    timer = runtime.setTimer(() => {
      timedOut = true;
      terminate();
    }, timeoutMs);
    const watchCgroupMemory = () => {
      if (settled) return;
      let memory: CgroupMemorySnapshot | null;
      try {
        memory = runtime.readCgroupMemory();
      } catch {
        memory = { currentBytes: -1, maxBytes: 0 };
      }
      if ((memory === null && runtime.production) || !cgroupMemoryHasReserve(memory)) {
        memoryLimitBreached = true;
        terminate();
        return;
      }
      // No v2 limit means there is no meaningful aggregate budget to watch.
      if (memory !== null) {
        memoryWatchTimer = runtime.setTimer(watchCgroupMemory, CGROUP_MEMORY_POLL_MS);
      }
    };
    child.on("close", (code: number | null, signal: NodeJS.Signals | null) => {
      if (settled) return;
      if (timer) runtime.clearTimer(timer);
      if (memoryWatchTimer) runtime.clearTimer(memoryWatchTimer);
      if (timedOut || runtime.now() - startedAt >= timeoutMs) return fail("Proposal verifier child timed out");
      if (memoryLimitBreached) return fail("Proposal verifier child exceeded cgroup memory reserve");
      if (isLaneLost()) return fail("Proposal verifier child lost its heavy-work lane lock");
      if (protocolOverflow) return fail("Proposal verifier child protocol exceeded 8KB");
      if (childError) return fail("Proposal verifier child failed before completing");
      if (code !== 0 || signal !== null) return fail(`Proposal verifier child exited unsuccessfully (code=${code}, signal=${signal ?? "none"})`);

      stdout += stdoutDecoder.end();
      const lines = stdout.endsWith("\n") ? stdout.slice(0, -1).split("\n") : stdout.split("\n");
      const resultLines = lines.filter((line) => line.startsWith(RESULT_MARKER));
      if (resultLines.length !== 1) {
        return fail("Proposal verifier child returned malformed protocol");
      }
      let result: unknown;
      try {
        result = JSON.parse(resultLines[0].slice(RESULT_MARKER.length));
      } catch {
        return fail("Proposal verifier child returned malformed protocol");
      }
      if (!validVerifyResult(result)) return fail("Proposal verifier child returned invalid result");
      settled = true;
      resolve(result);
    });
    if (isLaneLost()) terminate();
    else watchCgroupMemory();
  });
}

export async function verifyProposalIsolated(
  proposalId: number,
  tenantId: number,
  leaseDeadlineMs?: number,
  options: { strictSourceBase?: boolean } = {},
): Promise<VerifyResult> {
  return verifyWithRuntime(proposalId, tenantId, defaultRuntime, leaseDeadlineMs, options.strictSourceBase === true);
}

/** Injection seam for deterministic process/lane/timeout tests; not used by production callers. */
export async function __verifyProposalIsolatedForTest(
  proposalId: number,
  tenantId: number,
  runtime: ProposalVerifierRuntime,
  leaseDeadlineMs?: number,
  options: { strictSourceBase?: boolean } = {},
): Promise<VerifyResult> {
  return verifyWithRuntime(proposalId, tenantId, runtime, leaseDeadlineMs, options.strictSourceBase === true);
}