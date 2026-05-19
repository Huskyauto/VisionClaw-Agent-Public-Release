import { type Express, type Request, type Response } from "express";
import { db } from "../db";
import { sql, and, eq, inArray } from "drizzle-orm";
import { storage, memoryEntrySafeCols } from "../storage";
import { insertMemoryEntrySchema, memoryEntries } from "@shared/schema";
import { generateEmbedding, generateAndStoreEmbeddings } from "../embeddings";

type MemoryHelpers = {
  getTenantFromRequest: (req: Request) => number | null;
  isAdminRequest: (req: Request) => boolean;
  ADMIN_TENANT_ID: number;
  requirePlatformAdmin: (req: Request, res: Response) => boolean;
};

/**
 * Round 60+ Stage 5: Memory routes extracted from server/routes.ts (~310 LOC
 * removed from the monolith). 16 of the 18 memory routes — pure move with zero
 * behavior change. The 2 multer-heavy upload routes (`/api/memory/upload` and
 * `/api/memory/upload-chunked`, ~191 LOC each) are intentionally NOT extracted
 * here: they share the upload pipeline closures (validateUploadedFile,
 * assembleChunkedFile) with the wider file-storage routes, so moving them is a
 * separate Stage 5b task that should bundle file-storage routes too.
 *
 * Routes covered: CRUD (list/create/update/delete), categories+graph+links,
 * intelligence (categorize-existing, health, deduplicate), backfill-embeddings
 * (admin), backup (admin), export, backup-to-drive, compaction-archives, stats.
 */
