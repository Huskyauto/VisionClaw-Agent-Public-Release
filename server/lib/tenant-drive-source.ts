import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open, realpath } from "node:fs/promises";
import path from "node:path";

export const MAX_TENANT_DRIVE_SOURCE_BYTES = 100 * 1024 * 1024;

export interface TenantDriveUploadOwnerRow {
  tenantId: number;
  filename: string;
  /** Base64-encoded persisted bytes. Empty/missing data is not byte authority. */
  data?: string | null;
  size?: number | null;
}

export interface TenantDriveArtifactManifest {
  sha256: string;
  size: number;
}

export interface TenantDriveSourceDependencies {
  /** Server-configured uploads root; never supplied by the caller. */
  uploadsRoot: string;
  /** Must return every file_storage owner row for this basename, across tenants. */
  resolveUploadOwnerRows: (tenantId: number, filename: string) => Promise<TenantDriveUploadOwnerRow[]>;
  /** Must return a caller-owned artifact manifest for this logical filename only. */
  findOwnedArtifact: (tenantId: number, filename: string) => Promise<TenantDriveArtifactManifest | null>;
}

function assertTenantId(tenantId: unknown): asserts tenantId is number {
  if (!Number.isSafeInteger(tenantId) || Number(tenantId) <= 0) {
    throw new Error("Tenant Drive source requires a valid trusted tenant");
  }
}

function isRestrictedName(name: string): boolean {
  return name.startsWith(".") ||
    /(^|[._-])(env|secret|secrets|admin|backup|backups|config|credentials)([._-]|$)/i.test(name) ||
    /^__(?:admin[-_]|VisionClaw-Admin[-_])/i.test(name);
}

function resolveRelativeSource(filePath: unknown, uploadsRoot: string): string[] {
  if (typeof filePath !== "string" || !filePath || filePath.includes("\0") || filePath.includes("\\")) {
    throw new Error("Invalid Tenant Drive source path");
  }

  let relative: string;
  if (path.isAbsolute(filePath)) {
    relative = path.relative(uploadsRoot, path.resolve(filePath));
    if (!relative || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
      throw new Error("Tenant Drive source must be under uploads");
    }
  } else {
    if (!filePath.startsWith("uploads/")) throw new Error("Tenant Drive source must be under uploads");
    relative = filePath.slice("uploads/".length);
  }

  const parts = relative.split(/[\\/]/);
  if (parts.some(part => !part || part === "." || part === "..")) {
    throw new Error("Invalid Tenant Drive source path");
  }
  return parts;
}

function decodeOwnedBytes(encoded: string, expectedSize?: number | null): Buffer {
  if (!encoded || encoded.length > Math.ceil(MAX_TENANT_DRIVE_SOURCE_BYTES / 3) * 4 ||
      encoded.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) {
    throw new Error("Caller-owned upload bytes are unavailable or invalid");
  }
  const bytes = Buffer.from(encoded, "base64");
  if (!bytes.length || bytes.length > MAX_TENANT_DRIVE_SOURCE_BYTES ||
      bytes.toString("base64") !== encoded ||
      (expectedSize != null && (!Number.isSafeInteger(expectedSize) || expectedSize !== bytes.length))) {
    throw new Error("Caller-owned upload bytes are unavailable or invalid");
  }
  return bytes;
}

async function assertSafeSourceLocation(root: string, parts: string[], allowMissingLeaf: boolean): Promise<string | null> {
  const canonicalRoot = await realpath(root);
  const rootStat = await lstat(canonicalRoot);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) throw new Error("Uploads root is unavailable");

  let current = canonicalRoot;
  for (let index = 0; index < parts.length; index++) {
    current = path.join(current, parts[index]);
    let stat;
    try {
      stat = await lstat(current);
    } catch (error) {
      if (allowMissingLeaf && index === parts.length - 1 && (error as NodeJS.ErrnoException).code === "ENOENT") {
        return null;
      }
      throw error;
    }
    if (stat.isSymbolicLink()) throw new Error("Tenant Drive source cannot use symlinks");
    if (index < parts.length - 1 && !stat.isDirectory()) throw new Error("Tenant Drive source parent is not a directory");
    if (index === parts.length - 1 &&
        (!stat.isFile() || stat.size > MAX_TENANT_DRIVE_SOURCE_BYTES)) {
      throw new Error("Tenant Drive source must be a regular file no larger than 100 MB");
    }
  }

  const parentRealPath = await realpath(path.dirname(current));
  const containedParent = path.relative(canonicalRoot, parentRealPath);
  if (containedParent === ".." || containedParent.startsWith(`..${path.sep}`) || path.isAbsolute(containedParent)) {
    throw new Error("Tenant Drive source parent escapes uploads");
  }
  const realFilePath = await realpath(current);
  if (realFilePath !== path.join(parentRealPath, path.basename(current))) {
    throw new Error("Tenant Drive source resolves outside its verified parent");
  }
  return current;
}

