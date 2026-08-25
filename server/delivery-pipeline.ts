import { db } from "./db";
import { deliveryLogs } from "@shared/schema";
import { eq, and, desc, sql } from "drizzle-orm";
import { uploadAndShare, uploadToDrive, verifyDriveFilePublicAccess } from "./google-drive";
import { isEmailConfigured, getPrimaryInboxId, sendEmail } from "./email";
import { signUploadUrl } from "./upload-signing";
import { scanForSecrets, scanFileForSecrets, isLikelyTextPath, summarizeReport, type ScanReport } from "./lib/secret-scan";
import { verifyDeliverable } from "./deliverable-verifier";
import type { DeliveryLog } from "@shared/schema";
import fs from "node:fs";
import path from "node:path";

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
    default:
      return null;
  }
}

/**
 * Copy the deliverable into our own /uploads/ static folder and return a
 * public URL served by our Express server. This bypasses Google Drive's
 * preview transcoder entirely — videos and audio play instantly in any
 * browser (desktop or mobile) the moment the link is opened.
 * Returns null if the file cannot be staged.
 */
function publishToOwnServer(req: DeliveryRequest, deliveryId: number): string | null {
  return publishOneFileToOwnServer({
    fileName: req.fileName,
    filePath: req.filePath,
    fileData: req.fileData,
  }, deliveryId, req.tenantId ?? 1);
}

// Cap DB persistence at 25MB — file_storage holds base64 text; anything larger
// (raw video etc.) stays disk/Drive-only with a loud log so we know it won't
// survive a republish.
const MAX_DB_PERSIST_BYTES = 25 * 1024 * 1024;

async function persistDeliveryAssetToDb(publicName: string, originalName: string, absPath: string, tenantId: number, deliveryId: number): Promise<void> {
  try {
    const bytes = fs.readFileSync(absPath);
    if (bytes.length === 0) return;
    if (bytes.length > MAX_DB_PERSIST_BYTES) {
      console.warn(`[delivery] #${deliveryId} ${publicName} is ${(bytes.length / 1048576).toFixed(1)}MB — too large for DB backup; link will NOT survive a republish.`);
      return;
    }
    const ext = path.extname(publicName).toLowerCase();
    const mimeMap: Record<string, string> = {
      ".pdf": "application/pdf", ".zip": "application/zip", ".png": "image/png",
      ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".txt": "text/plain",
      ".csv": "text/csv", ".json": "application/json", ".md": "text/markdown",
      ".html": "text/html", ".mp4": "video/mp4", ".mp3": "audio/mpeg",
      ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    };
    const { db } = await import("./db");
    const { fileStorage } = await import("@shared/schema");
    const values = {
      originalName,
      mimeType: mimeMap[ext] || "application/octet-stream",
      size: bytes.length,
      data: bytes.toString("base64"),
    };
    // Atomic upsert on the (tenant_id, filename) unique index — a retried
    // delivery or concurrent republish of the same asset can never duplicate.
    await db.insert(fileStorage)
      .values({ filename: publicName, tenantId, ...values })
      .onConflictDoUpdate({
        target: [fileStorage.tenantId, fileStorage.filename],
        // Matches the partial unique index file_storage_delivery_asset_uidx
        // (publicName is always "delivery-<id>-<name>").
        targetWhere: sql`filename LIKE 'delivery-%'`,
        set: values,
      });
    console.log(`[delivery] #${deliveryId} persisted ${publicName} to DB (${bytes.length} bytes) — survives republish.`);
  } catch (err: any) {
    console.error(`[delivery] #${deliveryId} DB persist FAILED for ${publicName} (disk copy intact): ${err.message}`);
  }
}

function publishOneFileToOwnServer(file: { fileName: string; filePath?: string; fileData?: Buffer }, deliveryId: number, tenantId: number): string | null {
  try {
    const cwd = process.cwd();
    const uploadsDir = path.resolve(cwd, "uploads");
    if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
    const safeName = file.fileName.replace(/[^a-zA-Z0-9._-]/g, "_");
    const publicName = `delivery-${deliveryId}-${safeName}`;
    const dest = path.resolve(uploadsDir, publicName);

    if (file.fileData) {
      fs.writeFileSync(dest, file.fileData);
    } else if (file.filePath) {
      let candidate = file.filePath;
      if (candidate.startsWith("/uploads/") || candidate.startsWith("/attached_assets/") || candidate.startsWith("/stress-test-output/")) {
        candidate = candidate.slice(1);
      }
      const src = path.resolve(cwd, candidate);
      if (!src.startsWith(cwd + path.sep) || !fs.existsSync(src)) return null;
      if (src !== dest) fs.copyFileSync(src, dest);
    } else {
      return null;
    }

    // Republish durability (2026-08-14): /uploads is ephemeral on the prod FS
    // (resets on every publish), which used to 404 customer delivery links
    // after a deploy. Persist the published bytes to file_storage so the
    // /uploads route's DB fallback keeps serving them. Fire-and-forget +
    // fail-open (the disk copy above already succeeded), loud on failure.
    void persistDeliveryAssetToDb(publicName, file.fileName, dest, tenantId, deliveryId);

    // R74.13e — sign the URL so the /uploads/ auth gate accepts it without a
    // session cookie. Without this the customer gets {"error":"Authentication
    // required"} on every play/download attempt.
    // NOTE: we request 90 days here, but signUploadUrl() hard-clamps any ttl to
    // MAX_TTL_MS (7 days) as a leak-blast-radius bound — so the EFFECTIVE link
    // life is 7 days, not 90. If durable-delivery links are a product
    // requirement, raise the bound deliberately in upload-signing.ts (a security
    // tradeoff) rather than relying on this larger request value.
    // Uses static ESM import (signUploadUrl) at top of file — earlier require()
    // attempt failed with "require is not defined" in ESM context.
    try {
      const REQUESTED_TTL_MS = 90 * 24 * 60 * 60 * 1000; // clamped to MAX_TTL_MS (7d) by the signer
      // tid is part of the HMAC payload only — delivery assets carry no
      // file_storage owner row, so the /uploads gate authorizes them purely by
      // the signed capability URL (see routes.ts delivery-asset branch), never
      // by this tid. We still thread the real delivery tenant (defaults to the
      // owner/admin tenant 1) for telemetry + forward-correctness.
      const signed = signUploadUrl(publicName, tenantId, REQUESTED_TTL_MS);
      return `${getBaseUrl()}${signed}`;
    } catch (signErr: any) {
      // R98.22+sec — fail-closed. Previously fell back to an unsigned URL,
      // which bypassed the /uploads/ auth gate and could leak the file
      // publicly. Now we surface the failure so delivery retries and the
      // caller can alert; never ship an unauthenticated download URL.
      console.error(`[delivery] #${deliveryId} signing FAILED (${signErr.message}) — refusing to ship unsigned URL`);
      return null;
    }
  } catch (err: any) {
    console.warn(`[delivery] #${deliveryId} publishOneFileToOwnServer failed for ${file.fileName}: ${err.message}`);
    return null;
  }
}

const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 5000;
const LINK_VERIFY_TIMEOUT_MS = 8000;
const DELIVERY_VERIFICATION_TIMEOUT_MS = 15_000;
const ADMIN_ALERT_EMAIL = process.env.ADMIN_ALERT_EMAIL || "";

