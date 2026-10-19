import fs from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "../db";
import { ownerAlertLogs } from "@shared/schema";
import { ADMIN_TENANT_ID } from "../tenant-constants";
import { archiveOwnerAlert, prepareOwnerAlert, validAlertId, pendingAlertBatch, type AlertRecord, type AlertInput } from "./owner-alert-archive-core";

const ROOT = path.join(process.cwd(), "data", "private-alert-logs");
let retryCursor = "";
class InvalidSpool extends Error {}

async function persist(row: AlertRecord) {
  if (row.tenantId !== ADMIN_TENANT_ID || !validAlertId(row.id)) throw new Error("Invalid owner alert scope");
  const sizeBytes = Buffer.byteLength(JSON.stringify(row));
  await db.transaction(async tx => {
    await tx.execute(sql`SET LOCAL statement_timeout = '5000ms'`);
    await tx.execute(sql`SELECT pg_advisory_xact_lock(812804, ${ADMIN_TENANT_ID})`);
    const prior = await tx.select({ id: ownerAlertLogs.id }).from(ownerAlertLogs)
      .where(and(eq(ownerAlertLogs.tenantId, ADMIN_TENANT_ID), eq(ownerAlertLogs.id, row.id))).limit(1);
    if (prior.length) return;
    const [usage] = await tx.select({
      count: sql<number>`count(*)::int`, bytes: sql<number>`coalesce(sum(${ownerAlertLogs.sizeBytes}),0)::bigint`,
    }).from(ownerAlertLogs).where(eq(ownerAlertLogs.tenantId, ADMIN_TENANT_ID));
    if (Number(usage.count) >= 10_000 || Number(usage.bytes) + sizeBytes > 512 * 1024 * 1024)
      throw new Error("Private alert archive capacity reached; manual export required");
    await tx.insert(ownerAlertLogs).values({
      id: row.id, tenantId: ADMIN_TENANT_ID, subject: row.subject, source: row.source,
      severity: row.severity, sizeBytes, record: row, createdAt: new Date(row.createdAt),
    });
  });
}

async function privateDir(dir: string) {
  await fs.mkdir(dir, { recursive: true, mode: 0o700 });
  const stat = await fs.lstat(dir);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("Unsafe private alert directory");
  await fs.chmod(dir, 0o700);
}

async function mirror(row: AlertRecord, pending: boolean) {
  if (!validAlertId(row.id)) throw new Error("Invalid alert id");
  await privateDir(ROOT);
  const dir = path.join(ROOT, pending ? "pending" : "archive");
  await privateDir(dir);
  const target = path.join(dir, `${row.id}.json`);
  if (pending) {
    const names = await fs.readdir(dir);
    if (names.filter(n => n.endsWith(".json")).length >= 64 && !names.includes(`${row.id}.json`))
      throw new Error("Private pending alert spool is full");
  }
  const tmp = `${target}.${randomUUID()}.tmp`;
  const handle = await fs.open(tmp, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  try { await handle.writeFile(JSON.stringify(row)); await handle.sync(); }
  finally { await handle.close(); }
  await fs.rename(tmp, target);
  if (!pending) await fs.unlink(path.join(ROOT, "pending", `${row.id}.json`)).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== "ENOENT") throw error;
  });
}

export async function saveOwnerAlert(input: AlertInput) {
  const result = await archiveOwnerAlert(input, { persist, mirror });
  if (result.warnings.length) console.error(`[owner-alert-archive] ${result.durability}: ${result.warnings.join(" ")}`);
  return result;
}

/** Retry at most ten private spool records per scheduler tick; never execute contents. */
export async function retryPendingOwnerAlerts() {
  await privateDir(ROOT);
  await privateDir(path.join(ROOT, "pending"));
  let names: string[];
  try { names = await fs.readdir(path.join(ROOT, "pending")); }
  catch (error: any) { if (error.code === "ENOENT") return; throw error; }
  for (const name of pendingAlertBatch(names, retryCursor)) {
    retryCursor = name;
    let clean: AlertRecord;
    try {
      const handle = await fs.open(path.join(ROOT, "pending", name), constants.O_RDONLY | constants.O_NOFOLLOW);
      try {
        const stat = await handle.stat();
        if (!stat.isFile() || stat.size > 8 * 1024 * 1024) throw new InvalidSpool("Invalid alert spool file");
        const row = JSON.parse(await handle.readFile("utf8")) as AlertRecord;
        if (!row || typeof row !== "object" || row.id !== name.slice(0, -5) || row.tenantId !== ADMIN_TENANT_ID || row.version !== 1 ||
            !Number.isFinite(Date.parse(row.createdAt))) throw new InvalidSpool("Invalid alert spool identity");
        try { clean = { ...prepareOwnerAlert(row), id: row.id, createdAt: row.createdAt }; }
        catch { throw new InvalidSpool("Invalid alert spool contents"); }
      } finally { await handle.close(); }
    } catch (error) {
      if (!(error instanceof SyntaxError) && !(error instanceof InvalidSpool) &&
          (error as NodeJS.ErrnoException)?.code !== "ELOOP") {
        console.error("[owner-alert-archive] transient spool read failure; valid evidence retained for retry");
        continue;
      }
      await privateDir(path.join(ROOT, "quarantine"));
      await fs.rename(path.join(ROOT, "pending", name), path.join(ROOT, "quarantine", name))
        .catch(() => console.error("[owner-alert-archive] invalid spool quarantine failed; manual inspection required"));
      console.error("[owner-alert-archive] invalid spool entry quarantined; later records will still be attempted");
      continue;
    }
    try { await persist(clean); await mirror(clean, false); }
    catch { console.error("[owner-alert-archive] pending entry not recovered; retained for retry, continuing later entries"); }
  }
}

export async function listOwnerAlerts(page: number) {
  const rows = await db.select({
    id: ownerAlertLogs.id, createdAt: ownerAlertLogs.createdAt, subject: ownerAlertLogs.subject,
    source: ownerAlertLogs.source, severity: ownerAlertLogs.severity, sizeBytes: ownerAlertLogs.sizeBytes,
  }).from(ownerAlertLogs).where(eq(ownerAlertLogs.tenantId, ADMIN_TENANT_ID))
    .orderBy(desc(ownerAlertLogs.createdAt), desc(ownerAlertLogs.id)).limit(26).offset(page * 25);
  return { items: rows.slice(0, 25), hasMore: rows.length > 25, page };
}
export async function readOwnerAlert(id: string) {
  if (!validAlertId(id)) return null;
  const [row] = await db.select({ record: ownerAlertLogs.record, sizeBytes: ownerAlertLogs.sizeBytes }).from(ownerAlertLogs)
    .where(and(eq(ownerAlertLogs.id, id), eq(ownerAlertLogs.tenantId, ADMIN_TENANT_ID))).limit(1);
  const record = (row?.record as AlertRecord | undefined) || null;
  if (record) {
    try { await mirror(record, false); }
    catch { console.warn("[owner-alert-archive] durable read succeeded; local mirror restoration unavailable"); }
  }
  return record ? { ...record, sizeBytes: row.sizeBytes } : null;
}
