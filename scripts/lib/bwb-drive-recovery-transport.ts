import { createHash } from "node:crypto";
import path from "node:path";
import type { RecoveryTransport } from "./bwb-drive-recovery";

export function recoveryArtifactKey(identity: string): string {
  return `artifact:${createHash("sha256").update(identity).digest("hex")}`;
}

/** Internal BWB owner service only. Never use platform Drive for customer tenants. */
export async function createOwnerRecoveryTransport(videoId: string): Promise<RecoveryTransport> {
  const { uploadToDrive, getAccessToken, readDriveFileBytes } = await import("../../server/google-drive");
  const { withTenantContext } = await import("../../server/lib/tenant-context");
  const digest = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
  async function verify(remote: { fileId: string; folderId: string }, bytes: Buffer) {
    if (!/^[a-zA-Z0-9_-]{10,}$/.test(remote.fileId)) throw new Error("Invalid recovery Drive identity");
    const token = await getAccessToken();
    const response = await fetch(
      `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(remote.fileId)}?fields=id,size,trashed,ownedByMe,parents,permissions(type,role,deleted)`,
      { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(30_000), redirect: "error" },
    );
    if (!response.ok) throw new Error(`Recovery metadata verification failed: HTTP ${response.status}`);
    const metadata = await response.json();
    assertPrivateRecoveryMetadata(metadata, remote.folderId, bytes.length);
    const downloaded = await readDriveFileBytes(remote.fileId);
    if (downloaded.length !== bytes.length || digest(downloaded) !== digest(bytes)) {
      throw new Error("Drive recovery content verification failed");
    }
  }
  let folder: Promise<string> | undefined;
  async function getFolder() {
    if (!folder) {
      folder = withTenantContext(1, async () => {
        const bytes = Buffer.from(JSON.stringify({ version: 1, videoId, purpose: "Private BWB recovery" }));
        const seed = await uploadToDrive({
          fileData: bytes, fileName: "RECOVERY-START.json", mimeType: "application/json",
          folderLabel: `BWB Recovery ${videoId}`, share: false, customerDelivery: true,
          durableArtifactKey: recoveryArtifactKey(`bwb-recovery-folder-v1:${videoId}`),
        });
        if (!seed.success || !seed.fileId || !seed.customerFolderId) {
          throw new Error(`Could not establish private BWB recovery folder: ${seed.error?.slice(0, 200) || "missing upload identity"}`);
        }
        await verify({ fileId: seed.fileId, folderId: seed.customerFolderId }, bytes);
        return seed.customerFolderId;
      }).catch(error => { folder = undefined; throw error; });
    }
    return folder;
  }
  return {
    async put(name, bytes, key) {
      return withTenantContext(1, async () => {
        const folderId = await getFolder();
        const result = await uploadToDrive({
          fileData: bytes,
          fileName: `${createHash("sha256").update(name).digest("hex").slice(0, 12)}-${path.posix.basename(name)}`,
          mimeType: "application/octet-stream", share: false, customerDelivery: true,
          parentFolderId: folderId, skipSubfolder: true, durableArtifactKey: recoveryArtifactKey(key),
          description: `BWB recovery: ${name}`,
        });
        if (!result.success || !result.fileId || result.customerFolderId !== folderId) {
          throw new Error("BWB recovery upload unconfirmed; local work retained, next stage paused");
        }
        return { fileId: result.fileId, folderId };
      });
    },
    verify: (receipt, bytes) => withTenantContext(1, () => verify(receipt, bytes)),
  };
}

export function assertPrivateRecoveryMetadata(metadata: {
  ownedByMe?: boolean; trashed?: boolean; size?: string;
  parents?: string[]; permissions?: { type?: string; role?: string; deleted?: boolean }[];
}, folderId: string, size: number) {
  if (metadata.trashed || metadata.ownedByMe !== true || Number(metadata.size) !== size ||
      !metadata.parents?.includes(folderId) || !Array.isArray(metadata.permissions) ||
      !metadata.permissions.length || metadata.permissions.some(p => !p.deleted && (p.type !== "user" || p.role !== "owner"))) {
    throw new Error("BWB recovery file is missing, incomplete or not owner-private");
  }
}
