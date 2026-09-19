import crypto from "node:crypto";
import { and, desc, eq, ilike, sql } from "drizzle-orm";
import { db } from "./db";
import {
  artifactEvents,
  artifactRecords,
  deliveryLogs,
  fileStorage,
  projects,
  type ArtifactRecord,
} from "@shared/schema";

export const ARTIFACT_STATUSES = ["pending", "durable", "degraded", "failed", "deleted"] as const;
export type ArtifactStatus = typeof ARTIFACT_STATUSES[number];
const DRIVE_UPLOAD_DISPATCH_PENDING = "Drive upload dispatch pending";

export type ArtifactIntentInput = {
  tenantId: number;
  projectId?: number | null;
  logicalName: string;
  artifactKind: string;
  mimeType: string;
  idempotencyKey: string;
  sourceRunKey?: string | null;
  sourceRequestId?: string | null;
  deliveryLogId?: number | null;
  fileStorageId?: number | null;
  metadata?: Record<string, unknown>;
  bytes?: Buffer;
  sha256?: string;
  sizeBytes?: number;
  revision?: number;
};

export function sha256Artifact(bytes: Buffer): string {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

export function artifactScopeKey(projectId?: number | null): string {
  if (projectId == null) return "tenant";
  if (!Number.isSafeInteger(projectId) || projectId <= 0) throw new Error("Artifact requires a valid project when projectId is supplied");
  return `project:${projectId}`;
}

function requireText(value: unknown, field: string, max: number): string {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!normalized || normalized.length > max || /[\u0000-\u001f\u007f]/.test(normalized)) {
    throw new Error(`Artifact requires a valid ${field}`);
  }
  return normalized;
}

function requireTenantId(tenantId: unknown): number {
  if (!Number.isSafeInteger(tenantId) || (tenantId as number) <= 0) throw new Error("Artifact requires a valid tenant");
  return tenantId as number;
}

export function verifyArtifactBytes(params: {
  bytes: Buffer;
  expectedSha256: string;
  expectedSize: number;
}): void {
  if (!Buffer.isBuffer(params.bytes)) throw new Error("Artifact bytes are invalid");
  if (!Number.isSafeInteger(params.expectedSize) || params.expectedSize <= 0) {
    throw new Error("Artifact size is invalid");
  }
  if (params.bytes.length !== params.expectedSize) throw new Error("Artifact size mismatch");
  if (!/^[a-f0-9]{64}$/i.test(params.expectedSha256)) throw new Error("Artifact hash is invalid");
  if (sha256Artifact(params.bytes) !== params.expectedSha256.toLowerCase()) {
    throw new Error("Artifact hash mismatch");
  }
}

export function buildArtifactIntent(input: ArtifactIntentInput) {
  const tenantId = requireTenantId(input.tenantId);
  const logicalName = requireText(input.logicalName, "logical name", 300);
  const artifactKind = requireText(input.artifactKind, "kind", 80);
  const mimeType = requireText(input.mimeType, "MIME type", 200);
  const idempotencyKey = requireText(input.idempotencyKey, "idempotency key", 300);
  const sourceRunKey = input.sourceRunKey == null ? null : requireText(input.sourceRunKey, "source run key", 300);
  const sourceRequestId = input.sourceRequestId == null ? null : requireText(input.sourceRequestId, "source request id", 300);
  const scopeKey = artifactScopeKey(input.projectId);
  let sha256 = input.sha256;
  let sizeBytes = input.sizeBytes;
  if (input.bytes) {
    if (input.bytes.length === 0) throw new Error("Artifact cannot be empty");
    sha256 = sha256Artifact(input.bytes);
    sizeBytes = input.bytes.length;
  }
  if (
    typeof sha256 !== "string" ||
    !/^[a-f0-9]{64}$/i.test(sha256) ||
    typeof sizeBytes !== "number" ||
    !Number.isSafeInteger(sizeBytes) ||
    sizeBytes <= 0
  ) {
    throw new Error("Artifact requires verified bytes or a valid hash and size");
  }
  if (input.revision !== undefined && (!Number.isSafeInteger(input.revision) || input.revision <= 0)) {
    throw new Error("Artifact revision is invalid");
  }
  return {
    tenantId,
    projectId: input.projectId ?? null,
    scopeKey,
    logicalName,
    artifactKind,
    mimeType,
    idempotencyKey,
    sourceRunKey,
    sourceRequestId,
    deliveryLogId: input.deliveryLogId ?? null,
    fileStorageId: input.fileStorageId ?? null,
    metadata: input.metadata ?? {},
    sha256: sha256.toLowerCase(),
    sizeBytes,
    revision: input.revision,
  };
}

