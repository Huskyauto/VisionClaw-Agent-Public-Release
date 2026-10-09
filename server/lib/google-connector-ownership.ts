/** Replit connections belong to the platform owner, not its customer tenants. */
export function isPlatformGoogleConnectorTenant(
  tenantId: unknown,
  configuredAdmin: string | undefined = process.env.ADMIN_TENANT_ID,
): boolean {
  const configured = configuredAdmin?.trim() || "1";
  if (!/^[1-9]\d*$/.test(configured)) return false;
  const adminId = Number(configured);
  return Number.isSafeInteger(adminId) && Number.isSafeInteger(tenantId)
    && tenantId === adminId;
}