import crypto from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { db } from "./db";
import { fileStorage } from "@shared/schema";

const ARTIFACT_IO_TIMEOUT_MS = 15_000;

async function withArtifactDeadline<T>(operation: () => Promise<T>, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const operationPromise = operation();
  operationPromise.catch(() => {});
  const timeoutPromise = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(
      () => reject(new Error(`${label} timed out after ${ARTIFACT_IO_TIMEOUT_MS}ms`)),
      ARTIFACT_IO_TIMEOUT_MS,
    );
  });
  try {
    return await Promise.race([operationPromise, timeoutPromise]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function sha256(bytes: Buffer): string {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

function prospectArtifactFilename(params: {
  projectId: number;
  sourceRunKey: string;
  originalName: string;
}): string {
  const identity = crypto
    .createHash("sha256")
    .update(`${params.projectId}\0${params.sourceRunKey}\0${params.originalName}`)
    .digest("hex")
    .slice(0, 32);
  const safeName = params.originalName.replace(/[^a-zA-Z0-9._-]+/g, "-").slice(-120);
  return `cmmc-prospect-${identity}-${safeName}`;
}

function verifyBytes(bytes: Buffer, expectedSha256: string, expectedSize: number): void {
  if (bytes.length !== expectedSize) throw new Error("CMMC prospect artifact size mismatch");
  if (sha256(bytes) !== expectedSha256) throw new Error("CMMC prospect artifact hash mismatch");
}

async function getObjectStorage() {
  return import("./object-storage");
}

export async function persistCmmcProspectArtifact(params: {
  tenantId: number;
  projectId: number;
  sourceRunKey: string;
  originalName: string;
  mimeType: string;
  bytes: Buffer;
}): Promise<{ filename: string; sha256: string; size: number }> {
  if (!Number.isInteger(params.tenantId) || params.tenantId <= 0) {
    throw new Error("CMMC prospect artifact requires a valid tenant");
  }
  if (!Number.isInteger(params.projectId) || params.projectId <= 0) {
    throw new Error("CMMC prospect artifact requires a valid project");
  }
  if (!params.sourceRunKey || !params.originalName || !params.mimeType) {
    throw new Error("CMMC prospect artifact metadata is incomplete");
  }
  if (params.bytes.length === 0) throw new Error("CMMC prospect artifact is empty");

  const filename = prospectArtifactFilename(params);
  const expectedSha256 = sha256(params.bytes);
  const databaseFallback = params.bytes.toString("base64");
  let storageKey: string | null = null;

  try {
    const { uploadTenantFile } = await getObjectStorage();
    storageKey = (await withArtifactDeadline(
      () => uploadTenantFile(
        params.tenantId,
        "cmmc-prospect-reports",
        params.originalName,
        params.bytes,
      ),
      "CMMC prospect artifact upload",
    )).storageKey;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[cmmc-prospect-artifact] object storage unavailable; retaining database copy: ${message}`);
  }

  await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`cmmc-prospect-artifact:${params.tenantId}:${filename}`}))`);
    const [existing] = await tx.select({ id: fileStorage.id }).from(fileStorage).where(and(
      eq(fileStorage.tenantId, params.tenantId),
      eq(fileStorage.filename, filename),
    )).limit(1);
    const values = {
      originalName: params.originalName,
      mimeType: params.mimeType,
      size: params.bytes.length,
      data: databaseFallback,
      storageKey,
      isPublic: false,
    };
    if (existing) {
      await tx.update(fileStorage).set(values).where(and(
        eq(fileStorage.id, existing.id),
        eq(fileStorage.tenantId, params.tenantId),
      ));
    } else {
      await tx.insert(fileStorage).values({
        filename,
        tenantId: params.tenantId,
        ...values,
      });
    }
  });

  await loadCmmcProspectArtifact({
    tenantId: params.tenantId,
    filename,
    expectedSha256,
    expectedSize: params.bytes.length,
  });
  return { filename, sha256: expectedSha256, size: params.bytes.length };
}

export async function loadCmmcProspectArtifact(params: {
  tenantId: number;
  filename: string;
  expectedSha256: string;
  expectedSize: number;
}): Promise<Buffer> {
  const [stored] = await db.select().from(fileStorage).where(and(
    eq(fileStorage.tenantId, params.tenantId),
    eq(fileStorage.filename, params.filename),
  )).limit(1);
  if (!stored) throw new Error("CMMC prospect artifact is unavailable");

  let bytes: Buffer | null = null;
  if (stored.storageKey) {
    try {
      const { downloadTenantFile } = await getObjectStorage();
      bytes = await withArtifactDeadline(
        () => downloadTenantFile(params.tenantId, stored.storageKey!),
        "CMMC prospect artifact download",
      );
      verifyBytes(bytes, params.expectedSha256, params.expectedSize);
    } catch (error) {
      if (!stored.data) throw error;
      bytes = null;
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`[cmmc-prospect-artifact] object read failed; using database copy: ${message}`);
    }
  }
  if (!bytes && stored.data) bytes = Buffer.from(stored.data, "base64");
  if (!bytes) throw new Error("CMMC prospect artifact has no recoverable bytes");
  verifyBytes(bytes, params.expectedSha256, params.expectedSize);
  return bytes;
}