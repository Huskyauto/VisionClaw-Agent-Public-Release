import fs from "node:fs";
import path from "node:path";
import { and, eq } from "drizzle-orm";
import { db } from "./db";
import { verifyDeliverable } from "./deliverable-verifier";
import type { DeliveryLog } from "@shared/schema";
import type { DeliveryRequest, DeliveryResult } from "./delivery-pipeline";

/**
 * Delivery is a security boundary, not just a reporting action. Keep the
 * extension-to-contract mapping explicit so uncontracted files cannot be
 * uploaded or emailed by accident.
 */
export function resolveDeliveryContractType(fileName: string): string | null {
  switch (path.extname(fileName).toLowerCase()) {
    case ".html":
    case ".htm":
      return "html_page";
    case ".pdf":
      return "pdf_document";
    case ".docx":
      return "word_document";
    case ".pptx":
      return "slide_deck";
    case ".png":
    case ".jpg":
    case ".jpeg":
    case ".webp":
    case ".gif":
      return "image";
    case ".mp4":
    case ".webm":
    case ".mov":
      return "video";
    case ".mp3":
    case ".wav":
    case ".ogg":
      return "audio";
    case ".csv":
      return "csv_data";
    case ".json":
      return "json_data";
    case ".md":
    case ".markdown":
      return "markdown_document";
    case ".txt":
      return "text_document";
    default:
      return null;
  }
}

const DELIVERY_VERIFICATION_TIMEOUT_MS = 15_000;

