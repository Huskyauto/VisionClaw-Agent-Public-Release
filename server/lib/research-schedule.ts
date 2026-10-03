export async function validateScheduleProgramOwnership(
  tenantId: number | null,
  programId: number | null | undefined,
  lookupTenantId: (programId: number) => Promise<number | null>,
): Promise<boolean> {
  if (!Number.isInteger(tenantId) || tenantId! <= 0) return false;
  if (programId === null || programId === undefined) return true;
  if (!Number.isInteger(programId) || programId <= 0) return false;
  return (await lookupTenantId(programId)) === tenantId;
}