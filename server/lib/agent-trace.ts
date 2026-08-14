// R101 — Causality graphs.
//
// Unified telemetry layer that ties every tool call, LLM call, delegate,
// and subagent dispatch back to its originating user turn. Solves the
// "Bob got a wrong answer at 3:47pm — which tools led there?" question
// that previously required manual log-stitching across chat_messages,
// decline_events, llm_usage, and tool_performance.
//
// Design:
//   - traceId is set ONCE per user-facing entrypoint (chat root, scheduled
//     job, cron fire). All downstream awaits inherit it via AsyncLocalStorage.
//   - Each `withSpan(kind, name, fn)` opens a child span with the current
//     span as parent, runs fn, closes the span (records ended_at + status).
//   - Errors auto-capture status='error' + summary=err.message, then re-throw.
//   - Persistence is fire-and-forget — telemetry never blocks dispatch.
//   - Tenant-scoped: every span row carries tenantId from currentTenantId();
//     spans without tenant context are dropped (logged loudly).

import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { db } from "../db";
import { currentTenantId } from "./tenant-context";
import { logSilentCatch } from "./silent-catch";

export type SpanKind = "chat" | "tool" | "llm" | "delegate" | "subagent";
export type SpanStatus = "ok" | "error" | "declined";

interface SpanContext {
  traceId: string;
  spanId: string;
  agentName?: string;
}

const spanStorage = new AsyncLocalStorage<SpanContext>();

export function currentTraceId(): string | null {
  return spanStorage.getStore()?.traceId ?? null;
}
export function currentSpanId(): string | null {
  return spanStorage.getStore()?.spanId ?? null;
}
export function currentAgentName(): string | null {
  return spanStorage.getStore()?.agentName ?? null;
}

interface OpenSpanOptions {
  kind: SpanKind;
  agentName?: string;
  toolName?: string;
  summary?: string;
  metadata?: Record<string, unknown>;
}

// R101 +arch1 — Span persistence is fire-and-forget by design. The trace
// tree is reconstructable from in-process ALS state (parent_span_id lives
// in the SpanContext, NOT in the DB row), so neither open nor close needs
// to block the hot path. Both writes are dispatched via setImmediate and
// any error is logged but never propagated back to the caller.
//
// Ordering: every span's CLOSE awaits its own OPEN promise so the UPDATE
// never races ahead of the INSERT. The map auto-cleans on close to avoid
// unbounded growth — span ids are uuids, so collisions are not a concern.
const _openPromises = new Map<string, Promise<unknown>>();
// Track every in-flight DB write so test flush can drain them all. In
// production this set is constant-bounded (entries removed on settle) and
// the bookkeeping cost is a single Set add/delete per span — negligible
// versus the actual DB roundtrip.
const _inflightWrites = new Set<Promise<unknown>>();
function _track<T>(p: Promise<T>): Promise<T> {
  _inflightWrites.add(p);
  // Bookkeeping side-channel — must not produce its own unhandled rejection
  // when p rejects. The original p is returned to the caller for normal
  // .catch handling.
  p.then(
    () => _inflightWrites.delete(p),
    () => _inflightWrites.delete(p),
  );
  return p;
}

function persistSpanOpen(
  tenantId: number,
  ctx: SpanContext,
  parentSpanId: string | null,
  opts: OpenSpanOptions,
): void {
  const p = new Promise<void>((resolve) => {
    setImmediate(() => {
      _track(
        db.execute(sql`
          INSERT INTO agent_trace_spans
            (tenant_id, trace_id, span_id, parent_span_id, kind, agent_name, tool_name, summary, metadata)
          VALUES (
            ${tenantId},
            ${ctx.traceId},
            ${ctx.spanId},
            ${parentSpanId},
            ${opts.kind},
            ${opts.agentName ?? null},
            ${opts.toolName ?? null},
            ${opts.summary ?? null},
            ${opts.metadata ? JSON.stringify(opts.metadata) : null}::jsonb
          )
        `),
      )
        .catch((e: any) => logSilentCatch("server/lib/agent-trace.ts (open)", e))
        .finally(() => resolve());
    });
  });
  _openPromises.set(ctx.spanId, p);
}

