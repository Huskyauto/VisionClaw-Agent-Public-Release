import test from "node:test";
import assert from "node:assert/strict";
import { assertOwnerOnlyDriveAccess } from "../../server/lib/backup-confidentiality";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { transformSync } from "esbuild";

test("backup access accepts inherited lower access belonging to the same direct owner", async () => {
  const owner = { type: "user", role: "owner", deleted: false,
    permissionDetails: [
      { inherited: true, permissionType: "file", role: "writer" },
      { inherited: false, permissionType: "file", role: "owner" },
    ] };
  await assert.doesNotReject(assertOwnerOnlyDriveAccess("fixture", async () => [owner]));
  for (const permissions of [
    [owner, { type: "user", role: "writer" }],
    [owner, { type: "anyone", role: "reader" }],
    [{ ...owner, permissionDetails: [null] }],
    [{ ...owner, permissionDetails: [
      { inherited: true, role: "writer" }, { inherited: true, role: "owner" },
    ] }],
    [{ ...owner, permissionDetails: [
      { inherited: true, role: "organizer" }, { inherited: false, role: "owner" },
    ] }],
  ]) {
    await assert.rejects(assertOwnerOnlyDriveAccess("fixture", async () => permissions), /owner-only/);
  }
});

test("backup access rejects effective public, group, domain and inherited writer grants", async () => {
  const owner = { type: "user", role: "owner" };
  for (const permissions of [
    [], null, {}, [owner, { type: "anyone", role: "writer" }],
    [owner, { type: "group", role: "reader" }],
    [owner, { type: "domain", role: "reader" }],
    [owner, { type: "user", role: "reader" }],
    [{ ...owner, permissionDetails: [{ inherited: true, role: "writer" }] }],
  ]) {
    await assert.rejects(assertOwnerOnlyDriveAccess("fixture", async () => permissions as any),
      /owner-only/);
  }
  await assert.doesNotReject(assertOwnerOnlyDriveAccess("fixture", async () => [owner]));
  await assert.rejects(assertOwnerOnlyDriveAccess("fixture", async () => {
    throw new Error("permission transport unavailable");
  }), /permission transport unavailable/);
});

function loadUploadFixture(options: { parentUnsafe?: boolean; fileUnsafe?: boolean; permissionFailure?: boolean; paginatedUnsafe?: boolean; ownerInheritedAccess?: boolean; folderListing?: unknown } = {}) {
  const source = readFileSync("server/google-drive.ts", "utf8");
  const ast = ts.createSourceFile("drive.ts", source, ts.ScriptTarget.Latest, true);
  const names = new Set(["driveJsonStrict", "listAllDrivePermissions", "verifyConfidentialBackupAccess",
    "ensureConfidentialBackupFolder", "uploadToDrive"]);
  const functions = ast.statements.filter((node): node is ts.FunctionDeclaration =>
    ts.isFunctionDeclaration(node) && !!node.name && names.has(node.name.text)).map(node => node.getText(ast)).join("\n");
  let uploads = 0;
  const requests: string[] = [];
  const owner = { type: "user", role: "owner",
    ...(options.ownerInheritedAccess ? { permissionDetails: [
      { inherited: true, permissionType: "file", role: "writer" },
      { inherited: false, permissionType: "file", role: "owner" },
    ] } : {}) };
  const driveRequest = async (endpoint: string) => {
    requests.push(endpoint);
    if (endpoint.includes("/permissions?")) {
      if (options.permissionFailure) return new Response("{}", { status: 403 });
      const unsafe = endpoint.includes("/fixture-file/") ? options.fileUnsafe : options.parentUnsafe;
      if (options.paginatedUnsafe && !endpoint.includes("pageToken=")) {
        return Response.json({ permissions: [owner], nextPageToken: "second" });
      }
      return Response.json({ permissions: unsafe || options.paginatedUnsafe
        ? [owner, { type: "anyone", role: "writer", permissionDetails: [{ inherited: true, role: "writer" }] }]
        : [owner] });
    }
    return Response.json(options.folderListing ?? { files: [{ id: "fixture-folder" }] });
  };
  const module = { exports: {} as any };
  vm.runInNewContext(transformSync(functions, { loader: "ts", format: "cjs" }).code, {
    module, exports: module.exports, assertOwnerOnlyDriveAccess, driveRequest, URLSearchParams,
    Buffer, Date, console, DRIVE_API: "https://www.googleapis.com", VISIONCLAW_FOLDER_NAME: "fixture",
    getAccessToken: async () => "synthetic-token",
    buildDriveMultipartUploadBody: (args: any) => {
      assert.equal(args.metadata.parents[0], "fixture-folder");
      return args.fileBuffer;
    },
    fetchWithTimeout: async (url: string, args: any) => {
      uploads++;
      assert.match(url, /ignoreDefaultVisibility=true/);
      assert.equal(args.body.toString(), "synthetic backup");
      return Response.json({ id: "fixture-file" });
    },
    warn: () => {},
    log: () => {},
  });
  return { upload: module.exports.uploadToDrive, folder: module.exports.ensureConfidentialBackupFolder,
    requests, get uploads() { return uploads; } };
}

