import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import type { PaperBar, PaperOptions, PaperResult } from "../../shared/treasury-paper-contract";
import archive from "../data/treasury-comparisons-2026-10-08.json";
import { requirePaperOwner, requirePaperEnabled } from "./treasury-paper-store";
import { pool } from "../db";

export interface ComparisonClient {
  query(text: string, values?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
  release(): void;
}
export interface ComparisonDatabase {
  connect(): Promise<ComparisonClient>;
}

export interface ArchivedComparison {
  id: string;
  options: PaperOptions;
  source_bars: PaperBar[];
  result: PaperResult;
  created_at: string;
  finished_at: string;
}

// Server-owned, owner-approved evidence only. Never accept archive bytes from clients.
export function approvedComparisons(): ArchivedComparison[] {
  const digest = createHash("sha256").update(JSON.stringify(archive)).digest("hex");
  if (digest !== "34ee39ec87b760f4eaa404e12c78eea140a636dc5805d33a912456a5c3550260") {
    throw new Error("Approved comparison archive integrity check failed");
  }
  return structuredClone(archive) as ArchivedComparison[];
}

function timestamp(value: unknown): string {
  // pg returns Date objects; String(Date) discards the stored milliseconds.
  return value instanceof Date ? value.toISOString() : new Date(String(value)).toISOString();
}

export async function importApprovedComparisons(tenantId: number, database: ComparisonDatabase = pool) {
  requirePaperOwner(tenantId);
  requirePaperEnabled();
  const records = approvedComparisons();
  const client = await database.connect();
  let imported = 0, existing = 0;
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(660201,$1)", [tenantId]);
    requirePaperEnabled();
    for (const record of records) {
      const prior = await client.query(`SELECT id,status,options,source_bars,result,created_at,finished_at
        FROM treasury_paper_runs WHERE tenant_id=$1 AND (id=$2 OR request_key=$2) FOR UPDATE`, [tenantId,record.id]);
      if (prior.rows.length) {
        const row = prior.rows[0];
        if (prior.rows.length !== 1 || row.id !== record.id || row.status !== "completed" ||
          !isDeepStrictEqual(row.options,record.options) ||
          !isDeepStrictEqual(row.source_bars,record.source_bars) ||
          !isDeepStrictEqual(row.result,record.result) ||
          timestamp(row.created_at) !== timestamp(record.created_at) ||
          timestamp(row.finished_at) !== timestamp(record.finished_at)) {
          throw new Error("Saved comparison conflicts with existing evidence; nothing was imported");
        }
        existing++;
        continue;
      }
      const digest = createHash("sha256").update(JSON.stringify(record.options)).digest("hex");
      await client.query(`INSERT INTO treasury_paper_runs
        (id,tenant_id,request_key,request_digest,status,options,source_bars,result,created_at,finished_at,lease_until)
        VALUES ($1,$2,$1,$8,'completed',$3::jsonb,$4::jsonb,$5::jsonb,$6,$7,$7)`,
        [record.id,tenantId,JSON.stringify(record.options),JSON.stringify(record.source_bars),
          JSON.stringify(record.result),record.created_at,record.finished_at,digest]);
      imported++;
    }
    await client.query("COMMIT");
    console.info(`[treasury-paper] approved comparison import: imported=${imported} existing=${existing}`);
    return { imported,existing,total:records.length };
  } catch (error) {
    await client.query("ROLLBACK");
    if (error instanceof Error && error.message.startsWith("Saved comparison conflicts")) throw error;
    throw new Error("Comparison import failed; no partial import was committed");
  } finally {
    client.release();
  }
}
