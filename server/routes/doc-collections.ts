// R74.13t — Stage 19 of routes.ts decomposition.
// 12 routes for Document Collections — search, status, get, list, create,
// delete, add-document, single-file upload, chunked upload (init/append/
// finish), delete-document, context, embed:
// /api/doc-collections/{search, status, get, "" GET, "" POST, /:id DELETE,
//  /:id/documents POST, /:id/upload POST (multer), /:id/upload-chunked POST,
//  /:id/documents/:docPath DELETE, /:id/context POST, /:id/embed POST}.
// All tenant-scoped via getTenantFromRequest. The chunked-upload sub-state
// (chunkedUploads Map + multer `upload` instance) is owned by routes.ts
// — passed in via helpers so the cleanup janitor at routes.ts L292 stays
// authoritative (single source of truth for stale-upload sweeps).
// Extracted verbatim from server/routes.ts L4821-L5229.
import type { Express, Request, Response } from "express";
import express from "express";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { storage } from "../storage";
import { logSilentCatch } from "../lib/silent-catch";

type DocCollectionsHelpers = {
  getTenantFromRequest: (req: Request) => number | null;
  upload: any;
  chunkUpload: any;
  chunkedUploads: Map<string, any>;
  UPLOADS_DIR: string;
  validateUploadedFile: (req: Request, res: Response) => Promise<boolean>;
  extractTextFromFile: (filePath: string, ext: string) => Promise<string>;
};

