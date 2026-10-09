import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { assembleOwnedChunkedUpload } from "../../server/lib/chunked-upload";

test("chunked upload completion keeps foreign and missing state untouched and assembles only for its owner", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "chunked-upload-tenant-"));
  const chunkPath = path.join(root, "chunk.bin");
  const uploadsDir = path.join(root, "assembled");
  mkdirSync(uploadsDir);
  writeFileSync(chunkPath, "tenant-owned contents");
  const state = {
    tenantId: 17,
    fileName: "report.txt",
    fileSize: 21,
    totalChunks: 1,
    chunks: new Map([[0, chunkPath]]),
    bytesReceived: 21,
  };
  const uploads = new Map([["owned", state]]);

  try {
    await assert.rejects(
      assembleOwnedChunkedUpload({ uploadId: "owned", tenantId: 23, uploads, uploadsDir }),
      (error: any) => error.statusCode === 403,
    );
    assert.equal(uploads.get("owned"), state, "a foreign completion must preserve the upload state");
    assert.equal(readFileSync(chunkPath, "utf8"), "tenant-owned contents", "a foreign completion must not read/delete chunks");

    await assert.rejects(
      assembleOwnedChunkedUpload({ uploadId: "missing", tenantId: 17, uploads, uploadsDir }),
      (error: any) => error.statusCode === 400,
    );
    assert.equal(uploads.get("owned"), state);

    const assembled = await assembleOwnedChunkedUpload({ uploadId: "owned", tenantId: 17, uploads, uploadsDir });
    assert.equal(readFileSync(assembled.filePath, "utf8"), "tenant-owned contents");
    assert.equal(assembled.fileName, "report.txt");
    assert.equal(uploads.has("owned"), false, "successful owner completion consumes the upload state");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("chunked upload assembly requires an explicit positive tenant context", async () => {
  const uploads = new Map<string, any>([["owned", { tenantId: 17 }]]);
  await assert.rejects(
    assembleOwnedChunkedUpload({ uploadId: "owned", tenantId: null as any, uploads, uploadsDir: tmpdir() }),
    (error: any) => error.statusCode === 401,
  );
  assert.equal(uploads.has("owned"), true);
});

test("incomplete and unreadable uploads remain available after owner assembly attempts", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "chunked-upload-failure-"));
  const uploadsDir = path.join(root, "assembled");
  mkdirSync(uploadsDir);
  const incomplete = {
    tenantId: 17,
    fileName: "incomplete.txt",
    fileSize: 8,
    totalChunks: 2,
    chunks: new Map([[0, path.join(root, "first.bin")]]),
  };
  const unreadable = {
    tenantId: 17,
    fileName: "unreadable.txt",
    fileSize: 8,
    totalChunks: 1,
    chunks: new Map([[0, path.join(root, "missing.bin")]]),
  };
  const uploads = new Map([["incomplete", incomplete], ["unreadable", unreadable]]);
  writeFileSync(path.join(root, "first.bin"), "first");

  try {
    await assert.rejects(
      assembleOwnedChunkedUpload({ uploadId: "incomplete", tenantId: 17, uploads, uploadsDir }),
      (error: any) => error.statusCode === 400,
    );
    await assert.rejects(
      assembleOwnedChunkedUpload({ uploadId: "unreadable", tenantId: 17, uploads, uploadsDir }),
    );
    assert.equal(uploads.get("incomplete"), incomplete);
    assert.equal(uploads.get("unreadable"), unreadable);
    assert.equal(incomplete.assembling, undefined);
    assert.equal(unreadable.assembling, false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("all completion endpoints use the tenant-aware assembler before filesystem access", () => {
  const source = readFileSync(new URL("../../server/routes/doc-collections.ts", import.meta.url), "utf8");
  const routes = [
    source.slice(source.indexOf('app.post("/api/doc-collections/:id/upload-chunked"'), source.indexOf('app.post("/api/knowledge/upload-chunked"')),
    source.slice(source.indexOf('app.post("/api/knowledge/upload-chunked"'), source.indexOf('app.post("/api/memory/upload-chunked"')),
    source.slice(source.indexOf('app.post("/api/memory/upload-chunked"'), source.indexOf('app.delete("/api/doc-collections/:id/documents/:docPath"')),
  ];
  assert.equal(routes.length, 3);
  for (const route of routes) {
    assert.match(route, /assembleOwnedChunkedUpload\(\{ uploadId, tenantId, uploads: chunkedUploads, uploadsDir: UPLOADS_DIR \}\)/);
  }
  assert.ok(
    routes[0].indexOf("docCollections.listCollections(tenantId)") < routes[0].indexOf("assembleOwnedChunkedUpload"),
    "a foreign destination collection must be rejected before upload chunks are consumed",
  );
});