export async function verifyDeliveryArtifact(input: Parameters<typeof verifyDeliverable>[0]) {
  let timer: NodeJS.Timeout | undefined;
  const verification = verifyDeliverable(input);
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`delivery verification timed out after ${DELIVERY_VERIFICATION_TIMEOUT_MS / 1000}s`)),
      DELIVERY_VERIFICATION_TIMEOUT_MS,
    );
  });
  try {
    return await Promise.race([verification, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

const DELIVERY_SOURCE_PATH_METADATA_KEY = "_deliverySourcePath";
const DELIVERY_MIME_TYPE_METADATA_KEY = "_deliveryMimeType";

function normalizeWorkspaceRelativePath(candidate: unknown): string | null {
  if (typeof candidate !== "string" || !candidate.trim() || path.isAbsolute(candidate)) return null;
  const normalized = path.normalize(candidate.trim());
  if (normalized === "." || normalized === ".." || normalized.startsWith(`..${path.sep}`)) return null;

  const workspaceRoot = path.resolve(process.cwd());
  const resolved = path.resolve(workspaceRoot, normalized);
  if (!resolved.startsWith(`${workspaceRoot}${path.sep}`)) return null;
  return normalized;
}

export function metadataWithDeliverySource(req: DeliveryRequest): Record<string, any> | null {
  const metadata = req.metadata ? { ...req.metadata } : {};
  const sourcePath = normalizeWorkspaceRelativePath(req.filePath);
  if (sourcePath) metadata[DELIVERY_SOURCE_PATH_METADATA_KEY] = sourcePath;
  if (typeof req.mimeType === "string" && req.mimeType) metadata[DELIVERY_MIME_TYPE_METADATA_KEY] = req.mimeType;
  return Object.keys(metadata).length > 0 ? metadata : null;
}

export function readDeliveryArtifactBytes(file: { filePath?: string; fileData?: Buffer; fileName: string }): Buffer {
  if (file.fileData) {
    if (file.fileData.length === 0) throw new Error(`Delivery artifact ${file.fileName} is empty`);
    return file.fileData;
  }
  const normalized = normalizeWorkspaceRelativePath(file.filePath);
  if (!normalized) throw new Error(`Delivery artifact ${file.fileName} has no safe source bytes`);
  const absolutePath = path.resolve(process.cwd(), normalized);
  const bytes = fs.readFileSync(absolutePath);
  if (bytes.length === 0) throw new Error(`Delivery artifact ${file.fileName} is empty`);
  return bytes;
}

function getRetrySourcePath(log: Pick<DeliveryLog, "fileName" | "metadata">): string | null {
  const metadata = log.metadata && typeof log.metadata === "object" && !Array.isArray(log.metadata)
    ? log.metadata as Record<string, unknown>
    : null;
  const recordedPath = normalizeWorkspaceRelativePath(metadata?.[DELIVERY_SOURCE_PATH_METADATA_KEY]);
  if (recordedPath) return recordedPath;
  return normalizeWorkspaceRelativePath(path.join("uploads", path.basename(log.fileName)));
}

function isPathWithin(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative !== "" && !relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative);
}

export interface RetrySource {
  filePath: string;
  fileData: Buffer;
}

/**
 * Open a retry source as a verified, workspace-contained regular file.
 * The resulting bytes are the only retry input used after this returns, so a
 * source cannot be swapped for a symlink between validation and delivery.
 */
export function readRetrySource(log: Pick<DeliveryLog, "fileName" | "metadata">): RetrySource | null {
  const filePath = getRetrySourcePath(log);
  if (!filePath) return null;

  try {
    const workspaceRoot = fs.realpathSync(process.cwd());
    const candidate = path.resolve(workspaceRoot, filePath);
    if (!isPathWithin(workspaceRoot, candidate)) return null;

    // Open the caller's path once, without following a final symlink, then
    // validate the actual open descriptor. Resolving a pathname before opening
    // it would leave a check-to-open race where it could be swapped.
    const fd = fs.openSync(candidate, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
    try {
      if (!fs.fstatSync(fd).isFile()) return null;
      const descriptorTarget = fs.readlinkSync(`/proc/self/fd/${fd}`).replace(/ \(deleted\)$/, "");
      const physicalPath = path.resolve(descriptorTarget);
      if (!isPathWithin(workspaceRoot, physicalPath) || physicalPath !== candidate) return null;
      return { filePath, fileData: fs.readFileSync(fd) };
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return null;
  }
}

/**
 * Resolve a retry source only when it is a readable regular file contained in
 * the workspace. Legacy rows may fall back to uploads/<basename>.
 */
export function resolveRetrySourcePath(log: Pick<DeliveryLog, "fileName" | "metadata">): string | null {
  return readRetrySource(log)?.filePath ?? null;
}

export function buildRetryDeliveryRequest(
  log: Pick<DeliveryLog, "tenantId" | "customerName" | "customerEmail" | "productName" | "fileName" | "orderId" | "stripePaymentId" | "idempotencyKey" | "metadata">,
  retrySource: RetrySource,
): DeliveryRequest {
  const metadata = log.metadata && typeof log.metadata === "object" && !Array.isArray(log.metadata)
    ? log.metadata as Record<string, unknown>
    : {};
  return {
    tenantId: log.tenantId,
    customerName: log.customerName,
    customerEmail: log.customerEmail || undefined,
    productName: log.productName,
    fileName: log.fileName,
    fileData: retrySource.fileData,
    mimeType: typeof metadata[DELIVERY_MIME_TYPE_METADATA_KEY] === "string"
      ? metadata[DELIVERY_MIME_TYPE_METADATA_KEY]
      : undefined,
    orderId: log.orderId || undefined,
    stripePaymentId: log.stripePaymentId || undefined,
    idempotencyKey: log.idempotencyKey || undefined,
    metadata: (log.metadata as Record<string, any>) || undefined,
  };
}

const CMMC_DELIVERY_IDEMPOTENCY_KEY = /^cmmc-delivery-(\d+)-r(\d+)$/;

/**
 * CMMC deliveries own a paired-artifact state machine. Generic delivery
 * retries cannot safely reconstruct their source from a transient local path,
 * so recognize CMMC receipts and return them to that durable recovery flow.
 */
export async function retryCmmcDeliveryIfApplicable(log: DeliveryLog): Promise<DeliveryResult | null> {
  const metadata = log.metadata && typeof log.metadata === "object" && !Array.isArray(log.metadata)
    ? log.metadata as Record<string, unknown>
    : {};
  const reportId = typeof metadata.cmmcReportId === "number" && Number.isInteger(metadata.cmmcReportId) && metadata.cmmcReportId > 0
    ? metadata.cmmcReportId
    : null;
  const legacyKey = typeof log.idempotencyKey === "string"
    ? log.idempotencyKey.match(CMMC_DELIVERY_IDEMPOTENCY_KEY)
    : null;
  if (!reportId && !legacyKey) return null;

  const { cmmcAssessments, cmmcReportExports } = await import("@shared/schema");
  const reportWhere = reportId
    ? and(
      eq(cmmcReportExports.id, reportId),
      eq(cmmcReportExports.tenantId, log.tenantId),
    )
    : and(
      eq(cmmcReportExports.assessmentId, Number(legacyKey![1])),
      eq(cmmcReportExports.revision, Number(legacyKey![2])),
      eq(cmmcReportExports.tenantId, log.tenantId),
    );
  const [report] = await db.select().from(cmmcReportExports).where(reportWhere).limit(1);
  if (!report) {
    return {
      success: false,
      deliveryId: log.id,
      error: "CMMC report record is unavailable; refusing an unsafe local-file retry",
    };
  }
  const [assessment] = await db.select().from(cmmcAssessments).where(and(
    eq(cmmcAssessments.id, report.assessmentId),
    eq(cmmcAssessments.tenantId, log.tenantId),
  )).limit(1);
  if (!assessment) {
    return {
      success: false,
      deliveryId: log.id,
      error: "CMMC assessment is unavailable; refusing an unsafe local-file retry",
    };
  }

  console.log(`[delivery] Manual CMMC retry #${log.id}: returning to durable paired-artifact recovery`);
  try {
    const { deliverCmmcReportPair } = await import("./cmmc-report");
    const delivered = await deliverCmmcReportPair({
      tenantId: log.tenantId,
      assessment,
      report,
      reviewedBy: "manual delivery retry",
    });
    return {
      success: delivered.status === "delivered",
      deliveryId: delivered.deliveryLogId || log.id,
      downloadLink: delivered.pdfDriveFileId || undefined,
      folderLink: delivered.driveFolderId || undefined,
      error: delivered.status === "delivered" ? undefined : "CMMC delivery did not reach a completed state",
    };
  } catch (error) {
    return {
      success: false,
      deliveryId: log.id,
      error: error instanceof Error ? error.message : "CMMC durable retry failed",
    };
  }
}