function persistSpanClose(
  spanId: string,
  status: SpanStatus,
  summary?: string,
): void {
  const openP = _openPromises.get(spanId) ?? Promise.resolve();
  const closeP = new Promise<void>((resolve) => {
    setImmediate(() => {
      openP
        .then(() =>
          db.execute(sql`
            UPDATE agent_trace_spans
               SET ended_at = NOW(),
                   status = ${status},
                   summary = COALESCE(${summary ?? null}, summary)
             WHERE span_id = ${spanId}
          `),
        )
        .catch((e: any) => logSilentCatch("server/lib/agent-trace.ts (close)", e))
        .finally(() => {
          _openPromises.delete(spanId);
          resolve();
        });
    });
  });
  _track(closeP);
}

// Test helper — flush pending span writes by waiting one event-loop tick
// for setImmediate callbacks to drain, then await a no-op DB query so any
// in-flight INSERTs/UPDATEs settle. Tests that read back trace state need
// to call this between the act-phase and the assert-phase.
export async function _flushTracesForTests(): Promise<void> {
  // Drain pending setImmediates → opens fire → closes get scheduled → drain
  // again → close UPDATEs fire → await all tracked DB writes to settle.
  for (let i = 0; i < 4; i++) {
    await new Promise<void>((resolve) => setImmediate(resolve));
    await Promise.allSettled(Array.from(_inflightWrites));
  }
  await db.execute(sql`SELECT 1`);
}

/**
 * Open a root span (a new trace). Use at user-facing entrypoints — chat
 * route, scheduled job runner, cron fire. Returns the trace + span ids.
 */
export async function withRootSpan<T>(
  opts: { agentName?: string; summary?: string; metadata?: Record<string, unknown> },
  fn: (traceId: string) => Promise<T>,
): Promise<T> {
  const tenantId = currentTenantId();
  if (!tenantId) {
    // No tenant context — telemetry off but execute the work.
    console.warn("[agent-trace] root span requested without tenant context — running untracked");
    return fn(randomUUID());
  }
  const traceId = randomUUID();
  const spanId = randomUUID();
  const ctx: SpanContext = { traceId, spanId, agentName: opts.agentName };
  persistSpanOpen(tenantId, ctx, null, { kind: "chat", agentName: opts.agentName, summary: opts.summary, metadata: opts.metadata });

  return spanStorage.run(ctx, async () => {
    try {
      const out = await fn(traceId);
      persistSpanClose(spanId, "ok");
      return out;
    } catch (e: any) {
      persistSpanClose(spanId, "error", e?.message?.slice(0, 500));
      throw e;
    }
  });
}

/**
 * Open a child span under the current trace. No-op (just runs fn) if there
 * is no active trace context — this keeps callsites cheap to add without
 * forcing every code path to be traced.
 */
export async function withSpan<T>(
  opts: OpenSpanOptions,
  fn: () => Promise<T>,
): Promise<T> {
  const parent = spanStorage.getStore();
  if (!parent) return fn(); // no-op when untraced
  const tenantId = currentTenantId();
  if (!tenantId) return fn();

  const spanId = randomUUID();
  const ctx: SpanContext = { traceId: parent.traceId, spanId, agentName: opts.agentName ?? parent.agentName };
  persistSpanOpen(tenantId, ctx, parent.spanId, opts);

  return spanStorage.run(ctx, async () => {
    try {
      const out = await fn();
      // Inspect the result for an "error" envelope (tool dispatch convention)
      // and tag the span as declined when present so the trace surfaces it.
      let status: SpanStatus = "ok";
      let summary: string | undefined;
      if (out && typeof out === "object") {
        const errMsg = (out as any).error;
        if (errMsg) {
          status = String(errMsg).toLowerCase().includes("declin") || String(errMsg).toLowerCase().includes("polic") ? "declined" : "error";
          summary = String(errMsg).slice(0, 500);
        }
      }
      persistSpanClose(spanId, status, summary);
      return out;
    } catch (e: any) {
      persistSpanClose(spanId, "error", e?.message?.slice(0, 500));
      throw e;
    }
  });
}

