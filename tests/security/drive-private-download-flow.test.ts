import assert from "node:assert/strict";
import fs from "node:fs";
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import test from "node:test";
import { transformSync } from "esbuild";
import { assertDriveTenant, tenantDriveDownloadPath } from "../../server/lib/tenant-drive-access";
import { resolveTenantDriveUploadSource } from "../../server/lib/tenant-drive-source";

const sourceBytes = Buffer.from("private tenant drive download\nsecond line");

function extractFunction(source: string, startMarker: string, nextMarker: string): string {
  const start = source.indexOf(startMarker);
  assert.ok(start >= 0, `missing source function ${startMarker}`);
  const end = source.indexOf(nextMarker, start + startMarker.length);
  assert.ok(end > start, `missing function end marker ${nextMarker}`);
  return source.slice(start, end);
}

function loadDownloadFromDrive(
  uploadsRoot: string,
  provider: { metadata: any; body: Buffer },
  tenantDriveReader: (sourcePath: string, tenantId: number) => Promise<Buffer> = async () => {
    throw new Error("Cached source reader was not configured");
  },
) {
  const source = fs.readFileSync("server/google-drive.ts", "utf8");
  const functionSource = extractFunction(source, "export async function downloadFromDrive(", "\nexport ");
  const compiled = transformSync(functionSource, { loader: "ts", format: "cjs", target: "node20" }).code;
  const module = { exports: {} as any };
  let mediaCalls = 0;
  vm.runInNewContext(compiled, {
    module,
    exports: module.exports,
    Buffer,
    console,
    process,
    fs,
    path,
    UPLOADS_DIR: uploadsRoot,
    MAX_TENANT_DRIVE_SOURCE_BYTES: 100 * 1024 * 1024,
    tenantDriveDownloadPath,
    readTenantDriveUploadBytes: tenantDriveReader,
    isPathWithin(root: string, candidate: string) {
      const relative = path.relative(root, candidate);
      return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
    },
    resolveUploadsChild(relative: string) { return path.resolve(uploadsRoot, relative); },
    driveJson: async () => provider.metadata,
    driveRequest: async () => {
      mediaCalls++;
      const exactArrayBuffer = Uint8Array.from(provider.body).buffer;
      return { ok: true, arrayBuffer: async () => exactArrayBuffer };
    },
  });
  return {
    download: module.exports.downloadFromDrive as (params: any) => Promise<any>,
    mediaCalls: () => mediaCalls,
  };
}

function loadReadFileHandler(
  workspaceRoot: string,
  uploadsRoot: string,
  tenantDriveReader: (sourcePath: string, tenantId: number) => Promise<Buffer>,
  recoveryMocks: {
    projectRows?: any[];
    googleDrive?: Record<string, any>;
  } = {},
) {
  const source = fs.readFileSync("server/tools/domains/files/handlers.ts", "utf8");
  const functionSource = extractFunction(source, "export async function readFileHandler(", "\nexport async function googleDriveHandler(")
    .replaceAll('await import("node:fs")', "__fs")
    .replaceAll('await import("node:path")', "__path")
    .replaceAll('await import("../../../lib/silent-catch")', "__silent")
    .replaceAll('await import("../../../google-drive")', "__googleDrive")
    .replaceAll('await import("../../../db")', "__dbModule")
    .replaceAll('await import("@shared/schema")', "__schema")
    .replaceAll('await import("drizzle-orm")', "__drizzle")
    .replaceAll('"/home/runner/workspace"', "__workspaceRoot");
  const jailStart = source.indexOf("function isPathInsideRoot(");
  assert.ok(jailStart >= 0, "read_file path-jail helper must remain present");
  const jailEnd = source.indexOf("\n}", jailStart) + 2;
  const compiled = transformSync(
    `${functionSource}\n${source.slice(jailStart, jailEnd)}`,
    { loader: "ts", format: "cjs", target: "node20" },
  ).code;
  const module = { exports: {} as any };
  let selectCount = 0;
  const projectRows = recoveryMocks.projectRows || [];
  const fakeDb = {
    select() {
      const queryIndex = selectCount++;
      const query: any = {
        from() { return query; },
        innerJoin() { return query; },
        where() { return query; },
        orderBy() { return query; },
        limit() { return queryIndex === 0 ? [] : projectRows; },
      };
      return query;
    },
  };
  vm.runInNewContext(compiled, {
    module,
    exports: module.exports,
    Buffer,
    console,
    __fs: fs,
    __path: path,
    path,
    __silent: { logSilentCatch() {} },
    __googleDrive: { readTenantDriveUploadBytes: tenantDriveReader, ...(recoveryMocks.googleDrive || {}) },
    __dbModule: { db: fakeDb },
    __schema: {
      fileStorage: { id: "id", filename: "filename", originalName: "originalName", tenantId: "tenantId" },
      projectFiles: { fileName: "fileName", filePath: "filePath", fileUrl: "fileUrl", projectId: "projectId", createdAt: "createdAt" },
      projects: { id: "id", tenantId: "tenantId" },
    },
    __drizzle: { eq() {}, desc() {}, or() {}, and() {} },
    __workspaceRoot: workspaceRoot,
    UPLOADS_ROOT: uploadsRoot,
    UPLOADS_ROOT_WITH_SEP: uploadsRoot + path.sep,
    WORKSPACE_ROOT: workspaceRoot,
  });
  return module.exports.readFileHandler as (params: any, ctx: any) => Promise<any>;
}

