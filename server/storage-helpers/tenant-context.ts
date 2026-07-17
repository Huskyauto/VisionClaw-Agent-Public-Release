/**
 * R74.13g — STRICT_TENANT_CONTEXT runtime flag.
 *
 * Resolves a request/task tenantId, defending against the silent
 * `?? 1` fall-through that could leak one tenant's data into another's
 * step-ledger run, knowledge graph, trust events, or notifications.
 *
 * Two modes:
 *   - permissive (default): logs a rate-limited warning and returns
 *     ADMIN_TENANT_ID (1), preserving today's behavior for legacy callers.
 *   - strict (STRICT_TENANT_CONTEXT=true): throws. Use in CI and in prod
 *     once every call site is fixed.
 *
 * Caller pattern:
 *   const tenantId = assertTenantContext(conv.tenantId, "chat-engine:processMessage");
 *   // tenantId is now a known-good positive integer; reuse it everywhere.
 */

export const ADMIN_TENANT_ID = 1;

export function isStrictTenantContext(): boolean {
  return process.env.STRICT_TENANT_CONTEXT === "true";
}

const warnedSources = new Map<string, number>();
const WARN_INTERVAL_MS = 60_000;

function logFallback(sourceTag: string, raw: unknown) {
  const now = Date.now();
  const last = warnedSources.get(sourceTag) ?? 0;
  if (now - last < WARN_INTERVAL_MS) return;
  warnedSources.set(sourceTag, now);
  console.warn(
    `[tenant-context] Missing/invalid tenantId at "${sourceTag}" ` +
      `(raw=${JSON.stringify(raw)}); falling back to ADMIN_TENANT_ID. ` +
      `Set STRICT_TENANT_CONTEXT=true to make this throw.`,
  );
}

function isValidTenantId(v: unknown): v is number {
  return typeof v === "number" && Number.isInteger(v) && v > 0;
}

/**
 * Resolves a tenantId or returns ADMIN_TENANT_ID (1) under permissive mode.
 * Throws under strict mode (STRICT_TENANT_CONTEXT=true).
 *
 * `sourceTag` is a free-form string ("chat-engine:processMessage",
 * "heartbeat:executeTaskInner", etc.) used for log de-duplication so a
 * misbehaving caller can be located without flooding stderr.
 */
export function assertTenantContext(
  tenantId: number | null | undefined,
  sourceTag: string,
): number {
  if (isValidTenantId(tenantId)) return tenantId;
  if (isStrictTenantContext()) {
    throw new Error(
      `[assertTenantContext] STRICT_TENANT_CONTEXT=true and tenantId ` +
        `is missing/invalid at "${sourceTag}" (raw=${JSON.stringify(tenantId)}). ` +
        `Every call site must thread a positive-integer tenantId.`,
    );
  }
  logFallback(sourceTag, tenantId);
  return ADMIN_TENANT_ID;
}

/**
 * Test-only: clears the rate-limit cache so each test starts fresh.
 */
export function _resetTenantContextWarnings() {
  warnedSources.clear();
}
