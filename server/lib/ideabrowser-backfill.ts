// One-shot idempotent backfill of IdeaBrowser/Isenberg projects into a fresh
// production database. The dev workspace is where the Isenberg IOTD ingest and
// weekly-scenario runs execute, so their projects historically only existed in
// the dev DB — prod had zero, which made the virtual "IdeaBrowser" folder on
// /projects (tag-driven, client/src/pages/projects.tsx) invisible in prod.
//
// Data source: data/ideabrowser-backfill.json, produced by
// scripts/ideabrowser-backfill-export.ts (re-run that script to refresh the
// snapshot before a publish if you want newer ideas included).
//
// Safety properties:
// - Idempotent per project: existence check by (name, tenant_id) before INSERT.
// - Explicit tenant_id on every INSERT (platform invariant — no defaults).
// - Fail-open, non-fatal: any error is logged loudly and boot continues.
// - Cheap short-circuit: per-tenant — skipped only when EVERY tenant present
//   in the snapshot already has >= that tenant's snapshot count of idea-tagged
//   projects (a global count could let one tenant's rows mask another's gap).
import { db } from "../db";
import { sql } from "drizzle-orm";
import { readFileSync, existsSync } from "fs";
import path from "path";

const IDEA_TAG_LITERAL = "{ideabrowser,isenberg,isenberg-iotd,iotd,idea-stage,ideabrowser-weekly-run}";

function toPgTextArray(arr: unknown): string {
  const items = Array.isArray(arr) ? arr : [];
  return `{${items.map((t) => `"${String(t).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`).join(",")}}`;
}

export async function importIdeabrowserBackfill(): Promise<void> {
  const filePath = path.resolve(process.cwd(), "data/ideabrowser-backfill.json");
  if (!existsSync(filePath)) return;

  try {
    const raw = JSON.parse(readFileSync(filePath, "utf-8"));
    if (raw?.kind !== "ideabrowser-backfill" || !Array.isArray(raw.projects) || raw.projects.length === 0) {
      console.warn("[ideabrowser-backfill] snapshot file present but malformed/empty — skipping");
      return;
    }

    // Per-tenant short-circuit: skip only if every snapshot tenant is already
    // at/above its own snapshot count. A global count can be satisfied by one
    // tenant's rows while another tenant is still missing everything.
    const wantedByTenant = new Map<number, number>();
    for (const p of raw.projects) {
      const t = Number(p.tenantId);
      if (Number.isInteger(t) && t > 0) wantedByTenant.set(t, (wantedByTenant.get(t) || 0) + 1);
    }
    const countRes = await db.execute(sql`
      SELECT tenant_id, count(*)::int AS c FROM projects
      WHERE tags && ${IDEA_TAG_LITERAL}::text[]
      GROUP BY tenant_id
    `);
    const haveByTenant = new Map<number, number>();
    for (const r of ((countRes as any).rows || countRes) as any[]) {
      haveByTenant.set(Number(r.tenant_id), Number(r.c) || 0);
    }
    let allSatisfied = wantedByTenant.size > 0;
    for (const [t, wanted] of wantedByTenant) {
      if ((haveByTenant.get(t) || 0) < wanted) { allSatisfied = false; break; }
    }
    if (allSatisfied) {
      return; // every snapshot tenant already backfilled (or organically ahead)
    }

    console.log(`[ideabrowser-backfill] backfilling ${raw.projects.length} snapshot projects across ${wantedByTenant.size} tenant(s)`);

    // dev project id -> new prod project id, for file/note re-parenting
    const idMap = new Map<number, number>();
    let inserted = 0;

    for (const p of raw.projects) {
      const tenantId = Number(p.tenantId);
      if (!Number.isInteger(tenantId) || tenantId <= 0 || !p.name) continue;

      const existing = await db.execute(sql`
        SELECT id FROM projects WHERE name = ${p.name} AND tenant_id = ${tenantId} LIMIT 1
      `);
      const rows = (existing as any).rows || existing;
      if (rows.length > 0) {
        idMap.set(Number(p.devId), Number(rows[0].id));
        continue;
      }

      const tagsLiteral = toPgTextArray(p.tags);
      const res = await db.execute(sql`
        INSERT INTO projects (name, description, status, tags, metadata, tenant_id, created_at, updated_at, drive_folder_id, drive_folder_url, current_state)
        VALUES (${p.name}, ${p.description ?? ""}, ${p.status ?? "active"}, ${tagsLiteral}::text[], ${JSON.stringify(p.metadata ?? {})}::jsonb, ${tenantId}, ${p.createdAt}, ${p.updatedAt}, ${p.driveFolderId}, ${p.driveFolderUrl}, ${p.currentState ?? ""})
        RETURNING id
      `);
      const newId = Number((((res as any).rows || res)?.[0] || {}).id);
      if (Number.isInteger(newId)) idMap.set(Number(p.devId), newId);
      inserted++;
    }

    let filesInserted = 0;
    for (const f of Array.isArray(raw.files) ? raw.files : []) {
      const newProjectId = idMap.get(Number(f.devProjectId));
      if (!newProjectId || !f.fileName) continue;
      const existing = await db.execute(sql`
        SELECT id FROM project_files WHERE project_id = ${newProjectId} AND file_name = ${f.fileName} LIMIT 1
      `);
      if (((existing as any).rows || existing).length > 0) continue;
      await db.execute(sql`
        INSERT INTO project_files (project_id, file_name, file_path, file_url, file_type, file_size, uploaded_by, created_at)
        VALUES (${newProjectId}, ${f.fileName}, ${f.filePath}, ${f.fileUrl}, ${f.fileType}, ${f.fileSize}, ${f.uploadedBy ?? "system"}, ${f.createdAt})
      `);
      filesInserted++;
    }

    let notesInserted = 0;
    for (const n of Array.isArray(raw.notes) ? raw.notes : []) {
      const newProjectId = idMap.get(Number(n.devProjectId));
      if (!newProjectId || !n.note) continue;
      const existing = await db.execute(sql`
        SELECT id FROM project_notes WHERE project_id = ${newProjectId} AND note = ${n.note} LIMIT 1
      `);
      if (((existing as any).rows || existing).length > 0) continue;
      await db.execute(sql`
        INSERT INTO project_notes (project_id, note, author, created_at)
        VALUES (${newProjectId}, ${n.note}, ${n.author ?? "system"}, ${n.createdAt})
      `);
      notesInserted++;
    }

    console.log(`[ideabrowser-backfill] complete: ${inserted} projects, ${filesInserted} files, ${notesInserted} notes inserted`);
  } catch (err: any) {
    console.error("[ideabrowser-backfill] import error (non-fatal):", err?.message || err);
  }
}
