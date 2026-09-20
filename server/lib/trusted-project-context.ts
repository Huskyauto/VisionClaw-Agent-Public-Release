export interface ResolvedProjectToolContext {
  projectId: number;
  driveFolderId?: string | null;
}

/**
 * Stamps only server-resolved project context onto a prepared tool call.
 * Any model-provided underscore fields have already been stripped by the
 * chat engine; overwriting here is defense-in-depth against future callsites.
 */
export function stampResolvedProjectToolContext(
  args: Record<string, unknown>,
  project: ResolvedProjectToolContext | null,
): void {
  if (!project || !Number.isInteger(project.projectId) || project.projectId <= 0) return;
  args._projectId = project.projectId;
  if (typeof project.driveFolderId === "string" && project.driveFolderId.trim()) {
    args._projectDriveFolderId = project.driveFolderId;
  }
}