async function readBoundedRegularFile(root: string, parts: string[]): Promise<Buffer> {
  const filePath = await assertSafeSourceLocation(root, parts, false);
  if (!filePath) throw new Error("Tenant Drive source is unavailable");
  const handle = await open(filePath, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const before = await handle.stat();
    if (!before.isFile() || before.size <= 0 || before.size > MAX_TENANT_DRIVE_SOURCE_BYTES) {
      throw new Error("Tenant Drive source must be a non-empty regular file no larger than 100 MB");
    }
    const chunks: Buffer[] = [];
    let total = 0;
    let offset = 0;
    while (true) {
      const chunk = Buffer.allocUnsafe(Math.min(64 * 1024, MAX_TENANT_DRIVE_SOURCE_BYTES + 1 - total));
      const { bytesRead } = await handle.read(chunk, 0, chunk.length, offset);
      if (!bytesRead) break;
      total += bytesRead;
      if (total > MAX_TENANT_DRIVE_SOURCE_BYTES) {
        throw new Error("Tenant Drive source exceeds the 100 MB limit");
      }
      chunks.push(chunk.subarray(0, bytesRead));
      offset += bytesRead;
    }
    const bytes = Buffer.concat(chunks, total);
    const after = await handle.stat();
    if (bytes.length !== before.size || bytes.length > MAX_TENANT_DRIVE_SOURCE_BYTES ||
        before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size) {
      throw new Error("Tenant Drive source changed while being verified");
    }
    return bytes;
  } finally {
    await handle.close();
  }
}

/**
 * Resolves an authorized upload source to the exact bytes that were verified.
 * It deliberately returns bytes, never a path that a caller could reopen later.
 */
export async function resolveTenantDriveUploadSource(
  filePath: unknown,
  tenantId: unknown,
  deps: TenantDriveSourceDependencies,
): Promise<Buffer> {
  assertTenantId(tenantId);
  if (!deps || typeof deps.uploadsRoot !== "string" || !deps.uploadsRoot ||
      typeof deps.resolveUploadOwnerRows !== "function" || typeof deps.findOwnedArtifact !== "function") {
    throw new Error("Tenant Drive source authorization is unavailable");
  }

  const uploadsRoot = path.resolve(deps.uploadsRoot);
  const parts = resolveRelativeSource(filePath, uploadsRoot);
  const isPrivateTenantPath = parts[0] === "tenant-drive";
  let filename: string;

  if (isPrivateTenantPath) {
    if (parts.length !== 3 || parts[1] !== String(tenantId)) {
      throw new Error("Tenant Drive source belongs to a different tenant or namespace");
    }
    filename = parts[2];
  } else {
    if (parts.length !== 1) throw new Error("Flat upload source must be a filename under uploads");
    filename = parts[0];
  }
  if (isRestrictedName(filename)) throw new Error("Restricted Tenant Drive source filename");

  let artifactManifest: TenantDriveArtifactManifest | null = null;
  if (!isPrivateTenantPath) {
    const ownerRows = await deps.resolveUploadOwnerRows(tenantId, filename);
    if (!Array.isArray(ownerRows)) throw new Error("Upload ownership could not be verified");
    if (ownerRows.some(row => !row || row.filename !== filename || row.tenantId !== tenantId)) {
      throw new Error("Upload basename is owned by another tenant or has ambiguous ownership");
    }
    if (ownerRows.length > 1) throw new Error("Upload basename has ambiguous ownership");
    const row = ownerRows[0];
    if (row?.data) {
      const bytes = decodeOwnedBytes(row.data, row.size);
      await assertSafeSourceLocation(uploadsRoot, parts, true);
      return bytes;
    }

    artifactManifest = await deps.findOwnedArtifact(tenantId, filename);
    if (!artifactManifest || !/^[a-f0-9]{64}$/i.test(artifactManifest.sha256) ||
        !Number.isSafeInteger(artifactManifest.size) || artifactManifest.size <= 0 ||
        artifactManifest.size > MAX_TENANT_DRIVE_SOURCE_BYTES) {
      throw new Error("Caller-owned artifact manifest is unavailable or invalid");
    }
  }

  const bytes = await readBoundedRegularFile(uploadsRoot, parts);
  if (artifactManifest) {
    const actualDigest = createHash("sha256").update(bytes).digest("hex");
    if (bytes.length !== artifactManifest.size || actualDigest !== artifactManifest.sha256.toLowerCase()) {
      throw new Error("Generated upload does not match its caller-owned artifact manifest");
    }
  }
  return bytes;
}