import { db } from "./db";
import { artifactRecords, deliveryLogs } from "@shared/schema";
import { eq, and, desc, sql } from "drizzle-orm";
import { ensureRecoveredDriveFileSharing, makeFileShareable, uploadAndShare, uploadToDrive, verifyDriveFilePublicAccess } from "./google-drive";
import { isEmailConfigured, getPrimaryInboxId, sendEmail, sendEmailDirect } from "./email";
import {
  isOwnerRecipient,
  reconcileOwnerEmailVerified,
  sendOwnerEmailVerified,
  shouldAttemptDeliveryEmail,
} from "./lib/owner-delivery-email";
import { isSuppressedSendResult } from "./lib/outbound-email-preflight";
import { scanForSecrets, scanFileForSecrets, isLikelyTextPath, summarizeReport, type ScanReport } from "./lib/secret-scan";
import {
  getDeliveryBaseUrl as getBaseUrl,
  publishOneFileToOwnServer,
  publishToOwnServer,
} from "./delivery-file-publishing";
import type { DeliveryLog } from "@shared/schema";
import {
  attachArtifactFileStorageFallback,
  clearArtifactDriveUploadDispatchPending,
  clearArtifactDeliveryReceiptPending,
  createArtifactIntent,
  markArtifactDriveUploadDispatchPending,
  markArtifactDeliveryReceiptPending,
  recordArtifactResendIntent,
  recordArtifactResendUncertain,
  recordArtifactResent,
  verifyAndMarkArtifactDurable,
} from "./durable-artifacts";
import fs from "node:fs";
import path from "node:path";
import {
  buildRetryDeliveryRequest,
  metadataWithDeliverySource,
  readDeliveryArtifactBytes,
  readRetrySource,
  resolveDeliveryContractType,
  retryCmmcDeliveryIfApplicable,
  verifyDeliveryArtifact,
} from "./delivery-artifact-recovery";
import {
  validateCompletedArtifactReceipt,
  validateCompletedEmailReceipt,
} from "./lib/delivery-receipt-policy";
export {
  buildRetryDeliveryRequest,
  readRetrySource,
  resolveDeliveryContractType,
  resolveRetrySourcePath,
} from "./delivery-artifact-recovery";
export type { RetrySource } from "./delivery-artifact-recovery";

/**
 * Delivery is a security boundary, not just a reporting action. Keep the
 * extension-to-contract mapping explicit so uncontracted files cannot be
 * uploaded or emailed by accident.
 */
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 5000;
const LINK_VERIFY_TIMEOUT_MS = 8000;
const ADMIN_ALERT_EMAIL = process.env.ADMIN_ALERT_EMAIL || "";

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
   * Required owning tenant for this delivery. Callers must derive it from
   * authenticated or server-owned context; it is never defaulted.
   */
  tenantId: number;
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

const DELIVERY_BUNDLE_FILES_METADATA_KEY = "_deliveryBundleFiles";

type PersistedBundleFile = {
  fileName: string;
  description?: string;
  driveFileId: string;
  downloadLink?: string;
  shareableLink?: string;
};

type FailedDeliveryRetryEvidence = {
  driveFileId?: string | null;
  driveFolderId?: string | null;
  folderLink?: string | null;
  downloadLink?: string | null;
  shareableLink?: string | null;
  emailSent?: boolean | null;
  emailMessageId?: string | null;
  errorMessage?: string | null;
  metadata?: unknown;
};

function hasPersistedBundleReceiptEvidence(metadata: unknown): boolean {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return false;
  const record = metadata as Record<string, unknown>;
  if (!Object.prototype.hasOwnProperty.call(record, DELIVERY_BUNDLE_FILES_METADATA_KEY)) return false;
  const rawFiles = record[DELIVERY_BUNDLE_FILES_METADATA_KEY];
  if (!Array.isArray(rawFiles)) return true;
  return rawFiles.length > 0;
}

/**
 * A failed row may still own an external Drive or email side effect. Such rows
 * cannot safely be released for a new delivery attempt: preserve the receipt
 * and require explicit reconciliation instead of duplicating the send.
 */
export function failedDeliveryRequiresReconciliation(log: FailedDeliveryRetryEvidence): boolean {
  return Boolean(
    log.driveFileId ||
    log.driveFolderId ||
    log.folderLink ||
    log.downloadLink ||
    log.shareableLink ||
    log.emailSent ||
    log.emailMessageId ||
    hasPersistedBundleReceiptEvidence(log.metadata) ||
    /Drive upload completed but|completion uncertain|Do not retry automatically/i.test(log.errorMessage || ""),
  );
}

type DeliveryArtifactIntents = {
  primaryArtifactId: number;
  bundleArtifactIds: number[];
};

/**
 * Write-ahead artifact records for the primary file and every companion. The
 * delivery receipt is created first, then these records are idempotently
 * reused on retry before a Drive or email side effect can run.
 */
