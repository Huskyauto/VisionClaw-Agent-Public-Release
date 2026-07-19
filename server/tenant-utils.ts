import { db } from "./db";
import { sql } from "drizzle-orm";

export const ADMIN_TENANT_ID = 1;

let cache: { ids: number[]; ts: number } | null = null;
const TTL_MS = 60_000;

export async function getActiveTenantIds(): Promise<number[]> {
  if (cache && Date.now() - cache.ts < TTL_MS) return cache.ids;
  try {
    const r = await db.execute(sql`SELECT id FROM tenants WHERE is_active = true ORDER BY id ASC`);
    const rows = (r as any).rows || r;
    const ids = rows.map((row: any) => Number(row.id)).filter((n: number) => Number.isFinite(n));
    cache = { ids: ids.length > 0 ? ids : [ADMIN_TENANT_ID], ts: Date.now() };
    return cache.ids;
  } catch {
    return [ADMIN_TENANT_ID];
  }
}

export function invalidateTenantCache() {
  cache = null;
}

export function requireTenantId(t: number | undefined | null, op: string): number {
  if (typeof t !== "number" || !Number.isFinite(t) || t < 1) {
    throw new Error(`[tenant-guard] ${op} requires a valid tenantId, received ${t}`);
  }
  return t;
}