async function verifyDeliveryArtifact(input: Parameters<typeof verifyDeliverable>[0]) {
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

function escapeHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function sanitizeDisplayField(value: string | undefined | null, max = 120): string {
  const s = String(value ?? "")
    .replace(/[\x00-\x1f\x7f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!s) return "Customer";
  return s.length > max ? s.slice(0, max - 3) + "..." : s;
}

export interface BundleFile {
  filePath?: string;
  fileData?: Buffer;
  fileName: string;
  mimeType?: string;
  /** Short customer-facing label rendered next to the download link in the email. */
  description?: string;
}

export interface DeliveryRequest {
  /**
   * Owning tenant for this delivery. Defaults to the admin tenant (1) when
   * omitted — preserves historical owner-initiated delivery behavior. All
   * read/list/retry paths filter on this so one tenant can never enumerate,
   * read, or re-trigger another tenant's deliveries (which expose customer
   * name/email/download links).
   */
  tenantId?: number;
  customerName: string;
  customerEmail?: string;
  productName: string;
  filePath?: string;
  fileData?: Buffer;
  fileName: string;
  mimeType?: string;
  orderId?: string;
  stripePaymentId?: string;
  /** Stable caller-owned key for non-payment fulfillment retries. */
  idempotencyKey?: string;
  /**
   * A caller-created delivery receipt that this invocation may consume exactly
   * once. CMMC uses this to atomically reserve its receipt with its report
   * lease before external Drive/email work begins.
   */
  reservedDeliveryId?: number;
  sendEmail?: boolean;
  emailSubject?: string;
  emailBody?: string;
  metadata?: Record<string, any>;
  /**
   * Additional files to include in the same delivery (bundle mode). All
   * files land in the same per-customer Drive folder created by the primary
   * upload, are staged in /uploads/, and are listed in the email under a
   * "Bundle includes" section. Use for product bundles like
   * "App + PDF instructions + sample data".
   */
  additionalFiles?: BundleFile[];
  /** Refuse the entire delivery when any required companion file fails upload or link verification. */
  requireAllFiles?: boolean;
  /**
   * Optional upgrade offer rendered at the bottom of the delivery email
   * (e.g. the $497 audit upsells the $1,997 done-for-you package). All
   * fields are escaped before rendering; ctaUrl must be an https URL we
   * control (built server-side, never customer input).
   */
  upsell?: { headline: string; body: string; ctaLabel: string; ctaUrl: string };
  /**
   * Revenue-mission linkage (task #153). When set to a positive integer, the
   * entire delivery runs inside withMissionCostAttribution(missionId, ...) so
   * any instrumented spend incurred during fulfillment delivery (LLM calls,
   * recordCost rows from downstream tooling) lands in agent_cost_ledger with
   * this mission_id and counts against the mission's contribution margin.
   */
  missionId?: number;
}

const DELIVERY_SOURCE_PATH_METADATA_KEY = "_deliverySourcePath";
const DELIVERY_MIME_TYPE_METADATA_KEY = "_deliveryMimeType";
const DELIVERY_BUNDLE_FILES_METADATA_KEY = "_deliveryBundleFiles";

type PersistedBundleFile = {
  fileName: string;
  description?: string;
  driveFileId: string;
  downloadLink?: string;
  shareableLink?: string;
};

function serializeBundleFiles(bundleResults: Array<{ file: BundleFile; uploadResult: any }>): PersistedBundleFile[] {
  return bundleResults.flatMap(({ file, uploadResult }) => {
    if (!uploadResult?.success || typeof uploadResult.fileId !== "string" || !uploadResult.fileId) return [];
    return [{
      fileName: file.fileName.slice(0, 200),
      description: typeof file.description === "string" ? file.description.slice(0, 500) : undefined,
      driveFileId: uploadResult.fileId,
      downloadLink: typeof uploadResult.directDownloadLink === "string" ? uploadResult.directDownloadLink : undefined,
      shareableLink: typeof uploadResult.shareableLink === "string" ? uploadResult.shareableLink : undefined,
    }];
  });
}

export function readPersistedBundleFiles(metadata: unknown): BundleFileResult[] | undefined {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return undefined;
  const rawFiles = (metadata as Record<string, unknown>)[DELIVERY_BUNDLE_FILES_METADATA_KEY];
  if (!Array.isArray(rawFiles)) return undefined;
  const files = rawFiles.flatMap((candidate): BundleFileResult[] => {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return [];
    const file = candidate as Record<string, unknown>;
    if (typeof file.fileName !== "string" || typeof file.driveFileId !== "string" || !file.driveFileId) return [];
    return [{
      fileName: file.fileName,
      description: typeof file.description === "string" ? file.description : undefined,
      success: true,
      driveFileId: file.driveFileId,
      downloadLink: typeof file.downloadLink === "string" ? file.downloadLink : undefined,
      shareableLink: typeof file.shareableLink === "string" ? file.shareableLink : undefined,
    }];
  });
  return files.length > 0 ? files : undefined;
}

function normalizeWorkspaceRelativePath(candidate: unknown): string | null {
  if (typeof candidate !== "string" || !candidate.trim() || path.isAbsolute(candidate)) return null;
  const normalized = path.normalize(candidate.trim());
  if (normalized === "." || normalized === ".." || normalized.startsWith(`..${path.sep}`)) return null;

  const workspaceRoot = path.resolve(process.cwd());
  const resolved = path.resolve(workspaceRoot, normalized);
  if (!resolved.startsWith(`${workspaceRoot}${path.sep}`)) return null;
  return normalized;
}

function metadataWithDeliverySource(req: DeliveryRequest): Record<string, any> | null {
  const metadata = req.metadata ? { ...req.metadata } : {};
  const sourcePath = normalizeWorkspaceRelativePath(req.filePath);
  if (sourcePath) metadata[DELIVERY_SOURCE_PATH_METADATA_KEY] = sourcePath;
  if (typeof req.mimeType === "string" && req.mimeType) metadata[DELIVERY_MIME_TYPE_METADATA_KEY] = req.mimeType;
  return Object.keys(metadata).length > 0 ? metadata : null;
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
async function retryCmmcDeliveryIfApplicable(log: DeliveryLog): Promise<DeliveryResult | null> {
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

export interface BundleFileResult {
  fileName: string;
  description?: string;
  downloadLink?: string;
  shareableLink?: string;
  publicPlayLink?: string;
  driveFileId?: string;
  success: boolean;
  error?: string;
}

export interface DeliveryResult {
  success: boolean;
  deliveryId: number;
  /** Google Drive ID for the primary delivered file. */
  driveFileId?: string;
  downloadLink?: string;
  folderLink?: string;
  shareableLink?: string;
  /** Signed self-hosted streaming URL on /uploads/ — set when the file was
   * also published to our own Express server (always for media kinds). Use
   * this URL for video/audio Play CTAs; it survives Drive's mobile preview
   * transcoder. */
  publicPlayLink?: string;
  emailSent?: boolean;
  linkVerified?: boolean;
  attempts?: number;
  error?: string;
  /** Another worker already owns this delivery; retry after its lease/heartbeat. */
  inProgress?: boolean;
  /** Per-file results when additionalFiles was provided. */
  bundleFiles?: BundleFileResult[];
}

export function deliveryCompletionUncertainResult(params: {
  deliveryId: number;
  attempts: number;
  linkVerified: boolean;
  error: string;
}): DeliveryResult {
  return {
    success: false,
    deliveryId: params.deliveryId,
    emailSent: true,
    linkVerified: params.linkVerified,
    attempts: params.attempts,
    inProgress: true,
    error: params.error,
  };
}

async function createDeliveryLog(req: DeliveryRequest): Promise<number> {
  const [row] = await db.insert(deliveryLogs).values({
    tenantId: req.tenantId ?? 1,
    orderId: req.orderId || null,
    customerName: sanitizeDisplayField(req.customerName, 120),
    customerEmail: req.customerEmail ? sanitizeDisplayField(req.customerEmail, 254) : null,
    productName: sanitizeDisplayField(req.productName, 200),
    fileName: sanitizeDisplayField(req.fileName, 200),
    status: "pending",
    stripePaymentId: req.stripePaymentId || null,
    idempotencyKey: req.idempotencyKey || null,
    metadata: metadataWithDeliverySource(req),
  }).returning({ id: deliveryLogs.id });
  return row.id;
}

async function updateDeliveryLog(id: number, updates: Partial<DeliveryLog>) {
  const [updated] = await db.update(deliveryLogs).set(updates).where(eq(deliveryLogs.id, id))
    .returning({ id: deliveryLogs.id });
  if (!updated) throw new Error(`Delivery log #${id} could not be updated`);
}

async function updateDeliveryLogWithBundleFiles(
  id: number,
  updates: Partial<DeliveryLog>,
  bundleResults: Array<{ file: BundleFile; uploadResult: any }>,
  existingBundleFiles: BundleFileResult[] = [],
): Promise<void> {
  const merged = new Map<string, PersistedBundleFile>(
    existingBundleFiles.flatMap((file) => file.success && file.driveFileId
      ? [[file.fileName, {
        fileName: file.fileName,
        description: file.description,
        driveFileId: file.driveFileId,
        downloadLink: file.downloadLink,
        shareableLink: file.shareableLink,
      }]]
      : []),
  );
  for (const file of serializeBundleFiles(bundleResults)) merged.set(file.fileName, file);
  const metadata = JSON.stringify({ [DELIVERY_BUNDLE_FILES_METADATA_KEY]: [...merged.values()] });
  const [updated] = await db.update(deliveryLogs).set({
    ...updates,
    metadata: sql`COALESCE(metadata, '{}'::jsonb) || ${metadata}::jsonb`,
  }).where(eq(deliveryLogs.id, id)).returning({ id: deliveryLogs.id });
  if (!updated) throw new Error(`Delivery log #${id} bundle receipt could not be recorded`);
}

async function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function sendAdminAlert(deliveryId: number, error: string, req: DeliveryRequest) {
  if (!isEmailConfigured()) {
    console.error(`[delivery] ADMIN ALERT (no email configured): Delivery #${deliveryId} failed after ${MAX_RETRIES} attempts: ${error}`);
    return;
  }

  try {
    const inboxId = await getPrimaryInboxId();
    const { siteConfig } = await import("./site-config");
    const alertTo = ADMIN_ALERT_EMAIL || siteConfig.contactEmail || siteConfig.ownerEmail;
    await sendEmail({
      inboxId,
      to: alertTo,
      subject: `[ALERT] Delivery #${deliveryId} Failed — ${sanitizeDisplayField(req.productName, 80)}`,
      text: [
        `Delivery #${deliveryId} has FAILED after ${MAX_RETRIES} retry attempts.`,
        ``,
        `Customer: ${sanitizeDisplayField(req.customerName, 120)}`,
        `Email: ${req.customerEmail ? sanitizeDisplayField(req.customerEmail, 254) : "N/A"}`,
        `Product: ${sanitizeDisplayField(req.productName, 200)}`,
        `File: ${sanitizeDisplayField(req.fileName, 200)}`,
        `Order ID: ${req.orderId || "N/A"}`,
        `Stripe Payment: ${req.stripePaymentId || "N/A"}`,
        ``,
        `Error: ${String(error).slice(0, 1000)}`,
        ``,
        `Action: Check the delivery logs at /api/deliveries/${deliveryId}`,
        `Retry: POST /api/deliveries/${deliveryId}/retry`,
      ].join("\n"),
    });
    console.log(`[delivery] Admin alert sent for delivery #${deliveryId}`);
  } catch (alertErr: any) {
    console.error(`[delivery] Admin alert email failed: ${alertErr.message}`);
  }
}

function getBaseUrl(): string {
  const domain = process.env.REPLIT_DEV_DOMAIN || process.env.REPLIT_DOMAINS?.split(",")[0] || "localhost:5000";
  const protocol = domain.includes("localhost") ? "http" : "https";
  return `${protocol}://${domain}`;
}

function buildDeliveryEmail(
  req: DeliveryRequest,
  links: { downloadLink: string; viewLink: string; folderLink: string; publicPlayLink?: string | null; orderPageLink?: string | null },
  bundleFiles?: BundleFileResult[],
  deliveryId?: number,
): { subject: string; text: string; html: string } {
  // Subject must be unique-per-delivery so two orders for the same product
  // don't produce indistinguishable emails. Without an order ref, a customer
  // who buys the same bundle twice (or sees a re-delivery) gets two emails
  // with identical subject lines and can't tell which is which. Worse,
  // Gmail/Outlook may thread or even spam-filter the second one as a
  // duplicate. Round 9 / deliveries #70 + #71 surfaced this — both arrived,
  // both said "Your order is ready: VisionClaw Productivity Bundle", and
  // the recipient could not distinguish them.
  const orderRef = req.orderId || (deliveryId ? `#${deliveryId}` : null);
  // safeSubject: strip CR/LF so a user-controlled productName/emailSubject can't inject
  // additional headers (Bcc:, Reply-To:, etc.) into the outgoing message. Cap at 200
  // chars too — anything longer is almost certainly junk and gets folded by MTAs anyway.
  const safeSubject = (s: string) => s.replace(/[\r\n]+/g, " ").slice(0, 200).trim();
  const baseSubject = req.emailSubject
    ? safeSubject(req.emailSubject)
    : `Your order is ready: ${sanitizeDisplayField(req.productName, 150)}`;
  const subject = req.emailSubject
    ? safeSubject(req.emailSubject)
    : orderRef
      ? safeSubject(`${baseSubject} (Order ${orderRef.startsWith('#') ? orderRef : '#' + orderRef})`)
      : baseSubject;
  // Detect content type from mimeType + filename so labels match the actual product
  const mt = (req.mimeType || "").toLowerCase();
  const fn = (req.fileName || "").toLowerCase();
  const isVideo = mt.startsWith("video/") || /\.(mp4|mov|webm|mkv)$/.test(fn);
  const isAudio = mt.startsWith("audio/") || /\.(mp3|wav|m4a|ogg)$/.test(fn);
  const isImage = mt.startsWith("image/") || /\.(png|jpg|jpeg|gif|webp|svg)$/.test(fn);
  const isPdf = mt === "application/pdf" || /\.pdf$/.test(fn);
  // Code projects / local apps: standalone HTML, JS bundles, zips, etc.
  // These are meant to be downloaded and run locally — there's no useful
  // "preview" path (Drive can't render HTML/zip and our /uploads/ static
  // intentionally serves .html as octet-stream for XSS safety).
  const isApp = mt === "text/html"
    || mt === "application/zip"
    || mt === "application/x-zip-compressed"
    || mt === "application/javascript"
    || /\.(html?|zip|js|mjs)$/.test(fn);
  const kind = isVideo ? "Video" : isAudio ? "Audio" : isImage ? "Image" : isPdf ? "PDF" : isApp ? "App" : "File";
  const verbView = isVideo ? "Play" : isAudio ? "Play" : isImage ? "View" : "Open";
  // For videos/audio, Drive's preview can take minutes to transcode and Drive's
  // mobile app intercepts download URLs to show that same broken preview. So
  // for media files, prefer the public link served by our own Express server,
  // which streams the file as video/mp4 (or audio/*) and plays instantly in
  // any browser. Fall back to the direct download URL, then to Drive's view.
  // For HTML/JS apps, the self-hosted play link with ?play=1 lets mobile
  // customers tap-to-open instead of downloading-then-double-clicking
  // (which doesn't work on phones and is what was breaking customers).
  // Drive's mobile preview can't render HTML at all, so don't fall back
  // to viewLink for apps.
  // publicPlayLink is ALREADY a signed capability URL (signUploadUrl → ?exp=…&sig=…).
  // Appending "?play=1" would make a second "?" — the sig value swallows "?play=1"
  // and signature verification 401s for the customer. Separator-aware append.
  const appPlayLink = isApp && links.publicPlayLink
    ? `${links.publicPlayLink}${links.publicPlayLink.includes("?") ? "&" : "?"}play=1`
    : null;
  const playLink = (isVideo || isAudio)
    ? (links.publicPlayLink || links.downloadLink)
    : isApp
      ? (appPlayLink || links.downloadLink)
      : links.viewLink;

  // For media files, also route the "Download" button through our own server
  // (with ?dl=1 to force a real file save) instead of Drive — Drive's mobile
  // app intercepts its own download URLs and shoves them into the broken
  // preview player. This guarantees both buttons in the email actually work
  // on every device. PDFs/images keep Drive's download link as before.
  // Pick the download URL carefully:
  //   - Video/Audio: Drive's mobile app intercepts Drive URLs and shoves
  //     them into its broken preview player on phones. So for media, we
  //     route through our own Express server with ?dl=1 to force a real
  //     attachment download. (Caveat: this depends on the Repl being
  //     awake — once deployed, this URL is permanent. Until then, dev
  //     URL sleep can cause customers to see the Replit splash page if
  //     they click the link long after delivery.)
  //   - App (HTML/zip/JS), PDF, Image: Drive's direct download URL
  //     (uc?export=download&id=...) reliably serves these as a real
  //     attachment on every device with no mobile-app interception. It
  //     also has no sleep dependency. Use it as-is.
  // For HTML/JS apps we ALSO route through our own server with ?dl=1.
  // Drive's `uc?export=download&id=...` URL gets intercepted by the Drive
  // mobile app and shoved into its broken PDF preview ("Cannot display PDF").
  // Our /uploads route forces Content-Disposition: attachment + octet-stream
  // for any .html, so the browser saves the file directly with no preview.
  const downloadHref = (isVideo || isAudio || isApp) && links.publicPlayLink
    ? `${links.publicPlayLink}${links.publicPlayLink.includes("?") ? "&" : "?"}dl=1`
    : links.downloadLink;

  const runLocallyHint = isApp
    ? (appPlayLink
        ? `Tap "Open App in Browser" to use it instantly on your phone or computer — no install, nothing to set up. Or download the file to keep an offline copy.`
        : `Save the file to your device, then double-click it to run locally in your browser. Nothing installs.`)
    : null;

  const validBundle = (bundleFiles || []).filter(b => b.success && b.downloadLink);
  const failedBundle = (bundleFiles || []).filter(b => !b.success);

  // Render-boundary guard: the upsell CTA must be an http(s) URL — anything
  // else (javascript:, data:, a caller bug passing customer text) drops the
  // whole upsell block rather than rendering a bad link.
  const upsell = req.upsell && /^https?:\/\//i.test(req.upsell.ctaUrl) ? req.upsell : undefined;
  const upsellTextLines = upsell ? [
    ``,
    `---`,
    sanitizeDisplayField(upsell.headline, 150),
    sanitizeDisplayField(upsell.body, 600),
    `${sanitizeDisplayField(upsell.ctaLabel, 80)}: ${upsell.ctaUrl}`,
  ] : [];

  const orderPageLines = links.orderPageLink ? [
    ``,
    `Bookmark your order page (re-download anytime): ${links.orderPageLink}`,
  ] : [];

  // Durable-link fallback (2026-08-16): for media the primary Play/Download
  // buttons are self-hosted signed URLs, which die when the dev workspace
  // sleeps, the app is republished before the DB copy is readable, or the
  // 7-day signature expires. The Drive copy is permanent, so media emails
  // always carry it as a labeled backup. We use Drive's VIEW link (never
  // uc?export=download for media — Drive mobile intercepts that into its
  // broken preview player; the view page at least offers a working download).
  const mediaDriveBackupLines = (isVideo || isAudio) && links.viewLink ? [
    ``,
    `Permanent backup on Google Drive (works even if the links above stop): ${links.viewLink}`,
    `(Drive's mobile preview can take 5-30 min to process — use its download option if the preview isn't ready.)`,
  ] : [];

  const bundleTextLines = validBundle.length > 0 ? [
    ``,
    `Bundle includes ${validBundle.length} additional file${validBundle.length === 1 ? "" : "s"}:`,
    ...validBundle.map(b => `  • ${b.description || b.fileName}: ${b.downloadLink}`),
  ] : [];

  // For HTML/JS apps where we have a working play link, lead with "Open in
  // Browser" because it's the only path that works on mobile. Download is
  // still offered as a secondary "keep offline" option.
  const appPrimaryLines = isApp && appPlayLink
    ? [
        `Open App in Browser (works on phone too): ${appPlayLink}`,
        `Download to Keep Offline: ${downloadHref}`,
      ]
    : [
        `Download ${kind}: ${downloadHref}`,
        ...(isApp ? [``, `How to use: ${runLocallyHint}`] : [`${verbView} ${kind} in Your Browser: ${playLink}`]),
      ];

  const safeCustomerName = sanitizeDisplayField(req.customerName, 120);
  const safeProductName = sanitizeDisplayField(req.productName, 200);
  const text = req.emailBody || [
    `Hi ${safeCustomerName},`,
    ``,
    `Your digital product "${safeProductName}" is ready! Please use the link below for immediate access:`,
    ``,
    ...appPrimaryLines,
    ...mediaDriveBackupLines,
    ...bundleTextLines,
    `All Files (Delivery Folder): ${links.folderLink}`,
    ...orderPageLines,
    ...upsellTextLines,
    ``,
    `No login required — all links are publicly accessible.`,
    ``,
    `Thank you for your purchase!`,
    `— VisionClaw Digital Delivery`,
  ].join("\n");

  const secondaryButtonHtml = isApp && appPlayLink
    ? `<div style="text-align: center; margin: 16px 0;">
        <a href="${downloadHref}" style="display: inline-block; background: #fff; color: #2563eb; text-decoration: none; padding: 12px 28px; border-radius: 8px; font-weight: 600; font-size: 14px; border: 1px solid #2563eb;">⬇️ Download to Keep Offline</a>
      </div>
      <p style="text-align: center; margin: 12px 0 0; color: #555; font-size: 13px; line-height: 1.5;">📱 The "Open" button works instantly on phones — no install, nothing to set up. The download is just for keeping an offline copy.</p>`
    : isApp
      ? `<p style="text-align: center; margin: 16px 0 0; color: #555; font-size: 13px; line-height: 1.5;">📦 Download once, run anywhere — opens in any browser, fully offline. Nothing installs.</p>`
      : `<div style="text-align: center; margin: 16px 0;">
        <a href="${playLink}" style="display: inline-block; background: #059669; color: #fff; text-decoration: none; padding: 12px 28px; border-radius: 8px; font-weight: 600; font-size: 14px;">${isVideo || isAudio ? "▶️" : "👁️"} ${verbView} ${kind} in Browser</a>
      </div>`;

  const bundleHtml = validBundle.length > 0 ? `
    <div style="background: #fff; border: 1px solid #e5e7eb; padding: 20px 24px; border-radius: 8px; margin-bottom: 24px;">
      <p style="margin: 0 0 12px; font-size: 14px; color: #111827; font-weight: 600;">📦 Bundle includes ${validBundle.length} additional file${validBundle.length === 1 ? "" : "s"}:</p>
      <ul style="margin: 0; padding: 0; list-style: none;">
        ${validBundle.map(b => `
          <li style="padding: 10px 0; border-top: 1px solid #f3f4f6;">
            <a href="${b.downloadLink}" style="color: #2563eb; text-decoration: none; font-weight: 500; font-size: 14px;">⬇️ ${escapeHtml(b.description || b.fileName)}</a>
            ${b.description && b.description !== b.fileName ? `<div style="color: #6b7280; font-size: 12px; margin-top: 2px;">${escapeHtml(b.fileName)}</div>` : ""}
          </li>`).join("")}
      </ul>
      ${failedBundle.length > 0 ? `<p style="margin: 12px 0 0; color: #b45309; font-size: 12px;">Note: ${failedBundle.length} bundle file${failedBundle.length === 1 ? "" : "s"} could not be uploaded. Reply to this email and we'll resend.</p>` : ""}
    </div>` : "";

  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px;">
      <div style="background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%); padding: 32px; border-radius: 12px; color: #fff; text-align: center; margin-bottom: 24px;">
        <h1 style="margin: 0 0 8px; font-size: 24px;">🦞 VisionClaw</h1>
        <p style="margin: 0; opacity: 0.8; font-size: 14px;">Your digital ${kind.toLowerCase()} is ready</p>
      </div>
      <div style="background: #f8f9fa; padding: 24px; border-radius: 8px; margin-bottom: 24px;">
        <p style="margin: 0 0 12px;">Hi <strong>${escapeHtml(req.customerName)}</strong>,</p>
        <p style="margin: 0 0 20px;">Your digital product <strong>"${escapeHtml(req.productName)}"</strong> is ready!${isApp && appPlayLink ? " Tap the button below to open it instantly — works on phone or computer, no install needed." : isApp ? " Click below to download — then double-click the file to run it locally in your browser." : " Use the links below for immediate access:"}</p>
        <div style="text-align: center; margin: 24px 0;">
          ${isApp && appPlayLink
            ? `<a href="${appPlayLink}" style="display: inline-block; background: #2563eb; color: #fff; text-decoration: none; padding: 14px 32px; border-radius: 8px; font-weight: 600; font-size: 16px; margin-bottom: 12px;">▶️ Open App in Browser</a>`
            : `<a href="${downloadHref}" style="display: inline-block; background: #2563eb; color: #fff; text-decoration: none; padding: 14px 32px; border-radius: 8px; font-weight: 600; font-size: 16px; margin-bottom: 12px;">⬇️ Download ${kind}</a>`}
        </div>
        ${secondaryButtonHtml}
        ${(isVideo || isAudio) && links.viewLink ? `
        <div style="text-align: center; margin: 16px 0 0;">
          <a href="${links.viewLink}" style="color: #2563eb; font-size: 13px;">Permanent backup on Google Drive (works even if the buttons above stop)</a>
          <p style="margin: 6px 0 0; color: #9ca3af; font-size: 11px;">Drive's mobile preview can take 5-30 min to process — use its download option if the preview isn't ready.</p>
        </div>` : ""}
        <div style="text-align: center; margin: 16px 0 0;">
          <a href="${links.folderLink}" style="color: #2563eb; font-size: 14px; font-weight: 500;">📁 View All Files in Delivery Folder</a>
        </div>
      </div>
      ${bundleHtml}
      ${upsell ? `
      <div style="background: #fefce8; border: 1px solid #fde047; padding: 20px 24px; border-radius: 8px; margin-bottom: 24px; text-align: center;">
        <p style="margin: 0 0 8px; font-size: 15px; color: #713f12; font-weight: 700;">${escapeHtml(upsell.headline)}</p>
        <p style="margin: 0 0 14px; font-size: 13px; color: #854d0e; line-height: 1.5;">${escapeHtml(upsell.body)}</p>
        <a href="${escapeHtml(upsell.ctaUrl)}" style="display: inline-block; background: #ca8a04; color: #fff; text-decoration: none; padding: 12px 26px; border-radius: 8px; font-weight: 600; font-size: 14px;">${escapeHtml(upsell.ctaLabel)}</a>
      </div>` : ""}
      ${links.orderPageLink ? `
      <div style="background: #eff6ff; border: 1px solid #bfdbfe; padding: 18px 22px; border-radius: 8px; margin-bottom: 24px; text-align: center;">
        <p style="margin: 0 0 10px; font-size: 14px; color: #1e3a8a; font-weight: 600;">🔖 Bookmark your order page</p>
        <p style="margin: 0 0 12px; font-size: 13px; color: #1e40af;">Save this link to re-download your files anytime — no need to find this email again.</p>
        <a href="${links.orderPageLink}" style="display: inline-block; background: #1d4ed8; color: #fff; text-decoration: none; padding: 10px 22px; border-radius: 6px; font-weight: 600; font-size: 13px;">Open My Order Page</a>
        <p style="margin: 10px 0 0; font-size: 11px; color: #1e40af; word-break: break-all;">${escapeHtml(links.orderPageLink)}</p>
      </div>` : ""}
      <p style="font-size: 12px; color: #999; text-align: center; margin: 0;">
        No login required — all links are publicly accessible.<br/>
        © ${new Date().getFullYear()} VisionClaw — Agentic AI Corporation
      </p>
    </div>
  `;

  return { subject, text, html };
}

// TEST-ONLY failure injection. Set env VC_DRIVE_FAIL_ATTEMPTS=N to force the
// first N upload attempts of EACH delivery to fail with a synthetic error.
// Used by scripts/round12-drive-failure-recovery.ts to validate the retry
// path. Has zero effect when the env var is unset.
//
// Per-delivery counters (Map keyed by deliveryId) so concurrent deliveries
// don't share/race a single counter. Map entries auto-evict after the
// delivery completes (cleared on the attempt that returns no-fail).
const __testFailRemaining: Map<number, number> = new Map();
function __consumeTestFailure(deliveryId: number): { fail: boolean; error?: string } {
  const cfg = process.env.VC_DRIVE_FAIL_ATTEMPTS || "";
  if (!cfg) {
    __testFailRemaining.delete(deliveryId);
    return { fail: false };
  }
  const parsed = parseInt(cfg, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    __testFailRemaining.delete(deliveryId);
    return { fail: false };
  }
  // Initialize per-delivery on first call; subsequent calls decrement.
  let remaining = __testFailRemaining.has(deliveryId)
    ? __testFailRemaining.get(deliveryId)!
    : parsed;
  if (remaining > 0) {
    remaining--;
    __testFailRemaining.set(deliveryId, remaining);
    return { fail: true, error: `[TEST INJECTION] Forced Drive failure (delivery #${deliveryId}, ${remaining} forced failures remaining)` };
  }
  __testFailRemaining.delete(deliveryId);
  return { fail: false };
}

/**
 * R110 +sec — Pre-delivery secret scan. Walks the primary file + every bundle
 * file through the 48-pattern catalog (server/lib/secret-scan.ts) BEFORE any
 * bytes leave for Drive. CRITICAL or HIGH hits abort the upload fail-CLOSED;
 * MEDIUM/LOW are logged + annotated on the delivery row but do not block
 * (env-driven `redactSecrets` already runs in the chat layer for those tiers).
 *
 * Skips: non-text extensions (mp4 / mp3 / png / pdf binary blob etc.) — those
 * are caller-side; the chat-ingress validator handles ingest-side PDFs via
 * extractTextFromFile + scanForSecrets. The point of THIS gate is the common
 * Felix failure: a hardcoded sk-ant key inside a .ts script attached to a
 * Drive delivery folder.
 */
async function scanDeliverablesForSecrets(req: DeliveryRequest, deliveryId: number): Promise<{
  blocked: boolean;
  worstSeverity: ScanReport["worstSeverity"];
  reports: Array<{ fileName: string; report: ScanReport }>;
}> {
  const reports: Array<{ fileName: string; report: ScanReport }> = [];
  const all: Array<{ fileName: string; filePath?: string; fileData?: Buffer }> = [
    { fileName: req.fileName, filePath: req.filePath, fileData: req.fileData },
    ...(req.additionalFiles || []).map((f) => ({ fileName: f.fileName, filePath: f.filePath, fileData: f.fileData })),
  ];
  let worst: ScanReport["worstSeverity"] = null;
  for (const f of all) {
    try {
      let report: ScanReport | null = null;
      if (f.filePath && isLikelyTextPath(f.filePath)) {
        let resolved = f.filePath;
        if (resolved.startsWith("/uploads/") || resolved.startsWith("/attached_assets/") || resolved.startsWith("/stress-test-output/")) {
          resolved = resolved.slice(1);
        }
        const abs = path.resolve(process.cwd(), resolved);
        if (fs.existsSync(abs)) report = await scanFileForSecrets(abs, { source: f.fileName });
      } else if (f.fileData && isLikelyTextPath(f.fileName)) {
        report = scanForSecrets(f.fileData.toString("utf8"), { source: f.fileName });
      }
      if (!report) continue;
      reports.push({ fileName: f.fileName, report });
      if (report.hits.length > 0) {
        const sevRank = { low: 1, medium: 2, high: 3, critical: 4 } as const;
        if (!worst || sevRank[report.worstSeverity!] > sevRank[worst]) worst = report.worstSeverity;
        const tag = report.shouldBlock ? "[secret-scan] BLOCK" : "[secret-scan] FLAG";
        console.warn(`${tag} delivery #${deliveryId} ${f.fileName}: ${summarizeReport(report)}`);
      }
    } catch (err: any) {
      // R110 +sec gold-pass-3 — FAIL-CLOSED. Scanner-throw used to log a
      // warning and continue (effectively skipping the gate). An attacker
      // who can shape a deliverable to throw during scan would have
      // bypassed the pre-delivery secret gate entirely. Synthesize a
      // blocking report so attemptUpload aborts with a "scanner
      // unavailable" message and operator alert, exactly like a real hit.
      const synthMsg = `scanner unavailable: ${String(err?.message || err).slice(0, 200)}`;
      console.warn(`[secret-scan] FAIL-CLOSED delivery #${deliveryId} ${f.fileName}: ${synthMsg}`);
      reports.push({
        fileName: f.fileName,
        report: {
          source: f.fileName,
          hits: [{
            pattern: "SCANNER_UNAVAILABLE",
            severity: "high",
            category: "scanner_infra",
            line: 0,
            col: 0,
            redacted: synthMsg,
          }] as any,
          hitsBySeverity: { critical: 0, high: 1, medium: 0, low: 0 },
          worstSeverity: "high",
          shouldBlock: true,
        } as any,
      });
      worst = (!worst || worst === "low" || worst === "medium") ? "high" : worst;
    }
  }
  const blocked = reports.some((r) => r.report.shouldBlock);
  return { blocked, worstSeverity: worst, reports };
}

async function attemptUpload(req: DeliveryRequest, deliveryId: number): Promise<{
  success: boolean;
  uploadResult?: any;
  linkVerified?: boolean;
  bundleResults?: Array<{ file: BundleFile; uploadResult: any }>;
  error?: string;
}> {
  const inject = __consumeTestFailure(deliveryId);
  if (inject.fail) {
    return { success: false, error: inject.error };
  }

  // Hard delivery-integrity gate. Quality tooling remains useful for an agent
  // while it works, but it is not optional at the irreversible upload/email
  // boundary. Every artifact must pass a known contract and leave an audit row.
  const artifacts: Array<{ fileName: string; filePath?: string; fileData?: Buffer }> = [
    { fileName: req.fileName, filePath: req.filePath, fileData: req.fileData },
    ...(req.additionalFiles || []).map((file) => ({
      fileName: file.fileName,
      filePath: file.filePath,
      fileData: file.fileData,
    })),
  ];
  for (const artifact of artifacts) {
    const deliverableType = resolveDeliveryContractType(artifact.fileName);
    if (!deliverableType) {
      return { success: false, error: `Delivery verification blocked uncontracted artifact: ${artifact.fileName}` };
    }
    try {
      const verification = await verifyDeliveryArtifact({
        tenantId: req.tenantId ?? 1,
        deliverableType,
        filePath: artifact.filePath,
        fileName: artifact.fileName,
        buffer: artifact.fileData,
      });
      if (verification.status !== "passed" || !verification.passed || verification.auditPersisted !== true) {
        return {
          success: false,
          error: `Delivery verification failed for ${artifact.fileName}: ${verification.failures.join("; ") || verification.status}`,
        };
      }
    } catch (err: any) {
      return { success: false, error: `Delivery verification unavailable for ${artifact.fileName}: ${err?.message || String(err)}` };
    }
  }

  // R110 +sec — Fail-CLOSED secret-pattern scan BEFORE Drive upload.
  const secretScan = await scanDeliverablesForSecrets(req, deliveryId);
  if (secretScan.blocked) {
    const offenders = secretScan.reports
      .filter((r) => r.report.shouldBlock)
      .map((r) => `${r.fileName}: ${summarizeReport(r.report)}`)
      .join(" | ");
    const errMsg = `Pre-delivery secret scan BLOCKED upload (${secretScan.worstSeverity}) — ${offenders}`;
    console.error(`[delivery] #${deliveryId} ${errMsg}`);
    try {
      await sendAdminAlert(deliveryId, errMsg, req);
    } catch (alertErr: any) {
      console.warn(`[delivery] #${deliveryId} secret-scan alert send failed: ${alertErr.message}`);
    }
    return { success: false, error: errMsg };
  }

  const [priorDelivery] = await db.select({
    driveFileId: deliveryLogs.driveFileId,
    driveFolderId: deliveryLogs.driveFolderId,
    folderLink: deliveryLogs.folderLink,
    downloadLink: deliveryLogs.downloadLink,
    shareableLink: deliveryLogs.shareableLink,
    metadata: deliveryLogs.metadata,
  }).from(deliveryLogs).where(and(
    eq(deliveryLogs.id, deliveryId),
    eq(deliveryLogs.tenantId, req.tenantId ?? 1),
  )).limit(1);
  const priorBundles = new Map(
    (readPersistedBundleFiles(priorDelivery?.metadata || null) || []).map((file) => [file.fileName, file]),
  );
  const uploadResult = priorDelivery?.driveFileId && priorDelivery.driveFolderId
    ? {
      success: true,
      fileId: priorDelivery.driveFileId,
      customerFolderId: priorDelivery.driveFolderId,
      customerFolderLink: priorDelivery.folderLink || undefined,
      directDownloadLink: priorDelivery.downloadLink || undefined,
      shareableLink: priorDelivery.shareableLink || undefined,
    }
    : await uploadToDrive({
      filePath: req.filePath,
      fileData: req.fileData,
      fileName: req.fileName,
      mimeType: req.mimeType || "application/pdf",
      customerName: req.customerName,
      share: true,
      customerDelivery: true,
    });

  if (!uploadResult.success) return { success: false, error: uploadResult.error };

  // Checkpoint the primary Drive side effect before attempting companions.
  // If the worker dies mid-bundle, a retry resumes this exact folder/file
  // instead of creating another customer delivery folder.
  await updateDeliveryLog(deliveryId, {
    status: "verifying",
    driveFileId: uploadResult.fileId || null,
    driveFolderId: uploadResult.customerFolderId || null,
    folderLink: uploadResult.customerFolderLink || null,
    downloadLink: uploadResult.directDownloadLink || null,
    shareableLink: uploadResult.shareableLink || null,
  });

  // Bundle mode: upload each additional file into the SAME per-customer
  // folder created by the primary upload above. Failures here do not abort
  // the primary delivery — the customer still gets the main product, and
  // any failed bundle items are flagged in the email.
  const bundleResults: Array<{ file: BundleFile; uploadResult: any }> = [];
  if (req.additionalFiles && req.additionalFiles.length > 0 && uploadResult.customerFolderId) {
    for (const f of req.additionalFiles) {
      const prior = priorBundles.get(f.fileName);
      const r = prior
        ? {
          success: true,
          fileId: prior.driveFileId,
          directDownloadLink: prior.downloadLink,
          shareableLink: prior.shareableLink,
        }
        : await uploadToDrive({
          filePath: f.filePath,
          fileData: f.fileData,
          fileName: f.fileName,
          mimeType: f.mimeType || "application/octet-stream",
          parentFolderId: uploadResult.customerFolderId,
          skipSubfolder: true,
          share: true,
          customerDelivery: true,
        });
      bundleResults.push({ file: f, uploadResult: r });
      if (r.success) {
        // Each companion is an external side effect. Persist it before the
        // next upload so any interruption resumes from this exact checkpoint.
        await updateDeliveryLogWithBundleFiles(deliveryId, {}, bundleResults, [...priorBundles.values()]);
      }
      if (!r.success) {
        console.warn(`[delivery] #${deliveryId} Bundle file failed: ${f.fileName} — ${r.error}`);
      }
    }
  }

  await updateDeliveryLogWithBundleFiles(deliveryId, { status: "verifying" }, bundleResults, [...priorBundles.values()]);

  // Prove the exact file-level permission that customer links require through
  // Drive's authenticated API. Anonymous HEAD probes against Google download
  // URLs are redirect-sensitive and caused false failures after successful
  // uploads, leading to needless duplicate folders and 60-second waits.
  const uploadedFiles = [
    { label: req.fileName, fileId: uploadResult.fileId },
    ...bundleResults
      .filter(({ uploadResult: bundle }) => bundle?.success)
      .map(({ file, uploadResult: bundle }) => ({ label: file.fileName, fileId: bundle.fileId })),
  ];
  let linkVerified = uploadedFiles.length > 0;
  let linkVerificationError: string | undefined;
  for (const uploaded of uploadedFiles) {
    const access = await verifyDriveFilePublicAccess(uploaded.fileId || "");
    if (!access.verified) {
      linkVerified = false;
      linkVerificationError = `${uploaded.label}: ${access.reason}`;
      break;
    }
  }

  const missingRequiredBundle = Boolean(req.requireAllFiles && (
    !req.additionalFiles?.length ||
    bundleResults.length !== req.additionalFiles.length ||
    bundleResults.some(({ uploadResult: bundle }) => !bundle?.success)
  ));
  if (missingRequiredBundle) {
    return { success: false, error: "A required companion file could not be uploaded", uploadResult, linkVerified, bundleResults };
  }
  return { success: true, uploadResult, linkVerified, bundleResults, error: linkVerificationError };
}

export async function deliverDigitalProduct(req: DeliveryRequest): Promise<DeliveryResult> {
  // Task #153 — mission cost attribution chokepoint. If the caller knows the
  // revenue mission this delivery fulfills, run the whole pipeline inside the
  // mission-cost ALS scope so every recordCost fired downstream is stamped
  // with mission_id. Invalid/absent missionId falls through unattributed
  // (withMissionCostAttribution itself also tolerates invalid ids, but we
  // avoid the import entirely on the common unattributed path).
  if (typeof req.missionId === "number" && Number.isInteger(req.missionId) && req.missionId > 0) {
    const { withMissionCostAttribution } = await import("./agentic/cost-ledger");
    return withMissionCostAttribution(req.missionId, () => deliverDigitalProductInner(req));
  }
  return deliverDigitalProductInner(req);
}

async function deliverDigitalProductInner(req: DeliveryRequest): Promise<DeliveryResult> {
  let deliveryId: number | null = null;
  if (req.reservedDeliveryId != null) {
    const tenantId = req.tenantId ?? 1;
    const [reserved] = await db.update(deliveryLogs).set({
      status: "pending",
      metadata: metadataWithDeliverySource(req),
    }).where(and(
      eq(deliveryLogs.id, req.reservedDeliveryId),
      eq(deliveryLogs.tenantId, tenantId),
      eq(deliveryLogs.status, "reserved"),
      ...(req.idempotencyKey ? [eq(deliveryLogs.idempotencyKey, req.idempotencyKey)] : []),
    )).returning({ id: deliveryLogs.id });
    if (!reserved) {
      const [current] = await db.select().from(deliveryLogs).where(and(
        eq(deliveryLogs.id, req.reservedDeliveryId),
        eq(deliveryLogs.tenantId, tenantId),
      )).limit(1);
      if (current?.status === "completed") {
        return {
          success: true,
          deliveryId: current.id,
          driveFileId: current.driveFileId || undefined,
          downloadLink: current.downloadLink || undefined,
          folderLink: current.folderLink || undefined,
          shareableLink: current.shareableLink || undefined,
          emailSent: current.emailSent || false,
          linkVerified: true,
          attempts: 0,
          bundleFiles: readPersistedBundleFiles(current.metadata),
        };
      }
      return {
        success: false,
        deliveryId: req.reservedDeliveryId,
        inProgress: true,
        error: "The reserved delivery receipt is already owned by another worker",
      };
    }
    deliveryId = reserved.id;
  }
  if (!deliveryId && req.idempotencyKey) {
    const tenantId = req.tenantId ?? 1;
    const [prior] = await db.select().from(deliveryLogs).where(and(
      eq(deliveryLogs.tenantId, tenantId),
      eq(deliveryLogs.idempotencyKey, req.idempotencyKey),
    )).orderBy(deliveryLogs.id).limit(1);
    if (prior?.status === "completed" && (!req.sendEmail || prior.emailSent)) {
      return {
        success: true,
        deliveryId: prior.id,
        driveFileId: prior.driveFileId || undefined,
        downloadLink: prior.downloadLink || undefined,
        folderLink: prior.folderLink || undefined,
        shareableLink: prior.shareableLink || undefined,
        emailSent: prior.emailSent || false,
        linkVerified: true,
        attempts: 0,
        bundleFiles: readPersistedBundleFiles(prior.metadata),
      };
    }
    if (prior) {
      if (prior.status !== "failed") {
        return {
          success: false,
          deliveryId: prior.id,
          error: "A delivery with this idempotency key is already in progress",
          inProgress: true,
        };
      }
      const [released] = await db.update(deliveryLogs).set({ idempotencyKey: null }).where(and(
        eq(deliveryLogs.id, prior.id),
        eq(deliveryLogs.tenantId, tenantId),
        eq(deliveryLogs.status, "failed"),
        eq(deliveryLogs.idempotencyKey, req.idempotencyKey),
      )).returning({ id: deliveryLogs.id });
      if (!released) {
        return {
          success: false,
          deliveryId: prior.id,
          error: "A delivery retry with this idempotency key is already in progress",
          inProgress: true,
        };
      }
    }
  }
  // Round 27 — idempotency guard. If we've already completed delivery for
  // this stripe payment, return the prior success instead of charging the
  // customer twice in product (Drive uploads + email). Stripe webhook can
  // legitimately fire the same payment_intent.succeeded multiple times on
  // retry, and our prior code happily made a fresh delivery each time.
  if (req.stripePaymentId) {
    // Tenant-isolation fix (2026-07-25): stripePaymentId can arrive as an LLM
    // tool arg, so the idempotency lookup (and the release UPDATE below) must
    // be tenant-scoped — otherwise supplying another tenant's payment id
    // returns that tenant's delivery links or NULLs their delivery row.
    const reqTenantId = req.tenantId ?? 1;
    const [prior] = await db
      .select()
      .from(deliveryLogs)
      .where(and(eq(deliveryLogs.stripePaymentId, req.stripePaymentId), eq(deliveryLogs.tenantId, reqTenantId)))
      .orderBy(deliveryLogs.id)
      .limit(1);
    if (prior && prior.status === "completed") {
      console.log(`[delivery] IDEMPOTENT-HIT stripe=${req.stripePaymentId} → existing delivery #${prior.id} already completed; returning prior result`);
      return {
        success: true,
        deliveryId: prior.id,
        downloadLink: prior.downloadLink || undefined,
        folderLink: prior.folderLink || undefined,
        shareableLink: prior.shareableLink || undefined,
        emailSent: prior.emailSent || false,
        linkVerified: true,
        attempts: 0,
      };
    }
    if (prior && prior.status !== "failed") {
      console.log(`[delivery] IDEMPOTENT-WAIT stripe=${req.stripePaymentId} → in-flight delivery #${prior.id} (status=${prior.status}); returning provisional result without restarting`);
      return {
        success: false,
        deliveryId: prior.id,
        emailSent: prior.emailSent || false,
        inProgress: true,
        error: "A Stripe-backed delivery is already in progress",
        attempts: 0,
      };
    }
    // prior.status === 'failed' (or null) → fall through and create a fresh
    // attempt. The unique index lets us replace a failed prior with NULL'ing
    // its stripe_payment_id transactionally before insert.
    if (prior) {
      console.log(`[delivery] RETRY-AFTER-FAILURE stripe=${req.stripePaymentId} → prior delivery #${prior.id} was ${prior.status}; releasing payment_id for fresh attempt`);
      const releaseMeta = JSON.stringify({
        round27_payment_id_released_at: new Date().toISOString(),
        round27_payment_id_released_for: req.stripePaymentId,
      });
      await db.update(deliveryLogs)
        .set({
          stripePaymentId: null,
          metadata: sql`COALESCE(metadata, '{}'::jsonb) || ${releaseMeta}::jsonb`,
        })
        .where(and(eq(deliveryLogs.id, prior.id), eq(deliveryLogs.tenantId, reqTenantId)));
    }
  }

  if (!deliveryId) deliveryId = await createDeliveryLog(req);
  // PII-safe logging: redact customer identifiers before they hit stdout. The full
  // customerName/customerEmail still lives in delivery_logs (auth-gated) for audit.
  const redactName = (n: string | undefined | null) => {
    if (!n) return "<no-name>";
    const clean = String(n).trim();
    if (!clean) return "<no-name>";
    const parts = clean.split(/\s+/);
    return parts.length > 1 ? `${parts[0][0]}. ${parts[parts.length - 1][0]}.` : `${parts[0][0]}.`;
  };
  const redactEmail = (e: string | undefined | null) => {
    if (!e) return "<no-email>";
    const m = String(e).match(/^([^@]+)@(.+)$/);
    if (!m) return "<invalid>";
    const local = m[1];
    const masked = local.length <= 2 ? local[0] + "*" : local[0] + "***" + local.slice(-1);
    return `${masked}@${m[2]}`;
  };
  console.log(`[delivery] #${deliveryId} Started: "${sanitizeDisplayField(req.productName, 80)}" for ${redactName(req.customerName)}`);

  let lastError = "";
  let attempts = 0;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    attempts = attempt;
    try {
      await updateDeliveryLog(deliveryId, { status: attempt > 1 ? `retry_${attempt}` : "uploading" });

      if (attempt > 1) {
        console.log(`[delivery] #${deliveryId} Retry attempt ${attempt}/${MAX_RETRIES} (waiting ${RETRY_DELAY_MS}ms)...`);
        await sleep(RETRY_DELAY_MS);
      }

      const result = await attemptUpload(req, deliveryId);

      if (!result.success) {
        lastError = `Drive upload failed: ${result.error}`;
        console.error(`[delivery] #${deliveryId} Attempt ${attempt} FAILED: ${lastError}`);
        continue;
      }

      const uploadResult = result.uploadResult;
      console.log(`[delivery] #${deliveryId} Uploaded to Drive (attempt ${attempt}). File: ${uploadResult.fileId}, linkVerified: ${result.linkVerified}`);

      if (!result.linkVerified) {
        lastError = `Drive permission verification failed; refusing to email an inaccessible artifact${result.error ? ` (${result.error})` : ""}`;
        console.error(`[delivery] #${deliveryId} ${lastError}`);
        break;
      }

      // Stage bundle files in /uploads/ for retry/diagnostics, BEFORE email
      // so the bundleResults are available even if the customer doesn't get
      // an email (e.g. owner-only delivery).
      const bundleResults: BundleFileResult[] = (result.bundleResults || []).map(({ file, uploadResult: r }) => {
        if (!r.success) {
          return { fileName: file.fileName, description: file.description, success: false, error: r.error };
        }
        publishOneFileToOwnServer({ fileName: file.fileName, filePath: file.filePath, fileData: file.fileData }, deliveryId, req.tenantId ?? 1);
        return {
          fileName: file.fileName,
          description: file.description,
          success: true,
          driveFileId: r.fileId,
          downloadLink: r.directDownloadLink,
          shareableLink: r.shareableLink,
        };
      });

      // Always publish a copy of the deliverable on our own server so videos/
      // audio/apps play instantly without Drive's mobile preview transcoder.
      // Hoisted out of the email block so the streaming URL is available even
      // when sendEmail=false (programmatic callers like build-bwb-video.ts
      // print and act on it directly).
      const publicPlayLink = publishToOwnServer(req, deliveryId);
      if (publicPlayLink) {
        console.log(`[delivery] #${deliveryId} Self-hosted play link: ${publicPlayLink}`);
      }

      let emailSent = false;
      if (req.sendEmail !== false && req.customerEmail && !isEmailConfigured()) {
        const message = "Customer email transport is unavailable. Do not retry automatically until email configuration is restored.";
        console.error(`[delivery] #${deliveryId} ${message}`);
        void sendAdminAlert(deliveryId, message, req).catch(() => {});
        return deliveryCompletionUncertainResult({
          deliveryId,
          attempts: attempt,
          linkVerified: result.linkVerified,
          error: message,
        });
      }
      if (req.sendEmail !== false && req.customerEmail && isEmailConfigured()) {
        try {
          await updateDeliveryLog(deliveryId, { status: "emailing" });
          const deliveryInboxId = await getPrimaryInboxId();
          const viewLink = uploadResult.shareableLink || (uploadResult.fileId ? `https://drive.google.com/file/d/${uploadResult.fileId}/view?usp=sharing` : "");

          const orderPageLink = req.orderId ? `${getBaseUrl()}/orders/${encodeURIComponent(req.orderId)}` : null;

          const emailContent = buildDeliveryEmail(req, {
            downloadLink: uploadResult.directDownloadLink || "",
            viewLink,
            folderLink: uploadResult.customerFolderLink || "",
            publicPlayLink,
            orderPageLink,
          }, bundleResults, deliveryId);

          const emailResult = await sendEmail({
            inboxId: deliveryInboxId,
            to: req.customerEmail,
            subject: emailContent.subject,
            text: emailContent.text,
            html: emailContent.html,
          });

          emailSent = true;
          try {
            await updateDeliveryLog(deliveryId, {
              emailSent: true,
              emailMessageId: (emailResult as any)?.id || (emailResult as any)?.messageId || null,
            });
          } catch (persistenceError: any) {
            const message = "Customer email may have been sent, but its delivery receipt could not be recorded safely. Do not retry automatically.";
            console.error(`[delivery] #${deliveryId} ${message} ${persistenceError?.message || ""}`);
            void sendAdminAlert(deliveryId, `${message} ${persistenceError?.message || ""}`, req).catch(() => {});
            return deliveryCompletionUncertainResult({
              deliveryId,
              attempts: attempt,
              linkVerified: result.linkVerified,
              error: message,
            });
          }
          console.log(`[delivery] #${deliveryId} Email sent to ${redactEmail(req.customerEmail)}`);
        } catch (emailErr: any) {
          const message = "Customer email dispatch outcome is uncertain. Do not retry automatically.";
          console.error(`[delivery] #${deliveryId} ${message} ${emailErr.message}`);
          void sendAdminAlert(deliveryId, `${message} ${emailErr.message}`, req).catch(() => {});
          return deliveryCompletionUncertainResult({
            deliveryId,
            attempts: attempt,
            linkVerified: result.linkVerified,
            error: message,
          });
        }
      }

      try {
        await updateDeliveryLog(deliveryId, {
          status: "completed",
          completedAt: new Date(),
        });
      } catch (persistenceError: any) {
        const message = "Customer email may have been sent, but final delivery completion could not be recorded safely. Do not retry automatically.";
        console.error(`[delivery] #${deliveryId} ${message} ${persistenceError?.message || ""}`);
        void sendAdminAlert(deliveryId, `${message} ${persistenceError?.message || ""}`, req).catch(() => {});
        return deliveryCompletionUncertainResult({
          deliveryId,
          attempts: attempt,
          linkVerified: result.linkVerified,
          error: message,
        });
      }

      console.log(`[delivery] #${deliveryId} COMPLETED: "${sanitizeDisplayField(req.productName, 80)}" → ${redactName(req.customerName)} (email: ${emailSent}, verified: ${result.linkVerified}, attempts: ${attempt})`);

      // Attention Bus v0: publish completion event (low salience by default).
      try {
        const { emitEvent } = await import("./event-bus");
        await emitEvent({
          type: "delivery.completed",
          source: "delivery-pipeline",
          tenantId: req.tenantId ?? 1,
          data: {
            // PII-safe: deliveryId is the FK into delivery_logs (auth-gated) for any
            // handler that needs the raw customer details. The event_log itself is
            // visible to background handlers + future audit exports — keep PII out.
            deliveryId,
            productName: sanitizeDisplayField(req.productName, 80),
            customerNameRedacted: redactName(req.customerName),
            customerEmailRedacted: redactEmail(req.customerEmail),
            emailSent,
            attempts: attempt,
            priceUsd: typeof (req as any).priceUsd === "number" ? (req as any).priceUsd : undefined,
          },
        });
      } catch (e: any) {
        console.warn(`[delivery] #${deliveryId} attention-bus publish failed (non-fatal): ${e.message}`);
      }

      return {
        success: true,
        deliveryId,
        driveFileId: uploadResult.fileId || undefined,
        downloadLink: uploadResult.directDownloadLink || undefined,
        folderLink: uploadResult.customerFolderLink || undefined,
        shareableLink: uploadResult.shareableLink || undefined,
        publicPlayLink: publicPlayLink || undefined,
        emailSent,
        linkVerified: result.linkVerified,
        attempts: attempt,
        bundleFiles: bundleResults.length > 0 ? bundleResults : undefined,
      };
    } catch (err: any) {
      lastError = err.message || "Unknown delivery error";
      console.error(`[delivery] #${deliveryId} Attempt ${attempt} ERROR: ${lastError}`);
    }
  }

  await updateDeliveryLog(deliveryId, { status: "failed", errorMessage: `Failed after ${MAX_RETRIES} attempts: ${lastError}` });
  console.error(`[delivery] #${deliveryId} FAILED after ${MAX_RETRIES} attempts: ${lastError}`);

  // Attention Bus v0: publish failure event (high salience — wakes the owner).
  try {
    const { emitEvent } = await import("./event-bus");
    await emitEvent({
      type: "delivery.failed",
      source: "delivery-pipeline",
      tenantId: req.tenantId ?? 1,
      data: {
        // PII-safe: see delivery.completed event above. deliveryId is the FK; raw
        // customer fields stay in delivery_logs (auth-gated).
        deliveryId,
        productName: sanitizeDisplayField(req.productName, 80),
        customerNameRedacted: redactName(req.customerName),
        customerEmailRedacted: redactEmail(req.customerEmail),
        attempts,
        lastError,
        priceUsd: typeof (req as any).priceUsd === "number" ? (req as any).priceUsd : undefined,
      },
    });
  } catch (e: any) {
    console.warn(`[delivery] #${deliveryId} attention-bus publish failed (non-fatal): ${e.message}`);
  }

  sendAdminAlert(deliveryId, lastError, req).catch(() => {});

  // Repo Surgeon (#51): emit a structured incident for the unified classifier.
  // Delivery (Drive/email transport) failures are infra — classified transient
  // (retry), not a code fix. Fire-and-forget; telemetry must not break delivery.
  import("./agentic/repair-incident")
    .then(({ captureIncident }) =>
      captureIncident({
        // Delivery is the platform-owner storefront (tenant 1) by design — same
        // scoping as the delivery.failed event above — but thread a real tenant
        // if one is ever carried on the request/metadata.
        tenantId: (req as any).tenantId ?? (req.metadata as any)?.tenantId ?? 1,
        source: "felix_deliverable",
        title: `delivery #${deliveryId}: ${req.productName}`.slice(0, 200),
        signature: "delivery_failed",
        error: lastError,
        stage: "delivery",
        felixFailureKind: "delivery_infra",
        metadata: { deliveryId, attempts },
      }),
    )
    .catch((e) => console.warn(`[delivery] #${deliveryId} incident capture failed (non-fatal): ${e?.message || e}`));

  return { success: false, deliveryId, error: lastError, attempts };
}

export async function retryDelivery(deliveryId: number, tenantId?: number): Promise<DeliveryResult> {
  // Tenant-scope the lookup: a tenant must not be able to re-trigger (and thus
  // re-email) another tenant's delivery. When tenantId is omitted (trusted
  // internal callers) the filter is skipped.
  const where = tenantId != null
    ? and(eq(deliveryLogs.id, deliveryId), eq(deliveryLogs.tenantId, tenantId))
    : eq(deliveryLogs.id, deliveryId);
  const [log] = await db.select().from(deliveryLogs).where(where).limit(1);
  if (!log) return { success: false, deliveryId, error: "Delivery not found" };
  if (log.status === "completed") return { success: true, deliveryId, downloadLink: log.downloadLink || undefined, folderLink: log.folderLink || undefined };
  if (log.errorMessage?.includes("Do not retry automatically")) {
    return {
      success: false,
      deliveryId,
      inProgress: true,
      error: "Delivery requires reconciliation before any resend decision",
    };
  }
  if (log.status !== "failed") {
    return {
      success: false,
      deliveryId,
      inProgress: true,
      error: "Delivery is not in a retryable failed state",
    };
  }

  const cmmcRetry = await retryCmmcDeliveryIfApplicable(log);
  if (cmmcRetry) return cmmcRetry;

  const retrySource = readRetrySource(log);
  if (!retrySource) {
    return { success: false, deliveryId, error: "Delivery source path is invalid; refusing retry" };
  }

  // Keep the failed row eligible until deliverDigitalProduct atomically releases
  // its idempotency/payment claim. Marking it retrying here makes the new call
  // see its own source row as in-flight, while a non-atomic release lets two
  // retries race into duplicate email sends.
  console.log(`[delivery] Manual retry #${deliveryId}: ${log.productName}`);
  return deliverDigitalProduct(buildRetryDeliveryRequest(log, retrySource));
}

export async function getDeliveryStatus(deliveryId: number, tenantId?: number): Promise<DeliveryLog | null> {
  const where = tenantId != null
    ? and(eq(deliveryLogs.id, deliveryId), eq(deliveryLogs.tenantId, tenantId))
    : eq(deliveryLogs.id, deliveryId);
  const [log] = await db.select().from(deliveryLogs).where(where).limit(1);
  return log || null;
}

export async function listDeliveries(limit = 50, offset = 0, tenantId?: number): Promise<DeliveryLog[]> {
  const base = db.select().from(deliveryLogs);
  const scoped = tenantId != null ? base.where(eq(deliveryLogs.tenantId, tenantId)) : base;
  return scoped.orderBy(desc(deliveryLogs.createdAt)).limit(limit).offset(offset);
}

export async function getDeliveryStats(tenantId?: number): Promise<{
  total: number;
  completed: number;
  failed: number;
  pending: number;
  emailsSent: number;
  todayCount: number;
}> {
  const all = tenantId != null
    ? await db.select().from(deliveryLogs).where(eq(deliveryLogs.tenantId, tenantId))
    : await db.select().from(deliveryLogs);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return {
    total: all.length,
    completed: all.filter(d => d.status === "completed").length,
    failed: all.filter(d => d.status === "failed").length,
    pending: all.filter(d => !["completed", "failed"].includes(d.status)).length,
    emailsSent: all.filter(d => d.emailSent).length,
    todayCount: all.filter(d => d.createdAt >= today).length,
  };
}

export async function getDeliveryByStripePayment(paymentId: string): Promise<DeliveryLog | null> {
  const [log] = await db.select().from(deliveryLogs).where(eq(deliveryLogs.stripePaymentId, paymentId)).limit(1);
  return log || null;
}