async function appendArtifactEvent(
  tenantId: number,
  artifactId: number,
  eventType: string,
  status: ArtifactStatus,
  message?: string,
  metadata: Record<string, unknown> = {},
): Promise<void> {
  await db.insert(artifactEvents).values({ tenantId, artifactId, eventType, status, message: message || null, metadata });
}

/**
 * Creates the write-ahead intent for one generated work product. The advisory
 * lock serializes new revisions of the same logical artifact while the unique
 * idempotency key causes concurrent retries to return the same row.
 */
export async function createArtifactIntent(input: ArtifactIntentInput): Promise<ArtifactRecord> {
  const intent = buildArtifactIntent(input);
  return db.transaction(async (tx) => {
    // Serialize retries by their tenant-scoped operation key BEFORE lookup; a
    // same-key concurrent caller must receive the existing manifest, not lose
    // an INSERT race to the unique constraint.
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`artifact-idempotency:${intent.tenantId}:${intent.idempotencyKey}`}))`);
    if (intent.projectId) {
      const [project] = await tx.select({ id: projects.id }).from(projects).where(and(
        eq(projects.id, intent.projectId),
        eq(projects.tenantId, intent.tenantId),
      )).limit(1);
      if (!project) throw new Error("Artifact project does not belong to this tenant");
    }
    if (intent.deliveryLogId) {
      const [delivery] = await tx.select({ id: deliveryLogs.id }).from(deliveryLogs).where(and(
        eq(deliveryLogs.id, intent.deliveryLogId),
        eq(deliveryLogs.tenantId, intent.tenantId),
      )).limit(1);
      if (!delivery) throw new Error("Artifact delivery record does not belong to this tenant");
    }
    if (intent.fileStorageId) {
      const [storedFile] = await tx.select({ id: fileStorage.id }).from(fileStorage).where(and(
        eq(fileStorage.id, intent.fileStorageId),
        eq(fileStorage.tenantId, intent.tenantId),
      )).limit(1);
      if (!storedFile) throw new Error("Artifact file record does not belong to this tenant");
    }
    const [existing] = await tx.select().from(artifactRecords).where(and(
      eq(artifactRecords.tenantId, intent.tenantId),
      eq(artifactRecords.idempotencyKey, intent.idempotencyKey),
    )).limit(1);
    if (existing) {
      if (
        existing.scopeKey !== intent.scopeKey ||
        existing.logicalName !== intent.logicalName ||
        existing.sha256 !== intent.sha256 ||
        existing.sizeBytes !== intent.sizeBytes
      ) {
        throw new Error("Artifact idempotency key is already bound to different bytes or identity");
      }
      return existing;
    }

    // The manifest has no parent row to lock for a first revision, so serialize
    // revision allocation by a stable tenant+scope+logical-name advisory lock.
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`${intent.tenantId}:${intent.scopeKey}:${intent.logicalName}`}))`);
    const [revisionRow] = await tx.select({
      revision: sql<number>`COALESCE(MAX(${artifactRecords.revision}), 0)`,
    }).from(artifactRecords).where(and(
      eq(artifactRecords.tenantId, intent.tenantId),
      eq(artifactRecords.scopeKey, intent.scopeKey),
      eq(artifactRecords.logicalName, intent.logicalName),
    ));
    const revision = intent.revision ?? Number(revisionRow?.revision ?? 0) + 1;
    const [created] = await tx.insert(artifactRecords).values({
      ...intent,
      revision,
      status: "pending",
      metadata: intent.metadata,
    }).returning();
    if (!created) throw new Error("Artifact intent could not be persisted");
    await tx.insert(artifactEvents).values({
      tenantId: intent.tenantId,
      artifactId: created.id,
      eventType: "intent_created",
      status: "pending",
      metadata: { sourceRunKey: intent.sourceRunKey, sourceRequestId: intent.sourceRequestId },
    });
    return created;
  });
}

