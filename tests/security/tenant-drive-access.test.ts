import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";
import test from "node:test";
import { transformSync } from "esbuild";
import { authorizeTenantDriveFile, driveParentQuery, tenantDriveDownloadPath } from "../../server/lib/tenant-drive-access";

function loadHandler(drive: Record<string, unknown>) {
  const source = readFileSync("server/tools/domains/files/handlers.ts", "utf8");
  const start = source.indexOf("export async function googleDriveHandler(");
  const rest = source.slice(start);
  const end = rest.indexOf("\nexport ", 10);
  const handler = (end < 0 ? rest : rest.slice(0, end))
    .replace('await import("../../../google-drive")', "__drive");
  const compiled = transformSync(handler, { loader: "ts", format: "cjs", target: "node20" }).code;
  const module = { exports: {} as any };
  vm.runInNewContext(compiled, { module, exports: module.exports, __drive: drive, path, Buffer, console });
  return module.exports.googleDriveHandler;
}

test("Drive download rejects foreign ownership before fetching bytes", async () => {
  let downloads = 0;
  const handler = loadHandler({
    driveJson: async () => ({ id: "foreign-file", name: "ordinary-document.txt" }),
    requireTenantDriveFileAccess: async () => { throw new Error("Drive file is not authorized for this tenant"); },
    downloadFromDrive: async () => { downloads++; return { success: true, path: "foreign.txt" }; },
  });
  const result = await handler({ command: "download", fileId: "foreign-file" }, { tenantId: 2 });
  assert.equal(downloads, 0, "foreign bytes must never be fetched or written");
  assert.ok(result.error);
});

for (const command of ["delete", "share"]) {
  test(`Drive ${command} rejects foreign IDs before mutation`, async () => {
    let mutations = 0;
    const handler = loadHandler({
      requireTenantDriveFileAccess: async () => { throw new Error("foreign"); },
      driveJson: async () => ({ id: "foreign", name: "ordinary.txt" }),
      deleteDriveFile: async () => { mutations++; return { success: true }; },
      makeFileShareable: async () => { mutations++; return { success: true }; },
    });
    assert.ok((await handler({ command, fileId: "foreign" }, { tenantId: 2 })).error);
    assert.equal(mutations, 0);
  });
}

test("missing trusted context blocks Drive before any provider operation", async () => {
  let calls = 0;
  const handler = loadHandler({ listDriveFiles: async () => { calls++; return { success: true }; } });
  assert.ok((await handler({ command: "list", _tenantId: 2 }, {})).error);
  assert.equal(calls, 0);
});

test("Drive list scopes its provider call to trusted tenant and project", async () => {
  let received: any;
  const handler = loadHandler({ listDriveFiles: async (args: any) => { received = args; return { success: true, files: [] }; } });
  await handler({ command: "list", _tenantId: 3 }, { tenantId: 2, projectId: 12 });
  assert.equal(received.tenantId, 2);
  assert.equal(received.projectId, 12);
});

test("owned nested file is authorized; identical foreign lineage is denied", async () => {
  const metadata: Record<string, any> = {
    own: { id: "own", name: "own.txt", parents: ["nested"] },
    nested: { id: "nested", name: "Folder", parents: ["tenant-two"] },
    "tenant-two": { id: "tenant-two", name: "Tenant two" },
    foreign: { id: "foreign", name: "foreign.txt", parents: ["tenant-three"] },
    "tenant-three": { id: "tenant-three", name: "Tenant three", parents: [] },
  };
  const deps = { getRoots: async () => ["tenant-two"], readMetadata: async (id: string) => metadata[id] };
  assert.equal((await authorizeTenantDriveFile(2, "own", deps)).id, "own");
  await assert.rejects(authorizeTenantDriveFile(2, "foreign", deps), /not authorized/);
});

