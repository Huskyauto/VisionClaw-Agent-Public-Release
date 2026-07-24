// Export all IdeaBrowser/Isenberg-tagged projects (+ their files) from the
// dev database into data/ideabrowser-backfill.json so the boot-time importer
// (server/lib/ideabrowser-backfill.ts) can idempotently seed them into prod.
// One-line runnable: npx tsx scripts/ideabrowser-backfill-export.ts
import { db } from "../server/db";
import { sql } from "drizzle-orm";
import { writeFileSync } from "fs";
import path from "path";

const IDEA_TAGS = ["ideabrowser", "isenberg", "isenberg-iotd", "iotd", "idea-stage", "ideabrowser-weekly-run"];

async function main() {
  const tagLiteral = `{${IDEA_TAGS.join(",")}}`;
  const projRes = await db.execute(sql`
    SELECT id, name, description, status, tags, metadata, tenant_id,
           created_at, updated_at, drive_folder_id, drive_folder_url, current_state
    FROM projects
    WHERE tags && ${tagLiteral}::text[]
    ORDER BY id
  `);
  const projects = ((projRes as any).rows || projRes) as any[];
  if (projects.length === 0) {
    console.error("No ideabrowser-tagged projects found in dev DB — refusing to write an empty backfill file.");
    process.exit(1);
  }

  const ids = projects.map((p) => Number(p.id)).filter((n) => Number.isInteger(n));
  const idLiteral = `{${ids.join(",")}}`;
  const fileRes = await db.execute(sql`
    SELECT f.project_id, f.file_name, f.file_path, f.file_url, f.file_type, f.file_size, f.uploaded_by, f.created_at
    FROM project_files f
    WHERE f.project_id = ANY(${idLiteral}::int[])
    ORDER BY f.id
  `);
  const files = ((fileRes as any).rows || fileRes) as any[];

  const noteRes = await db.execute(sql`
    SELECT n.project_id, n.note, n.author, n.created_at
    FROM project_notes n
    WHERE n.project_id = ANY(${idLiteral}::int[])
    ORDER BY n.id
  `);
  const notes = ((noteRes as any).rows || noteRes) as any[];

  const out = {
    exportedAt: new Date().toISOString(),
    kind: "ideabrowser-backfill",
    projects: projects.map((p) => ({
      // dev id kept only as a join key WITHIN this file; never inserted
      devId: Number(p.id),
      name: p.name,
      description: p.description ?? "",
      status: p.status ?? "active",
      tags: p.tags ?? [],
      metadata: p.metadata ?? {},
      tenantId: Number(p.tenant_id),
      createdAt: p.created_at,
      updatedAt: p.updated_at,
      driveFolderId: p.drive_folder_id ?? null,
      driveFolderUrl: p.drive_folder_url ?? null,
      currentState: p.current_state ?? "",
    })),
    files: files.map((f) => ({
      devProjectId: Number(f.project_id),
      fileName: f.file_name,
      filePath: f.file_path ?? null,
      fileUrl: f.file_url ?? null,
      fileType: f.file_type ?? null,
      fileSize: f.file_size ?? null,
      uploadedBy: f.uploaded_by ?? "system",
      createdAt: f.created_at,
    })),
    notes: notes.map((n) => ({
      devProjectId: Number(n.project_id),
      note: n.note,
      author: n.author ?? null,
      createdAt: n.created_at,
    })),
  };

  const outPath = path.resolve(process.cwd(), "data/ideabrowser-backfill.json");
  writeFileSync(outPath, JSON.stringify(out, null, 1));
  console.log(`Wrote ${out.projects.length} projects, ${out.files.length} files, ${out.notes.length} notes -> ${outPath}`);
  process.exit(0);
}

main().catch((e) => {
  console.error("export failed:", e?.message || e);
  process.exit(1);
});