export async function registerDocCollectionsRoutes(app: Express, helpers: DocCollectionsHelpers) {
  const { getTenantFromRequest, upload, chunkUpload, chunkedUploads, UPLOADS_DIR, validateUploadedFile, extractTextFromFile } = helpers;

  // ─── Document Collections ──────────────────────────────
  const docCollections = await import("../doc-collections");

  app.get("/api/doc-collections/search", async (req, res) => {
    try {
      const tenantId = getTenantFromRequest(req);
      if (!tenantId) return res.status(401).json({ error: "Authentication required" });
      const { q, collection, mode, topK, minScore } = req.query;
      if (!q) return res.status(400).json({ error: "q (query) is required" });
      res.json(await docCollections.searchDocuments(String(q), tenantId, {
        collection: collection ? String(collection) : undefined,
        mode: (mode as any) || "keyword",
        topK: topK ? Number(topK) : undefined,
        minScore: minScore ? Number(minScore) : undefined,
      }));
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  app.get("/api/doc-collections/status", async (req, res) => {
    try {
      const tenantId = getTenantFromRequest(req);
      if (!tenantId) return res.status(401).json({ error: "Authentication required" });
      res.json(await docCollections.getCollectionStatus(tenantId));
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  app.get("/api/doc-collections/get", async (req, res) => {
    try {
      const tenantId = getTenantFromRequest(req);
      if (!tenantId) return res.status(401).json({ error: "Authentication required" });
      const docPath = req.query.docPath ? String(req.query.docPath) : "";
      if (!docPath) return res.status(400).json({ error: "docPath query parameter is required" });
      const collection = req.query.collection ? String(req.query.collection) : undefined;
      res.json(await docCollections.getDocument(docPath, tenantId, collection));
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  app.get("/api/doc-collections", async (req, res) => {
    try {
      const tenantId = getTenantFromRequest(req);
      if (!tenantId) return res.status(401).json({ error: "Authentication required" });
      res.json(await docCollections.listCollections(tenantId));
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  app.post("/api/doc-collections", async (req, res) => {
    try {
      const tenantId = getTenantFromRequest(req);
      if (!tenantId) return res.status(401).json({ error: "Authentication required" });
      const { name, description } = req.body;
      if (!name) return res.status(400).json({ error: "name is required" });
      res.json(await docCollections.createCollection(name, description || "", tenantId));
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  app.delete("/api/doc-collections/:id", async (req, res) => {
    try {
      const tenantId = getTenantFromRequest(req);
      if (!tenantId) return res.status(401).json({ error: "Authentication required" });
      res.json(await docCollections.deleteCollection(Number((req.params.id as string)), tenantId));
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  app.post("/api/doc-collections/:id/documents", async (req, res) => {
    try {
      const tenantId = getTenantFromRequest(req);
      if (!tenantId) return res.status(401).json({ error: "Authentication required" });
      const { docPath, content, context, autoContextualize } = req.body;
      if (!docPath || !content) return res.status(400).json({ error: "docPath and content are required" });
      const auto = autoContextualize === true || autoContextualize === "true";
      res.json(await docCollections.addDocument(Number((req.params.id as string)), docPath, content, context || "", tenantId, { autoContextualize: auto }));
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  app.post("/api/doc-collections/:id/upload", upload.single("file"), async (req: any, res) => {
    try {
      const tenantId = getTenantFromRequest(req);
      if (!tenantId) return res.status(401).json({ error: "Authentication required" });
      const file = req.file;
      if (!file) return res.status(400).json({ error: "No file uploaded" });
      if (!(await validateUploadedFile(req, res))) return;
      const ext = path.extname(file.originalname).toLowerCase();
      const textContent = await extractTextFromFile(file.path, ext);
      if (!textContent.trim()) { try { fs.unlinkSync(file.path); } catch (_silentErr) { logSilentCatch("server/routes.ts", _silentErr); } return res.status(400).json({ error: "File is empty or could not be parsed" }); }
      const context = (req.body.context as string) || "";
      const autoContextualize = req.body.autoContextualize === true || req.body.autoContextualize === "true";
      const docPath = file.originalname;
      const result = await docCollections.addDocument(Number((req.params.id as string)), docPath, textContent, context, tenantId, { autoContextualize });
      try { fs.unlinkSync(file.path); } catch (_silentErr) { logSilentCatch("server/routes.ts", _silentErr); }
      res.json({ ...result, extractedLength: textContent.length, fileName: file.originalname });
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  app.post("/api/knowledge/upload", upload.single("file"), async (req: any, res) => {
    try {
      const tenantId = getTenantFromRequest(req);
      if (!tenantId) return res.status(401).json({ error: "Authentication required" });
      const file = req.file;
      if (!file) return res.status(400).json({ error: "No file uploaded" });
      if (!(await validateUploadedFile(req, res))) return;
      const ext = path.extname(file.originalname).toLowerCase();
      const textContent = await extractTextFromFile(file.path, ext);
      if (!textContent.trim()) { try { fs.unlinkSync(file.path); } catch (_silentErr) { logSilentCatch("server/routes.ts", _silentErr); } return res.status(400).json({ error: "File is empty or could not be parsed" }); }
      const category = (req.body.category as string) || "reference";
      const priority = parseInt(req.body.priority as string) || 3;
      const personaId = req.body.personaId ? parseInt(req.body.personaId as string) : undefined;
      const MAX_CHUNK = 4000;
      const paragraphs = textContent.split(/\n\s*\n/).filter((p: string) => p.trim());
      const chunks: string[] = [];
      let currentChunk = "";
      for (const para of paragraphs) {
        if ((currentChunk + "\n\n" + para).length > MAX_CHUNK && currentChunk) {
          chunks.push(currentChunk.trim());
          currentChunk = para;
        } else {
          currentChunk = currentChunk ? currentChunk + "\n\n" + para : para;
        }
      }
      if (currentChunk.trim()) chunks.push(currentChunk.trim());
      if (chunks.length === 0) chunks.push(textContent.slice(0, MAX_CHUNK));
      const created: any[] = [];
      const baseName = file.originalname.replace(/\.[^.]+$/, "");
      for (let i = 0; i < chunks.length; i++) {
        const title = chunks.length === 1 ? baseName : `${baseName} (Part ${i + 1}/${chunks.length})`;
        const entry = await storage.createKnowledge({
          title,
          content: chunks[i],
          category,
          priority,
          source: "file-upload",
          personaId: personaId ?? null,
          tenantId,
        });
        created.push(entry);
      }
      try { fs.unlinkSync(file.path); } catch (_silentErr) { logSilentCatch("server/routes.ts", _silentErr); }
      res.json({ success: true, entriesCreated: created.length, fileName: file.originalname, extractedLength: textContent.length });
      setImmediate(async () => {
        try {
          const { generateEmbedding } = await import("../embeddings");
          for (const entry of created) {
            try {
              const embedding = await generateEmbedding(`${entry.title} ${entry.content}`);
              if (embedding) await storage.updateKnowledgeEmbedding(entry.id, embedding);
            } catch (_silentErr) { logSilentCatch("server/routes.ts", _silentErr); }
          }
          console.log(`[upload] Background embeddings done for ${created.length} knowledge chunks`);
        } catch (e) { console.error("[upload] Background embedding error:", e); }
      });
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  app.post("/api/memory/upload", upload.single("file"), async (req: any, res) => {
    try {
      const tenantId = getTenantFromRequest(req);
      if (!tenantId) return res.status(401).json({ error: "Authentication required" });
      const file = req.file;
      if (!file) return res.status(400).json({ error: "No file uploaded" });
      if (!(await validateUploadedFile(req, res))) return;
      const ext = path.extname(file.originalname).toLowerCase();
      const textContent = await extractTextFromFile(file.path, ext);
      if (!textContent.trim()) { try { fs.unlinkSync(file.path); } catch (_silentErr) { logSilentCatch("server/routes.ts", _silentErr); } return res.status(400).json({ error: "File is empty or could not be parsed" }); }
      const category = (req.body.category as string) || "preference";
      const personaId = req.body.personaId ? parseInt(req.body.personaId as string) : undefined;
      const lines = textContent.split(/\n/).map((l: string) => l.trim()).filter((l: string) => l.length > 10);
      const MAX_FACTS = 100;
      const facts = lines.slice(0, MAX_FACTS);
      const created: any[] = [];
      for (const fact of facts) {
        if (fact.length > 2000) continue;
        const entry = await storage.createMemoryEntry({
          fact,
          category,
          source: `file:${file.originalname}`,
          personaId: personaId ?? null,
          tenantId,
        });
        created.push(entry);
      }
      try { fs.unlinkSync(file.path); } catch (_silentErr) { logSilentCatch("server/routes.ts", _silentErr); }
      res.json({ success: true, memoriesCreated: created.length, fileName: file.originalname, totalLinesFound: lines.length });
      setImmediate(async () => {
        try {
          const { generateEmbedding } = await import("../embeddings");
          for (const entry of created) {
            try {
              const embedding = await generateEmbedding(entry.fact);
              if (embedding) await storage.updateMemoryEmbedding(entry.id, embedding);
            } catch (_silentErr) { logSilentCatch("server/routes.ts", _silentErr); }
          }
          console.log(`[upload] Background embeddings done for ${created.length} memory facts`);
        } catch (e) { console.error("[upload] Background embedding error:", e); }
      });
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;
  const MAX_CHUNKS_PER_UPLOAD = 1000;
  const MAX_INFLIGHT_UPLOADS_PER_TENANT = 10;

  app.post("/api/upload/init", express.json(), async (req: any, res) => {
    try {
      const tenantId = getTenantFromRequest(req);
      if (!tenantId) return res.status(401).json({ error: "Authentication required" });
      const { fileName, fileSize, totalChunks } = req.body;
      if (!fileName) return res.status(400).json({ error: "fileName required" });
      const declaredSize = parseInt(fileSize);
      const declaredChunks = parseInt(totalChunks);
      if (!Number.isFinite(declaredSize) || declaredSize <= 0 || declaredSize > MAX_UPLOAD_BYTES) {
        return res.status(400).json({ error: `File size must be 1 byte to ${MAX_UPLOAD_BYTES} bytes` });
      }
      if (!Number.isFinite(declaredChunks) || declaredChunks < 1 || declaredChunks > MAX_CHUNKS_PER_UPLOAD) {
        return res.status(400).json({ error: `totalChunks must be 1 to ${MAX_CHUNKS_PER_UPLOAD}` });
      }
      let inflight = 0;
      for (const u of chunkedUploads.values()) if ((u as any).tenantId === tenantId) inflight++;
      if (inflight >= MAX_INFLIGHT_UPLOADS_PER_TENANT) {
        return res.status(429).json({ error: "Too many concurrent uploads" });
      }
      const uploadId = `${Date.now()}-${crypto.randomBytes(8).toString("hex")}`;
      chunkedUploads.set(uploadId, {
        fileName,
        fileSize: declaredSize,
        chunks: new Map(),
        totalChunks: declaredChunks,
        createdAt: Date.now(),
        tenantId,
        bytesReceived: 0,
      } as any);
      res.json({ uploadId });
    } catch (err: any) { res.status(500).json({ error: "Upload init failed" }); }
  });

  app.post("/api/upload/chunk", chunkUpload.single("chunk"), async (req: any, res) => {
    try {
      const tenantId = getTenantFromRequest(req);
      if (!tenantId) return res.status(401).json({ error: "Authentication required" });
      const { uploadId, chunkIndex } = req.body;
      const upload: any = chunkedUploads.get(uploadId);
      if (!upload) {
        if (req.file) try { fs.unlinkSync(req.file.path); } catch (_silentErr) { logSilentCatch("server/routes.ts", _silentErr); }
        return res.status(400).json({ error: "Invalid upload ID" });
      }
      if (upload.tenantId !== tenantId) {
        if (req.file) try { fs.unlinkSync(req.file.path); } catch (_silentErr) { logSilentCatch("server/routes.ts", _silentErr); }
        return res.status(403).json({ error: "Upload does not belong to this tenant" });
      }
      if (!req.file) return res.status(400).json({ error: "No chunk data" });
      const idx = parseInt(chunkIndex);
      if (!Number.isFinite(idx) || idx < 0 || idx >= upload.totalChunks) {
        try { fs.unlinkSync(req.file.path); } catch (_silentErr) { logSilentCatch("server/routes.ts", _silentErr); }
        return res.status(400).json({ error: `chunkIndex must be 0 to ${upload.totalChunks - 1}` });
      }
      if (upload.chunks.has(idx)) {
        try { fs.unlinkSync(req.file.path); } catch (_silentErr) { logSilentCatch("server/routes.ts", _silentErr); }
        return res.status(400).json({ error: "Chunk already received" });
      }
      const newBytes = (upload.bytesReceived || 0) + req.file.size;
      if (newBytes > upload.fileSize) {
        try { fs.unlinkSync(req.file.path); } catch (_silentErr) { logSilentCatch("server/routes.ts", _silentErr); }
        chunkedUploads.delete(uploadId);
        return res.status(400).json({ error: "Upload exceeds declared file size" });
      }
      upload.bytesReceived = newBytes;
      upload.chunks.set(idx, req.file.path);
      res.json({ received: upload.chunks.size, total: upload.totalChunks });
    } catch (err: any) { res.status(500).json({ error: "Chunk upload failed" }); }
  });

  async function assembleChunkedFile(uploadId: string): Promise<{ filePath: string; fileName: string }> {
    const upload = chunkedUploads.get(uploadId);
    if (!upload) throw new Error("Invalid upload ID");
    if (upload.chunks.size < upload.totalChunks) throw new Error(`Missing chunks: got ${upload.chunks.size}/${upload.totalChunks}`);
    const ext = path.extname(upload.fileName).toLowerCase();
    const assembledPath = path.join(UPLOADS_DIR, `${uploadId}-assembled${ext}`);
    const writeStream = fs.createWriteStream(assembledPath);
    for (let i = 0; i < upload.totalChunks; i++) {
      const chunkPath = upload.chunks.get(i);
      if (!chunkPath) throw new Error(`Missing chunk ${i}`);
      const data = fs.readFileSync(chunkPath);
      writeStream.write(data);
      try { fs.unlinkSync(chunkPath); } catch (_silentErr) { logSilentCatch("server/routes.ts", _silentErr); }
    }
    writeStream.end();
    await new Promise<void>((resolve, reject) => { writeStream.on("finish", resolve); writeStream.on("error", reject); });
    chunkedUploads.delete(uploadId);
    return { filePath: assembledPath, fileName: upload.fileName };
  }

  app.post("/api/doc-collections/:id/upload-chunked", express.json(), async (req: any, res) => {
    try {
      const tenantId = getTenantFromRequest(req);
      if (!tenantId) return res.status(401).json({ error: "Authentication required" });
      const { uploadId, context, autoContextualize } = req.body;
      const auto = autoContextualize === true || autoContextualize === "true";
      console.log(`[upload] Assembling chunked file for upload ${uploadId}`);
      const { filePath, fileName } = await assembleChunkedFile(uploadId);
      const ext = path.extname(fileName).toLowerCase();
      const fileStats = fs.statSync(filePath);
      console.log(`[upload] Assembled file: ${fileName} (${(fileStats.size / 1024 / 1024).toFixed(1)}MB), parsing as ${ext}`);
      const textContent = await extractTextFromFile(filePath, ext);
      try { fs.unlinkSync(filePath); } catch (_silentErr) { logSilentCatch("server/routes.ts", _silentErr); }
      if (!textContent.trim()) return res.status(400).json({ error: "File is empty or could not be parsed" });
      console.log(`[upload] Extracted ${textContent.length} chars from ${fileName}, adding to collection ${req.params.id}`);
      const result = await docCollections.addDocument(Number((req.params.id as string)), fileName, textContent, context || "", tenantId, { autoContextualize: auto });
      res.json({ ...result, extractedLength: textContent.length, fileName });
    } catch (err: any) {
      console.error(`[upload] Chunked upload error:`, err.message, err.stack?.slice(0, 500));
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/knowledge/upload-chunked", express.json(), async (req: any, res) => {
    try {
      const tenantId = getTenantFromRequest(req);
      if (!tenantId) return res.status(401).json({ error: "Authentication required" });
      const { uploadId, category, priority, personaId } = req.body;
      const { filePath, fileName } = await assembleChunkedFile(uploadId);
      const ext = path.extname(fileName).toLowerCase();
      const textContent = await extractTextFromFile(filePath, ext);
      try { fs.unlinkSync(filePath); } catch (_silentErr) { logSilentCatch("server/routes.ts", _silentErr); }
      if (!textContent.trim()) return res.status(400).json({ error: "File is empty or could not be parsed" });
      const MAX_CHUNK = 4000;
      const paragraphs = textContent.split(/\n\s*\n/).filter((p: string) => p.trim());
      const chunks: string[] = [];
      let currentChunk = "";
      for (const para of paragraphs) {
        if ((currentChunk + "\n\n" + para).length > MAX_CHUNK && currentChunk) { chunks.push(currentChunk.trim()); currentChunk = para; }
        else { currentChunk = currentChunk ? currentChunk + "\n\n" + para : para; }
      }
      if (currentChunk.trim()) chunks.push(currentChunk.trim());
      if (chunks.length === 0) chunks.push(textContent.slice(0, MAX_CHUNK));
      const created: any[] = [];
      const baseName = fileName.replace(/\.[^.]+$/, "");
      for (let i = 0; i < chunks.length; i++) {
        const title = chunks.length === 1 ? baseName : `${baseName} (Part ${i + 1}/${chunks.length})`;
        const entry = await storage.createKnowledge({
          title, content: chunks[i], category: category || "reference", priority: parseInt(priority) || 3,
          source: "file-upload", personaId: personaId ? parseInt(personaId) : null, tenantId,
        });
        created.push(entry);
      }
      res.json({ success: true, entriesCreated: created.length, fileName, extractedLength: textContent.length });
      setImmediate(async () => {
        try {
          const { generateEmbedding } = await import("../embeddings");
          for (const entry of created) {
            try { const emb = await generateEmbedding(`${entry.title} ${entry.content}`); if (emb) await storage.updateKnowledgeEmbedding(entry.id, emb); } catch (_silentErr) { logSilentCatch("server/routes.ts", _silentErr); }
          }
        } catch (_silentErr) { logSilentCatch("server/routes.ts", _silentErr); }
      });
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  app.post("/api/memory/upload-chunked", express.json(), async (req: any, res) => {
    try {
      const tenantId = getTenantFromRequest(req);
      if (!tenantId) return res.status(401).json({ error: "Authentication required" });
      const { uploadId, category, personaId } = req.body;
      const { filePath, fileName } = await assembleChunkedFile(uploadId);
      const ext = path.extname(fileName).toLowerCase();
      const textContent = await extractTextFromFile(filePath, ext);
      try { fs.unlinkSync(filePath); } catch (_silentErr) { logSilentCatch("server/routes.ts", _silentErr); }
      if (!textContent.trim()) return res.status(400).json({ error: "File is empty or could not be parsed" });
      const lines = textContent.split(/\n/).map((l: string) => l.trim()).filter((l: string) => l.length > 10);
      const facts = lines.slice(0, 100);
      const created: any[] = [];
      for (const fact of facts) {
        if (fact.length > 2000) continue;
        const entry = await storage.createMemoryEntry({
          fact, category: category || "preference", source: `file:${fileName}`,
          personaId: personaId ? parseInt(personaId) : null, tenantId,
        });
        created.push(entry);
      }
      res.json({ success: true, memoriesCreated: created.length, fileName, totalLinesFound: lines.length });
      setImmediate(async () => {
        try {
          const { generateEmbedding } = await import("../embeddings");
          for (const entry of created) {
            try { const emb = await generateEmbedding(entry.fact); if (emb) await storage.updateMemoryEmbedding(entry.id, emb); } catch (_silentErr) { logSilentCatch("server/routes.ts", _silentErr); }
          }
        } catch (_silentErr) { logSilentCatch("server/routes.ts", _silentErr); }
      });
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  app.delete("/api/doc-collections/:id/documents/:docPath", async (req, res) => {
    try {
      const tenantId = getTenantFromRequest(req);
      if (!tenantId) return res.status(401).json({ error: "Authentication required" });
      res.json(await docCollections.removeDocument(Number((req.params.id as string)), decodeURIComponent((req.params.docPath as string)), tenantId));
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  app.post("/api/doc-collections/:id/context", async (req, res) => {
    try {
      const tenantId = getTenantFromRequest(req);
      if (!tenantId) return res.status(401).json({ error: "Authentication required" });
      const { context } = req.body;
      if (!context) return res.status(400).json({ error: "context is required" });
      res.json(await docCollections.addContext(Number((req.params.id as string)), context, tenantId));
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  app.post("/api/doc-collections/:id/embed", async (req, res) => {
    try {
      const tenantId = getTenantFromRequest(req);
      if (!tenantId) return res.status(401).json({ error: "Authentication required" });
      res.json(await docCollections.generateCollectionEmbeddings(Number((req.params.id as string)), tenantId));
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });
}
