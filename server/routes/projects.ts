import express, { type Express, type Request } from "express";
import type multer from "multer";
import path from "path";
import crypto from "crypto";
import fsPromises from "fs/promises";
import { db } from "../db";
import { sql } from "drizzle-orm";
import { storage } from "../storage";
import { logSilentCatch } from "../lib/silent-catch";

type ProjectsHelpers = {
  getTenantFromRequest: (req: Request) => number | null;
  authMiddleware: any;
  upload: multer.Multer;
  SAFE_EXTENSIONS: Record<string, string>;
  UPLOADS_DIR: string;
};

/**
 * Round 60: Projects routes extracted from server/routes.ts (~337 LOC removed
 * from the monolith). Pure move — no behavior changes. The /api/projects/:id
 * conversations-union query was previously fixed for snake_case `project_id`.
 */
export function registerProjectsRoutes(app: Express, helpers: ProjectsHelpers) {
  const { getTenantFromRequest, authMiddleware, upload, SAFE_EXTENSIONS, UPLOADS_DIR } = helpers;

  app.get("/api/projects", async (req, res) => {
    try {
      res.set("Cache-Control", "no-cache, no-store, must-revalidate");
      const tenantId = getTenantFromRequest(req);
      if (!tenantId) return res.status(401).json({ error: "Authentication required" });
      console.log(`[projects] Fetching projects for tenant ${tenantId}`);
      const result = await db.execute(sql`
        SELECT p.*,
          (SELECT COUNT(*) FROM project_files WHERE project_id = p.id) as file_count,
          (SELECT COUNT(*) FROM project_notes WHERE project_id = p.id) as note_count,
          (SELECT COUNT(*) FROM project_conversations WHERE project_id = p.id) as conversation_count
        FROM projects p WHERE p.tenant_id = ${tenantId} ORDER BY p.updated_at DESC
      `);
      const rows = (result as any).rows || result;
      console.log(`[projects] Found ${Array.isArray(rows) ? rows.length : 0} projects for tenant ${tenantId}`);
      res.json(rows);
    } catch (e: any) {
      console.error("[projects] Error fetching projects:", e);
      res.status(500).json({ error: "Failed to fetch projects" });
    }
  });

  app.get("/api/projects/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id as string);
      if (isNaN(id)) return res.status(400).json({ error: "Invalid project ID" });
      const tenantId = getTenantFromRequest(req);
      if (!tenantId) return res.status(401).json({ error: "Authentication required" });
      const pResult = await db.execute(sql`SELECT * FROM projects WHERE id = ${id} AND tenant_id = ${tenantId}`);
      const pRows = (pResult as any).rows || pResult;
      const project = Array.isArray(pRows) ? pRows[0] : pRows;
      if (!project) return res.status(404).json({ error: "Not found" });
      // R74.13h: defense-in-depth — even though the parent project row is
      // already tenant-checked above, also constrain dependent reads to the
      // same tenant so any stale/malformed cross-tenant FK can't leak data.
      const files = await db.execute(sql`
        SELECT pf.* FROM project_files pf
        JOIN projects p ON p.id = pf.project_id
        WHERE pf.project_id = ${id} AND p.tenant_id = ${tenantId}
        ORDER BY pf.created_at DESC
      `);
      const notes = await db.execute(sql`
        SELECT pn.* FROM project_notes pn
        JOIN projects p ON p.id = pn.project_id
        WHERE pn.project_id = ${id} AND p.tenant_id = ${tenantId}
        ORDER BY pn.created_at DESC
      `);
      const convs = await db.execute(sql`
        SELECT conversation_id, title, created_at FROM (
          SELECT pc.conversation_id, c.title, c.created_at
          FROM project_conversations pc
          JOIN conversations c ON c.id = pc.conversation_id
          WHERE pc.project_id = ${id} AND c.tenant_id = ${tenantId}
          UNION
          SELECT c.id as conversation_id, c.title, c.created_at
          FROM conversations c
          WHERE c.project_id = ${id} AND c.tenant_id = ${tenantId}
        ) combined ORDER BY created_at DESC
      `);
      res.json({ project, files: (files as any).rows || files, notes: (notes as any).rows || notes, conversations: (convs as any).rows || convs });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.post("/api/projects", async (req, res) => {
    try {
      const tenantId = getTenantFromRequest(req);
      if (!tenantId) return res.status(401).json({ error: "Authentication required" });
      const { name, description, customerName, customerEmail, tags, status } = req.body;
      if (!name?.trim()) return res.status(400).json({ error: "name required" });
      const tagArray = Array.isArray(tags) ? tags.map((t: string) => String(t).slice(0, 100)) : [];
      const tagLiteral = `{${tagArray.map((t: string) => `"${t.replace(/"/g, '\\"')}"`).join(",")}}`;
      const result = await db.execute(sql`
        INSERT INTO projects (name, description, status, customer_name, customer_email, tags, tenant_id)
        VALUES (${name.trim()}, ${description || ''}, ${status || 'active'}, ${customerName || null}, ${customerEmail || null}, ${tagLiteral}::text[], ${tenantId})
        RETURNING *
      `);
      const rows = (result as any).rows || result;
      const project = Array.isArray(rows) ? rows[0] : rows;

      try {
        const tenant = await storage.getTenant(tenantId);
        const tenantName = tenant?.name || `tenant-${tenantId}`;
        const { ensureProjectFolder } = await import("../google-drive");
        const folder = await ensureProjectFolder(project.id, name.trim(), tenantId, tenantName);
        project.drive_folder_id = folder.id;
        project.drive_folder_url = folder.url;
        console.log(`[projects] Auto-created Drive folder for project ${project.id}: ${folder.url}`);
      } catch (driveErr) {
        console.log(`[projects] Drive folder creation skipped: ${(driveErr as Error).message}`);
      }

      res.json(project);
    } catch (e: any) { console.error("[projects] Create error:", e.message); res.status(500).json({ error: "Failed to create project" }); }
  });

  app.patch("/api/projects/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id as string);
      if (isNaN(id)) return res.status(400).json({ error: "Invalid project ID" });
      const tenantId = getTenantFromRequest(req);
      if (!tenantId) return res.status(401).json({ error: "Authentication required" });
      const { name, description, status, customerName, customerEmail, primaryConversationId } = req.body;
      const chunks = [sql`UPDATE projects SET updated_at = CURRENT_TIMESTAMP`];
      if (name !== undefined) chunks.push(sql`, name = ${name}`);
      if (description !== undefined) chunks.push(sql`, description = ${description}`);
      if (status !== undefined) chunks.push(sql`, status = ${status}`);
      if (customerName !== undefined) chunks.push(sql`, customer_name = ${customerName}`);
      if (customerEmail !== undefined) chunks.push(sql`, customer_email = ${customerEmail}`);
      if (primaryConversationId !== undefined) {
        if (primaryConversationId === null) {
          chunks.push(sql`, primary_conversation_id = NULL`);
        } else {
          const convCheck = await db.execute(sql`
            SELECT 1 FROM conversations c
            WHERE c.id = ${primaryConversationId} AND c.tenant_id = ${tenantId}
            AND (
              EXISTS (SELECT 1 FROM project_conversations pc WHERE pc.project_id = ${id} AND pc.conversation_id = ${primaryConversationId})
              OR c.project_id = ${id}
            )
          `);
          const convRows = (convCheck as any).rows || convCheck;
          if (!convRows || (Array.isArray(convRows) && convRows.length === 0)) {
            return res.status(400).json({ error: "Conversation not found or not linked to this project" });
          }
          chunks.push(sql`, primary_conversation_id = ${primaryConversationId}`);
        }
      }
      chunks.push(sql` WHERE id = ${id} AND tenant_id = ${tenantId} RETURNING *`);
      const result = await db.execute(sql.join(chunks, sql.raw("")));
      const rows = (result as any).rows || result;
      const updated = Array.isArray(rows) ? rows[0] : rows;
      if (!updated) return res.status(404).json({ error: "Project not found" });
      res.json(updated);
    } catch (e: any) { res.status(500).json({ error: "Failed to update project" }); }
  });

  app.delete("/api/projects/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id as string);
      if (isNaN(id)) return res.status(400).json({ error: "Invalid project ID" });
      const tenantId = getTenantFromRequest(req);
      if (!tenantId) return res.status(401).json({ error: "Authentication required" });
      await db.execute(sql`DELETE FROM projects WHERE id = ${id} AND tenant_id = ${tenantId}`);
      res.json({ deleted: true });
    } catch (e: any) { res.status(500).json({ error: "Failed to delete project" }); }
  });

  app.post("/api/projects/:id/notes", authMiddleware, async (req, res) => {
    try {
      const id = parseInt(req.params.id as string);
      if (isNaN(id)) return res.status(400).json({ error: "Invalid project ID" });
      const tenantId = getTenantFromRequest(req);
      if (!tenantId) return res.status(401).json({ error: "Authentication required" });
      const projCheck = await db.execute(sql`SELECT id FROM projects WHERE id = ${id} AND tenant_id = ${tenantId}`);
      const projRows = (projCheck as any).rows || projCheck;
      if (!Array.isArray(projRows) || projRows.length === 0) return res.status(404).json({ error: "Project not found" });
      if (!req.body.note?.trim()) return res.status(400).json({ error: "Note content required" });
      const result = await db.execute(sql`
        INSERT INTO project_notes (project_id, note, author)
        VALUES (${id}, ${req.body.note}, ${req.body.author || 'user'})
        RETURNING *
      `);
      const rows = (result as any).rows || result;
      res.json(Array.isArray(rows) ? rows[0] : rows);
    } catch (e: any) { res.status(500).json({ error: "Failed to add note" }); }
  });

  app.post("/api/projects/:id/files-base64", authMiddleware, express.json({ limit: "50mb" }), async (req, res) => {
    try {
      const projectId = parseInt(req.params.id as string);
      if (isNaN(projectId)) return res.status(400).json({ error: "Invalid project ID" });
      const tenantId = getTenantFromRequest(req);
      if (!tenantId) return res.status(401).json({ error: "Authentication required" });
      const projCheck = await db.execute(sql`SELECT id, name, drive_folder_id FROM projects WHERE id = ${projectId} AND tenant_id = ${tenantId}`);
      const projRows = (projCheck as any).rows || projCheck;
      if (!Array.isArray(projRows) || projRows.length === 0) return res.status(404).json({ error: "Project not found" });
      const projectName = projRows[0].name || `Project ${projectId}`;
      const projectDriveFolderId = projRows[0].drive_folder_id || null;
      const { files: fileList } = req.body;
      if (!fileList || !Array.isArray(fileList) || fileList.length === 0) return res.status(400).json({ error: "No files provided" });
      const results: any[] = [];
      for (const f of fileList) {
        const fileBuffer = Buffer.from(f.data, "base64");
        const ext = SAFE_EXTENSIONS[f.mimeType] || path.extname(f.fileName) || ".bin";
        const uniqueName = `${Date.now()}-${crypto.randomBytes(6).toString("hex")}${ext}`;
        const diskPath = path.join(UPLOADS_DIR, uniqueName);
        await fsPromises.writeFile(diskPath, fileBuffer);
        let fileUrl: string | null = null;
        try {
          const { uploadAndShare } = await import("../google-drive");
          const driveResult = await uploadAndShare({ filePath: diskPath, fileName: f.fileName, mimeType: f.mimeType, folderLabel: `Projects/${projectName}`, description: `Project file: ${f.fileName}`, parentFolderId: projectDriveFolderId || undefined, share: true });
          if ((driveResult as any).shareableLink) fileUrl = (driveResult as any).shareableLink;
          else if (driveResult.viewUrl) fileUrl = driveResult.viewUrl;
        } catch (driveErr: any) {
          console.log(`[projects] Drive upload skipped for ${f.fileName}: ${driveErr.message}`);
        }
        const downloadPath = `/api/projects/${projectId}/files/download/${uniqueName}`;
        const result = await db.execute(sql`
          INSERT INTO project_files (project_id, file_name, file_path, file_url, file_type, file_size)
          VALUES (${projectId}, ${f.fileName}, ${"uploads/" + uniqueName}, ${fileUrl || downloadPath}, ${f.mimeType || "application/octet-stream"}, ${fileBuffer.length})
          RETURNING *
        `);
        const rows = (result as any).rows || result;
        results.push(Array.isArray(rows) ? rows[0] : rows);
      }
      await db.execute(sql`UPDATE projects SET updated_at = CURRENT_TIMESTAMP WHERE id = ${projectId}`);
      res.json({ uploaded: results.length, files: results });
    } catch (e: any) {
      console.error("[projects] File upload error:", e.message || e);
      res.status(500).json({ error: e.message || "Failed to upload files" });
    }
  });

  app.post("/api/projects/:id/files", (req, res, next) => {
    upload.array("files", 20)(req, res, (err: any) => {
      if (err) {
        if (err.code === "LIMIT_FILE_SIZE") {
          return res.status(413).json({ error: "File too large. Maximum size is 50 MB per file." });
        }
        if (err.code === "LIMIT_FILE_COUNT") {
          return res.status(400).json({ error: "Too many files. Maximum is 20 files per upload." });
        }
        return res.status(400).json({ error: err.message || "Upload failed" });
      }
      next();
    });
  }, async (req, res) => {
    try {
      const projectId = parseInt(req.params.id as string);
      if (isNaN(projectId)) return res.status(400).json({ error: "Invalid project ID" });
      const tenantId = getTenantFromRequest(req);
      if (!tenantId) return res.status(401).json({ error: "Authentication required" });
      const projCheck = await db.execute(sql`SELECT id, name, drive_folder_id FROM projects WHERE id = ${projectId} AND tenant_id = ${tenantId}`);
      const projRows = (projCheck as any).rows || projCheck;
      if (!Array.isArray(projRows) || projRows.length === 0) {
        return res.status(404).json({ error: "Project not found" });
      }
      const projectName = projRows[0].name || `Project ${projectId}`;
      const projectDriveFolderId = projRows[0].drive_folder_id || null;
      const files = req.files as Express.Multer.File[];
      if (!files || files.length === 0) return res.status(400).json({ error: "No files uploaded" });
      const results: any[] = [];
      for (const file of files) {
        const filePath = `uploads/${file.filename}`;
        let fileUrl: string | null = null;
        try {
          const { uploadAndShare } = await import("../google-drive");
          const driveResult = await uploadAndShare({
            filePath,
            fileName: file.originalname,
            mimeType: file.mimetype,
            folderLabel: `Projects/${projectName}`,
            description: `Project file: ${file.originalname}`,
            parentFolderId: projectDriveFolderId || undefined,
            share: true,
          });
          if ((driveResult as any).shareableLink) {
            fileUrl = (driveResult as any).shareableLink;
          } else if (driveResult.viewUrl) {
            fileUrl = driveResult.viewUrl;
          }
        } catch (driveErr: any) {
          console.log(`[projects] Drive upload skipped for ${file.originalname}: ${driveErr.message}`);
        }
        const downloadPath = `/api/projects/${projectId}/files/download/${file.filename}`;
        const result = await db.execute(sql`
          INSERT INTO project_files (project_id, file_name, file_path, file_url, file_type, file_size)
          VALUES (${projectId}, ${file.originalname}, ${filePath}, ${fileUrl || downloadPath}, ${file.mimetype}, ${file.size})
          RETURNING *
        `);
        const rows = (result as any).rows || result;
        results.push(Array.isArray(rows) ? rows[0] : rows);
      }
      await db.execute(sql`UPDATE projects SET updated_at = CURRENT_TIMESTAMP WHERE id = ${projectId}`);
      res.json({ uploaded: results.length, files: results });
    } catch (e: any) {
      console.error("[projects] File upload error:", e.message || e);
      res.status(500).json({ error: e.message || "Failed to upload files" });
    }
  });

  app.get("/api/projects/:id/files", async (req, res) => {
    try {
      const projectId = parseInt(req.params.id as string);
      if (isNaN(projectId)) return res.status(400).json({ error: "Invalid project ID" });
      const tenantId = getTenantFromRequest(req);
      if (!tenantId) return res.status(401).json({ error: "Authentication required" });
      const projCheck = await db.execute(sql`SELECT id FROM projects WHERE id = ${projectId} AND tenant_id = ${tenantId}`);
      const projRows = (projCheck as any).rows || projCheck;
      if (!Array.isArray(projRows) || projRows.length === 0) {
        return res.status(404).json({ error: "Project not found" });
      }
      const result = await db.execute(sql`SELECT * FROM project_files WHERE project_id = ${projectId} ORDER BY created_at DESC`);
      const rows = (result as any).rows || result;
      res.json(Array.isArray(rows) ? rows : []);
    } catch (e: any) {
      res.status(500).json({ error: "Failed to get files" });
    }
  });

  app.get("/api/projects/:id/files/download/:filename", async (req, res) => {
    try {
      const projectId = parseInt(req.params.id as string);
      if (isNaN(projectId)) return res.status(400).json({ error: "Invalid project ID" });
      const tenantId = getTenantFromRequest(req);
      if (!tenantId) return res.status(401).json({ error: "Authentication required" });
      const projCheck = await db.execute(sql`SELECT id FROM projects WHERE id = ${projectId} AND tenant_id = ${tenantId}`);
      const projRows = (projCheck as any).rows || projCheck;
      if (!Array.isArray(projRows) || projRows.length === 0) {
        return res.status(404).json({ error: "Project not found" });
      }
      const filename = path.basename(req.params.filename as string);
      if (filename !== req.params.filename || filename.includes("..") || filename.includes("/") || filename.includes("\\")) {
        return res.status(400).json({ error: "Invalid filename" });
      }
      const fileRecord = await db.execute(sql`SELECT file_name, file_type, file_path FROM project_files WHERE project_id = ${projectId} AND file_path = ${"uploads/" + filename} LIMIT 1`);
      const fileRow = (fileRecord as any).rows?.[0];
      if (!fileRow) return res.status(404).json({ error: "File not found in project" });
      const filePath = path.join(process.cwd(), "uploads", filename);
      const fs = await import("fs");
      if (!fs.existsSync(filePath)) return res.status(404).json({ error: "File not found on disk" });
      const originalName = fileRow.file_name || filename;
      const mimeType = fileRow.file_type || "application/octet-stream";
      res.setHeader("Content-Disposition", `attachment; filename="${originalName}"`);
      res.setHeader("Content-Type", mimeType);
      const fileStream = fs.createReadStream(filePath);
      fileStream.pipe(res);
    } catch (e: any) {
      res.status(500).json({ error: "Download failed" });
    }
  });

  app.delete("/api/projects/:id/files/:fileId", async (req, res) => {
    try {
      const projectId = parseInt(req.params.id as string);
      const fileId = parseInt(req.params.fileId as string);
      if (isNaN(projectId) || isNaN(fileId)) return res.status(400).json({ error: "Invalid ID" });
      const tenantId = getTenantFromRequest(req);
      if (!tenantId) return res.status(401).json({ error: "Authentication required" });
      const projCheck = await db.execute(sql`SELECT id FROM projects WHERE id = ${projectId} AND tenant_id = ${tenantId}`);
      const projRows = (projCheck as any).rows || projCheck;
      if (!Array.isArray(projRows) || projRows.length === 0) {
        return res.status(404).json({ error: "Project not found" });
      }
      await db.execute(sql`DELETE FROM project_files WHERE id = ${fileId} AND project_id = ${projectId}`);
      res.json({ deleted: true });
    } catch (e: any) {
      res.status(500).json({ error: "Failed to delete file" });
    }
  });
}
