/**
 * Finding 1A — pure authorization-persona derivation for GUARDED plan-step tool
 * execution (see server/plan-executor.ts `runToolStep`).
 *
 * Kept in its own dependency-free module so this privilege-escalation-critical
 * derivation can be unit-tested without importing the executor's heavy
 * transitive graph (db / tools / …), which would otherwise open a pg pool and
 * hang the node:test process.
 *
 * The `plans` table has NO separate "invoker" column, so a plan's persisted
 * tenant_id IS its authorization tenant. Only the admin/owner tenant earns the
 * trusted "system" persona name; every other tenant resolves to `undefined` so
 * the AHB destructive-tool policy fails CLOSED on trusted-only /
 * approval-required / owner-only tools.
 */
export function resolvePlanStepPolicyPersona(
  authTenant: number,
  adminTenantId: number,
): "system" | undefined {
  return authTenant === adminTenantId ? "system" : undefined;
}