test("existing backup folder resolves read-only with the observed direct-owner permission shape", async () => {
  const f = loadUploadFixture({ ownerInheritedAccess: true });
  assert.equal(await f.folder("VisionClaw Backups"), "fixture-folder");
  assert.equal(f.requests.length, 2);
  assert.ok(f.requests[0].startsWith("/drive/v3/files?"));
  assert.ok(f.requests[1].includes("/fixture-folder/permissions?"));
  assert.equal(f.uploads, 0);
});

test("backup folder ambiguity and incomplete listings still fail before permissions or upload", async () => {
  for (const folderListing of [
    { files: [{ id: "old" }, { id: "current" }] },
    { files: [{ id: "current" }], nextPageToken: "more" },
    {},
  ]) {
    const f = loadUploadFixture({ folderListing });
    await assert.rejects(f.folder("VisionClaw Backups"), /ambiguous or incomplete/);
    assert.equal(f.requests.length, 1);
    assert.equal(f.uploads, 0);
  }
});

test("actual backup upload refuses unsafe or unreadable inherited permissions before sending bytes", async () => {
  for (const options of [{ parentUnsafe: true }, { permissionFailure: true }, { paginatedUnsafe: true }]) {
    const f = loadUploadFixture(options);
    const result = await f.upload({ confidentialBackup: true, share: false,
      fileData: Buffer.from("synthetic backup"), fileName: "__admin-fixture.json", mimeType: "application/json" });
    assert.equal(result.success, false);
    assert.equal(f.uploads, 0);
  }
});

test("actual backup upload verifies resulting file and never reports unsafe upload as success", async () => {
  for (const fileUnsafe of [false, true]) {
    const f = loadUploadFixture({ fileUnsafe });
    const result = await f.upload({ confidentialBackup: true, share: false,
      fileData: Buffer.from("synthetic backup"), fileName: "__admin-fixture.json", mimeType: "application/json" });
    assert.equal(f.uploads, 1);
    assert.equal(result.success, !fileUnsafe);
    assert.ok(f.requests.some(url => url.includes("/fixture-file/permissions?")));
    if (fileUnsafe) {
      assert.equal(result.completionUncertain, true);
      assert.equal(result.fileId, "fixture-file");
      assert.equal(result.shareableLink, undefined);
    }
  }
});

test("confidential upload refuses sharing and recovered/project destinations before I/O", async () => {
  for (const extra of [{ share: true }, { durableArtifactKey: "recovery" }, { parentFolderId: "foreign" }, { customerDelivery: true }]) {
    const f = loadUploadFixture();
    const result = await f.upload({ confidentialBackup: true, share: false, ...extra,
      fileData: Buffer.from("synthetic backup"), fileName: "__admin-fixture.json", mimeType: "application/json" });
    assert.equal(result.success, false);
    assert.equal(f.uploads, 0);
    assert.equal(f.requests.length, 0);
  }
});

test("legacy system and memory backups fail before export on an unsafe destination", async () => {
  let reads = 0;
  let uploads = 0;
  const source = readFileSync("server/backup.ts", "utf8").replace(/^import .*;$/gm, "");
  const module = { exports: {} as any };
  vm.runInNewContext(transformSync(source, { loader: "ts", format: "cjs" }).code, {
    module, exports: module.exports, Buffer, Date, console: { log: () => {} },
    storage: {
      getAllDataForExport: async () => { reads++; return {}; },
      getAllMemoriesForBackup: async () => { reads++; return []; },
    },
    ensureConfidentialBackupFolder: async () => { throw new Error("unsafe parent"); },
    driveRequest: async () => { uploads++; },
  });
  await assert.rejects(module.exports.runBackupToGoogleDrive(), /unsafe parent/);
  await assert.rejects(module.exports.runMemoryBackupToGoogleDrive(), /unsafe parent/);
  assert.equal(reads, 0);
  assert.equal(uploads, 0);
});