function loadGoogleDriveUploadByteResolver(uploadsRoot: string) {
  const source = fs.readFileSync("server/google-drive.ts", "utf8");
  const functionSource = extractFunction(
    source,
    "export async function readTenantDriveUploadBytes(",
    "\nexport ",
  ).replace('await import("drizzle-orm")', "__drizzle");
  const compiled = transformSync(functionSource, { loader: "ts", format: "cjs", target: "node20" }).code;
  const module = { exports: {} as any };
  vm.runInNewContext(compiled, {
    module,
    exports: module.exports,
    Buffer,
    assertDriveTenant,
    resolveTenantDriveUploadSource,
    MAX_TENANT_DRIVE_SOURCE_BYTES: 100 * 1024 * 1024,
    UPLOADS_DIR: uploadsRoot,
    __drizzle: { sql() { throw new Error("Database SQL is not expected for the private namespace"); } },
    db: { execute: async () => { throw new Error("Database is not expected for the private namespace"); } },
  });
  return module.exports.readTenantDriveUploadBytes as (sourcePath: string, tenantId: number) => Promise<Buffer>;
}

async function fixture() {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "drive-private-flow-"));
  const uploadsRoot = path.join(workspaceRoot, "uploads");
  await mkdir(uploadsRoot, { recursive: true });
  const reader = loadGoogleDriveUploadByteResolver(uploadsRoot);
  return { workspaceRoot, uploadsRoot, reader, dispose: () => rm(workspaceRoot, { recursive: true, force: true }) };
}

test("Drive download path is the exact private file read_file and upload-source resolver consume", async () => {
  const f = await fixture();
  try {
    const drive = loadDownloadFromDrive(f.uploadsRoot, {
      metadata: { id: "drive-id", name: "report.txt", size: sourceBytes.length },
      body: sourceBytes,
    });
    const downloaded = await drive.download({ fileId: "drive-id", tenantId: 2 });
    assert.equal(downloaded.success, true, JSON.stringify(downloaded));
    assert.equal(downloaded.path, "uploads/tenant-drive/2/drive-id-report.txt");
    const absolutePath = path.join(f.uploadsRoot, "tenant-drive", "2", "drive-id-report.txt");
    assert.deepEqual(await readFile(absolutePath), sourceBytes);

    const readFileHandler = loadReadFileHandler(f.workspaceRoot, f.uploadsRoot, f.reader);
    const readResult = await readFileHandler({ path: downloaded.path }, { tenantId: 2 });
    assert.equal(readResult.success, true);
    assert.equal(readResult.content, sourceBytes.toString("utf8"));

    const uploadBytes = await f.reader(downloaded.path, 2);
    assert.deepEqual(uploadBytes, sourceBytes);
    assert.equal(drive.mediaCalls(), 1);
  } finally {
    await f.dispose();
  }
});

