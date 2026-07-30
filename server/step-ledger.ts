import { EventEmitter } from "events";
import { AsyncLocalStorage } from "async_hooks";
import { randomUUID } from "crypto";
import { db } from "./db";
import { agentKnowledge } from "@shared/schema";
import { and, eq, like, asc } from "drizzle-orm";

import { logSilentCatch } from "./lib/silent-catch";
import { redactObjectForStorage } from "./storage-helpers/pii-redaction-guard";
export type LedgerKind = "intent" | "proposal" | "execution" | "result" | "approval" | "note";

export interface LedgerEntry {
  runId: string;
  seq: number;
  kind: LedgerKind;
  timestamp: number;
  tenantId: number;
  personaId?: number;
  payload: any;
}

export interface RunHandle {
  runId: string;
  tenantId: number;
  personaId?: number;
  task: string;
  startedAt: number;
  status: "running" | "completed" | "failed" | "cancelled";
  phase?: string;
  activeTool?: string;
  counters: { intents: number; proposals: number; executions: number; commits: number; rejections: number; failures: number };
  finalAnswer?: string;
  endedAt?: number;
  lastActivityAt: number;
}

const activeRuns: Map<string, RunHandle> = new Map();
const runSeq: Map<string, number> = new Map();
export const ledgerEvents = new EventEmitter();
ledgerEvents.setMaxListeners(200);

// AsyncLocalStorage so nested awaits inside an orchestration entry point can
// auto-pick the active runId without callers threading it through every param.
export const runContext = new AsyncLocalStorage<RunHandle>();
export function currentRun(): RunHandle | undefined {
  return runContext.getStore();
}

const LEDGER_CATEGORY = "step_ledger";
const LEDGER_SOURCE = "step_ledger";

function nextSeq(runId: string): number {
  const n = (runSeq.get(runId) || 0) + 1;
  runSeq.set(runId, n);
  return n;
}

export function startRun(opts: { tenantId: number; personaId?: number; task: string; runId?: string }): RunHandle {
  const runId = opts.runId || randomUUID();
  const now = Date.now();
  const handle: RunHandle = {
    runId,
    tenantId: opts.tenantId,
    personaId: opts.personaId,
    task: opts.task,
    startedAt: now,
    lastActivityAt: now,
    status: "running",
    counters: { intents: 0, proposals: 0, executions: 0, commits: 0, rejections: 0, failures: 0 },
  };
  activeRuns.set(runId, handle);
  runSeq.set(runId, 0);
  ledgerEvents.emit("run:start", handle);
  return handle;
}

function disposeRun(runId: string) {
  activeRuns.delete(runId);
  runSeq.delete(runId);
}

export function endRun(runId: string, opts: { status: "completed" | "failed" | "cancelled"; finalAnswer?: string }) {
  const h = activeRuns.get(runId);
  if (!h) return;
  h.status = opts.status;
  h.finalAnswer = opts.finalAnswer;
  h.endedAt = Date.now();
  h.lastActivityAt = Date.now();
  ledgerEvents.emit("run:end", h);
  // R68.2 — clean BOTH maps to prevent runSeq leak.
  setTimeout(() => disposeRun(runId), 5 * 60_000);
}

// R68.2 — stale-run sweeper. Fail-close any "running" handle that has shown no
// activity for STALE_RUN_MS. Catches abandoned runs whose owning code crashed
// or returned without calling endRun. Runs every minute; cheap O(n).
const STALE_RUN_MS = 60 * 60_000; // 1 hour idle = abandoned
setInterval(() => {
  const now = Date.now();
  for (const [runId, h] of activeRuns) {
    if (h.status === "running" && now - h.lastActivityAt > STALE_RUN_MS) {
      console.warn(`[step-ledger] sweeping stale run ${runId} (idle ${Math.round((now - h.lastActivityAt) / 60000)}min, task: ${h.task.slice(0, 60)})`);
      h.status = "failed";
      h.finalAnswer = "abandoned (stale-run sweeper)";
      h.endedAt = now;
      ledgerEvents.emit("run:end", h);
      setTimeout(() => disposeRun(runId), 5 * 60_000);
    }
  }
}, 60_000).unref();

export function getActiveRuns(tenantId?: number): RunHandle[] {
  const all = Array.from(activeRuns.values());
  return tenantId ? all.filter((r) => r.tenantId === tenantId) : all;
}

export function getRun(runId: string): RunHandle | undefined {
  return activeRuns.get(runId);
}

async function persistEntry(entry: LedgerEntry): Promise<void> {
  try {
    // Gate-1 storage-boundary redaction: this is a DIRECT agent_knowledge insert
    // that bypasses storage.createKnowledge(), and the serialized ledger entry
    // can carry tool args/outputs with secrets/PII. Redact the OBJECT (not the
    // stringified text) so the persisted JSON stays valid on readback.
    const g = redactObjectForStorage(entry);
    if (g.redactedClasses.length > 0) {
      console.info(`[pii-guard] step-ledger redacted classes: ${g.redactedClasses.join(",")}`);
    }
    await db.insert(agentKnowledge).values({
      title: `step:${entry.runId}:${String(entry.seq).padStart(6, "0")}:${entry.kind}`,
      content: JSON.stringify(g.redacted),
      category: LEDGER_CATEGORY,
      priority: 3,
      personaId: entry.personaId ?? null,
      tenantId: entry.tenantId,
      source: LEDGER_SOURCE,
    } as any);
  } catch (e: any) {
    console.error("[step-ledger] persist failed:", e?.message || e);
  }
}

