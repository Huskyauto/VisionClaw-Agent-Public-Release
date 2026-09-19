import crypto from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { db } from "./db";
import { fileStorage } from "@shared/schema";

export type CmmcArtifactKind = "pdf" | "docx";

const MIME_TYPES: Record<CmmcArtifactKind, string> = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
};

async function getObjectStorage() {
  return import("./object-storage");
}

export function cmmcArtifactFilename(params: {
  reportId: number;
  snapshotHash: string;
  kind: CmmcArtifactKind;
}): string {
  if (!Number.isInteger(params.reportId) || params.reportId <= 0) {
    throw new Error("CMMC artifact requires a valid report id");
  }
  if (!/^[a-f0-9]{64}$/i.test(params.snapshotHash)) {
    throw new Error("CMMC artifact requires a valid signed snapshot hash");
  }
  return `cmmc-report-${params.reportId}-${params.snapshotHash.toLowerCase()}-${params.kind}`;
}

export function sha256Artifact(bytes: Buffer): string {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

export function verifyCmmcArtifactBytes(params: {
  bytes: Buffer;
  expectedSha256: string;
  expectedSize: number;
}): void {
  if (!Number.isInteger(params.expectedSize) || params.expectedSize < 0) {
    throw new Error("CMMC artifact size is invalid");
  }
  if (params.bytes.length !== params.expectedSize) {
    throw new Error("CMMC artifact size mismatch");
  }
  if (!/^[a-f0-9]{64}$/i.test(params.expectedSha256)) {
    throw new Error("CMMC artifact hash is invalid");
  }
  if (sha256Artifact(params.bytes) !== params.expectedSha256.toLowerCase()) {
    throw new Error("CMMC artifact hash mismatch");
  }
}

export async function persistCmmcArtifact(params: {
  tenantId: number;
  reportId: number;
  snapshotHash: string;
  kind: CmmcArtifactKind;
  originalName: string;
  bytes: Buffer;
}): Promise<{ artifactKey: string; sha256: string; size: number }> {
  if (!Number.isInteger(params.tenantId) || params.tenantId <= 0) {
    throw new Error("CMMC artifact requires a valid tenant");
  }
  if (params.bytes.length === 0) throw new Error("CMMC artifact is empty");

  const artifactKey = cmmcArtifactFilename(params);
  const sha256 = sha256Artifact(params.bytes);
  const databaseFallback = params.bytes.toString("base64");
  let storageKey: string | null = null;
  try {
    const { uploadTenantFile } = await getObjectStorage();
    storageKey = (await uploadTenantFile(
      params.tenantId,
      "cmmc-reports",
      params.originalName,
      params.bytes,
    )).storageKey;
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown storage error";
    console.warn(`[cmmc-artifact] object storage unavailable; using database fallback for report=${params.reportId} kind=${params.kind}: ${message}`);
  }

  const [stored] = await db.insert(fileStorage).values({
    filename: artifactKey,
    originalName: params.originalName,
    mimeType: MIME_TYPES[params.kind],
    size: params.bytes.length,
    // Keep an independently durable database copy even when object storage is
    // healthy. Object storage remains the preferred read path, while this copy
    // makes a successful object write recoverable if its read-back fails.
    data: databaseFallback,
    storageKey,
    tenantId: params.tenantId,
    isPublic: false,
  }).onConflictDoUpdate({
    target: [fileStorage.tenantId, fileStorage.filename],
    targetWhere: sql`filename LIKE 'cmmc-report-%'`,
    set: {
      originalName: params.originalName,
      mimeType: MIME_TYPES[params.kind],
      size: params.bytes.length,
      data: databaseFallback,
      storageKey,
      isPublic: false,
    },
  }).returning({ filename: fileStorage.filename });
  if (!stored || stored.filename !== artifactKey) {
    throw new Error("CMMC artifact persistence could not be verified");
  }
  // A report is not ready merely because an INSERT succeeded. Read bytes back
  // through the same durable boundary used by delivery and verify their
  // recorded digest/size before returning to the generation state machine.
  await loadCmmcArtifact({
    tenantId: params.tenantId,
    artifactKey,
    expectedSha256: sha256,
    expectedSize: params.bytes.length,
    kind: params.kind,
  });
  return { artifactKey, sha256, size: params.bytes.length };
}

export async function loadCmmcArtifact(params: {
  tenantId: number;
  artifactKey: string;
  expectedSha256: string;
  expectedSize: number;
  kind: CmmcArtifactKind;
}): Promise<{ bytes: Buffer; originalName: string }> {
  if (!Number.isInteger(params.tenantId) || params.tenantId <= 0) {
    throw new Error("CMMC artifact requires a valid tenant");
  }
  const [stored] = await db.select().from(fileStorage).where(and(
    eq(fileStorage.tenantId, params.tenantId),
    eq(fileStorage.filename, params.artifactKey),
  )).limit(1);
  if (!stored || stored.mimeType !== MIME_TYPES[params.kind]) {
    throw new Error("CMMC durable artifact is unavailable");
  }

  let bytes: Buffer | null = null;
  if (stored.storageKey) {
    try {
      const { downloadTenantFile } = await getObjectStorage();
      bytes = await downloadTenantFile(params.tenantId, stored.storageKey);
      verifyCmmcArtifactBytes({
        bytes,
        expectedSha256: params.expectedSha256,
        expectedSize: params.expectedSize,
      });
    } catch (error) {
      if (!stored.data) throw error;
      bytes = null;
      const message = error instanceof Error ? error.message : "unknown storage error";
      console.warn(`[cmmc-artifact] object storage read or verification failed; using database fallback for ${params.artifactKey}: ${message}`);
    }
  }
  if (!bytes && stored.data) {
    bytes = Buffer.from(stored.data, "base64");
  }
  if (!bytes) throw new Error("CMMC durable artifact has no recoverable bytes");

  verifyCmmcArtifactBytes({
    bytes,
    expectedSha256: params.expectedSha256,
    expectedSize: params.expectedSize,
  });
  return { bytes, originalName: stored.originalName };
}