async function createDeliveryArtifactIntents(req: DeliveryRequest, deliveryId: number): Promise<DeliveryArtifactIntents> {
  const tenantId = req.tenantId;
  const sourceRunKey = `delivery:${deliveryId}`;
  const primary = await createArtifactIntent({
    tenantId,
    logicalName: sanitizeDisplayField(req.fileName, 300),
    artifactKind: resolveDeliveryContractType(req.fileName) || "delivery_file",
    mimeType: req.mimeType || "application/octet-stream",
    idempotencyKey: `delivery-artifact:${deliveryId}:primary`,
    sourceRunKey,
    deliveryLogId: deliveryId,
    metadata: { role: "primary", productName: sanitizeDisplayField(req.productName, 200) },
    bytes: readDeliveryArtifactBytes(req),
  });
  const bundleArtifactIds: number[] = [];
  for (const [index, file] of (req.additionalFiles || []).entries()) {
    const bundle = await createArtifactIntent({
      tenantId,
      logicalName: sanitizeDisplayField(file.fileName, 300),
      artifactKind: resolveDeliveryContractType(file.fileName) || "delivery_file",
      mimeType: file.mimeType || "application/octet-stream",
      idempotencyKey: `delivery-artifact:${deliveryId}:bundle:${index}`,
      sourceRunKey,
      deliveryLogId: deliveryId,
      metadata: { role: "bundle", bundleIndex: index, productName: sanitizeDisplayField(req.productName, 200) },
      bytes: readDeliveryArtifactBytes(file),
    });
    bundleArtifactIds.push(bundle.id);
  }
  return { primaryArtifactId: primary.id, bundleArtifactIds };
}