export async function markArtifactDegraded(params: {
  tenantId: number;
  artifactId: number;
  message: string;
  eventType?: string;
}): Promise<ArtifactRecord> {
  const tenantId = requireTenantId(params.tenantId);
  const message = requireText(params.message, "failure message", 1000);
  const [updated] = await db.update(artifactRecords).set({
    status: "degraded",
    errorMessage: message,
    updatedAt: new Date(),
  }).where(and(eq(artifactRecords.id, params.artifactId), eq(artifactRecords.tenantId, tenantId)))
    .returning();
  if (!updated) throw new Error("Artifact record not found");
  await appendArtifactEvent(tenantId, updated.id, params.eventType || "durability_degraded", "degraded", message);
  return updated;
}

export async function verifyAndMarkArtifactDurable(params: {
  tenantId: number;
  artifactId: number;
  driveFileId: string;
  driveFolderId?: string | null;
  driveViewUrl?: string | null;
  driveDownloadUrl?: string | null;
  readBytes?: (fileId: string) => Promise<Buffer>;
}): Promise<ArtifactRecord> {
  const tenantId = requireTenantId(params.tenantId);
  const driveFileId = requireText(params.driveFileId, "Drive file id", 300);
  const [artifact] = await db.select().from(artifactRecords).where(and(
    eq(artifactRecords.id, params.artifactId),
    eq(artifactRecords.tenantId, tenantId),
  )).limit(1);
  if (!artifact) throw new Error("Artifact record not found");

  try {
    // Record the irreversible provider receipt before the verification read.
    // If the read times out, reconciliation has the exact Drive identity to
    // repair instead of treating the completed remote upload as invisible.
    const [receiptRecorded] = await db.update(artifactRecords).set({
      driveFileId,
      driveFolderId: params.driveFolderId || null,
      driveViewUrl: params.driveViewUrl || null,
      driveDownloadUrl: params.driveDownloadUrl || null,
      updatedAt: new Date(),
    }).where(and(eq(artifactRecords.id, artifact.id), eq(artifactRecords.tenantId, tenantId)))
      .returning({ id: artifactRecords.id });
    if (!receiptRecorded) throw new Error("Artifact Drive receipt could not be recorded");
    await appendArtifactEvent(tenantId, artifact.id, "drive_receipt_recorded", "pending", undefined, { driveFileId });

    const readBytes = params.readBytes || (async (fileId: string) => {
      const { readDriveFileBytes } = await import("./google-drive");
      return readDriveFileBytes(fileId);
    });
    const bytes = await readBytes(driveFileId);
    verifyArtifactBytes({ bytes, expectedSha256: artifact.sha256, expectedSize: artifact.sizeBytes });
    const [updated] = await db.update(artifactRecords).set({
      driveFileId,
      driveFolderId: params.driveFolderId || null,
      driveViewUrl: params.driveViewUrl || null,
      driveDownloadUrl: params.driveDownloadUrl || null,
      status: "durable",
      errorMessage: null,
      durableAt: new Date(),
      updatedAt: new Date(),
    }).where(and(eq(artifactRecords.id, artifact.id), eq(artifactRecords.tenantId, tenantId)))
      .returning();
    if (!updated) throw new Error("Artifact durability receipt could not be recorded");
    await appendArtifactEvent(tenantId, artifact.id, "drive_verified", "durable", undefined, { driveFileId });
    return updated;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Drive durability verification failed";
    // A completed byte read proving a mismatch is corruption. Every other
    // failure leaves the provider receipt pending so reconciliation can retry
    // verification without confusing an unknown outcome with a bad artifact.
    if (/^Artifact (?:size|hash) mismatch$/.test(message)) {
      await markArtifactDegraded({ tenantId, artifactId: artifact.id, message, eventType: "drive_verification_failed" });
    } else {
      await appendArtifactEvent(
        tenantId,
        artifact.id,
        "durability_verification_uncertain",
        artifact.status as ArtifactStatus,
        message,
      );
    }
    throw new Error(`Artifact remains recoverable but is not durable: ${message}`);
  }
}

