import { sql, type SQL } from "drizzle-orm";

type Query = (statement: SQL) => Promise<{ rows: Record<string, any>[] }>;

function requireTenant(tenantId: number): void {
  if (!Number.isSafeInteger(tenantId) || tenantId <= 0) {
    throw new Error("Valid tenant ID required");
  }
}

function boundedText(value: unknown, limit: number): string {
  if (typeof value !== "string") throw new Error("Invalid project brief text");
  return value.slice(0, limit);
}

export async function listProjectBriefs(tenantId: number, execute: Query) {
  requireTenant(tenantId);
  const result = await execute(sql`
    SELECT p.id, LEFT(p.name, 160) AS name,
           LEFT(p.description, 1000) AS description,
           LEFT(p.status, 40) AS status, p.updated_at
      FROM projects p
     WHERE p.tenant_id = ${tenantId}
     ORDER BY p.updated_at DESC, p.id DESC
     LIMIT 20
  `);
  return result.rows.slice(0, 20).map((row) => ({
    id: row.id,
    name: boundedText(row.name, 160),
    description: boundedText(row.description, 1000),
    status: boundedText(row.status, 40),
    updatedAt: row.updated_at,
  }));
}

export async function getProjectBrief(projectId: number, tenantId: number, execute: Query) {
  requireTenant(tenantId);
  if (!Number.isSafeInteger(projectId) || projectId <= 0) {
    throw new Error("Valid project ID required");
  }
  const result = await execute(sql`
    SELECT p.id, LEFT(p.name, 160) AS name,
           LEFT(p.description, 2000) AS description,
           LEFT(p.status, 40) AS status,
           LEFT(COALESCE(p.current_state, ''), 2000) AS current_state,
           p.updated_at
      FROM projects p
     WHERE p.id = ${projectId} AND p.tenant_id = ${tenantId}
     LIMIT 1
  `);
  const row = result.rows[0];
  return row ? {
    id: row.id,
    name: boundedText(row.name, 160),
    description: boundedText(row.description, 2000),
    status: boundedText(row.status, 40),
    currentState: boundedText(row.current_state, 2000),
    updatedAt: row.updated_at,
  } : null;
}