function serializeBundleFiles(bundleResults: Array<{ file: BundleFile; uploadResult: any }>): PersistedBundleFile[] {
  return bundleResults.flatMap(({ file, uploadResult }) => {
    if ((!uploadResult?.success && !uploadResult?.completionUncertain) || typeof uploadResult.fileId !== "string" || !uploadResult.fileId) return [];
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
  /** A remote side effect may have succeeded but durable local receipt persistence failed. */
  completionUncertain?: boolean;
  /** Per-file results when additionalFiles was provided. */
  bundleFiles?: BundleFileResult[];
}

export function deliveryCompletionUncertainResult(params: {
  deliveryId: number;
  attempts: number;
  linkVerified: boolean;
  error: string;
  emailSent?: boolean;
}): DeliveryResult {
  return {
    success: false,
    deliveryId: params.deliveryId,
    emailSent: params.emailSent ?? false,
    linkVerified: params.linkVerified,
    attempts: params.attempts,
    inProgress: true,
    completionUncertain: true,
    error: params.error,
  };
}

async function createDeliveryLog(req: DeliveryRequest): Promise<number> {
  const [row] = await db.insert(deliveryLogs).values({
    tenantId: req.tenantId,
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

async function updateDeliveryLog(tenantId: number, id: number, updates: Partial<DeliveryLog>) {
  const [updated] = await db.update(deliveryLogs).set(updates).where(and(
    eq(deliveryLogs.id, id),
    eq(deliveryLogs.tenantId, tenantId),
  ))
    .returning({ id: deliveryLogs.id });
  if (!updated) throw new Error(`Delivery log #${id} could not be updated`);
}

async function updateDeliveryLogWithBundleFiles(
  tenantId: number,
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
  }).where(and(eq(deliveryLogs.id, id), eq(deliveryLogs.tenantId, tenantId))).returning({ id: deliveryLogs.id });
  if (!updated) throw new Error(`Delivery log #${id} bundle receipt could not be recorded`);
}

async function markDeliveryCompletionUncertain(tenantId: number, deliveryId: number, message: string): Promise<void> {
  try {
    await updateDeliveryLog(tenantId, deliveryId, {
      status: "completion_uncertain",
      errorMessage: message.slice(0, 1000),
    });
  } catch (error) {
    console.error(`[delivery] #${deliveryId} could not persist completion-uncertain state`, error);
  }
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

async function attemptUpload(req: DeliveryRequest, deliveryId: number, artifactIntents: DeliveryArtifactIntents): Promise<{
  success: boolean;
  uploadResult?: any;
  linkVerified?: boolean;
  bundleResults?: Array<{ file: BundleFile; uploadResult: any }>;
  completionUncertain?: boolean;
  error?: string;
}> {
  const tenantId = req.tenantId;
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
        tenantId: req.tenantId,
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
    eq(deliveryLogs.tenantId, req.tenantId),
  )).limit(1);
  const priorBundles = new Map(
    (readPersistedBundleFiles(priorDelivery?.metadata || null) || []).map((file) => [file.fileName, file]),
  );
  const recoveredPrimary = priorDelivery?.driveFileId && priorDelivery.driveFolderId
    ? await ensureRecoveredDriveFileSharing({
      fileId: priorDelivery.driveFileId,
      folderId: priorDelivery.driveFolderId,
      viewUrl: priorDelivery.shareableLink || undefined,
      downloadUrl: priorDelivery.downloadLink || undefined,
    }, true, {
      forcePermissionRepair: true,
      makeShareable: (fileId) => makeFileShareable(fileId, { relocateToPrivateRoot: true }),
    })
    : null;
  let uploadResult: any;
  if (recoveredPrimary) {
    uploadResult = recoveredPrimary.success
      ? {
        success: true,
        fileId: recoveredPrimary.file.fileId,
        customerFolderId: recoveredPrimary.file.folderId,
        customerFolderLink: recoveredPrimary.file.folderId ? `https://drive.google.com/drive/folders/${recoveredPrimary.file.folderId}` : undefined,
        directDownloadLink: recoveredPrimary.file.downloadUrl,
        shareableLink: recoveredPrimary.file.viewUrl,
      }
      : { success: false, error: recoveredPrimary.error };
  } else {
    try {
      await markArtifactDriveUploadDispatchPending(tenantId, artifactIntents.primaryArtifactId);
    } catch (error) {
      return {
        success: false,
        completionUncertain: true,
        error: error instanceof Error ? error.message : "Primary Drive upload requires reconciliation",
      };
    }
    uploadResult = await uploadToDrive({
      filePath: req.filePath,
      fileData: req.fileData,
      fileName: req.fileName,
      mimeType: req.mimeType || "application/pdf",
      customerName: req.customerName,
      share: true,
      customerDelivery: true,
      durableArtifactKey: `delivery:${deliveryId}:primary`,
    });
    if (!uploadResult.success && !uploadResult.completionUncertain) {
      try {
        await clearArtifactDriveUploadDispatchPending(tenantId, artifactIntents.primaryArtifactId);
      } catch (error) {
        return {
          success: false,
          completionUncertain: true,
          error: error instanceof Error ? error.message : "Primary Drive upload dispatch marker could not be cleared",
        };
      }
    }
  }

  if (!uploadResult.success) {
    if (uploadResult.completionUncertain && uploadResult.fileId) {
      try {
        await updateDeliveryLog(tenantId, deliveryId, {
          status: "verifying",
          driveFileId: uploadResult.fileId,
          driveFolderId: uploadResult.customerFolderId || null,
          folderLink: uploadResult.customerFolderLink || null,
          downloadLink: uploadResult.directDownloadLink || null,
          shareableLink: uploadResult.shareableLink || null,
        });
        await verifyAndMarkArtifactDurable({
          tenantId,
          artifactId: artifactIntents.primaryArtifactId,
          driveFileId: uploadResult.fileId,
          driveFolderId: uploadResult.customerFolderId || null,
          driveViewUrl: uploadResult.shareableLink || null,
          driveDownloadUrl: uploadResult.directDownloadLink || null,
        });
      } catch (receiptError) {
        console.error(`[delivery] #${deliveryId} could not checkpoint known primary Drive receipt`, receiptError);
      }
    }
    return {
      success: false,
      completionUncertain: uploadResult.completionUncertain,
      error: uploadResult.error,
    };
  }

  // Checkpoint the primary Drive side effect before attempting companions.
  // If the worker dies mid-bundle, a retry resumes this exact folder/file
  // instead of creating another customer delivery folder.
  try {
    await updateDeliveryLog(tenantId, deliveryId, {
      status: "verifying",
      driveFileId: uploadResult.fileId || null,
      driveFolderId: uploadResult.customerFolderId || null,
      folderLink: uploadResult.customerFolderLink || null,
      downloadLink: uploadResult.directDownloadLink || null,
      shareableLink: uploadResult.shareableLink || null,
    });
  } catch (checkpointError) {
    // A remote upload has already happened. Preserve its receipt in the
    // manifest if possible, then stop rather than re-uploading on retry.
    try {
      await verifyAndMarkArtifactDurable({
        tenantId,
        artifactId: artifactIntents.primaryArtifactId,
        driveFileId: uploadResult.fileId || "",
        driveFolderId: uploadResult.customerFolderId || null,
        driveViewUrl: uploadResult.shareableLink || null,
        driveDownloadUrl: uploadResult.directDownloadLink || null,
      });
    } catch (artifactError) {
      console.error(`[delivery] #${deliveryId} primary receipt recovery failed`, artifactError);
    }
    const message = checkpointError instanceof Error ? checkpointError.message : "primary Drive receipt checkpoint failed";
    return { success: false, completionUncertain: true, error: `Drive upload completed but its delivery receipt could not be checkpointed: ${message}` };
  }
  try {
    await verifyAndMarkArtifactDurable({
      tenantId: req.tenantId,
      artifactId: artifactIntents.primaryArtifactId,
      driveFileId: uploadResult.fileId || "",
      driveFolderId: uploadResult.customerFolderId || null,
      driveViewUrl: uploadResult.shareableLink || null,
      driveDownloadUrl: uploadResult.directDownloadLink || null,
    });
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : "Primary artifact durability verification failed" };
  }

  // Bundle mode: upload each additional file into the SAME per-customer
  // folder created by the primary upload above. Failures here do not abort
  // the primary delivery — the customer still gets the main product, and
  // any failed bundle items are flagged in the email.
  const bundleResults: Array<{ file: BundleFile; uploadResult: any }> = [];
  if (req.additionalFiles && req.additionalFiles.length > 0 && uploadResult.customerFolderId) {
    for (const [bundleIndex, f] of req.additionalFiles.entries()) {
      const prior = priorBundles.get(f.fileName);
      const recoveredBundle = prior
        ? typeof prior.driveFileId === "string" && prior.driveFileId
          ? await ensureRecoveredDriveFileSharing({
            fileId: prior.driveFileId,
            viewUrl: prior.shareableLink,
            downloadUrl: prior.downloadLink,
          }, true, {
            forcePermissionRepair: true,
            makeShareable: (fileId) => makeFileShareable(fileId, { relocateToPrivateRoot: true }),
          })
          : { success: false as const, error: "Persisted bundle receipt has no valid Drive file ID" }
        : null;
      let r: any;
      if (recoveredBundle) {
        r = recoveredBundle.success
          ? {
            success: true,
            fileId: recoveredBundle.file.fileId,
            directDownloadLink: recoveredBundle.file.downloadUrl,
            shareableLink: recoveredBundle.file.viewUrl,
          }
          : { success: false, error: recoveredBundle.error }
      } else {
        try {
          await markArtifactDriveUploadDispatchPending(tenantId, artifactIntents.bundleArtifactIds[bundleIndex]);
        } catch (error) {
          return {
            success: false,
            completionUncertain: true,
            error: error instanceof Error ? error.message : `Bundle Drive upload requires reconciliation for ${f.fileName}`,
            uploadResult,
            bundleResults,
          };
        }
        r = await uploadToDrive({
          filePath: f.filePath,
          fileData: f.fileData,
          fileName: f.fileName,
          mimeType: f.mimeType || "application/octet-stream",
          parentFolderId: uploadResult.customerFolderId,
          skipSubfolder: true,
          share: true,
          customerDelivery: true,
          durableArtifactKey: `delivery:${deliveryId}:bundle:${bundleIndex}`,
        });
        if (!r.success && !r.completionUncertain) {
          try {
            await clearArtifactDriveUploadDispatchPending(tenantId, artifactIntents.bundleArtifactIds[bundleIndex]);
          } catch (error) {
            return {
              success: false,
              completionUncertain: true,
              error: error instanceof Error ? error.message : `Bundle Drive upload dispatch marker could not be cleared for ${f.fileName}`,
              uploadResult,
              bundleResults,
            };
          }
        }
      }
      bundleResults.push({ file: f, uploadResult: r });
      if (r.completionUncertain) {
        if (r.fileId) {
          try {
            await updateDeliveryLogWithBundleFiles(tenantId, deliveryId, {}, bundleResults, [...priorBundles.values()]);
            await verifyAndMarkArtifactDurable({
              tenantId,
              artifactId: artifactIntents.bundleArtifactIds[bundleIndex],
              driveFileId: r.fileId,
              driveFolderId: uploadResult.customerFolderId || null,
              driveViewUrl: r.shareableLink || null,
              driveDownloadUrl: r.directDownloadLink || null,
            });
          } catch (receiptError) {
            console.error(`[delivery] #${deliveryId} could not checkpoint known bundle Drive receipt`, receiptError);
          }
        }
        return {
          success: false,
          completionUncertain: true,
          error: r.error || `Bundle upload outcome is uncertain for ${f.fileName}`,
          uploadResult,
          bundleResults,
        };
      }
      if (r.success) {
        // Each companion is an external side effect. Persist it before the
        // next upload so any interruption resumes from this exact checkpoint.
        try {
          await updateDeliveryLogWithBundleFiles(tenantId, deliveryId, {}, bundleResults, [...priorBundles.values()]);
        } catch (checkpointError) {
          try {
            await verifyAndMarkArtifactDurable({
              tenantId,
              artifactId: artifactIntents.bundleArtifactIds[bundleIndex],
              driveFileId: r.fileId || "",
              driveFolderId: uploadResult.customerFolderId || null,
              driveViewUrl: r.shareableLink || null,
              driveDownloadUrl: r.directDownloadLink || null,
            });
          } catch (artifactError) {
            console.error(`[delivery] #${deliveryId} bundle receipt recovery failed`, artifactError);
          }
          const message = checkpointError instanceof Error ? checkpointError.message : "bundle Drive receipt checkpoint failed";
          return { success: false, completionUncertain: true, error: `Bundle upload completed but its delivery receipt could not be checkpointed: ${message}` };
        }
        try {
          await verifyAndMarkArtifactDurable({
            tenantId: req.tenantId,
            artifactId: artifactIntents.bundleArtifactIds[bundleIndex],
            driveFileId: r.fileId || "",
            driveFolderId: uploadResult.customerFolderId || null,
            driveViewUrl: r.shareableLink || null,
            driveDownloadUrl: r.directDownloadLink || null,
          });
        } catch (error) {
          return { success: false, error: error instanceof Error ? error.message : `Bundle artifact ${f.fileName} durability verification failed` };
        }
      }
      if (!r.success) {
        console.warn(`[delivery] #${deliveryId} Bundle file failed: ${f.fileName} — ${r.error}`);
      }
    }
  }

  await updateDeliveryLogWithBundleFiles(tenantId, deliveryId, { status: "verifying" }, bundleResults, [...priorBundles.values()]);

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
  if (!Number.isInteger(req.tenantId) || req.tenantId <= 0) {
    throw new Error("deliverDigitalProduct requires a positive tenantId");
  }
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
    const tenantId = req.tenantId;
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
    const tenantId = req.tenantId;
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
      if (failedDeliveryRequiresReconciliation(prior)) {
        return {
          success: false,
          deliveryId: prior.id,
          inProgress: true,
          error: "A failed delivery already has external receipt evidence; reconcile it instead of retrying",
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
    const reqTenantId = req.tenantId;
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
    // A receipt-bearing failure is uncertain completion, never a fresh retry.
    // For a demonstrated pre-side-effect failure, the unique index lets us
    // release the old key transactionally before creating the next attempt.
    if (prior) {
      if (failedDeliveryRequiresReconciliation(prior)) {
        return {
          success: false,
          deliveryId: prior.id,
          inProgress: true,
          error: "A failed Stripe-backed delivery already has external receipt evidence; reconcile it instead of retrying",
          attempts: 0,
        };
      }
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
  const tenantId = req.tenantId;
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
  let artifactIntents: DeliveryArtifactIntents;
  try {
    artifactIntents = await createDeliveryArtifactIntents(req, deliveryId);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Artifact intent could not be created";
    await updateDeliveryLog(tenantId, deliveryId, { status: "failed", errorMessage: `Durable artifact intent failed: ${message}` });
    return { success: false, deliveryId, error: `Durable artifact intent failed: ${message}` };
  }

  let lastError = "";
  let attempts = 0;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    attempts = attempt;
    try {
      await updateDeliveryLog(tenantId, deliveryId, { status: attempt > 1 ? `retry_${attempt}` : "uploading" });

      if (attempt > 1) {
        console.log(`[delivery] #${deliveryId} Retry attempt ${attempt}/${MAX_RETRIES} (waiting ${RETRY_DELAY_MS}ms)...`);
        await sleep(RETRY_DELAY_MS);
      }

      const result = await attemptUpload(req, deliveryId, artifactIntents);

      if (!result.success) {
        lastError = `Drive upload failed: ${result.error}`;
        console.error(`[delivery] #${deliveryId} Attempt ${attempt} FAILED: ${lastError}`);
        if (result.completionUncertain) {
          await markDeliveryCompletionUncertain(tenantId, deliveryId, result.error || "Drive upload completion is uncertain; do not retry automatically.");
          return deliveryCompletionUncertainResult({
            deliveryId,
            attempts: attempt,
            linkVerified: false,
            emailSent: false,
            error: result.error || "Drive upload completion is uncertain; do not retry automatically.",
          });
        }
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
      const bundleResults: BundleFileResult[] = await Promise.all((result.bundleResults || []).map(async ({ file, uploadResult: r }, bundleIndex) => {
        if (!r.success) {
          return { fileName: file.fileName, description: file.description, success: false, error: r.error };
        }
        const staged = await publishOneFileToOwnServer({ fileName: file.fileName, filePath: file.filePath, fileData: file.fileData }, deliveryId, tenantId);
        if (staged.fallbackPersistenceError) throw new Error(staged.fallbackPersistenceError);
        if (staged.fileStorageId) {
          await attachArtifactFileStorageFallback({
            tenantId,
            artifactId: artifactIntents.bundleArtifactIds[bundleIndex],
            fileStorageId: staged.fileStorageId,
          });
        }
        return {
          fileName: file.fileName,
          description: file.description,
          success: true,
          driveFileId: r.fileId,
          downloadLink: r.directDownloadLink,
          shareableLink: r.shareableLink,
        };
      }));

      // Always publish a copy of the deliverable on our own server so videos/
      // audio/apps play instantly without Drive's mobile preview transcoder.
      // Hoisted out of the email block so the streaming URL is available even
      // when sendEmail=false (programmatic callers like build-bwb-video.ts
      // print and act on it directly).
      const primaryStage = await publishToOwnServer(req, deliveryId);
      if (primaryStage.fallbackPersistenceError) throw new Error(primaryStage.fallbackPersistenceError);
      if (primaryStage.fileStorageId) {
        await attachArtifactFileStorageFallback({
          tenantId,
          artifactId: artifactIntents.primaryArtifactId,
          fileStorageId: primaryStage.fileStorageId,
        });
      }
      const publicPlayLink = primaryStage.link;
      if (publicPlayLink) {
        console.log(`[delivery] #${deliveryId} Self-hosted play link: ${publicPlayLink}`);
      }

      let emailSent = false;
      const deliveryArtifactIds = [artifactIntents.primaryArtifactId, ...artifactIntents.bundleArtifactIds];
      const deliveryEmail = req.customerEmail?.trim() || "";
      const ownerRecipient = deliveryEmail ? await isOwnerRecipient(deliveryEmail) : false;
      const shouldAttemptEmail = shouldAttemptDeliveryEmail({
        requested: req.sendEmail !== false,
        customerEmail: deliveryEmail,
        ownerRecipient,
        agentMailConfigured: isEmailConfigured(),
      });
      if (req.sendEmail !== false && deliveryEmail && !shouldAttemptEmail) {
        const message = "Customer email transport is unavailable. Do not retry automatically until email configuration is restored.";
        console.error(`[delivery] #${deliveryId} ${message}`);
        await markDeliveryCompletionUncertain(tenantId, deliveryId, message);
        void sendAdminAlert(deliveryId, message, req).catch(() => {});
        return deliveryCompletionUncertainResult({
          deliveryId,
          attempts: attempt,
          linkVerified: result.linkVerified,
          error: message,
        });
      }
      if (shouldAttemptEmail) {
        try {
          // Persist the ambiguous-send marker BEFORE calling the provider. If
          // either post-send receipt write fails, the Vault remains visibly
          // recoverable even if delivery_logs is temporarily unavailable.
          await Promise.all(deliveryArtifactIds.map((artifactId) => markArtifactDeliveryReceiptPending(tenantId, artifactId)));
          await updateDeliveryLog(tenantId, deliveryId, { status: "emailing" });
          const viewLink = uploadResult.shareableLink || (uploadResult.fileId ? `https://drive.google.com/file/d/${uploadResult.fileId}/view?usp=sharing` : "");

          const orderPageLink = req.orderId ? `${getBaseUrl()}/orders/${encodeURIComponent(req.orderId)}` : null;

          const emailContent = buildDeliveryEmail(req, {
            downloadLink: uploadResult.directDownloadLink || "",
            viewLink,
            folderLink: uploadResult.customerFolderLink || "",
            publicPlayLink,
            orderPageLink,
          }, bundleResults, deliveryId);

          let emailMessageId: string | null = null;
          if (ownerRecipient) {
            const ownerResult = await sendOwnerEmailVerified({
              tenantId,
              to: deliveryEmail,
              subject: emailContent.subject,
              text: emailContent.text,
              html: emailContent.html,
              stableMessageKey: `delivery-${req.idempotencyKey || deliveryId}`,
              onMessageSent: async (messageId) => {
                await updateDeliveryLog(tenantId, deliveryId, { emailMessageId: messageId });
              },
            });
            emailMessageId = ownerResult.messageId;
          } else {
            const emailResult = await sendEmailDirect({
              to: deliveryEmail,
              subject: emailContent.subject,
              text: emailContent.text,
              html: emailContent.html,
            });
            if (isSuppressedSendResult(emailResult)) {
              throw new Error("Email provider returned a suppression sentinel instead of a send receipt.");
            }
            emailMessageId = (emailResult as any)?.id || (emailResult as any)?.messageId || null;
          }

          emailSent = true;
          try {
            await updateDeliveryLog(tenantId, deliveryId, {
              emailSent: true,
              emailMessageId,
            });
          } catch (persistenceError: any) {
            const message = "Customer email may have been sent, but its delivery receipt could not be recorded safely. Do not retry automatically.";
            console.error(`[delivery] #${deliveryId} ${message} ${persistenceError?.message || ""}`);
            await markDeliveryCompletionUncertain(tenantId, deliveryId, `${message} ${persistenceError?.message || ""}`);
            void sendAdminAlert(deliveryId, `${message} ${persistenceError?.message || ""}`, req).catch(() => {});
            return deliveryCompletionUncertainResult({
              deliveryId,
              attempts: attempt,
              linkVerified: result.linkVerified,
              error: message,
            });
          }
          console.log(`[delivery] #${deliveryId} Email sent to ${redactEmail(deliveryEmail)}`);
        } catch (emailErr: any) {
          const message = "Customer email dispatch outcome is uncertain. Do not retry automatically.";
          console.error(`[delivery] #${deliveryId} ${message} ${emailErr.message}`);
          await markDeliveryCompletionUncertain(tenantId, deliveryId, `${message} ${emailErr.message}`);
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
        await updateDeliveryLog(tenantId, deliveryId, {
          status: "completed",
          completedAt: new Date(),
        });
      } catch (persistenceError: any) {
        const message = "Customer email may have been sent, but final delivery completion could not be recorded safely. Do not retry automatically.";
        console.error(`[delivery] #${deliveryId} ${message} ${persistenceError?.message || ""}`);
        await markDeliveryCompletionUncertain(tenantId, deliveryId, `${message} ${persistenceError?.message || ""}`);
        void sendAdminAlert(deliveryId, `${message} ${persistenceError?.message || ""}`, req).catch(() => {});
        return deliveryCompletionUncertainResult({
          deliveryId,
          attempts: attempt,
          linkVerified: result.linkVerified,
          error: message,
        });
      }
      if (shouldAttemptEmail) {
        try {
          await Promise.all(deliveryArtifactIds.map((artifactId) => clearArtifactDeliveryReceiptPending(tenantId, artifactId)));
        } catch (error) {
          const message = error instanceof Error ? error.message : "Customer email receipt marker could not be cleared";
          console.error(`[delivery] #${deliveryId} ${message}`);
          await markDeliveryCompletionUncertain(tenantId, deliveryId, message);
          void sendAdminAlert(deliveryId, message, req).catch(() => {});
          return deliveryCompletionUncertainResult({
            deliveryId,
            attempts: attempt,
            linkVerified: result.linkVerified,
            error: message,
          });
        }
      }

      console.log(`[delivery] #${deliveryId} COMPLETED: "${sanitizeDisplayField(req.productName, 80)}" → ${redactName(req.customerName)} (email: ${emailSent}, verified: ${result.linkVerified}, attempts: ${attempt})`);

      // Attention Bus v0: publish completion event (low salience by default).
      try {
        const { emitEvent } = await import("./event-bus");
        await emitEvent({
          type: "delivery.completed",
          source: "delivery-pipeline",
          tenantId: req.tenantId,
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

  await updateDeliveryLog(tenantId, deliveryId, { status: "failed", errorMessage: `Failed after ${MAX_RETRIES} attempts: ${lastError}` });
  console.error(`[delivery] #${deliveryId} FAILED after ${MAX_RETRIES} attempts: ${lastError}`);

  // Attention Bus v0: publish failure event (high salience — wakes the owner).
  try {
    const { emitEvent } = await import("./event-bus");
    await emitEvent({
      type: "delivery.failed",
      source: "delivery-pipeline",
      tenantId: req.tenantId,
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

export async function retryDelivery(deliveryId: number, tenantId: number): Promise<DeliveryResult> {
  // The management API must always name its tenant. Global retry is an
  // explicit non-capability: it would allow an IDOR to re-send another
  // tenant's customer delivery.
  const [log] = await db.select().from(deliveryLogs).where(and(
    eq(deliveryLogs.id, deliveryId),
    eq(deliveryLogs.tenantId, tenantId),
  )).limit(1);
  if (!log) return { success: false, deliveryId, error: "Delivery not found" };
  if (log.status === "completed") return { success: true, deliveryId, downloadLink: log.downloadLink || undefined, folderLink: log.folderLink || undefined };
  if (
    log.status === "completion_uncertain"
    && log.customerEmail
    && await isOwnerRecipient(log.customerEmail)
  ) {
    try {
      const verified = await reconcileOwnerEmailVerified({
        tenantId: log.tenantId,
        to: log.customerEmail,
        existingMessageId: log.emailMessageId,
        stableMessageKey: `delivery-${log.idempotencyKey || log.id}`,
      });
      const artifacts = await db.select({ id: artifactRecords.id }).from(artifactRecords).where(and(
        eq(artifactRecords.tenantId, log.tenantId),
        eq(artifactRecords.deliveryLogId, log.id),
      ));
      await Promise.all(artifacts.map((artifact) => clearArtifactDeliveryReceiptPending(log.tenantId, artifact.id)));
      const [completed] = await db.update(deliveryLogs).set({
        status: "completed",
        emailSent: true,
        emailMessageId: verified.messageId,
        errorMessage: null,
        completedAt: new Date(),
      }).where(and(
        eq(deliveryLogs.id, log.id),
        eq(deliveryLogs.tenantId, log.tenantId),
        eq(deliveryLogs.status, "completion_uncertain"),
      )).returning({ id: deliveryLogs.id });
      if (!completed) {
        return { success: false, deliveryId, inProgress: true, error: "Delivery state changed during owner email reconciliation" };
      }
      return {
        success: true,
        deliveryId,
        downloadLink: log.downloadLink || undefined,
        folderLink: log.folderLink || undefined,
        shareableLink: log.shareableLink || undefined,
        emailSent: true,
        linkVerified: true,
        attempts: 0,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Owner email reconciliation failed";
      console.error(`[delivery] #${deliveryId} owner email reconciliation failed`, error);
      return {
        success: false,
        deliveryId,
        inProgress: true,
        error: `Owner email remains unverified; no resend was attempted: ${message}`,
      };
    }
  }
  if (log.status !== "failed") {
    return {
      success: false,
      deliveryId,
      inProgress: true,
      error: "Delivery is not in a retryable failed state",
    };
  }
  if (failedDeliveryRequiresReconciliation(log)) {
    return {
      success: false,
      deliveryId,
      inProgress: true,
      error: "Delivery requires reconciliation before any resend decision",
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

/**
 * Re-send an already completed delivery without re-uploading or regenerating
 * its work product. This is deliberately separate from retryDelivery: support
 * requests are an explicit email side effect, not recovery of a failed job.
 */
export async function resendExistingDelivery(deliveryId: number, tenantId: number): Promise<{ success: boolean; error?: string }> {
  const [log] = await db.select().from(deliveryLogs).where(and(
    eq(deliveryLogs.id, deliveryId),
    eq(deliveryLogs.tenantId, tenantId),
  )).limit(1);
  if (!log) return { success: false, error: "Delivery not found" };
  if (log.status !== "completed") return { success: false, error: "Only completed deliveries can be resent" };
  if (!log.customerEmail) return { success: false, error: "This delivery has no customer email address" };
  if (!log.downloadLink || !log.shareableLink || !log.folderLink) {
    return { success: false, error: "Delivery links are incomplete; reconcile the delivery before resending" };
  }
  const ownerRecipient = await isOwnerRecipient(log.customerEmail);
  if (!ownerRecipient && !isEmailConfigured()) {
    return { success: false, error: "Customer email transport is unavailable" };
  }
  const artifacts = await db.select({
    id: artifactRecords.id,
    status: artifactRecords.status,
  }).from(artifactRecords).where(and(
    eq(artifactRecords.tenantId, tenantId),
    eq(artifactRecords.deliveryLogId, deliveryId),
  ));
  if (artifacts.length === 0 || artifacts.some((artifact) => artifact.status !== "durable")) {
    return { success: false, error: "Every tracked delivery artifact must be durable before an existing delivery can be resent" };
  }
  const existingMetadata = log.metadata && typeof log.metadata === "object" && !Array.isArray(log.metadata)
    ? log.metadata as Record<string, unknown>
    : {};
  if (typeof existingMetadata.resendPendingAt === "string") {
    return { success: false, error: "A previous resend may have been sent but its receipt is incomplete; reconcile it before sending again" };
  }
  const resendPendingAt = new Date().toISOString();
  const [resendIntent] = await db.update(deliveryLogs).set({
    metadata: sql`COALESCE(metadata, '{}'::jsonb) || ${JSON.stringify({ resendPendingAt })}::jsonb`,
  }).where(and(
    eq(deliveryLogs.id, deliveryId),
    eq(deliveryLogs.tenantId, tenantId),
    sql`COALESCE(${deliveryLogs.metadata}->>'resendPendingAt', '') = ''`,
  ))
    .returning({ id: deliveryLogs.id });
  if (!resendIntent) return { success: false, error: "A resend is already in progress or requires reconciliation" };
  try {
    await Promise.all(artifacts.map((artifact) => recordArtifactResendIntent(tenantId, artifact.id)));
  } catch (error) {
    await db.update(deliveryLogs).set({
      metadata: sql`COALESCE(metadata, '{}'::jsonb) || ${JSON.stringify({ resendPendingAt: null, lastResendError: "artifact audit intent failed" })}::jsonb`,
    }).where(and(eq(deliveryLogs.id, deliveryId), eq(deliveryLogs.tenantId, tenantId)));
    return { success: false, error: error instanceof Error ? error.message : "Unable to record artifact resend intent" };
  }

  const email = buildDeliveryEmail({
    tenantId,
    customerName: log.customerName,
    customerEmail: log.customerEmail,
    productName: log.productName,
    fileName: log.fileName,
    orderId: log.orderId || undefined,
    sendEmail: true,
  }, {
    downloadLink: log.downloadLink,
    viewLink: log.shareableLink,
    folderLink: log.folderLink,
  }, readPersistedBundleFiles(log.metadata), deliveryId);
  let messageId: string | null = null;
  try {
    if (ownerRecipient) {
      const result = await sendOwnerEmailVerified({
        tenantId,
        to: log.customerEmail,
        subject: email.subject,
        text: email.text,
        html: email.html,
        stableMessageKey: `delivery-${deliveryId}-resend-${resendPendingAt}`,
      });
      messageId = result.messageId;
    } else {
      const result = await sendEmailDirect({
        to: log.customerEmail,
        subject: email.subject,
        text: email.text,
        html: email.html,
      });
      if (isSuppressedSendResult(result)) {
        throw new Error("Email provider returned a suppression sentinel instead of a resend receipt.");
      }
      messageId = (result as any)?.id || (result as any)?.messageId || null;
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "email dispatch outcome unknown";
    for (const artifact of artifacts) {
      try {
        await recordArtifactResendUncertain(tenantId, artifact.id, message);
      } catch (eventError) {
        console.error(`[delivery] #${deliveryId} could not record uncertain resend state`, eventError);
      }
    }
    return { success: false, error: `Customer email may have been sent; reconcile before resending: ${message}` };
  }
  try {
    await db.update(deliveryLogs).set({
      emailSent: true,
      emailMessageId: messageId || log.emailMessageId,
      metadata: sql`COALESCE(metadata, '{}'::jsonb) || ${JSON.stringify({ resendPendingAt: null, lastResentAt: new Date().toISOString() })}::jsonb`,
    }).where(and(eq(deliveryLogs.id, deliveryId), eq(deliveryLogs.tenantId, tenantId)));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Resend receipt could not be persisted";
    for (const artifact of artifacts) {
      try {
        await recordArtifactResendUncertain(tenantId, artifact.id, message);
      } catch (eventError) {
        console.error(`[delivery] #${deliveryId} could not record uncertain resend state`, eventError);
      }
    }
    return { success: false, error: `Customer email may have been sent, but its resend receipt could not be recorded safely: ${message}` };
  }
  try {
    await Promise.all(artifacts.map((artifact) => recordArtifactResent(tenantId, artifact.id)));
  } catch (eventError) {
    // The delivery receipt itself is durable at this point; do not misreport it
    // as a failed resend or invite a duplicate email solely for an audit-event
    // write failure.
    console.error(`[delivery] #${deliveryId} resend receipt was saved but artifact event recording failed`, eventError);
  }
  return { success: true };
}

export async function getDeliveryStatus(deliveryId: number, tenantId: number): Promise<DeliveryLog | null> {
  const [log] = await db.select().from(deliveryLogs).where(and(
    eq(deliveryLogs.id, deliveryId),
    eq(deliveryLogs.tenantId, tenantId),
  )).limit(1);
  return log || null;
}

type VerifyDeliveryReceiptParams = {
  deliveryId: number;
  tenantId: number;
  driveFileId: string;
};

async function verifyCompletedReceipt(
  params: VerifyDeliveryReceiptParams,
  requiresEmailReceipt: boolean,
): Promise<{ ok: true; delivery: DeliveryLog } | { ok: false; error: string }> {
  if (!Number.isSafeInteger(params.deliveryId) || params.deliveryId <= 0) {
    return { ok: false, error: "Delivery ID is invalid" };
  }
  const [delivery] = await db.select().from(deliveryLogs).where(and(
    eq(deliveryLogs.id, params.deliveryId),
    eq(deliveryLogs.tenantId, params.tenantId),
  )).limit(1);
  if (!delivery) return { ok: false, error: "Delivery receipt was not found for this tenant" };
  const artifacts = await db.select({
    status: artifactRecords.status,
    driveFileId: artifactRecords.driveFileId,
  }).from(artifactRecords).where(and(
    eq(artifactRecords.tenantId, params.tenantId),
    eq(artifactRecords.deliveryLogId, params.deliveryId),
  ));
  const error = requiresEmailReceipt
    ? validateCompletedEmailReceipt(delivery, artifacts, params.driveFileId)
    : validateCompletedArtifactReceipt(delivery, artifacts, params.driveFileId);
  if (error) return { ok: false, error };
  return { ok: true, delivery };
}

export async function verifyCompletedDeliveryReceipt(
  params: VerifyDeliveryReceiptParams,
): Promise<{ ok: true; delivery: DeliveryLog } | { ok: false; error: string }> {
  return verifyCompletedReceipt(params, true);
}

export async function verifyCompletedArtifactReceipt(
  params: VerifyDeliveryReceiptParams,
): Promise<{ ok: true; delivery: DeliveryLog } | { ok: false; error: string }> {
  return verifyCompletedReceipt(params, false);
}

export async function listDeliveries(limit: number, offset: number, tenantId: number): Promise<DeliveryLog[]> {
  return db.select().from(deliveryLogs)
    .where(eq(deliveryLogs.tenantId, tenantId))
    .orderBy(desc(deliveryLogs.createdAt)).limit(limit).offset(offset);
}

export async function getDeliveryStats(tenantId: number): Promise<{
  total: number;
  completed: number;
  failed: number;
  pending: number;
  emailsSent: number;
  todayCount: number;
}> {
  const all = await db.select().from(deliveryLogs).where(eq(deliveryLogs.tenantId, tenantId));
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

export async function getDeliveryByStripePayment(paymentId: string, tenantId: number): Promise<DeliveryLog | null> {
  if (!paymentId || !Number.isSafeInteger(tenantId) || tenantId <= 0) return null;
  const [log] = await db.select().from(deliveryLogs).where(and(
    eq(deliveryLogs.stripePaymentId, paymentId),
    eq(deliveryLogs.tenantId, tenantId),
  )).limit(1);
  return log || null;
}
