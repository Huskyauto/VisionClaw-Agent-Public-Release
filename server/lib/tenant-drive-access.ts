import path from "node:path";

export type DriveAccessMetadata = {
  id: string;
  name?: string;
  mimeType?: string;
  parents?: string[];
  trashed?: boolean;
  error?: unknown;
};
export const ADMIN_DRIVE_ARTIFACT_RE = /^__(admin[-_]|VisionClaw-Admin[-_])/i;
const DRIVE_ID_RE = /^[A-Za-z0-9_-]{1,180}$/;

export function assertDriveTenant(tenantId: unknown): asserts tenantId is number {
  if (!Number.isSafeInteger(tenantId) || Number(tenantId) <= 0) throw new Error("Drive requires a valid trusted tenant");
}

export function driveParentQuery(roots: readonly string[]): string {
  if (!roots.length || roots.length > 256 || roots.some(id => !DRIVE_ID_RE.test(id))) {
    throw new Error("Drive tenant folders are unavailable");
  }
  return `(${roots.map(id => `'${id}' in parents`).join(" or ")})`;
}

/** Folder IDs must come from server-managed tenant/project records, never tool arguments. */
export async function authorizeTenantDriveFile(
  tenantId: unknown,
  fileId: unknown,
  deps: {
    getRoots: (tenantId: number) => Promise<string[]>;
    readMetadata: (id: string) => Promise<DriveAccessMetadata>;
  },
): Promise<DriveAccessMetadata> {
  assertDriveTenant(tenantId);
  if (typeof fileId !== "string" || !DRIVE_ID_RE.test(fileId)) throw new Error("Invalid Drive file ID");
  let expired = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const check = async () => {
    const roots = await deps.getRoots(tenantId);
    driveParentQuery(roots);
    const owned = new Set(roots);
    const seen = new Set<string>();
    const queue = [{ id: fileId, depth: 0 }];
    let subject: DriveAccessMetadata | undefined;
    while (queue.length) {
      if (expired) throw new Error("Drive ownership verification timed out");
      const node = queue.shift()!;
      if (seen.has(node.id)) continue;
      if (seen.size >= 16 || node.depth > 8) throw new Error("Drive ownership could not be verified within limits");
      seen.add(node.id);
      const meta = await deps.readMetadata(node.id);
      if (expired) throw new Error("Drive ownership verification timed out");
      if (meta?.id !== node.id || typeof meta.name !== "string" || !meta.name.trim() || meta.error || meta.trashed ||
          ADMIN_DRIVE_ARTIFACT_RE.test(meta.name) || meta.mimeType === "application/vnd.google-apps.shortcut") {
        throw new Error("Drive file metadata is unavailable or restricted");
      }
      subject ||= meta;
      if (owned.has(node.id)) return subject;
      if (!Array.isArray(meta.parents) || meta.parents.some(id => !DRIVE_ID_RE.test(id))) {
        throw new Error("Drive file ownership is unavailable");
      }
      for (const parent of meta.parents) queue.push({ id: parent, depth: node.depth + 1 });
    }
    throw new Error("Drive file is not authorized for this tenant");
  };
  try {
    return await Promise.race([
      check(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => { expired = true; reject(new Error("Drive ownership verification timed out")); }, 8_000);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** Each tenant has a private destination namespace; file writes must use exclusive-create. */
export function tenantDriveDownloadPath(uploadsRoot: string, tenantId: unknown, fileName: string, requested?: string): string {
  assertDriveTenant(tenantId);
  const base = path.resolve(uploadsRoot, "tenant-drive", String(tenantId));
  const defaultName = path.basename(fileName).replace(/[^A-Za-z0-9._-]/g, "_");
  const value = requested || defaultName;
  if (!value || value === "." || value === ".." || value.includes("\0")) throw new Error("Invalid Drive download filename");
  const prefix = `uploads/tenant-drive/${tenantId}/`;
  const relative = value.startsWith(prefix) ? value.slice(prefix.length) : value;
  if (relative.startsWith(".") || relative.includes("/") || relative.includes("\\") || path.isAbsolute(relative)) {
    throw new Error(`Drive downloads must use a filename within ${prefix}`);
  }
  const result = path.resolve(base, relative);
  if (path.dirname(result) !== base) throw new Error("Unsafe Drive download destination");
  return result;
}