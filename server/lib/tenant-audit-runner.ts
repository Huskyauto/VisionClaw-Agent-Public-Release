import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import type { AgentJob } from "../job-queue";
import { renewJobLease } from "../job-queue";
import { auditCommand, isCompleteAuditReport, TENANT_AUDIT_JOB_KIND, AUDIT_DAILY_RUNTIME_MS } from "./tenant-audit-schedule-policy";
import { auditJobState, claimAuditDailyBatch, continueAuditJob, backoffAuditJob, deferAuditDeadline, recordAuditFailure, TenantAuditStop } from "./tenant-audit-job-state";
import { tryAcquireHeavyWorkLane, HeavyWorkDeferred } from "./heavy-work-lane";
import { isProductionRuntime } from "./runtime-env";

const RUNTIME_MS = AUDIT_DAILY_RUNTIME_MS; // lease renewed while the bounded daily batch runs
export interface TenantAuditRunnerPorts {
  state(): Promise<any>;
  acquire(onLost: () => void): Promise<(() => Promise<void>) | null>;
  claimSlice(): Promise<void | boolean>;
  child(): Promise<{ code: number; deadline: boolean }>;
  continue(): Promise<void>;
  outage(completedWork?: boolean): Promise<void>;
  deadline(): Promise<void>;
  recordFailure(): Promise<void>;
  command(): ReturnType<typeof auditCommand>;
}
/** Cursor/heartbeat/health writes are not completed work. */
export function auditProgressFingerprint(payload: any): string {
  const cp = payload?.auditCheckpoint;
  const keys = (value: unknown) => value && typeof value === "object" ? Object.keys(value).sort() : [];
  return createHash("sha256").update(JSON.stringify({
    completed: keys(cp?.completed), pending: keys(cp?.pending?.completed),
    receipts: keys(cp?.unitLedger?.receipts), precision: keys(payload?.auditPrecision),
  })).digest("hex");
}
/** One bounded daily batch, checkpointing the same weekly campaign. */
export async function runTenantAuditJob(job: AgentJob,
  ports: Partial<TenantAuditRunnerPorts> = {}): Promise<Record<string, unknown>> {
  if (job.tenantId !== 1 || job.kind !== TENANT_AUDIT_JOB_KIND || job.payload.tenantId !== 1 ||
      !/^\d{4}-\d{2}-\d{2}$/.test(job.payload.window) ||
      !/^[a-f0-9]{64}$/.test(job.payload.sourceHash) ||
      job.payload.dedupeKey !== `tenant-audit:${job.payload.window}:${job.payload.sourceHash}`)
    throw new TenantAuditStop("Invalid scheduled tenant audit authority");
  const identity = { id: job.id, attempt: job.attempts };
  const state = ports.state ?? (() => auditJobState(undefined, undefined, identity));
  try {
    await state();
  } catch (error) {
    if (error instanceof TenantAuditStop) throw error;
    // A transient read error is not an authority verdict. Count it if the
    // database has recovered; otherwise queue backoff still prevents dispatch.
    await (ports.recordFailure ?? (() => recordAuditFailure(identity)))();
    throw error;
  }
  let command: ReturnType<typeof auditCommand>;
  try {
    command = ports.command ? ports.command() : auditCommand(isProductionRuntime());
  } catch {
    // No model was dispatched. A missing bundle or unreadable authority is a
    // configuration/ownership failure, not permission for 384 blind retries.
    throw new TenantAuditStop("Tenant audit preflight unavailable; no child dispatched; inspect production bundle");
  }
  let stop: (() => void) | undefined;
  let laneLost = false;
  const onLost = () => { laneLost = true; stop?.(); };
  let release: (() => Promise<void>) | null;
  try {
    release = ports.acquire ? await ports.acquire(onLost) :
      await tryAcquireHeavyWorkLane("scheduled tenant isolation audit", { onLost });
  } catch (error) {
    console.warn("[tenant-audit] admission unavailable; no child dispatched", error);
    throw new HeavyWorkDeferred("scheduled tenant audit admission");
  }
  if (!release) throw new HeavyWorkDeferred("scheduled tenant audit");
  try {
    const payload = await state();
    if ((payload.auditSlices ?? 0) >= 2048) throw new TenantAuditStop("Tenant audit slice ceiling reached; coverage incomplete");
    // Preserve all child-written fields; this counter is independently fenced.
    const admitted = ports.claimSlice ? await ports.claimSlice() : await claimAuditDailyBatch(identity);
    if (admitted === false) return { status: "daily_batch_wait", continued: true };
    if (laneLost) throw new Error("Tenant audit admission lost before dispatch");
    const outcome = ports.child ? await ports.child() : await new Promise<{ code: number; deadline: boolean }>((resolve, reject) => {
      let deadline = false, lost = false;
      const child = spawn(command.command, command.args, { detached: true, stdio: "inherit",
        env: { ...process.env,
          TENANT_AUDIT_JOB_ID: String(job.id), TENANT_AUDIT_JOB_ATTEMPT: String(job.attempts),
          PROFUNDO_ENABLED: process.env.PROFUNDO_ENABLED === "0" ? "0" : "1",
          AUDIT_PROVIDER_LANE: "profundo",
          AUDIT_MODEL: "claude-sonnet-5", AUDIT_TRIAGE_MODEL: "claude-sonnet-5",
          AUDIT_SLICE_CHUNKS: "1", AUDIT_WEEKLY_BATCH: "1",
          AUDIT_MAX_CHUNKS: "0", TENANT_AUDIT_PRECISION: "1",
          AUDIT_TRIAGE_BATCH: "12", AUDIT_TRIAGE_MAX_BATCHES: "0",
          AUDIT_TRIAGE_MAX_TOKENS: "8000", AUDIT_TRIAGE_SNIPPET_LINES: "30",
          AUDIT_CHUNK_TIMEOUT_MS: "120000", AUDIT_TRIAGE_TIMEOUT_MS: "120000",
          AUDIT_OPERATION_TIMEOUT_MS: "30000",
          AUDIT_MAX_TOKENS: "32000",
          ALLOW_METERED_LLM: "0", TENANT_AUDIT_ENQUEUE_FIXES: "0", JURY_AUTOAPPLY: "0",
          AUDIT_DRY_RUN: "1", // scheduler supplies persistent notices; no repeated slice emails
          AUDIT_DEADLINE_AT: String(Date.now() + RUNTIME_MS - 5_000),
        } });
      stop = () => {
        lost = true;
        try { if (child.pid) process.kill(-child.pid, "SIGKILL"); }
        catch { child.kill("SIGKILL"); }
      };
      const timer = setTimeout(() => { deadline = true; stop?.(); }, RUNTIME_MS);
      const renewal = setInterval(() => {
        renewJobLease(job.id, job.attempts, 1, 5 * 60_000).then(ok => {
          if (!ok) stop?.();
        }).catch(error => { console.error("[tenant-audit] lease renewal failed", error); stop?.(); });
      }, 60_000);
      const cleanup = () => { clearTimeout(timer); clearInterval(renewal); stop = undefined; };
      child.once("error", error => { cleanup(); reject(error); });
      child.once("close", code => {
        cleanup();
        if (lost && !deadline) reject(new Error("Tenant audit admission/lease lost; child stopped"));
        else resolve({ code: code ?? 3, deadline });
      });
    });
    const current = await state();
    if ((outcome.deadline || outcome.code === 9 || outcome.code === 7) &&
        auditProgressFingerprint(current) === auditProgressFingerprint(payload)) {
      await (ports.deadline ?? (() => deferAuditDeadline(identity, payload.auditDeadlineStalls ?? 0)))();
      return { status: "incomplete", continued: true };
    }
    if (outcome.code === 8 && !outcome.deadline) {
      const completedWork = auditProgressFingerprint(current) !== auditProgressFingerprint(payload);
      const outages = payload.auditOutages ?? 0;
      if (!Number.isSafeInteger(outages) || outages < 0)
        throw new TenantAuditStop("Invalid audit recovery counter");
      if (!completedWork && outages >= 11)
        throw new TenantAuditStop("Tenant audit stopped after twelve recovery passes without completed work; inspect unavailable routes or invalid source units");
      await (ports.outage ?? ((progress?: boolean) => backoffAuditJob(identity, undefined, progress)))(completedWork);
      return { status: "provider_backoff", continued: true };
    }
    // Completed batches wait until tomorrow; outages cannot buy a second batch.
    if (outcome.code === 7 || outcome.code === 9 || outcome.deadline) {
      await (ports.continue ?? (() => continueAuditJob(identity)))();
      return { status: "incomplete", continued: true };
    }
    if (![0, 4, 6].includes(outcome.code) || !isCompleteAuditReport(current.auditReport))
      throw new Error("Tenant audit incomplete or provider unavailable; retained progress preserved");
    return { status: outcome.code === 0 ? "complete" : "findings_require_attention",
      coverage: current.auditReport.coverage, exitCode: outcome.code };
  } catch (error) {
    if (error instanceof TenantAuditStop) throw error;
    await (ports.recordFailure ?? (() => recordAuditFailure(identity)))();
    throw error;
  } finally { await release(); }
}