test("missing scope, bad IDs, unassigned roots, restricted metadata and provider failures fail closed", async () => {
  const deps = { getRoots: async () => ["root"], readMetadata: async (id: string) => ({ id, name: "normal", parents: ["root"] }) };
  for (const tenant of [undefined, 0, -1, "2", 2.5, NaN]) await assert.rejects(authorizeTenantDriveFile(tenant, "file", deps));
  await assert.rejects(authorizeTenantDriveFile(2, "../foreign", deps));
  await assert.rejects(authorizeTenantDriveFile(2, "file", { ...deps, getRoots: async () => [] }));
  await assert.rejects(authorizeTenantDriveFile(2, "file", { ...deps, readMetadata: async id => ({ id, name: "__admin-backup", parents: ["root"] }) }));
  await assert.rejects(authorizeTenantDriveFile(2, "file", { ...deps, readMetadata: async id => ({ id, name: "shortcut", mimeType: "application/vnd.google-apps.shortcut", parents: ["root"] }) }));
  await assert.rejects(authorizeTenantDriveFile(2, "file", { ...deps, readMetadata: async () => { throw new Error("offline"); } }));
});

test("cycles and overlong ancestry never become authorization", async () => {
  const deps = { getRoots: async () => ["root"], readMetadata: async (id: string) => ({ id, name: "folder", parents: [id] }) };
  await assert.rejects(authorizeTenantDriveFile(2, "file", deps));
  let visited = 0;
  await assert.rejects(authorizeTenantDriveFile(2, "node0", {
    ...deps,
    readMetadata: async id => ({ id, name: "folder", parents: [`node${++visited}`] }),
  }), /within limits/);
});

test("provider parent query cannot be escaped and never defaults to shared root", () => {
  assert.equal(driveParentQuery(["tenant-two", "project_12"]), "('tenant-two' in parents or 'project_12' in parents)");
  assert.throws(() => driveParentQuery([]));
  assert.throws(() => driveParentQuery(["root' or trashed=false"]));
});

test("download destinations are private tenant filenames, not arbitrary workspace paths", () => {
  const root = "/workspace/uploads";
  assert.equal(tenantDriveDownloadPath(root, 2, "ordinary.txt"), "/workspace/uploads/tenant-drive/2/ordinary.txt");
  assert.equal(tenantDriveDownloadPath(root, 2, "ordinary.txt", "uploads/tenant-drive/2/custom.txt"), "/workspace/uploads/tenant-drive/2/custom.txt");
  for (const requested of ["server/index.ts", "../other", "uploads/tenant-drive/3/other", "/tmp/file", ".env", "nested/file"]) {
    assert.throws(() => tenantDriveDownloadPath(root, 2, "ordinary", requested));
  }
});

test("upload ignores forged folder hints and uses a server-owned destination", async () => {
  let received: any;
  const handler = loadHandler({
    ensureToolDriveFolder: async () => ({ id: "owned-folder" }),
    uploadAndShare: async (args: any) => { received = args; return { success: true, fileId: "new-file" }; },
  });
  await handler({ command: "upload", fileData: "dGVzdA==", fileName: "sample.txt", _projectDriveFolderId: "foreign-folder" }, { tenantId: 2 });
  assert.equal(received.parentFolderId, "owned-folder");
  assert.equal(received.tenantId, 2);
});

test("upload cannot exfiltrate an unowned local source through an owned Drive destination", async () => {
  let uploads = 0;
  const handler = loadHandler({
    readTenantDriveUploadBytes: async () => { throw new Error("Source is not authorized"); },
    ensureToolDriveFolder: async () => ({ id: "owned-folder" }),
    uploadAndShare: async () => { uploads++; return { success: true, fileId: "exfiltrated" }; },
  });
  const result = await handler({ command: "upload", filePath: ".env", fileName: "ordinary.txt" }, { tenantId: 2 });
  assert.equal(uploads, 0);
  assert.ok(result.error);
});

test("upload preserves an explicit private-sharing choice and forwards a verified snapshot only", async () => {
  let received: any;
  const handler = loadHandler({
    readTenantDriveUploadBytes: async () => Buffer.from("owned bytes"),
    ensureToolDriveFolder: async () => ({ id: "owned-folder" }),
    uploadAndShare: async (args: any) => { received = args; return { success: true }; },
  });
  await handler({ command: "upload", filePath: "uploads/owned.txt", share: false }, { tenantId: 2 });
  assert.equal(received.filePath, undefined);
  assert.equal(received.fileData.toString(), "owned bytes");
  assert.equal(received.share, false);
});