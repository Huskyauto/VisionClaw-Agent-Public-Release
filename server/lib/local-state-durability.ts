/**
 * Republish durability for data/local-state/*.json runtime stores
 * (2026-08-14). The prod filesystem resets on every publish, wiping
 * admin job/receipt state. Every save is mirrored into file_storage
 * (admin tenant) via a per-name ordered+coalescing scheduler (same
 * pattern as the service-review-queue mirror — fire-and-forget writes
 * must never land out of order), and seed.ts restores missing files
 * from the newest DB copy at boot.
 *
 * DB filenames are `local-state-<basename>`. Cross-process safety is
 * guaranteed by the PARTIAL unique index file_storage_local_state_uidx
 * (tenant_id, filename WHERE filename LIKE 'local-state-%') + atomic
 * ON CONFLICT DO UPDATE — two overlapping processes can never create
 * duplicate backup rows (architect review 2026-08-14).
 */
import fs from "fs";
import path from "path";
import { sql } from "drizzle-orm";

const LOCAL_STATE_TENANT = 1; // admin tenant — operator-facing platform state

const dbName = (name: string) => `local-state-${path.basename(name)}`;

// Per-name latest-snapshot + single drain chain (ordering guarantee).
const pending = new Map<string, string>();
const draining = new Set<string>();

async function writeToDb(name: string, json: string): Promise<void> {
  const { db } = await import("../db");
  const { fileStorage } = await import("@shared/schema");
  const filename = dbName(name);
  await db.insert(fileStorage).values({
    filename,
    tenantId: LOCAL_STATE_TENANT,
    originalName: filename,
    mimeType: "application/json",
    size: Buffer.byteLength(json),
    data: json,
  }).onConflictDoUpdate({
    target: [fileStorage.tenantId, fileStorage.filename],
    // Matches the partial unique index file_storage_local_state_uidx.
    targetWhere: sql`filename LIKE 'local-state-%'`,
    set: { size: Buffer.byteLength(json), data: json },
  });
}

// Test seams (mirror the service-review-queue pattern).
export let __writeToDbForTest = writeToDb;
export function __setWriteToDbForTest(w: typeof writeToDb): typeof writeToDb {
  const prev = __writeToDbForTest;
  __writeToDbForTest = w;
  return prev;
}

/** Fire-and-forget DB mirror of a local-state JSON store. Ordered + coalesced per name. */
export function mirrorLocalState(name: string, json: string): void {
  const key = path.basename(name);
  pending.set(key, json);
  if (draining.has(key)) return;
  draining.add(key);
  void (async () => {
    try {
      while (pending.has(key)) {
        const next = pending.get(key)!;
        pending.delete(key);
        try {
          await __writeToDbForTest(key, next);
        } catch (err: any) {
          console.error(`[local-state] DB mirror FAILED for ${key} (file on disk intact): ${err.message}`);
        }
      }
    } finally {
      draining.delete(key);
    }
  })();
}

/**
 * Boot-time restore: for each known store, if the file is missing (fresh
 * prod FS) and a DB copy exists, rebuild the file. Never clobbers an
 * existing file; malformed backups are refused loudly.
 */
export async function restoreLocalStateIfMissing(stateDir: string, names: string[]): Promise<void> {
  for (const name of names) {
    try {
      const filePath = path.join(stateDir, path.basename(name));
      if (fs.existsSync(filePath)) continue;
      const { db } = await import("../db");
      const { fileStorage } = await import("@shared/schema");
      const { and, eq, desc } = await import("drizzle-orm");
      const [row] = await db.select().from(fileStorage)
        .where(and(eq(fileStorage.filename, dbName(name)), eq(fileStorage.tenantId, LOCAL_STATE_TENANT)))
        .orderBy(desc(fileStorage.id))
        .limit(1);
      if (!row?.data) continue;
      try {
        JSON.parse(row.data); // shape sanity — refuse to restore corrupt JSON
      } catch {
        console.error(`[local-state] DB backup for ${name} is not valid JSON — REFUSING restore.`);
        continue;
      }
      fs.mkdirSync(stateDir, { recursive: true });
      const tmp = `${filePath}.restore.${process.pid}.tmp`;
      fs.writeFileSync(tmp, row.data, { mode: 0o600 });
      fs.renameSync(tmp, filePath);
      console.log(`[local-state] Restored ${name} from DB backup (file was missing — fresh FS).`);
    } catch (err: any) {
      console.error(`[local-state] restore check failed for ${name} (non-fatal): ${err.message}`);
    }
  }
}
