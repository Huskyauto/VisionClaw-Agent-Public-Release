/** `share:false` only skips a new grant; it says nothing about inherited access. */
export async function assertOwnerOnlyDriveAccess(
  fileId: string,
  readPermissions: (id: string) => Promise<unknown>,
): Promise<void> {
  const permissions = await readPermissions(fileId);
  if (!Array.isArray(permissions) || permissions.length === 0
    || !permissions.every((p) => {
      if (!p || p.deleted === true || p.type !== "user" || p.role !== "owner") return false;
      const details = p.permissionDetails;
      if (details === undefined) return true;
      if (!Array.isArray(details)) return false;
      if (details.every((d) => d?.role === "owner")) return true;
      // Details belong to THIS permission's principal. A direct owner
      // can also inherit lesser access without granting another user access.
      return details.some((d) => d?.role === "owner" && d.inherited === false)
        && details.every((d) => d && (
          (d.role === "owner" && d.inherited === false)
          || (d.inherited === true && ["reader", "commenter", "writer"].includes(d.role))
        ));
    })) {
    throw new Error("Confidential backup requires verified owner-only Drive access");
  }
}
