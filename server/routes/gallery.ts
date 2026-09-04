import type { Express, Request, Response } from "express";
import { db } from "../db";
import { sql } from "drizzle-orm";
import fs from "fs";
import path from "path";

const SHOWCASE_MIME_PREFIXES = [
  "application/pdf",
  "video/",
  "audio/",
  "image/",
  "application/vnd.openxmlformats-officedocument",
  "application/vnd.ms-excel",
  "application/vnd.ms-powerpoint",
  "text/html",
];

const ADMIN_TENANT_ID = 1;
const CACHE_TTL_MS = 60_000;
const DRIVE_URL_HOST_ALLOWLIST = new Set([
  "drive.google.com",
  "docs.google.com",
]);

function safeDriveUrl(raw: unknown): string | null {
  if (typeof raw !== "string" || !raw) return null;
  try {
    const u = new URL(raw);
    if (u.protocol !== "https:") return null;
    if (!DRIVE_URL_HOST_ALLOWLIST.has(u.hostname.toLowerCase())) return null;
    return u.toString();
  } catch {
    return null;
  }
}

let listCache: { ts: number; payload: any } | null = null;

export function registerGalleryRoutes(app: Express) {
  app.get("/api/public/gallery", async (_req: Request, res: Response) => {
    try {
      if (listCache && Date.now() - listCache.ts < CACHE_TTL_MS) {
        res.setHeader("X-Cache", "HIT");
        return res.json(listCache.payload);
      }
      const result: any = await db.execute(sql`
        SELECT id, original_name, mime_type, size, drive_url, created_at
        FROM file_storage
        WHERE tenant_id = ${ADMIN_TENANT_ID}
          AND is_public = true
          AND (
            ${sql.join(
              SHOWCASE_MIME_PREFIXES.map((p) => sql`mime_type LIKE ${p + "%"}`),
              sql` OR `
            )}
          )
          AND size > 1024
        ORDER BY created_at DESC
        LIMIT 24
      `);
      const rows = (result.rows || result) as any[];
      const items = rows.map((r) => {
        const safe = safeDriveUrl(r.drive_url);
        return {
          id: r.id,
          name: r.original_name,
          mimeType: r.mime_type,
          size: Number(r.size),
          hasDriveLink: Boolean(safe),
          driveUrl: safe,
          fileUrl: `/api/public/gallery/file/${r.id}`,
          createdAt: r.created_at,
          kind: classifyKind(r.mime_type),
        };
      });
      const payload = {
        generatedAt: new Date().toISOString(),
        count: items.length,
        items,
      };
      listCache = { ts: Date.now(), payload };
      res.setHeader("X-Cache", "MISS");
      res.json(payload);
    } catch (err: any) {
      res.status(500).json({ error: err?.message ?? "gallery query failed" });
    }
  });

  app.get("/api/public/gallery/file/:id", async (req: Request, res: Response) => {
    try {
      const id = parseInt(String(req.params.id), 10);
      if (!Number.isFinite(id) || id <= 0) {
        return res.status(400).json({ error: "invalid id" });
      }
      const result: any = await db.execute(sql`
        SELECT original_name, mime_type, storage_key, drive_url
        FROM file_storage
        WHERE id = ${id}
          AND tenant_id = ${ADMIN_TENANT_ID}
          AND is_public = true
        LIMIT 1
      `);
      const rows = (result.rows || result) as any[];
      const row = rows[0];
      if (!row) {
        return res.status(404).json({ error: "not found" });
      }
      if (row.storage_key) {
        const safeKey = String(row.storage_key).replace(/[^a-zA-Z0-9._-]/g, "");
        if (!safeKey) {
          return res.status(404).json({ error: "not found" });
        }
        const filePath = path.join(process.cwd(), "uploads", safeKey);
        const uploadsRoot = path.join(process.cwd(), "uploads");
        const resolved = path.resolve(filePath);
        if (!resolved.startsWith(uploadsRoot + path.sep)) {
          return res.status(403).json({ error: "forbidden" });
        }
        if (fs.existsSync(resolved)) {
          res.setHeader("Content-Type", row.mime_type || "application/octet-stream");
          res.setHeader("Accept-Ranges", "bytes");
          return fs.createReadStream(resolved).pipe(res);
        }
      }
      const safeDrive = safeDriveUrl(row.drive_url);
      if (safeDrive) {
        return res.redirect(302, safeDrive);
      }
      res.status(404).json({ error: "no backing file" });
    } catch (err: any) {
      res.status(500).json({ error: err?.message ?? "file fetch failed" });
    }
  });
}

function classifyKind(mime: string): string {
  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("audio/")) return "audio";
  if (mime.startsWith("image/")) return "image";
  if (mime === "application/pdf") return "pdf";
  if (mime.includes("presentation") || mime.includes("powerpoint")) return "slides";
  if (mime.includes("spreadsheet") || mime.includes("excel")) return "spreadsheet";
  if (mime.includes("word") || mime.includes("document")) return "document";
  if (mime === "text/html") return "html";
  return "file";
}
