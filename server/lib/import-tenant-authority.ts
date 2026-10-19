/** Full-system restore is platform-admin only; do not collapse customer rows
 * into the owner's tenant, or trust an unvalidated destination in a file. */
export function resolveImportedTenant(
  sourceTenant: unknown, legacyOwnerTenant: number, authorizedTenants: ReadonlySet<number>,
): number {
  const tenant = sourceTenant === undefined ? legacyOwnerTenant : sourceTenant;
  if (typeof tenant !== "number" || !Number.isSafeInteger(tenant) || tenant <= 0 ||
      !authorizedTenants.has(tenant)) throw new Error("Import destination is not an existing authorized tenant");
  return tenant;
}

export function resolveImportedPersona(
  sourceId: unknown, declaredSourceIds: ReadonlySet<number>,
  restoredIds: ReadonlyMap<number, number>, existingIds: ReadonlySet<number>,
): number | null {
  if (sourceId === undefined || sourceId === null) return null;
  if (typeof sourceId !== "number" || !Number.isSafeInteger(sourceId) || sourceId <= 0)
    throw new Error("Invalid imported persona reference");
  if (declaredSourceIds.has(sourceId)) {
    const restored = restoredIds.get(sourceId);
    if (!restored) throw new Error("Referenced imported persona was not restored");
    return restored;
  }
  if (!existingIds.has(sourceId)) throw new Error("Referenced persona does not exist");
  return sourceId;
}
