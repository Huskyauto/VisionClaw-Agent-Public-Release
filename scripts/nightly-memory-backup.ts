/**
 * Nightly Memory Backup
 *
 * Dumps memory_entries (all tenants, including soft-deleted for full recovery
 * fidelity) to a single JSON file, uploads to Google Drive under the
 * VisionClaw-Backups folder, and prunes backups older than 30 days.
 *
 * Idempotent and safe to re-run: writes a timestamped filename per run.
 *
 * Designed to be invoked from `server/nightly-memory-backup-cron.ts` once per
 * day (24h cycle) AND runnable standalone via:
 *   npx tsx scripts/nightly-memory-backup.ts
 *
 * Exit codes:
 *   0 = success (file uploaded; retention prune optional)
 *   2 = DB read failed
 *   3 = Drive upload failed
 *   4 = retention prune failed but upload succeeded (non-fatal, logged)
 *
 * Output: emits a single JSON line on stdout summarizing the run so the cron
 * scheduler can parse it (matches the weekly-maintenance.ts contract).
 */

import { db } from "../server/db";
import { memoryEntries } from "../shared/schema";
import { uploadAndShare, listDriveFiles, deleteDriveFile } from "../server/google-drive";

const RETENTION_DAYS = 30;
// Admin-marker prefix on both folder + filename so the google_drive agent tool
// surface (list/download/delete/share) can refuse to expose this cross-tenant
// aggregate to any persona, regardless of which tenant the persona runs under.
// Matches the regex /^__admin[-_]/i in server/tools.ts google_drive dispatch.
const BACKUP_FILENAME_PREFIX = "__admin-memory-backup-";
const BACKUP_FOLDER_LABEL = "__VisionClaw-Admin-Backups__/";

interface BackupSummary {
  generatedAt: string;
  rowCount: number;
  bytes: number;
  driveFileId?: string;
  driveViewUrl?: string;
  prunedCount: number;
  status: "ok" | "db_failed" | "upload_failed" | "pruned_failed";
  error?: string;
}

async function main(): Promise<BackupSummary> {
  const now = new Date();
  const stamp = now.toISOString().slice(0, 19).replace(/[:T]/g, "-");
  const filename = `${BACKUP_FILENAME_PREFIX}${stamp}.json`;
  const summary: BackupSummary = {
    generatedAt: now.toISOString(),
    rowCount: 0,
    bytes: 0,
    prunedCount: 0,
    status: "ok",
  };

  // 1. Dump all memory_entries — every tenant, every row, soft-deleted included.
  let rows: any[];
  try {
    rows = await db.select().from(memoryEntries);
    summary.rowCount = rows.length;
  } catch (e: any) {
    summary.status = "db_failed";
    summary.error = `DB read failed: ${e.message || e}`;
    return summary;
  }

  // Strip embedding columns — they're large vector blobs that re-derive from
  // `fact` on demand. A backup needs the source of truth, not the cache.
  const stripped = rows.map((r: any) => {
    const { embedding, embedding_vec, embeddingVec, ...rest } = r;
    return rest;
  });

  const payload = {
    schemaVersion: 1,
    generatedAt: summary.generatedAt,
    table: "memory_entries",
    rowCount: stripped.length,
    rows: stripped,
  };
  const buf = Buffer.from(JSON.stringify(payload, null, 2), "utf8");
  summary.bytes = buf.byteLength;

  // 2. Upload to Drive under a STABLE backup folder.
  // Trailing slash on folderLabel forces uploadToDrive's nested-folder branch
  // (findOrCreateNestedFolder) instead of the default "YYYY-MM-DD_HH-MM-SS_<label>"
  // timestamped-subfolder branch. Without this, every nightly run created a
  // fresh dated subfolder and the prune at root never saw the old backups
  // — they were all hidden in distinct subfolders.
  let backupFolderId: string | undefined;
  try {
    const result = await uploadAndShare({
      fileData: buf,
      fileName: filename,
      mimeType: "application/json",
      folderLabel: BACKUP_FOLDER_LABEL,
      description: `Memory backup — ${summary.rowCount} rows, ${summary.bytes} bytes — ${summary.generatedAt}`,
      share: false,
      tenantId: 1,
    });
    if (!result.success) {
      summary.status = "upload_failed";
      summary.error = `Drive upload failed: ${result.error}`;
      return summary;
    }
    summary.driveFileId = (result as any).fileId;
    summary.driveViewUrl = (result as any).viewUrl || (result as any).webViewLink;
    // R121 fix: uploadAndShare returns `folderUrl` (a Drive share link like
    // https://drive.google.com/drive/folders/<ID>?usp=sharing), not `folderId` /
    // `customerFolderId`. Extract the folder ID from the URL so retention prune
    // can list+delete files in the same folder we just uploaded into. Falls back
    // to legacy field names if a future refactor adds them back.
    const folderUrl: string | undefined = (result as any).folderUrl;
    const folderIdMatch = folderUrl?.match(/\/folders\/([A-Za-z0-9_-]+)/);
    backupFolderId =
      (result as any).customerFolderId ||
      (result as any).folderId ||
      (folderIdMatch ? folderIdMatch[1] : undefined);
  } catch (e: any) {
    summary.status = "upload_failed";
    summary.error = `Drive upload threw: ${e.message || e}`;
    return summary;
  }

  // 3. Retention: prune memory-backup-*.json older than 30 days from the
  // SAME stable folder we just uploaded into. listDriveFiles defaults to the
  // root VisionClaw folder if no folderId is passed, which would miss our
  // backups entirely.
  if (!backupFolderId) {
    summary.status = "pruned_failed";
    summary.error = "Retention prune skipped: upload did not return a folder ID";
  } else {
    try {
      const listing = await listDriveFiles({
        folderId: backupFolderId,
        query: BACKUP_FILENAME_PREFIX,
        pageSize: 200,
      });
      if (!listing.success || !Array.isArray(listing.files)) {
        summary.status = "pruned_failed";
        summary.error = `Retention prune list failed: ${listing.error || "no files array"}`;
      } else {
        const cutoff = Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000;
        const deleteErrors: string[] = [];
        for (const f of listing.files) {
          if (!f.name?.startsWith(BACKUP_FILENAME_PREFIX)) continue;
          if (f.id === summary.driveFileId) continue; // never the file we just uploaded
          const created = f.createdTime ? Date.parse(f.createdTime) : NaN;
          if (Number.isFinite(created) && created < cutoff) {
            const del = await deleteDriveFile(f.id);
            if (del.success) {
              summary.prunedCount++;
            } else {
              deleteErrors.push(`${f.name}: ${del.error || "unknown"}`);
            }
          }
        }
        if (deleteErrors.length > 0) {
          summary.status = "pruned_failed";
          summary.error = `Retention prune partial: ${deleteErrors.slice(0, 5).join("; ")}${deleteErrors.length > 5 ? ` (+${deleteErrors.length - 5} more)` : ""}`;
        }
      }
    } catch (e: any) {
      summary.status = "pruned_failed";
      summary.error = `Retention prune threw: ${e.message || e}`;
      // Don't abort — upload succeeded, that's what matters.
    }
  }

  return summary;
}

main()
  .then((summary) => {
    console.log(JSON.stringify(summary));
    if (summary.status === "db_failed") process.exit(2);
    if (summary.status === "upload_failed") process.exit(3);
    if (summary.status === "pruned_failed") process.exit(4);
    process.exit(0);
  })
  .catch((err) => {
    console.error(JSON.stringify({ status: "uncaught", error: err?.message || String(err) }));
    process.exit(1);
  });