test("another tenant cannot read a private Drive download", async () => {
  const f = await fixture();
  try {
    const drive = loadDownloadFromDrive(f.uploadsRoot, {
      metadata: { id: "drive-id", name: "report.txt", size: sourceBytes.length },
      body: sourceBytes,
    });
    const downloaded = await drive.download({ fileId: "drive-id", tenantId: 2 });
    const readFileHandler = loadReadFileHandler(f.workspaceRoot, f.uploadsRoot, f.reader);
    const readResult = await readFileHandler({ path: downloaded.path }, { tenantId: 3 });
    assert.ok(readResult.error);
    await assert.rejects(f.reader(downloaded.path, 3));
  } finally {
    await f.dispose();
  }
});

test("overwrite and invalid workspace destinations are rejected before Drive media bytes are fetched", async () => {
  const f = await fixture();
  try {
    const existingPath = tenantDriveDownloadPath(f.uploadsRoot, 2, "drive-id-existing.txt", "uploads/tenant-drive/2/existing.txt");
    await mkdir(path.dirname(existingPath), { recursive: true });
    await writeFile(existingPath, "keep existing");
    const drive = loadDownloadFromDrive(f.uploadsRoot, {
      metadata: { id: "drive-id", name: "report.txt", size: sourceBytes.length },
      body: sourceBytes,
    });
    const overwritten = await drive.download({
      fileId: "drive-id", tenantId: 2, savePath: "uploads/tenant-drive/2/existing.txt",
    });
    assert.equal(overwritten.success, false);
    assert.equal(drive.mediaCalls(), 0);
    assert.equal(await readFile(existingPath, "utf8"), "keep existing");

    const invalid = await drive.download({ fileId: "drive-id", tenantId: 2, savePath: "../workspace/.env" });
    assert.equal(invalid.success, false);
    assert.equal(drive.mediaCalls(), 0);
  } finally {
    await f.dispose();
  }
});

test("private read_file rejects a symlinked downloaded source", async () => {
  const f = await fixture();
  const outsideRoot = await mkdtemp(path.join(os.tmpdir(), "drive-private-outside-"));
  try {
    const tenantDir = path.join(f.uploadsRoot, "tenant-drive", "2");
    await mkdir(tenantDir, { recursive: true });
    const outsideFile = path.join(outsideRoot, "secret.txt");
    await writeFile(outsideFile, "must not be read");
    await symlink(outsideFile, path.join(tenantDir, "linked.txt"));
    const readFileHandler = loadReadFileHandler(f.workspaceRoot, f.uploadsRoot, f.reader);
    const result = await readFileHandler({ path: "uploads/tenant-drive/2/linked.txt" }, { tenantId: 2 });
    assert.ok(result.error);
    await assert.rejects(f.reader("uploads/tenant-drive/2/linked.txt", 2));
  } finally {
    await f.dispose();
    await rm(outsideRoot, { recursive: true, force: true });
  }
});

test("a tenant-owned project row with a foreign Drive URL is not authority to download", async () => {
  const f = await fixture();
  try {
    const events: string[] = [];
    let mediaDownloads = 0;
    const readFileHandler = loadReadFileHandler(f.workspaceRoot, f.uploadsRoot, f.reader, {
      projectRows: [{
        fileName: "recover-me.txt",
        filePath: null,
        fileUrl: "https://drive.google.com/file/d/foreign-drive-id/view",
        projectId: 42,
      }],
      googleDrive: {
        extractDriveFileId: () => "foreign-drive-id",
        requireTenantDriveFileAccess: async (tenantId: number, driveId: string, projectId: number) => {
          events.push(`authorize:${tenantId}:${driveId}:${projectId}`);
          throw new Error("Drive file is not authorized for this tenant");
        },
        downloadFromDrive: async () => { mediaDownloads++; throw new Error("must not download"); },
      },
    });
    const result = await readFileHandler({ path: "uploads/recover-me.txt" }, { tenantId: 2 });
    assert.ok(result.error);
    assert.deepEqual(events, ["authorize:2:foreign-drive-id:42"]);
    assert.equal(mediaDownloads, 0);
  } finally {
    await f.dispose();
  }
});

