export type DrivePermission = {
  id?: string;
  type?: string;
  role?: string;
  deleted?: boolean;
  permissionDetails?: Array<{
    inherited?: boolean;
    inheritedFrom?: string;
    role?: string;
    permissionType?: string;
  }>;
};

export type DriveFileSummary = {
  id?: string;
  name?: string;
  ownedByMe?: boolean;
};

export function driveErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  if (error && typeof error === "object" && "message" in error) {
    return String(error.message);
  }
  return String(error);
}