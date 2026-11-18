import { storage, ALL_TENANTS } from "./storage";
import { driveRequest, driveJson, ensureConfidentialBackupFolder, verifyConfidentialBackupAccess } from "./google-drive";

const BACKUP_FOLDER_NAME = "VisionClaw Backups";
const MEMORY_SUBFOLDER_NAME = "Memory Snapshots";
const DRIVE_API = "https://www.googleapis.com";

async function findOrCreateFolder(name: string, parentId?: string): Promise<string> {
  return ensureConfidentialBackupFolder(name, parentId);
}

async function cleanOldFiles(folderId: string, keepCount: number = 30) {
  try {
    const data = await driveJson(
      `/drive/v3/files?q='${folderId}' in parents and trashed=false&orderBy=createdTime desc&fields=files(id,name,createdTime)&pageSize=100`
    );
    const files = data.files || [];
    if (files.length <= keepCount) return;

    const toDelete = files.slice(keepCount);
    for (const file of toDelete) {
      await driveRequest(`/drive/v3/files/${file.id}`, { method: "DELETE" }).catch(() => {});
    }
    console.log(`[backup] Cleaned ${toDelete.length} old files, keeping ${keepCount}`);
  } catch (err: any) {
    console.warn(`[backup] Cleanup warning: ${err.message}`);
  }
}

async function uploadJsonToDrive(folderId: string, fileName: string, data: any): Promise<{ id: string; name: string; size: string }> {
  await verifyConfidentialBackupAccess(folderId);
  const jsonContent = JSON.stringify(data, null, 2);
  const jsonBuffer = Buffer.from(jsonContent, "utf-8");

  const boundary = "----BackupBoundary" + Math.random().toString(36).slice(2);
  const metadata = JSON.stringify({
    name: fileName,
    parents: [folderId],
    mimeType: "application/json",
  });

  const parts: Buffer[] = [];
  parts.push(Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n`));
  parts.push(Buffer.from(`--${boundary}\r\nContent-Type: application/json\r\n\r\n`));
  parts.push(jsonBuffer);
  parts.push(Buffer.from(`\r\n--${boundary}--\r\n`));

  const body = Buffer.concat(parts);

  const resp = await driveRequest(
    `${DRIVE_API}/upload/drive/v3/files?uploadType=multipart&fields=id,name,size&ignoreDefaultVisibility=true`,
    {
      method: "POST",
      headers: { "Content-Type": `multipart/related; boundary=${boundary}` },
      body,
    }
  );

  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(`Upload failed (${resp.status}): ${errText}`);
  }

  const uploadData = (await resp.json()) as any;
  if (typeof uploadData?.id !== "string" || !uploadData.id) throw new Error("Backup upload ID missing");
  try {
    await verifyConfidentialBackupAccess(uploadData.id);
    await verifyConfidentialBackupAccess(folderId);
  } catch {
    throw new Error("Backup uploaded but owner-only Drive access is unverified; operator reconciliation required");
  }
  const sizeMB = (jsonBuffer.length / (1024 * 1024)).toFixed(2);

  return { id: uploadData.id, name: fileName, size: `${sizeMB} MB` };
}

export async function runBackupToGoogleDrive(): Promise<string> {
  const startTime = Date.now();
  console.log("[backup] Starting full system backup to Google Drive...");

  const folderId = await findOrCreateFolder(BACKUP_FOLDER_NAME);
  const exportData = await storage.getAllDataForExport();

  const backupData = {
    ...exportData,
    backupType: "automated_daily",
    backupTimestamp: new Date().toISOString(),
  };

  const now = new Date();
  const dateStr = now.toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const fileName = `__admin-visionclaw-backup-${dateStr}.json`;

  const result = await uploadJsonToDrive(folderId, fileName, backupData);
  await cleanOldFiles(folderId);

  const durationMs = Date.now() - startTime;
  const summary = `Backup complete: ${result.name} (${result.size}) uploaded to Google Drive/${BACKUP_FOLDER_NAME} in ${durationMs}ms. File ID: ${result.id}`;
  console.log(`[backup] ${summary}`);
  return summary;
}

export async function runMemoryBackupToGoogleDrive(): Promise<string> {
  const startTime = Date.now();
  console.log("[backup] Starting memory snapshot backup to Google Drive...");

  const backupFolderId = await findOrCreateFolder(BACKUP_FOLDER_NAME);
  const memoryFolderId = await findOrCreateFolder(MEMORY_SUBFOLDER_NAME, backupFolderId);
  const allMemories = await storage.getAllMemoriesForBackup();
  const memoryStats = await storage.getMemoryStats(undefined, ALL_TENANTS);

  const active = allMemories.filter((m: any) => m.status === "active");
  const superseded = allMemories.filter((m: any) => m.status === "superseded");

  const memoryExport = {
    exportType: "memory_snapshot",
    exportTimestamp: new Date().toISOString(),
    stats: {
      ...memoryStats,
      activeCount: active.length,
      supersededCount: superseded.length,
      totalCount: allMemories.length,
    },
    activeMemories: active.map((m: any) => ({
      id: m.id,
      fact: m.fact,
      category: m.category,
      source: m.source,
      personaId: m.personaId,
      accessCount: m.accessCount,
      createdAt: m.createdAt,
      lastAccessed: m.lastAccessed,
    })),
    supersededMemories: superseded.map((m: any) => ({
      id: m.id,
      fact: m.fact,
      category: m.category,
      source: m.source,
      personaId: m.personaId,
      createdAt: m.createdAt,
      // Preserve the supersession chain in the audit snapshot — which fact
      // replaced this one, and when it stopped being true.
      succeededById: m.succeededById ?? null,
      validUntil: m.validUntil ?? null,
    })),
    recentChanges: await getRecentMemoryChanges(),
  };

  const now = new Date();
  const dateStr = now.toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const fileName = `__admin-memory-snapshot-${dateStr}.json`;

  const result = await uploadJsonToDrive(memoryFolderId, fileName, memoryExport);
  await cleanOldFiles(memoryFolderId, 60);

  const durationMs = Date.now() - startTime;
  const summary = `Memory backup: ${active.length} active, ${superseded.length} superseded memories. File: ${result.name} (${result.size}) in ${durationMs}ms. ID: ${result.id}`;
  console.log(`[backup] ${summary}`);
  return summary;
}

async function getRecentMemoryChanges(): Promise<any[]> {
  try {
    const allMemories = await storage.getMemoryEntries(undefined, 200, 0);
    return allMemories.data
      .filter((m: any) => {
        const age = Date.now() - new Date(m.createdAt).getTime();
        return age < 7 * 24 * 60 * 60 * 1000;
      })
      .map((m: any) => ({
        id: m.id,
        fact: m.fact,
        category: m.category,
        status: m.status,
        createdAt: m.createdAt,
      }));
  } catch {
    return [];
  }
}