export async function getArtifactRecord(tenantId: number, artifactId: number): Promise<ArtifactRecord | null> {
  requireTenantId(tenantId);
  if (!Number.isSafeInteger(artifactId) || artifactId <= 0) return null;
  const [record] = await db.select().from(artifactRecords).where(and(
    eq(artifactRecords.tenantId, tenantId),
    eq(artifactRecords.id, artifactId),
  )).limit(1);
  return record || null;
}

export async function listArtifactRecords(params: {
  tenantId: number;
  query?: string;
  status?: ArtifactStatus;
  projectId?: number;
  limit?: number;
}): Promise<ArtifactRecord[]> {
  const tenantId = requireTenantId(params.tenantId);
  const clauses = [eq(artifactRecords.tenantId, tenantId)];
  if (params.status && ARTIFACT_STATUSES.includes(params.status)) clauses.push(eq(artifactRecords.status, params.status));
  if (params.projectId !== undefined) {
    if (!Number.isSafeInteger(params.projectId) || params.projectId <= 0) throw new Error("projectId must be a positive integer");
    clauses.push(eq(artifactRecords.projectId, params.projectId));
  }
  const query = typeof params.query === "string" ? params.query.trim().slice(0, 160) : "";
  if (query) clauses.push(ilike(artifactRecords.logicalName, `%${query.replace(/[%_\\]/g, "\\$&")}%`));
  const limit = Math.min(Math.max(Number.isSafeInteger(params.limit) ? params.limit! : 50, 1), 100);
  return db.select().from(artifactRecords).where(and(...clauses)).orderBy(desc(artifactRecords.updatedAt)).limit(limit);
}

export async function listArtifactEvents(tenantId: number, artifactId: number) {
  requireTenantId(tenantId);
  return db.select().from(artifactEvents).where(and(
    eq(artifactEvents.tenantId, tenantId),
    eq(artifactEvents.artifactId, artifactId),
  )).orderBy(desc(artifactEvents.createdAt)).limit(100);
}

/**
 * Repair a record after an interrupted remote write. Legacy delivery receipts
 * are a secondary source of truth: if the manifest write failed after Drive
 * succeeded, the receipt supplies the exact remote file ID without repeating
 * an upload or email.
 */
export async function reconcileArtifactDurability(tenantId: number, artifactId: number): Promise<ArtifactRecord> {
  const artifact = await getArtifactRecord(tenantId, artifactId);
  if (!artifact) throw new Error("Artifact not found");
  let driveFileId = artifact.driveFileId;
  let driveFolderId = artifact.driveFolderId;
  let driveViewUrl = artifact.driveViewUrl;
  let driveDownloadUrl = artifact.driveDownloadUrl;

  if (!driveFileId && artifact.deliveryLogId) {
    const [delivery] = await db.select({
      driveFileId: deliveryLogs.driveFileId,
      driveFolderId: deliveryLogs.driveFolderId,
      shareableLink: deliveryLogs.shareableLink,
      downloadLink: deliveryLogs.downloadLink,
    }).from(deliveryLogs).where(and(
      eq(deliveryLogs.id, artifact.deliveryLogId),
      eq(deliveryLogs.tenantId, tenantId),
    )).limit(1);
    driveFileId = delivery?.driveFileId || null;
    driveFolderId = delivery?.driveFolderId || null;
    driveViewUrl = delivery?.shareableLink || null;
    driveDownloadUrl = delivery?.downloadLink || null;
  }
  if (!driveFileId) {
    return markArtifactDegraded({
      tenantId,
      artifactId,
      message: "No provider receipt is available yet; wait for the active delivery or retry it explicitly.",
      eventType: "reconcile_missing_receipt",
    });
  }
  return verifyAndMarkArtifactDurable({
    tenantId,
    artifactId,
    driveFileId,
    driveFolderId,
    driveViewUrl,
    driveDownloadUrl,
  });
}

