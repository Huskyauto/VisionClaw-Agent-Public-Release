/** `share:false` only skips a new grant; it says nothing about inherited access. */
export async function assertOwnerOnlyDriveAccess(
  fileId: string,
  readPermissions: (id: string) => Promise<unknown>,
): Promise<void> {
  const permissions = await readPermissions(fileId);
  if (!Array.isArray(permissions) || permissions.length === 0
    || !permissions.every((p) => p && p.deleted !== true && p.type === "user" && p.role === "owner"
      && (p.permissionDetails === undefined
        || (Array.isArray(p.permissionDetails)
          && p.permissionDetails.every((d: any) => d?.role === "owner"))))) {
    throw new Error("Confidential backup requires verified owner-only Drive access");
  }
}
