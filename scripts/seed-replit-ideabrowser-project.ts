/**
 * Seeds the "Bob's Replit Ideabrowser" project — a long-running container for
 * agent-originated concepts (the ones I generate, not Isenberg's). Creates the
 * project + a Drive folder + uploads the three docs from 2026-05-25:
 *
 *   1. docs/agent-original-concepts-2026-05-25.md         (the 12 concepts)
 *   2. docs/youtube-portfolio-ops-onepager-2026-05-25.md  (the top pick one-pager)
 *   3. docs/isenberg-portfolio-prioritization-2026-05-25.md (cross-reference brief)
 *
 * Idempotent: if a project with the exact name already exists in tenant 1, it
 * reuses it and only uploads any missing files.
 */
import { db } from "../server/db";
import { sql } from "drizzle-orm";
import { storage } from "../server/storage";
import { ensureProjectFolder, uploadAndShare } from "../server/google-drive";
import * as fs from "fs";
import * as path from "path";

const TENANT_ID = 1;
const PROJECT_NAME = "Bob's Replit Ideabrowser";
const DESCRIPTION =
  "Agent-originated concept set + ongoing wedge ideation for VisionClaw. This is the counterpart to the Isenberg/Idea Browser inbound feed: ideas I (the agent) generate by cross-referencing what people actually build on platforms like Replit, what VisionClaw uniquely wins, and what's missing from external ideation sources. New concept briefs land here over time; existing concepts get re-scored against current strategy.";
const TAGS = ["agent-ideation", "replit-ideabrowser", "strategy", "wedge-candidates", "tier:meta"];

const FILES = [
  {
    path: "docs/agent-original-concepts-2026-05-25.md",
    mime: "text/markdown",
    desc: "Agent-originated 12 concepts brief (2026-05-25)",
  },
  {
    path: "docs/youtube-portfolio-ops-onepager-2026-05-25.md",
    mime: "text/markdown",
    desc: "YouTube Portfolio Ops one-pager (Isenberg portfolio top S-tier pick)",
  },
  {
    path: "docs/isenberg-portfolio-prioritization-2026-05-25.md",
    mime: "text/markdown",
    desc: "Isenberg/Idea Browser portfolio prioritization brief (cross-reference)",
  },
  {
    path: "docs/wedge-launch-plan-2026-05-25.md",
    mime: "text/markdown",
    desc: "Three-wedge launch plan with 7/14/21-day checklists and kill criteria",
  },
  {
    path: "docs/isenberg-outreach-dm-draft-2026-05-25.md",
    mime: "text/markdown",
    desc: "Greg Isenberg cold DM draft — HITL approval required before send",
  },
];

(async () => {
  const tenant = await storage.getTenant(TENANT_ID);
  const tenantName = tenant?.name || `tenant-${TENANT_ID}`;

  // Idempotent project lookup
  const existing: any = await db.execute(sql`
    SELECT id, drive_folder_id, drive_folder_url
    FROM projects WHERE tenant_id=${TENANT_ID} AND name=${PROJECT_NAME} LIMIT 1
  `);
  const existingRow = (existing.rows || existing)[0];

  let projectId: number;
  let driveFolderId: string | null = null;
  let driveFolderUrl: string | null = null;

  if (existingRow) {
    projectId = existingRow.id;
    driveFolderId = existingRow.drive_folder_id;
    driveFolderUrl = existingRow.drive_folder_url;
    console.log(`[seed] reusing existing project #${projectId}`);
  } else {
    const tagLiteral = `{${TAGS.map((t) => `"${t.replace(/"/g, '\\"')}"`).join(",")}}`;
    const ins: any = await db.execute(sql`
      INSERT INTO projects (name, description, status, tags, tenant_id)
      VALUES (${PROJECT_NAME}, ${DESCRIPTION}, 'active', ${tagLiteral}::text[], ${TENANT_ID})
      RETURNING id
    `);
    projectId = ((ins.rows || ins)[0] as any).id;
    console.log(`[seed] created project #${projectId}`);
  }

  if (!driveFolderId) {
    try {
      const folder = await ensureProjectFolder(projectId, PROJECT_NAME, TENANT_ID, tenantName);
      driveFolderId = folder.id;
      driveFolderUrl = folder.url;
      await db.execute(sql`
        UPDATE projects SET drive_folder_id=${folder.id}, drive_folder_url=${folder.url}
        WHERE id=${projectId} AND tenant_id=${TENANT_ID}
      `);
      console.log(`[seed] drive folder: ${folder.url}`);
    } catch (e: any) {
      console.warn(`[seed] drive folder setup failed: ${e.message}`);
    }
  } else {
    console.log(`[seed] existing drive folder: ${driveFolderUrl}`);
  }

  // Upload each file (skip if same filename already in project_files)
  const already: any = await db.execute(sql`
    SELECT file_name FROM project_files WHERE project_id=${projectId}
  `);
  const haveNames = new Set<string>((already.rows || already).map((r: any) => r.file_name));

  for (const f of FILES) {
    const filename = path.basename(f.path);
    if (haveNames.has(filename)) {
      console.log(`[seed] ✓ already uploaded: ${filename}`);
      continue;
    }
    if (!fs.existsSync(f.path)) {
      console.warn(`[seed] ✗ missing: ${f.path}`);
      continue;
    }
    if (!driveFolderId) {
      console.warn(`[seed] ✗ no drive folder, skipping ${filename}`);
      continue;
    }
    try {
      const up = await uploadAndShare({
        filePath: f.path,
        fileName: filename,
        mimeType: f.mime,
        folderLabel: `Projects/${PROJECT_NAME}`,
        description: f.desc,
        parentFolderId: driveFolderId,
        share: true,
      });
      await db.execute(sql`
        INSERT INTO project_files (project_id, file_name, file_path, file_url, file_type, file_size, uploaded_by)
        VALUES (${projectId}, ${filename}, ${f.path}, ${up.viewUrl}, ${f.mime}, ${fs.statSync(f.path).size}, 'seed-replit-ideabrowser-project')
      `);
      console.log(`[seed] ↑ uploaded ${filename} — ${up.viewUrl}`);
    } catch (e: any) {
      console.warn(`[seed] ✗ upload failed ${filename}: ${e.message}`);
    }
  }

  console.log(`\n========== SUMMARY ==========`);
  console.log(`Project: #${projectId} — ${PROJECT_NAME}`);
  if (driveFolderUrl) console.log(`Drive folder: ${driveFolderUrl}`);

  process.exit(0);
})().catch((e) => {
  console.error("[FATAL]", e);
  process.exit(1);
});