export async function recordArtifactResent(tenantId: number, artifactId: number): Promise<void> {
  const artifact = await getArtifactRecord(tenantId, artifactId);
  if (!artifact) throw new Error("Artifact not found");
  await db.update(artifactRecords).set({ errorMessage: null, updatedAt: new Date() }).where(and(
    eq(artifactRecords.id, artifactId),
    eq(artifactRecords.tenantId, tenantId),
  ));
  await appendArtifactEvent(tenantId, artifactId, "delivery_resent", artifact.status as ArtifactStatus);
}

export async function recordArtifactResendIntent(tenantId: number, artifactId: number): Promise<void> {
  const artifact = await getArtifactRecord(tenantId, artifactId);
  if (!artifact) throw new Error("Artifact not found");
  await appendArtifactEvent(tenantId, artifactId, "delivery_resend_started", artifact.status as ArtifactStatus);
}

export async function markArtifactDeliveryReceiptPending(tenantId: number, artifactId: number): Promise<void> {
  const artifact = await getArtifactRecord(tenantId, artifactId);
  if (!artifact) throw new Error("Artifact not found");
  await db.update(artifactRecords).set({
    errorMessage: "Customer email delivery receipt pending",
    updatedAt: new Date(),
  }).where(and(eq(artifactRecords.id, artifactId), eq(artifactRecords.tenantId, tenantId)));
  await appendArtifactEvent(tenantId, artifactId, "delivery_email_dispatch_started", artifact.status as ArtifactStatus);
}

/**
 * Write-ahead marker for a Drive upload request. A restart must never infer
 * that a missing Drive-key search proves an already-dispatched POST failed.
 */
export async function markArtifactDriveUploadDispatchPending(tenantId: number, artifactId: number): Promise<void> {
  const artifact = await getArtifactRecord(tenantId, artifactId);
  if (!artifact) throw new Error("Artifact not found");
  if (artifact.errorMessage === DRIVE_UPLOAD_DISPATCH_PENDING) {
    throw new Error("Artifact has a Drive upload dispatch awaiting reconciliation");
  }
  await db.update(artifactRecords).set({
    errorMessage: DRIVE_UPLOAD_DISPATCH_PENDING,
    updatedAt: new Date(),
  }).where(and(eq(artifactRecords.id, artifactId), eq(artifactRecords.tenantId, tenantId)));
  await appendArtifactEvent(tenantId, artifactId, "drive_upload_dispatch_started", artifact.status as ArtifactStatus);
}

/** Clear a write-ahead Drive marker only after a failure known to precede a POST. */
export async function clearArtifactDriveUploadDispatchPending(tenantId: number, artifactId: number): Promise<void> {
  const artifact = await getArtifactRecord(tenantId, artifactId);
  if (!artifact) throw new Error("Artifact not found");
  const [cleared] = await db.update(artifactRecords).set({
    errorMessage: null,
    updatedAt: new Date(),
  }).where(and(
    eq(artifactRecords.id, artifactId),
    eq(artifactRecords.tenantId, tenantId),
    eq(artifactRecords.errorMessage, DRIVE_UPLOAD_DISPATCH_PENDING),
  )).returning({ id: artifactRecords.id });
  if (cleared) {
    await appendArtifactEvent(tenantId, artifactId, "drive_upload_dispatch_aborted", artifact.status as ArtifactStatus);
  }
}

