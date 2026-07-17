// ─────────────────────────────────────────────────────────────────────────────
// R94 SECURITY — AsyncLocalStorage tenant context
// ─────────────────────────────────────────────────────────────────────────────
// Propagates the authenticated tenantId through every async hop downstream
// of an Express request (or a background job), so that singleton clients
// (replitOpenai, createMeteredOpenAIClient cached instances) can attribute
// cost to the correct tenant WITHOUT every callsite having to thread
// `tenantId` as a parameter.
//
// Set at:
//   - server/auth.ts authMiddleware — wraps next() once per request
//   - server/job-worker.ts (background) — wraps each job handler
//   - explicit `withTenantContext(id, fn)` for cron / scheduled tasks
//
// Read at:
//   - server/providers.ts replitOpenai cost resolver
//   - server/providers.ts createMeteredOpenAIClient cost resolver
//
// Contract:
//   - currentTenantId() returns null if no context is active. Callers MUST
//     handle null deliberately (warn + fall back to ADMIN, or hard-fail).
//   - Never silently default to a numeric tenant — that's the bug we are
//     fixing across the codebase (Round 94 architect finding R1-#1).
// ─────────────────────────────────────────────────────────────────────────────

import { AsyncLocalStorage } from "async_hooks";

export interface TenantContext {
  tenantId: number;
  source: "api-key" | "session" | "replit-oidc" | "background-job" | "cron" | "explicit";
}

const tenantStorage = new AsyncLocalStorage<TenantContext>();

export function currentTenantId(): number | null {
  return tenantStorage.getStore()?.tenantId ?? null;
}

export function currentTenantContext(): TenantContext | null {
  return tenantStorage.getStore() ?? null;
}

export function withTenantContext<T>(
  ctx: TenantContext,
  fn: () => T,
): T {
  return tenantStorage.run(ctx, fn);
}

// Convenience wrapper for Express middleware: call `runWithTenant(id, src, next)`
// to set the context for the rest of the request chain. next() is invoked
// inside the AsyncLocalStorage scope so all downstream awaits inherit it.
export function runWithTenant(
  tenantId: number,
  source: TenantContext["source"],
  fn: () => void,
): void {
  tenantStorage.run({ tenantId, source }, fn);
}
