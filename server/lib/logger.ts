// Structured, correlation-aware logging spine.
//
// WHY: the platform already has a full causality-graph tracing layer
// (./agent-trace.ts) that propagates traceId/spanId/agentName through every
// async hop via AsyncLocalStorage, plus tenant scoping (./tenant-context.ts).
// What was missing was a *log* surface that emits those identifiers, so a log
// line can be correlated back to a trace, span, tenant, and HTTP request.
// This module bridges that existing context into log output. It adds NO new
// runtime dependency (native async_hooks + crypto) and is purely additive —
// existing console.* / log() callsites keep working untouched; new/adopting
// code can call `logger.*` to get correlated structured output.
//
// DESIGN INVARIANTS:
//   - NEVER throws. Any failure inside the logger falls back to a bare
//     console.log and is swallowed — logging must not be able to break a
//     request or an autonomous loop.
//   - Reading trace/tenant context is best-effort and individually guarded;
//     an absent or erroring context just omits that field.
//   - Production (isProductionRuntime) emits one JSON object per line for
//     machine ingestion; dev emits a compact human-readable line.
//   - LOG_LEVEL (debug|info|warn|error, default "info") gates output.

import { AsyncLocalStorage } from "node:async_hooks";
import { logSilentCatch } from "./silent-catch";
import { randomUUID } from "node:crypto";
import { currentTraceId, currentSpanId, currentAgentName } from "./agent-trace";
import { currentTenantId } from "./tenant-context";
import { isProductionRuntime } from "./runtime-env";

export type LogLevel = "debug" | "info" | "warn" | "error";

const LEVEL_RANK: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

function thresholdRank(): number {
  const raw = (process.env.LOG_LEVEL || "info").toLowerCase();
  return LEVEL_RANK[(raw as LogLevel)] ?? LEVEL_RANK.info;
}

// --- Per-HTTP-request correlation id -------------------------------------
// The agent/trace ALS only exists for traced entrypoints (chat root, cron,
// scheduled job). Plain HTTP requests get their own lightweight requestId so
// the access log + any downstream work can be correlated to a single call.
const requestStore = new AsyncLocalStorage<{ requestId: string }>();

export function newRequestId(): string {
  try {
    return randomUUID();
  } catch {
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  }
}

/**
 * Normalize a caller-supplied request id (e.g. an inbound `x-request-id`
 * header) to a safe, bounded token. Keeps only RFC-friendly characters
 * (`A-Za-z0-9._:-`), strips everything else (incl. CR/LF — header & log
 * injection vectors), and caps length. Returns null when nothing usable
 * remains, signalling the caller to generate a fresh id instead. Never throws.
 */
export function sanitizeRequestId(raw: unknown): string | null {
  try {
    if (typeof raw !== "string") return null;
    const cleaned = raw.replace(/[^A-Za-z0-9._:-]/g, "").slice(0, 200);
    return cleaned.length > 0 ? cleaned : null;
  } catch {
    return null;
  }
}

export function runWithRequestId<T>(requestId: string, fn: () => T): T {
  return requestStore.run({ requestId }, fn);
}

export function currentRequestId(): string | null {
  try {
    return requestStore.getStore()?.requestId ?? null;
  } catch {
    return null;
  }
}

// --- Context gathering (best-effort, never throws) ------------------------
export interface LogContext {
  requestId?: string;
  traceId?: string;
  spanId?: string;
  tenantId?: number;
  agent?: string;
}

export function gatherContext(): LogContext {
  const ctx: LogContext = {};
  try {
    const r = currentRequestId();
    if (r) ctx.requestId = r;
  } catch (_silentErr) { logSilentCatch("server/lib/logger.ts", _silentErr); }
  try {
    const tr = currentTraceId();
    if (tr) ctx.traceId = tr;
  } catch (_silentErr) { logSilentCatch("server/lib/logger.ts", _silentErr); }
  try {
    const sp = currentSpanId();
    if (sp) ctx.spanId = sp;
  } catch (_silentErr) { logSilentCatch("server/lib/logger.ts", _silentErr); }
  try {
    const ag = currentAgentName();
    if (ag) ctx.agent = ag;
  } catch (_silentErr) { logSilentCatch("server/lib/logger.ts", _silentErr); }
  try {
    const tn = currentTenantId();
    if (tn != null) ctx.tenantId = tn;
  } catch (_silentErr) { logSilentCatch("server/lib/logger.ts", _silentErr); }
  return ctx;
}

/**
 * Compact `{req=… trace=… t=…}` suffix for human-readable lines. Returns an
 * empty string when there is no active context, so existing log formats are
 * unchanged when nothing is correlated. Never throws.
 */
export function contextTag(): string {
  try {
    const c = gatherContext();
    const parts: string[] = [];
    if (c.requestId) parts.push(`req=${c.requestId.slice(0, 8)}`);
    if (c.traceId) parts.push(`trace=${c.traceId.slice(0, 8)}`);
    if (c.tenantId != null) parts.push(`t=${c.tenantId}`);
    if (c.agent) parts.push(`agent=${c.agent}`);
    return parts.length ? ` {${parts.join(" ")}}` : "";
  } catch {
    return "";
  }
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    try {
      return String(value);
    } catch {
      return "[unserializable]";
    }
  }
}

function prettyTime(): string {
  try {
    return new Date().toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
      second: "2-digit",
      hour12: true,
    });
  } catch {
    return new Date().toISOString();
  }
}

function emit(level: LogLevel, msg: string, fields?: Record<string, unknown>): void {
  try {
    if (LEVEL_RANK[level] < thresholdRank()) return;
    const ctx = gatherContext();
    const hasFields = fields && Object.keys(fields).length > 0;

    if (isProductionRuntime()) {
      const record: Record<string, unknown> = {
        t: new Date().toISOString(),
        level,
        msg,
        ...ctx,
        ...(hasFields ? { fields } : {}),
      };
      const line = safeStringify(record);
      if (level === "error" || level === "warn") console.error(line);
      else console.log(line);
      return;
    }

    // Dev: compact, human-readable, with a correlation suffix.
    const suffix = (() => {
      const parts: string[] = [];
      if (ctx.requestId) parts.push(`req=${ctx.requestId.slice(0, 8)}`);
      if (ctx.traceId) parts.push(`trace=${ctx.traceId.slice(0, 8)}`);
      if (ctx.tenantId != null) parts.push(`t=${ctx.tenantId}`);
      if (ctx.agent) parts.push(`agent=${ctx.agent}`);
      return parts.length ? ` {${parts.join(" ")}}` : "";
    })();
    const extra = hasFields ? ` ${safeStringify(fields)}` : "";
    const out = `${prettyTime()} [${level}]${suffix} ${msg}${extra}`;
    if (level === "error" || level === "warn") console.error(out);
    else console.log(out);
  } catch {
    // Last-resort fallback — logging must never throw.
    try {
      console.log(`[logger-fallback] ${level} ${msg}`);
    } catch (_silentErr) { logSilentCatch("server/lib/logger.ts", _silentErr); }
  }
}

export const logger = {
  debug: (msg: string, fields?: Record<string, unknown>) => emit("debug", msg, fields),
  info: (msg: string, fields?: Record<string, unknown>) => emit("info", msg, fields),
  warn: (msg: string, fields?: Record<string, unknown>) => emit("warn", msg, fields),
  error: (msg: string, fields?: Record<string, unknown>) => emit("error", msg, fields),
};