test("recovery reauthorizes before reusing an exact private cache and keeps tenant/symlink scope", async () => {
  const f = await fixture();
  try {
    const events: string[] = [];
    const recoveredBytes = Buffer.from("authorized project recovery bytes\n");
    const downloader = loadDownloadFromDrive(f.uploadsRoot, {
      metadata: { id: "authorized-drive-id", name: "source.txt", size: recoveredBytes.length },
      body: recoveredBytes,
    }, f.reader);
    const readFileHandler = loadReadFileHandler(f.workspaceRoot, f.uploadsRoot, f.reader, {
      projectRows: [{
        fileName: "recover-me.txt",
        filePath: null,
        fileUrl: "https://drive.google.com/file/d/authorized-drive-id/view",
        projectId: 42,
      }],
      googleDrive: {
        extractDriveFileId: () => "authorized-drive-id",
        requireTenantDriveFileAccess: async (tenantId: number, driveId: string, projectId: number) => {
          events.push(`authorize:${tenantId}:${driveId}:${projectId}`);
          if (tenantId !== 2) throw new Error("Drive file is not authorized for this tenant");
        },
        downloadFromDrive: async (args: any) => {
          events.push(`download:${args.fileId}:${args.tenantId}:${args.reuseExisting}`);
          return downloader.download(args);
        },
      },
    });
    const firstRead = await readFileHandler({ path: "uploads/recover-me.txt" }, { tenantId: 2 });
    const secondRead = await readFileHandler({ path: "uploads/recover-me.txt" }, { tenantId: 2 });
    assert.deepEqual(events, [
      "authorize:2:authorized-drive-id:42",
      "download:authorized-drive-id:2:true",
      "authorize:2:authorized-drive-id:42",
      "download:authorized-drive-id:2:true",
    ]);
    for (const result of [firstRead, secondRead]) {
      assert.equal(result.success, true);
      assert.equal(result.content, recoveredBytes.toString("utf8"));
    }
    assert.equal(downloader.mediaCalls(), 1, "repeat recovery should reuse verified bytes without a second media fetch");
    assert.deepEqual(await readFile(path.join(f.uploadsRoot, "tenant-drive", "2", "authorized-drive-id-source.txt")), recoveredBytes);

    const tenantThreeRead = await readFileHandler({ path: "uploads/recover-me.txt" }, { tenantId: 3 });
    assert.ok(tenantThreeRead.error, "tenant 3 must not reuse tenant 2's project recovery");
    assert.equal(downloader.mediaCalls(), 1);

    const tenantThreeCache = tenantDriveDownloadPath(f.uploadsRoot, 3, "authorized-drive-id-source.txt");
    await mkdir(path.dirname(tenantThreeCache), { recursive: true });
    await symlink(path.join(f.uploadsRoot, "tenant-drive", "2", "authorized-drive-id-source.txt"), tenantThreeCache);
    const symlinkReuse = await downloader.download({
      fileId: "authorized-drive-id",
      tenantId: 3,
      reuseExisting: true,
    });
    assert.equal(symlinkReuse.success, false, "symlinked cache must not be returned as a verified hit");
    assert.equal(downloader.mediaCalls(), 1);
  } finally {
    await f.dispose();
  }
});

test("owning project metadata cannot authorize reading a local alias to a secret upload source", async () => {
  const f = await fixture();
  try {
    const privateReadAttempts: string[] = [];
    const secretFile = path.join(f.uploadsRoot, ".env");
    await writeFile(secretFile, "SECRET_DO_NOT_EXPOSE");
    const actualReader = f.reader;
    const readFileHandler = loadReadFileHandler(f.workspaceRoot, f.uploadsRoot, async (sourcePath, tenantId) => {
      privateReadAttempts.push(`${tenantId}:${sourcePath}`);
      return actualReader(sourcePath, tenantId);
    }, {
      projectRows: [{
        fileName: "friendly-alias.txt",
        filePath: "uploads/.env",
        fileUrl: null,
        projectId: 42,
      }],
    });
    const result = await readFileHandler({ path: "uploads/friendly-alias.txt" }, { tenantId: 2 });
    assert.ok(result.error);
    assert.deepEqual(privateReadAttempts, [`2:${secretFile}`]);
    assert.equal(JSON.stringify(result).includes("SECRET_DO_NOT_EXPOSE"), false);
  } finally {
    await f.dispose();
  }
});