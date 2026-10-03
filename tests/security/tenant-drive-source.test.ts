import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import test from "node:test";
import { resolveTenantDriveUploadSource } from "../../server/lib/tenant-drive-source";

const bytes = Buffer.from("tenant-owned source");
const digest = (value: Buffer) => createHash("sha256").update(value).digest("hex");

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "tenant-drive-source-"));
  await mkdir(root, { recursive: true });
  const ownerRows: Array<{ tenantId: number; filename: string; data?: string; size?: number }> = [];
  let manifest: { sha256: string; size: number } | null = null;
  let ownerQueries = 0;
  let artifactQueries = 0;
  const deps = {
    uploadsRoot: root,
    resolveUploadOwnerRows: async (_tenantId: number, filename: string) => {
      ownerQueries++;
      return ownerRows.filter(row => row.filename === filename);
    },
    findOwnedArtifact: async (_tenantId: number, filename: string) => {
      artifactQueries++;
      return filename === "generated.bin" ? manifest : null;
    },
  };
  return {
    root, ownerRows, deps,
    setManifest(value: Buffer) { manifest = { sha256: digest(value), size: value.length }; },
    get ownerQueries() { return ownerQueries; },
    get artifactQueries() { return artifactQueries; },
    dispose: () => rm(root, { recursive: true, force: true }),
  };
}

test("flat uploads return caller-owned backing bytes, not a mutable filesystem path", async () => {
  const f = await fixture();
  try {
    await writeFile(path.join(f.root, "report.txt"), Buffer.from("filesystem version"));
    f.ownerRows.push({ tenantId: 7, filename: "report.txt", data: bytes.toString("base64"), size: bytes.length });
    const result = await resolveTenantDriveUploadSource("uploads/report.txt", 7, f.deps);
    assert.deepEqual(result, bytes);
    assert.equal(Buffer.isBuffer(result), true);
    assert.equal(f.artifactQueries, 0);
  } finally { await f.dispose(); }
});

test("missing or foreign owner authority rejects before reading a flat file", async () => {
  for (const rows of [[], [{ tenantId: 8, filename: "report.txt", data: bytes.toString("base64") }]]) {
    const f = await fixture();
    try {
      await writeFile(path.join(f.root, "report.txt"), bytes);
      f.ownerRows.push(...rows);
      await assert.rejects(resolveTenantDriveUploadSource("uploads/report.txt", 7, f.deps));
      assert.equal(f.artifactQueries, rows.length ? 0 : 1);
    } finally { await f.dispose(); }
  }
});

test("a foreign owner collision defeats otherwise caller-owned backing data", async () => {
  const f = await fixture();
  try {
    f.ownerRows.push(
      { tenantId: 7, filename: "report.txt", data: bytes.toString("base64") },
      { tenantId: 8, filename: "report.txt", data: Buffer.from("foreign").toString("base64") },
    );
    await assert.rejects(resolveTenantDriveUploadSource("uploads/report.txt", 7, f.deps));
  } finally { await f.dispose(); }
});

test("generated flat upload requires an owned manifest before exact hash and size verification", async () => {
  const f = await fixture();
  try {
    await writeFile(path.join(f.root, "generated.bin"), bytes);
    await assert.rejects(resolveTenantDriveUploadSource("uploads/generated.bin", 7, f.deps));
    assert.equal(f.artifactQueries, 1);
    f.setManifest(bytes);
    assert.deepEqual(await resolveTenantDriveUploadSource("uploads/generated.bin", 7, f.deps), bytes);
    f.setManifest(Buffer.from("different"));
    await assert.rejects(resolveTenantDriveUploadSource("uploads/generated.bin", 7, f.deps));
  } finally { await f.dispose(); }
});

test("tenant-drive namespace accepts only a regular file beneath the caller namespace", async () => {
  const f = await fixture();
  try {
    const ownDir = path.join(f.root, "tenant-drive", "7");
    await mkdir(ownDir, { recursive: true });
    await writeFile(path.join(ownDir, "private.txt"), bytes);
    assert.deepEqual(await resolveTenantDriveUploadSource("uploads/tenant-drive/7/private.txt", 7, f.deps), bytes);
    await writeFile(path.join(f.root, "tenant-drive", "8", "private.txt"), bytes).catch(async () => {
      await mkdir(path.join(f.root, "tenant-drive", "8"), { recursive: true });
      await writeFile(path.join(f.root, "tenant-drive", "8", "private.txt"), bytes);
    });
    await assert.rejects(resolveTenantDriveUploadSource("uploads/tenant-drive/8/private.txt", 7, f.deps));
  } finally { await f.dispose(); }
});

test("private config/admin/backup/dot paths and escaped or symlinked paths are refused", async () => {
  const f = await fixture();
  const outside = await mkdtemp(path.join(os.tmpdir(), "tenant-drive-outside-"));
  try {
    for (const name of [".env", ".secret", "__admin-key.txt", "backup.zip", "config.json", "nested/file.txt", "../secret"]) {
      await assert.rejects(resolveTenantDriveUploadSource(`uploads/${name}`, 7, f.deps));
    }
    await writeFile(path.join(outside, "escape.txt"), bytes);
    await symlink(path.join(outside, "escape.txt"), path.join(f.root, "escape.txt"));
    f.ownerRows.push({ tenantId: 7, filename: "escape.txt", data: bytes.toString("base64") });
    await assert.rejects(resolveTenantDriveUploadSource("uploads/escape.txt", 7, f.deps));
    await assert.rejects(resolveTenantDriveUploadSource(path.join(outside, "escape.txt"), 7, f.deps));
  } finally {
    await f.dispose();
    await rm(outside, { recursive: true, force: true });
  }
});

test("trusted tenant context and backing-data encoding are validated", async () => {
  const f = await fixture();
  try {
    f.ownerRows.push({ tenantId: 7, filename: "report.txt", data: "not base64!" });
    await assert.rejects(resolveTenantDriveUploadSource("uploads/report.txt", undefined, f.deps));
    await assert.rejects(resolveTenantDriveUploadSource("uploads/report.txt", 7, f.deps));
  } finally { await f.dispose(); }
});