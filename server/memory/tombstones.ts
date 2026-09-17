import { createHmac } from "node:crypto";
import { sql } from "drizzle-orm";
import { db } from "../db";
import type { MemoryLifecycleSource } from "./forgetting-policy";

// Keep this boundary deliberately narrower than JavaScript trim()/\s:
// PostgreSQL and Node must preserve Unicode whitespace such as NBSP.
const ASCII_MEMORY_WHITESPACE = /[ \t\n\r\f\x0B]+/g;
const ASCII_MEMORY_TRIM = /^[ \t\n\r\f\x0B]+|[ \t\n\r\f\x0B]+$/g;

function canonicalMemoryPart(part: unknown): string {
  return String(part ?? "")
    .replace(ASCII_MEMORY_WHITESPACE, " ")
    .replace(ASCII_MEMORY_TRIM, "");
}

function tombstoneKey(): string | null {
  const key = process.env.MEMORY_TOMBSTONE_HMAC_KEY;
  return key || null;
}

export function canonicalMemoryValue(parts: readonly unknown[]): string {
  return parts.map(canonicalMemoryPart).join("\u001f");
}

/** Return the aggregate digest value and each nonblank field value. */
export function canonicalMemoryValues(parts: readonly unknown[]): string[] {
  const values = [
    canonicalMemoryValue(parts),
    ...parts.map(canonicalMemoryPart).filter((value) => value.length > 0),
  ];
  return [...new Set(values)];
}

export function memoryValueDigest(
  tenantId: number,
  _source: MemoryLifecycleSource,
  canonicalValue: string,
  key = tombstoneKey(),
): string {
  if (!Number.isInteger(tenantId) || tenantId <= 0) throw new Error("invalid tenantId");
  if (!key) throw new Error("memory tombstone key is unavailable");
  return createHmac("sha256", key)
    .update(`${tenantId}\u001f${canonicalValue}`, "utf8")
    .digest("hex");
}

export async function assertMemoryValueNotTombstoned(input: {
  tenantId: number;
  source: MemoryLifecycleSource;
  parts: readonly unknown[];
}): Promise<void> {
  const key = tombstoneKey();
  if (!key) {
    if (process.env.MEMORY_FORGETTING_ENABLED === "1") {
      throw new Error("memory tombstone key is unavailable");
    }
    return;
  }
  const values = canonicalMemoryValues(input.parts);
  const digests = [...new Set(values)].map((value) =>
    memoryValueDigest(input.tenantId, input.source, value, key));
  try {
    const result = await db.execute(sql`
      SELECT 1 FROM memory_tombstones
      WHERE tenant_id = ${input.tenantId}
        AND value_digest IN (${sql.join(digests.map((digest) => sql`${digest}`), sql`, `)})
      LIMIT 1
    `);
    const rows = (result as any).rows || result;
    if (Array.isArray(rows) && rows.length > 0) {
      throw new Error("memory write refused: erased content cannot be restored");
    }
  } catch (error: any) {
    if (error?.message?.includes("erased content")) throw error;
    const code = error?.code ?? error?.cause?.code;
    if (code === "42P01" && process.env.MEMORY_FORGETTING_ENABLED !== "1") return;
    throw error;
  }
}