/**
 * Like withSpan, but opens an implicit root span when no trace context exists.
 * Use at integration points where you'd like every call traced regardless of
 * whether the caller already opened a trace (e.g., executeTool dispatch).
 * The implicit root keeps the kind passed by the caller (so a tool call
 * without an upstream chat trace still appears as kind="tool", not kind="chat",
 * and the trace is still queryable by traceId from the result __trace).
 */
export async function withSpanOrRoot<T>(
  opts: OpenSpanOptions,
  fn: () => Promise<T>,
): Promise<T & { __traceId?: string } | T> {
  const tenantId = currentTenantId();
  if (!tenantId) return fn(); // no tenant → no telemetry, just run
  const parent = spanStorage.getStore();
  if (parent) return withSpan(opts, fn);

  const traceId = randomUUID();
  const spanId = randomUUID();
  const ctx: SpanContext = { traceId, spanId, agentName: opts.agentName };
  persistSpanOpen(tenantId, ctx, null, opts);

  return spanStorage.run(ctx, async () => {
    try {
      const out = await fn();
      let status: SpanStatus = "ok";
      let summary: string | undefined;
      if (out && typeof out === "object") {
        const errMsg = (out as any).error;
        if (errMsg) {
          status = String(errMsg).toLowerCase().includes("declin") || String(errMsg).toLowerCase().includes("polic") ? "declined" : "error";
          summary = String(errMsg).slice(0, 500);
        }
      }
      persistSpanClose(spanId, status, summary);
      // Surface the traceId so the caller can hand it to query_trace.
      if (out && typeof out === "object" && !Array.isArray(out)) {
        try { (out as any).__trace = { traceId, spanId }; } catch (_e) { logSilentCatch("server/lib/agent-trace.ts", _e); }
      }
      return out as any;
    } catch (e: any) {
      persistSpanClose(spanId, "error", e?.message?.slice(0, 500));
      throw e;
    }
  });
}

/**
 * Fetch the full span tree for a trace. Tenant-scoped — caller MUST pass
 * the requesting tenantId; the query never crosses tenants.
 */
export async function fetchTraceTree(
  tenantId: number,
  traceId: string,
): Promise<{ traceId: string; spans: any[]; tree: any }> {
  const r: any = await db.execute(sql`
    SELECT id, span_id, parent_span_id, kind, agent_name, tool_name,
           started_at, ended_at, status, summary, metadata
      FROM agent_trace_spans
     WHERE tenant_id = ${tenantId}
       AND trace_id = ${traceId}
     ORDER BY started_at ASC, id ASC
  `);
  const spans: any[] = (r.rows || r).map((row: any) => ({
    spanId: row.span_id,
    parentSpanId: row.parent_span_id,
    kind: row.kind,
    agentName: row.agent_name,
    toolName: row.tool_name,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    durationMs: row.ended_at ? new Date(row.ended_at).getTime() - new Date(row.started_at).getTime() : null,
    status: row.status,
    summary: row.summary,
    metadata: row.metadata,
  }));

  // Build the tree from the flat list.
  const byId = new Map<string, any>();
  for (const s of spans) byId.set(s.spanId, { ...s, children: [] });
  let root: any = null;
  for (const s of spans) {
    const node = byId.get(s.spanId);
    if (!s.parentSpanId) {
      if (!root) root = node;
      continue;
    }
    const parent = byId.get(s.parentSpanId);
    if (parent) parent.children.push(node);
    else if (!root) root = node; // orphan — treat as root
  }

  return { traceId, spans, tree: root };
}
