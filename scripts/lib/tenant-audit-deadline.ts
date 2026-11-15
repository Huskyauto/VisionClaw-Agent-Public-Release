import { AuditWorkDeferred } from "./tenant-audit-fallback";

export function auditDeadlineAt(value: string | undefined): number {
  if (value === undefined) return Infinity;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new Error("Invalid audit controller deadline");
  return parsed;
}
/** Leave enough room to persist a degraded report, never call this a provider outage. */
export function assertAuditTimeBudget(deadline: number, callMs: number, now = Date.now()): void {
  if (deadline - now < callMs + 15_000) throw new AuditWorkDeferred("Audit scheduling window exhausted; resume required");
}
