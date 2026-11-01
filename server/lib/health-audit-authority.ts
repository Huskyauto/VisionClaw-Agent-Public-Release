import { ADMIN_TENANT_ID } from "../tenant-constants";

/** A task's approval is not authority to run platform-wide maintenance. */
export function assertHealthAuditOwner(tenantId: unknown): void {
  if (tenantId !== ADMIN_TENANT_ID) {
    throw new Error("Global health maintenance requires the platform owner tenant");
  }
}
