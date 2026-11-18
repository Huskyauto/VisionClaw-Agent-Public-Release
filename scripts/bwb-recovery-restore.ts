/**
 * Restore a private recovery inventory without overwriting different work.
 * npx tsx scripts/bwb-recovery-restore.ts FOLDER_ID INVENTORY_FILE_ID
 * Select the newest RECOVERY-INVENTORY.json in the named Drive recovery folder.
 */
import { createHash } from "node:crypto";
import { restoreBwbRecovery, mergeRecoveryInventories } from "./lib/bwb-drive-recovery";
import { assertPrivateRecoveryMetadata } from "./lib/bwb-drive-recovery-transport";
import { getAccessToken, readDriveFileBytes } from "../server/google-drive";
import { withTenantContext } from "../server/lib/tenant-context";

async function main() {
  const [folderId, inventoryId] = process.argv.slice(2);
  if (!/^[A-Za-z0-9_-]{10,}$/.test(folderId || "") || (inventoryId && !/^[A-Za-z0-9_-]{10,}$/.test(inventoryId))) {
    throw new Error("Pass the private recovery folder ID and optionally one inventory file ID");
  }
  async function download(fileId: string) {
    if (!/^[A-Za-z0-9_-]{10,}$/.test(fileId)) throw new Error("Invalid recovery file identity");
    const token = await getAccessToken();
    const response = await fetch(
      `https://www.googleapis.com/drive/v3/files/${fileId}?fields=id,size,trashed,ownedByMe,parents,permissions(type,role,deleted)`,
      { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(30_000), redirect: "error" },
    );
    if (!response.ok) throw new Error(`Recovery metadata read failed: HTTP ${response.status}`);
    const metadata = await response.json();
    const size = Number(metadata.size);
    if (!Number.isSafeInteger(size) || size < 0 || size > 512 * 1024 * 1024) throw new Error("Invalid recovery size");
    assertPrivateRecoveryMetadata(metadata, folderId, size);
    const bytes = await readDriveFileBytes(fileId);
    if (bytes.length !== size) throw new Error("Recovery size changed during download");
    return bytes;
  }
  let inventory;
  if (inventoryId) {
    inventory = JSON.parse((await download(inventoryId)).toString("utf8"));
  } else {
    const token = await getAccessToken();
    const name = `${createHash("sha256").update("RECOVERY-INVENTORY.json").digest("hex").slice(0, 12)}-RECOVERY-INVENTORY.json`;
    const query = new URLSearchParams({
      q: `'${folderId}' in parents and trashed=false and name='${name}'`,
      pageSize: "1000", orderBy: "createdTime", fields: "nextPageToken,files(id)",
    });
    const response = await fetch(`https://www.googleapis.com/drive/v3/files?${query}`, {
      headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(30_000), redirect: "error",
    });
    if (!response.ok) throw new Error(`Recovery inventory listing failed: HTTP ${response.status}`);
    const listed = await response.json();
    if (listed.nextPageToken || !Array.isArray(listed.files) || !listed.files.length) {
      throw new Error("Recovery inventory listing is empty or exceeds the bounded restore limit");
    }
    const versions = [];
    for (const file of listed.files) versions.push(JSON.parse((await download(file.id)).toString("utf8")));
    inventory = mergeRecoveryInventories(versions);
  }
  const restored = await restoreBwbRecovery(inventory, async receipt => {
    if (receipt.folderId !== folderId) throw new Error("Recovery inventory crosses folders");
    return download(receipt.fileId);
  });
  console.log(JSON.stringify({ ...restored, inventoryId,
    inventorySha256: createHash("sha256").update(JSON.stringify(inventory)).digest("hex") }));
}
withTenantContext(1, main).then(() => process.exit(0)).catch(error => {
  console.error(`[bwb-recovery-restore] ${error.message}`);
  process.exit(1);
});