async function record(runId: string, kind: LedgerKind, payload: any, opts?: { tenantId?: number; personaId?: number }): Promise<LedgerEntry | null> {
  const h = activeRuns.get(runId);
  const tenantId = h?.tenantId ?? opts?.tenantId;
  if (!tenantId) {
    console.warn("[step-ledger] record skipped — no tenantId for run", runId);
    return null;
  }
  const entry: LedgerEntry = {
    runId,
    seq: nextSeq(runId),
    kind,
    timestamp: Date.now(),
    tenantId,
    personaId: opts?.personaId ?? h?.personaId,
    payload,
  };
  if (h) {
    h.lastActivityAt = entry.timestamp;
    if (kind === "intent") h.counters.intents++;
    if (kind === "proposal") h.counters.proposals++;
    if (kind === "execution") {
      h.counters.executions++;
      if (payload?.error) h.counters.failures++;
      else h.counters.commits++;
      h.activeTool = payload?.tool;
    }
    if (kind === "result" && payload?.rejected) h.counters.rejections++;
  }
  ledgerEvents.emit("entry", entry);
  ledgerEvents.emit(`run:${runId}`, entry);
  await persistEntry(entry);
  return entry;
}

export const recordIntent = (runId: string, payload: any, opts?: { tenantId?: number; personaId?: number }) =>
  record(runId, "intent", payload, opts);
export const recordProposal = (runId: string, payload: any, opts?: { tenantId?: number; personaId?: number }) =>
  record(runId, "proposal", payload, opts);
export const recordExecution = (runId: string, payload: any, opts?: { tenantId?: number; personaId?: number }) =>
  record(runId, "execution", payload, opts);
export const recordResult = (runId: string, payload: any, opts?: { tenantId?: number; personaId?: number }) =>
  record(runId, "result", payload, opts);
export const recordApproval = (runId: string, payload: any, opts?: { tenantId?: number; personaId?: number }) =>
  record(runId, "approval", payload, opts);
export const recordNote = (runId: string, payload: any, opts?: { tenantId?: number; personaId?: number }) =>
  record(runId, "note", payload, opts);

export async function getLedger(runId: string, tenantId: number): Promise<LedgerEntry[]> {
  const rows = await db
    .select()
    .from(agentKnowledge)
    .where(
      and(
        eq(agentKnowledge.category, LEDGER_CATEGORY),
        eq(agentKnowledge.tenantId, tenantId),
        like(agentKnowledge.title, `step:${runId}:%`),
      ),
    )
    .orderBy(asc(agentKnowledge.title));
  const entries: LedgerEntry[] = [];
  for (const r of rows as any[]) {
    try {
      entries.push(JSON.parse(r.content));
    } catch (_silentErr) { logSilentCatch("server/step-ledger.ts", _silentErr); }
  }
  return entries;
}

export async function getWorldAt(runId: string, tenantId: number, seq: number): Promise<{
  runId: string;
  seq: number;
  entries: LedgerEntry[];
  filesTouched: string[];
  toolsInvoked: Record<string, number>;
  errors: number;
  lastIntent?: any;
  lastResult?: any;
}> {
  const all = await getLedger(runId, tenantId);
  const upTo = all.filter((e) => e.seq <= seq);
  const filesTouched = new Set<string>();
  const toolsInvoked: Record<string, number> = {};
  let errors = 0;
  let lastIntent: any;
  let lastResult: any;
  for (const e of upTo) {
    if (e.kind === "execution") {
      const tool = e.payload?.tool;
      if (tool) toolsInvoked[tool] = (toolsInvoked[tool] || 0) + 1;
      const path = e.payload?.params?.path || e.payload?.params?.file_path || e.payload?.params?.filePath;
      if (typeof path === "string") filesTouched.add(path);
      if (e.payload?.error) errors++;
    }
    if (e.kind === "intent") lastIntent = e.payload;
    if (e.kind === "result") lastResult = e.payload;
  }
  return {
    runId,
    seq,
    entries: upTo,
    filesTouched: Array.from(filesTouched),
    toolsInvoked,
    errors,
    lastIntent,
    lastResult,
  };
}

// withRun: wraps an async function so executeTool calls inside it auto-attach
// to the run via AsyncLocalStorage. Marks the run completed/failed on exit.
export async function withRun<T>(
  opts: { tenantId: number; personaId?: number; task: string },
  fn: (handle: RunHandle) => Promise<T>,
): Promise<T> {
  const handle = startRun(opts);
  await recordIntent(handle.runId, { task: opts.task, source: "withRun" });
  try {
    return await runContext.run(handle, async () => {
      const out = await fn(handle);
      endRun(handle.runId, { status: "completed" });
      return out;
    });
  } catch (e: any) {
    endRun(handle.runId, { status: "failed", finalAnswer: String(e?.message || e).slice(0, 400) });
    throw e;
  }
}

export async function autoRecordToolCall(opts: {
  runId?: string;
  tenantId?: number;
  personaId?: number;
  toolName: string;
  params: Record<string, any>;
  result: any;
  durationMs: number;
}) {
  const { runId, toolName, params, result, durationMs, tenantId, personaId } = opts;
  if (!runId) return;
  const safeParams: Record<string, any> = {};
  for (const [k, v] of Object.entries(params)) {
    if (k.startsWith("_")) continue;
    if (typeof v === "string" && v.length > 500) safeParams[k] = v.slice(0, 500) + "…";
    else safeParams[k] = v;
  }
  const ok = !(result && typeof result === "object" && (result as any).error);
  await recordProposal(runId, { tool: toolName, params: safeParams }, { tenantId, personaId });
  await recordExecution(
    runId,
    {
      tool: toolName,
      params: safeParams,
      ok,
      error: ok ? undefined : String((result as any)?.error || "").slice(0, 400),
      durationMs,
      summary: typeof result === "string" ? result.slice(0, 300) : undefined,
    },
    { tenantId, personaId },
  );
}
