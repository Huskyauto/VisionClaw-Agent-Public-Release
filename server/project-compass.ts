import { sql } from "drizzle-orm";
import { db } from "./db";
import {
  normalizeProjectCompassEntries,
  type ProjectCompassEntry,
} from "./lib/project-compass-core";

export interface ProjectCompassProfile {
  projectId: number;
  revision: number;
  entries: ProjectCompassEntry[];
  updatedAt: string | Date | null;
}

export class ProjectCompassConflictError extends Error {
  constructor() {
    super("Project Compass changed since it was loaded");
    this.name = "ProjectCompassConflictError";
  }
}

export async function getProjectCompass(projectId: number, tenantId: number): Promise<ProjectCompassProfile | null> {
  const result = await db.execute(sql`
    SELECT p.id AS project_id, pc.entries, pc.revision, pc.updated_at
    FROM projects p
    LEFT JOIN project_compasses pc
      ON pc.project_id = p.id AND pc.tenant_id = p.tenant_id
    WHERE p.id = ${projectId} AND p.tenant_id = ${tenantId}
  `);
  const rows = (result as any).rows || result;
  const row = Array.isArray(rows) ? rows[0] : rows;
  if (!row) return null;
  return {
    projectId: Number(row.project_id),
    revision: Number(row.revision || 0),
    entries: normalizeProjectCompassEntries(row.entries || []),
    updatedAt: row.updated_at || null,
  };
}

export async function replaceProjectCompass(
  projectId: number,
  tenantId: number,
  expectedRevision: number,
  input: unknown,
): Promise<ProjectCompassProfile | null> {
  if (!Number.isInteger(expectedRevision) || expectedRevision < 0) {
    throw new Error("revision must be a non-negative integer");
  }
  const entries = normalizeProjectCompassEntries(input);
  const owner = await db.execute(sql`SELECT id FROM projects WHERE id = ${projectId} AND tenant_id = ${tenantId}`);
  const ownerRows = (owner as any).rows || owner;
  if (!Array.isArray(ownerRows) || ownerRows.length === 0) return null;

  const result = await db.execute(sql`
    INSERT INTO project_compasses (project_id, tenant_id, entries, revision)
    SELECT ${projectId}, ${tenantId}, ${JSON.stringify(entries)}::jsonb, 1
    WHERE ${expectedRevision} = 0
    ON CONFLICT (tenant_id, project_id) DO UPDATE
      SET entries = EXCLUDED.entries,
          revision = project_compasses.revision + 1,
          updated_at = CURRENT_TIMESTAMP
      WHERE project_compasses.revision = ${expectedRevision}
    RETURNING project_id, entries, revision, updated_at
  `);
  const rows = (result as any).rows || result;
  const row = Array.isArray(rows) ? rows[0] : rows;
  if (!row) throw new ProjectCompassConflictError();
  return {
    projectId: Number(row.project_id),
    revision: Number(row.revision),
    entries: normalizeProjectCompassEntries(row.entries),
    updatedAt: row.updated_at,
  };
}