export async function clearArtifactDeliveryReceiptPending(tenantId: number, artifactId: number): Promise<void> {
  const artifact = await getArtifactRecord(tenantId, artifactId);
  if (!artifact) throw new Error("Artifact not found");
  const [cleared] = await db.update(artifactRecords).set({
    errorMessage: null,
    updatedAt: new Date(),
  }).where(and(
    eq(artifactRecords.id, artifactId),
    eq(artifactRecords.tenantId, tenantId),
    eq(artifactRecords.errorMessage, "Customer email delivery receipt pending"),
  )).returning({ id: artifactRecords.id });
  if (cleared) {
    await appendArtifactEvent(tenantId, artifactId, "delivery_email_receipt_recorded", artifact.status as ArtifactStatus);
  }
}

export async function recordArtifactResendUncertain(tenantId: number, artifactId: number, message: string): Promise<void> {
  const artifact = await getArtifactRecord(tenantId, artifactId);
  if (!artifact) throw new Error("Artifact not found");
  const safeMessage = requireText(String(message).slice(0, 800), "resend failure message", 800);
  await db.update(artifactRecords).set({
    errorMessage: `Delivery resend outcome uncertain: ${safeMessage}`,
    updatedAt: new Date(),
  }).where(and(eq(artifactRecords.id, artifactId), eq(artifactRecords.tenantId, tenantId)));
  await appendArtifactEvent(tenantId, artifactId, "delivery_resend_uncertain", artifact.status as ArtifactStatus, safeMessage);
}

export async function resolveArtifactResendUncertainty(tenantId: number, artifactId: number): Promise<void> {
  const artifact = await getArtifactRecord(tenantId, artifactId);
  if (!artifact?.deliveryLogId) throw new Error("Artifact has no customer delivery to resolve");
  const [delivery] = await db.select({
    status: deliveryLogs.status,
    metadata: deliveryLogs.metadata,
  }).from(deliveryLogs).where(and(
    eq(deliveryLogs.id, artifact.deliveryLogId),
    eq(deliveryLogs.tenantId, tenantId),
  )).limit(1);
  if (!delivery) throw new Error("Customer delivery not found");
  const metadata = delivery.metadata && typeof delivery.metadata === "object" && !Array.isArray(delivery.metadata)
    ? delivery.metadata as Record<string, unknown>
    : {};
  const resendPending = typeof metadata.resendPendingAt === "string";
  const initialDeliveryPending = delivery.status === "completion_uncertain"
    && artifact.errorMessage === "Customer email delivery receipt pending";
  if (!resendPending && !initialDeliveryPending) throw new Error("No delivery uncertainty requires resolution");
  const [resolved] = await db.update(deliveryLogs).set({
    status: "completed",
    errorMessage: null,
    metadata: sql`COALESCE(metadata, '{}'::jsonb) || ${JSON.stringify({
      resendPendingAt: null,
      resendResolution: "operator_acknowledged",
      resendResolvedAt: new Date().toISOString(),
    })}::jsonb`,
  }).where(and(
    eq(deliveryLogs.id, artifact.deliveryLogId),
    eq(deliveryLogs.tenantId, tenantId),
  )).returning({ id: deliveryLogs.id });
  if (!resolved) throw new Error("Delivery uncertainty could not be resolved");
  await db.update(artifactRecords).set({ errorMessage: null, updatedAt: new Date() }).where(and(
    eq(artifactRecords.deliveryLogId, artifact.deliveryLogId),
    eq(artifactRecords.tenantId, tenantId),
  ));
  await appendArtifactEvent(tenantId, artifactId, "delivery_uncertainty_operator_resolved", artifact.status as ArtifactStatus, "A tenant user explicitly resolved the uncertain delivery state");
}

