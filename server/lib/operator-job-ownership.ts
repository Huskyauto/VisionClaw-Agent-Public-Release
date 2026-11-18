/** A random job ID and admin role do not substitute for an ownership binding. */
export function operatorJobMatchesTenant(job: { tenantId?: number } | undefined, tenantId: number): boolean {
  return Number.isSafeInteger(tenantId) && tenantId > 0 && job?.tenantId === tenantId;
}
