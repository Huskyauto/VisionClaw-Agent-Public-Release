import { eq, type SQL } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";

/**
 * Returns a Drizzle equality predicate scoping a query to `tenantId`,
 * or `undefined` if the caller explicitly passed `undefined` (admin / global call).
 *
 * Throws if `tenantId` is provided but invalid (NaN, 0, negative, non-integer).
 *
 * Replaces the truthy-check pattern `if (tenantId) conditions.push(eq(...))`
 * which silently treats `0`, `NaN`, and `null` as "no scoping" — the exact
 * fail-open class Furrow flagged BLOCKING in agentic-engines.ts (177, 257).
 *
 * Usage:
 *   const t = tenantScope(memoryEntries.tenantId, tenantId);
 *   if (t) conditions.push(t);
 */
export function tenantScope(
  column: PgColumn,
  tenantId: number | undefined | null,
): SQL | undefined {
  if (tenantId === undefined || tenantId === null) return undefined;
  if (typeof tenantId !== "number" || !Number.isInteger(tenantId) || tenantId <= 0) {
    throw new Error(
      `[tenantScope] Invalid tenantId: ${JSON.stringify(tenantId)} ` +
        `(expected positive integer or undefined). ` +
        `R74.13g — fail-closed scoping helper rejects 0/NaN/negative/non-integer.`,
    );
  }
  return eq(column, tenantId);
}

/**
 * Validates `tenantId` is a positive integer (or undefined/null).
 * Returns the value (or undefined for null/undefined inputs).
 * Throws on the fail-open shapes (0, NaN, negative, non-integer).
 *
 * Use when tenantScope's eq()-shape doesn't fit (e.g., raw SQL subqueries) but
 * you still need to validate the input before threading it into a query.
 */
export function assertValidTenantId(tenantId: number | undefined | null): number | undefined {
  if (tenantId === undefined || tenantId === null) return undefined;
  if (typeof tenantId !== "number" || !Number.isInteger(tenantId) || tenantId <= 0) {
    throw new Error(
      `[assertValidTenantId] Invalid tenantId: ${JSON.stringify(tenantId)} ` +
        `(expected positive integer or undefined)`,
    );
  }
  return tenantId;
}

/**
 * Strict variant: throws if `tenantId` is undefined/null. Use when tenant
 * scoping is mandatory (e.g., write operations that should never span tenants).
 */
export function requireTenantScope(column: PgColumn, tenantId: number | undefined | null): SQL {
  if (tenantId === undefined || tenantId === null) {
    throw new Error(`[requireTenantScope] tenantId is required (got ${JSON.stringify(tenantId)})`);
  }
  if (typeof tenantId !== "number" || !Number.isInteger(tenantId) || tenantId <= 0) {
    throw new Error(
      `[requireTenantScope] Invalid tenantId: ${JSON.stringify(tenantId)} (expected positive integer)`,
    );
  }
  return eq(column, tenantId);
}