export async function attachArtifactFileStorageFallback(params: {
  tenantId: number;
  artifactId: number;
  fileStorageId: number;
}): Promise<void> {
  const tenantId = requireTenantId(params.tenantId);
  const [storedFile] = await db.select({ id: fileStorage.id }).from(fileStorage).where(and(
    eq(fileStorage.id, params.fileStorageId),
    eq(fileStorage.tenantId, tenantId),
  )).limit(1);
  if (!storedFile) throw new Error("Artifact fallback file does not belong to this tenant");
  const [updated] = await db.update(artifactRecords).set({
    fileStorageId: params.fileStorageId,
    updatedAt: new Date(),
  }).where(and(eq(artifactRecords.id, params.artifactId), eq(artifactRecords.tenantId, tenantId)))
    .returning({ id: artifactRecords.id });
  if (!updated) throw new Error("Artifact record not found");
  await appendArtifactEvent(tenantId, params.artifactId, "file_storage_fallback_recorded", "durable", undefined, {
    fileStorageId: params.fileStorageId,
  });
}

export async function loadArtifactBytes(params: {
  tenantId: number;
  artifactId: number;
  readDriveBytes?: (fileId: string) => Promise<Buffer>;
}): Promise<{ record: ArtifactRecord; bytes: Buffer }> {
  const record = await getArtifactRecord(params.tenantId, params.artifactId);
  if (!record || record.status === "deleted") throw new Error("Artifact not found");
  let resolvedRecord = record;
  let lastError: Error | null = null;
  if (record.driveFileId) {
    try {
      const readDriveBytes = params.readDriveBytes || (async (fileId: string) => {
        const { readDriveFileBytes } = await import("./google-drive");
        return readDriveFileBytes(fileId);
      });
      const bytes = await readDriveBytes(record.driveFileId);
      verifyArtifactBytes({ bytes, expectedSha256: record.sha256, expectedSize: record.sizeBytes });
      return { record, bytes };
    } catch (error) {
      lastError = error instanceof Error ? error : new Error("Drive artifact read failed");
      if (record.status === "durable" && /^Artifact (?:size|hash) mismatch$/.test(lastError.message)) {
        try {
          resolvedRecord = await markArtifactDegraded({
            tenantId: record.tenantId,
            artifactId: record.id,
            message: `Drive copy could not be verified: ${lastError.message}`,
            eventType: "drive_copy_read_failed",
          });
        } catch (persistenceError) {
          const persistenceMessage = persistenceError instanceof Error ? persistenceError.message : "unknown persistence failure";
          throw new Error(`Artifact Drive copy could not be verified and its recovery state could not be recorded: ${lastError.message}; ${persistenceMessage}`);
        }
      } else {
        await appendArtifactEvent(
          record.tenantId,
          record.id,
          "durable_copy_read_uncertain",
          record.status as ArtifactStatus,
          lastError.message,
        );
      }
    }
  }
  if (record.fileStorageId) {
    try {
      const [fallback] = await db.select().from(fileStorage).where(and(
        eq(fileStorage.id, record.fileStorageId),
        eq(fileStorage.tenantId, record.tenantId),
      )).limit(1);
      if (fallback?.data) {
        const bytes = Buffer.from(fallback.data, "base64");
        verifyArtifactBytes({ bytes, expectedSha256: record.sha256, expectedSize: record.sizeBytes });
        return { record: resolvedRecord, bytes };
      }
    } catch (error) {
      lastError = error instanceof Error ? error : new Error("Artifact fallback read failed");
    }
  }
  const message = lastError?.message || "Artifact has no durable readable copy";
  if (resolvedRecord.status === "durable" && /^Artifact (?:size|hash) mismatch$/.test(message)) {
    try {
      await markArtifactDegraded({
        tenantId: record.tenantId,
        artifactId: record.id,
        message,
        eventType: "durable_copy_read_failed",
      });
    } catch (persistenceError) {
      const persistenceMessage = persistenceError instanceof Error ? persistenceError.message : "unknown persistence failure";
      throw new Error(`Artifact could not be read and its recovery state could not be recorded: ${message}; ${persistenceMessage}`);
    }
  } else {
    await appendArtifactEvent(
      record.tenantId,
      record.id,
      "durable_copy_read_uncertain",
      record.status as ArtifactStatus,
      message,
    );
  }
  throw new Error(`Artifact is not currently readable: ${message}`);
}