export function registerMemoryRoutes(app: Express, helpers: MemoryHelpers) {
  const { getTenantFromRequest, isAdminRequest, ADMIN_TENANT_ID, requirePlatformAdmin } = helpers;

  // ─── CRUD ─────────────────────────────────────────────────
  app.get("/api/memory", async (req, res) => {
    const tenantId = getTenantFromRequest(req);
    if (!tenantId) return res.status(401).json({ error: "Authentication required" });
    const personaId = req.query.personaId ? parseInt(req.query.personaId as string) : undefined;
    const limit = req.query.limit ? parseInt(req.query.limit as string) : 100;
    const offset = req.query.offset ? parseInt(req.query.offset as string) : 0;
    res.json(await storage.getMemoryEntries(personaId, limit, offset, tenantId));
  });

  app.post("/api/memory", async (req, res) => {
    const tenantId = getTenantFromRequest(req);
    if (!tenantId) return res.status(401).json({ error: "Authentication required" });
    const parsed = insertMemoryEntrySchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.message });
    const entry = await storage.createMemoryEntry({ ...parsed.data, tenantId });
    generateEmbedding(entry.fact).then((emb) => {
      if (emb) storage.updateMemoryEmbedding(entry.id, emb).catch(() => {});
    }).catch(() => {});
    res.status(201).json(entry);
  });

  app.patch("/api/memory/:id", async (req, res) => {
    const tenantId = getTenantFromRequest(req);
    if (!tenantId) return res.status(401).json({ error: "Authentication required" });
    const memId = parseInt(req.params.id as string);
    const scope = isAdminRequest(req) ? undefined : tenantId;
    const existing = await storage.getMemoryEntry(memId, scope);
    if (!existing) return res.status(404).json({ error: "Not found" });
    if (existing.tenantId !== tenantId && !isAdminRequest(req)) {
      return res.status(403).json({ error: "Access denied" });
    }
    const parsed = insertMemoryEntrySchema.partial().safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.message });
    const entry = await storage.updateMemoryEntry(memId, parsed.data);
    if (!entry) return res.status(404).json({ error: "Not found" });
    res.json(entry);
  });

  // R54.B: replace list-then-search IDOR (only checked first 1000 rows) with direct scoped lookup
  app.delete("/api/memory/:id", async (req, res) => {
    const tenantId = getTenantFromRequest(req);
    if (!tenantId) return res.status(401).json({ error: "Authentication required" });
    const memId = parseInt(req.params.id as string);
    const scope = isAdminRequest(req) ? undefined : tenantId;
    const existing = await storage.getMemoryEntry(memId, scope);
    if (!existing) return res.status(404).json({ error: "Not found" });
    if (existing.tenantId !== tenantId && !isAdminRequest(req)) {
      return res.status(403).json({ error: "Access denied" });
    }
    // R98.22+sec — pass tenant scope to the storage delete (admins remain
    // unscoped). Previously the bare `deleteMemoryEntry(memId)` allowed
    // cross-tenant soft-delete if the prior tenant check was bypassed.
    await storage.deleteMemoryEntry(memId, scope);
    res.status(204).send();
  });

  // ─── Categories / Graph / Links ───────────────────────────
  app.get("/api/memory/categories", async (req, res) => {
    const tenantId = getTenantFromRequest(req);
    if (!tenantId) return res.status(401).json({ error: "Authentication required" });
    try {
      const { getCategoryTree } = await import("../memory-graph");
      const tree = await getCategoryTree(tenantId);
      res.json(tree);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/memory/graph", async (req, res) => {
    const tenantId = getTenantFromRequest(req);
    if (!tenantId) return res.status(401).json({ error: "Authentication required" });
    try {
      const { getMemoryGraph } = await import("../memory-graph");
      const graph = await getMemoryGraph(tenantId);
      res.json(graph);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/memory/categorize-existing", async (req, res) => {
    const tenantId = getTenantFromRequest(req);
    if (!tenantId) return res.status(401).json({ error: "Authentication required" });
    if (!isAdminRequest(req)) return res.status(403).json({ error: "Admin only" });
    try {
      const { categorizeExistingMemories } = await import("../memory-graph");
      const count = await categorizeExistingMemories(tenantId);
      res.json({ success: true, categorized: count });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/memory/:id/links", async (req, res) => {
    const tenantId = getTenantFromRequest(req);
    if (!tenantId) return res.status(401).json({ error: "Authentication required" });
    try {
      const scope = isAdminRequest(req) ? undefined : tenantId;
      const sourceEntry = await storage.getMemoryEntry(parseInt(req.params.id as string), scope);
      if (!sourceEntry) return res.status(404).json({ error: "Memory not found" });
      if (sourceEntry.tenantId !== tenantId && !isAdminRequest(req)) {
        return res.status(403).json({ error: "Access denied" });
      }
      const { getLinkedMemories } = await import("../memory-graph");
      // R116 — pass tenantId for defense-in-depth (admin bypass = null)
      const linkedIds = await getLinkedMemories(
        parseInt(req.params.id as string),
        isAdminRequest(req) ? null : tenantId,
      );
      if (linkedIds.length === 0) return res.json([]);
      // R74.13k — B-MEDIUM fix from whole-app review (with F4-followup from
      // the re-review pass). Was: load each linked memory by ID with an
      // unscoped storage.getMemoryEntry() then filter at the app layer. That
      // works for visibility but iterates across tenant boundaries
      // (cross-tenant existence could leak via timing/behavior). Now: single
      // batch query with tenant predicate baked in, projecting through the
      // canonical memoryEntrySafeCols (re-exported from storage.ts) so the
      // response shape EXACTLY matches what storage.getMemoryEntry returned —
      // no client contract change, zero N+1, no cross-tenant fetch.
      const tenantClause = tenantId === ADMIN_TENANT_ID
        ? sql`TRUE`
        : eq(memoryEntries.tenantId, tenantId);
      const linkedEntries = await db.select(memoryEntrySafeCols).from(memoryEntries).where(
        and(inArray(memoryEntries.id, linkedIds), tenantClause)
      );
      res.json(linkedEntries);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ─── Stats / Backfill / Health / Dedupe / Backup ─────────
  app.get("/api/memory/stats", async (req, res) => {
    const tenantId = getTenantFromRequest(req);
    if (!tenantId) return res.status(401).json({ error: "Authentication required" });
    const personaId = req.query.personaId ? parseInt(req.query.personaId as string) : undefined;
    const stats = await storage.getMemoryStats(personaId, tenantId);
    res.json(stats);
  });

  app.post("/api/memory/backfill-embeddings", async (req, res) => {
    // R60 + R74.13k (B/D-HIGH from whole-app review) — PLATFORM admin only,
    // not just any tenant-admin: getMemoriesWithoutEmbeddings + getKnowledge
    // WithoutEmbeddings query GLOBALLY (no tenant predicate), so this both
    // burns the shared OpenAI quota and could touch foreign-tenant rows.
    // Tightened from isAdminRequest (any tenant's admin user) to
    // requirePlatformAdmin (platform tenant + admin claim).
    if (!requirePlatformAdmin(req, res)) return;
    try {
      const memoriesWithout = await storage.getMemoriesWithoutEmbeddings(100);
      const knowledgeWithout = await storage.getKnowledgeWithoutEmbeddings(100);

      const memCount = await generateAndStoreEmbeddings(
        memoriesWithout.map((m) => ({ id: m.id, text: m.fact })),
        (id, emb) => storage.updateMemoryEmbedding(id, emb),
      );
      const kCount = await generateAndStoreEmbeddings(
        knowledgeWithout.map((k) => ({ id: k.id, text: `${k.title} ${k.content}` })),
        (id, emb) => storage.updateKnowledgeEmbedding(id, emb),
      );

      res.json({
        memoriesProcessed: memCount,
        knowledgeProcessed: kCount,
        memoriesRemaining: Math.max(0, memoriesWithout.length - memCount),
        knowledgeRemaining: Math.max(0, knowledgeWithout.length - kCount),
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/memory/health", async (req, res) => {
    try {
      const personaId = req.query.personaId ? parseInt(req.query.personaId as string) : undefined;
      const tenantId = getTenantFromRequest(req);
      if (!tenantId) return res.status(401).json({ error: "Authentication required" });
      const { getMemoryHealth } = await import("../memory-intelligence");
      const health = await getMemoryHealth(personaId, tenantId);
      res.json(health);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/memory/deduplicate", async (req, res) => {
    try {
      const personaId = req.body?.personaId ?? undefined;
      const tenantId = getTenantFromRequest(req);
      if (!tenantId) return res.status(401).json({ error: "Authentication required" });
      const { deduplicateMemories } = await import("../memory-intelligence");
      const result = await deduplicateMemories(personaId, tenantId);
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/memory/backup", async (req, res) => {
    // R60 + R74.13k (B/D-HIGH from whole-app review) — PLATFORM admin only.
    // runMemoryBackupToGoogleDrive() dumps ALL tenant memory to a shared
    // Drive folder; must not be triggerable by a non-platform tenant-admin.
    // Per-tenant self-backup lives at /api/memory/backup-to-drive (which is
    // tenant-scoped and intentionally accessible to any authenticated tenant).
    if (!requirePlatformAdmin(req, res)) return;
    try {
      const { runMemoryBackupToGoogleDrive } = await import("../backup");
      const summary = await runMemoryBackupToGoogleDrive();
      res.json({ success: true, summary });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ─── Export / Drive backup / Compaction archives ─────────
  app.get("/api/memory/export", async (req, res) => {
    const tenantId = getTenantFromRequest(req);
    if (!tenantId) return res.status(401).json({ error: "Unauthorized" });
    try {
      const memoriesResult = await db.execute(sql`
        SELECT id, fact, category, source, status, persona_id, access_count, created_at, last_accessed, expires_at
        FROM memory_entries WHERE tenant_id = ${tenantId}
        ORDER BY created_at DESC
      `);
      const memories = (memoriesResult as any).rows || memoriesResult;

      const archivesResult = await db.execute(sql`
        SELECT ca.id, ca.conversation_id, ca.archived_at, ca.message_count, ca.total_messages, ca.summary
        FROM compaction_archives ca
        INNER JOIN conversations c ON c.id = ca.conversation_id
        WHERE c.tenant_id = ${tenantId}
        ORDER BY ca.archived_at DESC
      `).catch(() => ({ rows: [] }));
      const archives = (archivesResult as any).rows || archivesResult;

      const active = memories.filter((m: any) => m.status === "active");
      const archived = memories.filter((m: any) => m.status === "archived");
      const superseded = memories.filter((m: any) => m.status === "superseded");

      const exportData = {
        exportType: "tenant_memory_backup",
        exportTimestamp: new Date().toISOString(),
        tenantId,
        stats: {
          totalMemories: memories.length,
          active: active.length,
          archived: archived.length,
          superseded: superseded.length,
          compactionArchives: archives.length,
        },
        activeMemories: active,
        archivedMemories: archived,
        supersededMemories: superseded,
        compactionArchives: archives.map((a: any) => ({
          id: a.id,
          conversationId: a.conversation_id,
          archivedAt: a.archived_at,
          messageCount: a.message_count,
          summary: a.summary,
        })),
      };

      res.json(exportData);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.post("/api/memory/backup-to-drive", async (req, res) => {
    const tenantId = getTenantFromRequest(req);
    if (!tenantId) return res.status(401).json({ error: "Unauthorized" });
    try {
      const memoriesResult = await db.execute(sql`
        SELECT id, fact, category, source, status, persona_id, access_count, created_at, last_accessed
        FROM memory_entries WHERE tenant_id = ${tenantId}
        ORDER BY created_at DESC
      `);
      const memories = (memoriesResult as any).rows || memoriesResult;

      const archivesResult = await db.execute(sql`
        SELECT ca.id, ca.conversation_id, ca.archived_at, ca.message_count, ca.total_messages, ca.content
        FROM compaction_archives ca
        INNER JOIN conversations c ON c.id = ca.conversation_id
        WHERE c.tenant_id = ${tenantId}
        ORDER BY ca.archived_at DESC
      `).catch(() => ({ rows: [] }));
      const archives = (archivesResult as any).rows || archivesResult;

      const active = memories.filter((m: any) => m.status === "active");
      const archived = memories.filter((m: any) => m.status === "archived");
      const superseded = memories.filter((m: any) => m.status === "superseded");

      const tenant = await storage.getTenant(tenantId);
      const tenantName = tenant?.name || `tenant-${tenantId}`;

      const backupData = {
        exportType: "tenant_memory_backup",
        exportTimestamp: new Date().toISOString(),
        tenantId,
        tenantName,
        stats: {
          totalMemories: memories.length,
          active: active.length,
          archived: archived.length,
          superseded: superseded.length,
          compactionArchives: archives.length,
        },
        activeMemories: active,
        archivedMemories: archived,
        supersededMemories: superseded,
        compactionArchives: archives.map((a: any) => ({
          id: a.id,
          conversationId: a.conversation_id,
          archivedAt: a.archived_at,
          messageCount: a.message_count,
          totalMessages: a.total_messages,
          content: a.content,
        })),
      };

      const { uploadAndShare } = await import("../google-drive");
      const dateStr = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
      const fileName = `memory-backup-${tenantName.replace(/[^a-zA-Z0-9]/g, "-")}-${dateStr}.json`;
      const jsonContent = JSON.stringify(backupData, null, 2);
      const tmpPath = `/tmp/${fileName}`;
      const fsMod = await import("fs/promises");
      await fsMod.writeFile(tmpPath, jsonContent);

      const result = await uploadAndShare({ filePath: tmpPath, fileName, folderLabel: `VisionClaw Backups/Tenant Memory Backups` });
      await fsMod.unlink(tmpPath);

      res.json({
        success: true,
        fileName,
        driveUrl: result.viewUrl,
        stats: backupData.stats,
      });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.get("/api/memory/compaction-archives", async (req, res) => {
    const tenantId = getTenantFromRequest(req);
    if (!tenantId) return res.status(401).json({ error: "Unauthorized" });
    try {
      const conversationId = req.query.conversationId ? parseInt(req.query.conversationId as string) : undefined;
      let result;
      if (conversationId) {
        result = await db.execute(sql`
          SELECT ca.id, ca.conversation_id, ca.archived_at, ca.message_count, ca.total_messages, ca.summary,
                 LENGTH(ca.content) as content_length
          FROM compaction_archives ca
          INNER JOIN conversations c ON c.id = ca.conversation_id
          WHERE c.tenant_id = ${tenantId} AND ca.conversation_id = ${conversationId}
          ORDER BY ca.archived_at DESC LIMIT 50
        `);
      } else {
        result = await db.execute(sql`
          SELECT ca.id, ca.conversation_id, ca.archived_at, ca.message_count, ca.total_messages, ca.summary,
                 LENGTH(ca.content) as content_length
          FROM compaction_archives ca
          INNER JOIN conversations c ON c.id = ca.conversation_id
          WHERE c.tenant_id = ${tenantId}
          ORDER BY ca.archived_at DESC LIMIT 50
        `);
      }
      res.json((result as any).rows || result);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });
}
