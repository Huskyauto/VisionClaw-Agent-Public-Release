// Tenant-signal integrity for capability-gap (unmet-capability) telemetry.
//
// Architect finding 2026-07-14: detectGap() defaulted a missing/invalid tenant
// context to tenant 1 (admin), misattributing demand telemetry into the admin
// tenant's Unmet Capabilities card. Unknown tenant → sentinel 0
// ("system/unattributed"), which is deliberately excluded from per-tenant
// dashboards (the ecosystem-health probe filters WHERE tenant_id = <tenant>).
// Fail-isolated, not closed: the miss is still recorded, just never billed to
// a real tenant. Pure module (no db import) so it stays unit-testable without
// opening a pg pool (memory lesson: node-test DB-pool hang).
export const GAP_TENANT_UNATTRIBUTED = 0;

export function coerceGapTenantId(tenantId: unknown): number {
  const n = Number(tenantId);
  return Number.isFinite(n) && Number.isInteger(n) && n > 0 ? n : GAP_TENANT_UNATTRIBUTED;
}
