import { db } from "./db";
import { deliveryLogs } from "@shared/schema";
import { eq, and, desc, sql } from "drizzle-orm";
import { uploadAndShare, uploadToDrive } from "./google-drive";
import { isEmailConfigured, getPrimaryInboxId, sendEmail } from "./email";
import { signUploadUrl } from "./upload-signing";
import { ssrfSafeUrl } from "./lib/ssrf-jail";
import { scanForSecrets, scanFileForSecrets, isLikelyTextPath, summarizeReport, type ScanReport } from "./lib/secret-scan";
import type { DeliveryLog } from "@shared/schema";
import fs from "node:fs";
import path from "node:path";

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
  }, deliveryId);
}

function publishOneFileToOwnServer(file: { fileName: string; filePath?: string; fileData?: Buffer }, deliveryId: number): string | null {
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
      const ADMIN_TENANT = 1;
      const REQUESTED_TTL_MS = 90 * 24 * 60 * 60 * 1000; // clamped to MAX_TTL_MS (7d) by the signer
      const signed = signUploadUrl(publicName, ADMIN_TENANT, REQUESTED_TTL_MS);
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
  /** Per-file results when additionalFiles was provided. */
  bundleFiles?: BundleFileResult[];
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
    metadata: req.metadata || null,
  }).returning({ id: deliveryLogs.id });
  return row.id;
}

async function updateDeliveryLog(id: number, updates: Partial<DeliveryLog>) {
  await db.update(deliveryLogs).set(updates).where(eq(deliveryLogs.id, id));
}

async function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function verifyShareLink(url: string): Promise<boolean> {
  try {
    // R98.22+sec — jail the URL before HEAD-fetching, and switch redirect
    // mode from "follow" → "error" so a redirect to an internal IP can't
    // bypass the jail. Previously this was a raw `fetch(url)` SSRF surface.
    const safe = await ssrfSafeUrl(url);
    if (!safe.ok) {
      console.warn(`[delivery] Link verify rejected by SSRF jail: ${safe.reason}`);
      return false;
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), LINK_VERIFY_TIMEOUT_MS);
    const resp = await fetch(safe.url.toString(), {
      method: "HEAD",
      redirect: "error",
      signal: controller.signal,
    });
    clearTimeout(timeout);
    const ok = resp.status >= 200 && resp.status < 400;
    console.log(`[delivery] Link verify ${url.substring(0, 60)}... → ${resp.status} (${ok ? "OK" : "FAIL"})`);
    return ok;
  } catch (err: any) {
    console.warn(`[delivery] Link verify failed: ${err.message}`);
    return false;
  }
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

  const orderPageLines = links.orderPageLink ? [
    ``,
    `Bookmark your order page (re-download anytime): ${links.orderPageLink}`,
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
    ...bundleTextLines,
    `All Files (Delivery Folder): ${links.folderLink}`,
    ...orderPageLines,
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
        <div style="text-align: center; margin: 16px 0 0;">
          <a href="${links.folderLink}" style="color: #2563eb; font-size: 14px; font-weight: 500;">📁 View All Files in Delivery Folder</a>
        </div>
      </div>
      ${bundleHtml}
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

  const uploadResult = await uploadToDrive({
    filePath: req.filePath,
    fileData: req.fileData,
    fileName: req.fileName,
    mimeType: req.mimeType || "application/pdf",
    customerName: req.customerName,
    share: true,
  });

  if (!uploadResult.success) {
    return { success: false, error: uploadResult.error };
  }

  // Bundle mode: upload each additional file into the SAME per-customer
  // folder created by the primary upload above. Failures here do not abort
  // the primary delivery — the customer still gets the main product, and
  // any failed bundle items are flagged in the email.
  const bundleResults: Array<{ file: BundleFile; uploadResult: any }> = [];
  if (req.additionalFiles && req.additionalFiles.length > 0 && uploadResult.customerFolderId) {
    for (const f of req.additionalFiles) {
      const r = await uploadToDrive({
        filePath: f.filePath,
        fileData: f.fileData,
        fileName: f.fileName,
        mimeType: f.mimeType || "application/octet-stream",
        parentFolderId: uploadResult.customerFolderId,
        skipSubfolder: true,
        share: true,
      });
      bundleResults.push({ file: f, uploadResult: r });
      if (!r.success) {
        console.warn(`[delivery] #${deliveryId} Bundle file failed: ${f.fileName} — ${r.error}`);
      }
    }
  }

  await updateDeliveryLog(deliveryId, {
    status: "verifying",
    driveFileId: uploadResult.fileId || null,
    driveFolderId: uploadResult.customerFolderId || null,
    folderLink: uploadResult.customerFolderLink || null,
    downloadLink: uploadResult.directDownloadLink || null,
    shareableLink: uploadResult.shareableLink || null,
  });

  const linkToVerify = uploadResult.customerFolderLink || uploadResult.shareableLink;
  let linkVerified = false;
  if (linkToVerify) {
    await sleep(1500);
    linkVerified = await verifyShareLink(linkToVerify);
    if (!linkVerified) {
      await sleep(3000);
      linkVerified = await verifyShareLink(linkToVerify);
    }
  }

  return { success: true, uploadResult, linkVerified, bundleResults };
}

export async function deliverDigitalProduct(req: DeliveryRequest): Promise<DeliveryResult> {
  // Round 27 — idempotency guard. If we've already completed delivery for
  // this stripe payment, return the prior success instead of charging the
  // customer twice in product (Drive uploads + email). Stripe webhook can
  // legitimately fire the same payment_intent.succeeded multiple times on
  // retry, and our prior code happily made a fresh delivery each time.
  if (req.stripePaymentId) {
    const [prior] = await db
      .select()
      .from(deliveryLogs)
      .where(eq(deliveryLogs.stripePaymentId, req.stripePaymentId))
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
    if (prior && (prior.status === "uploading" || prior.status === "emailing" || prior.status === "pending" || prior.status?.startsWith("retry_"))) {
      console.log(`[delivery] IDEMPOTENT-WAIT stripe=${req.stripePaymentId} → in-flight delivery #${prior.id} (status=${prior.status}); returning provisional result without restarting`);
      return {
        success: true,
        deliveryId: prior.id,
        emailSent: prior.emailSent || false,
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
        .where(eq(deliveryLogs.id, prior.id));
    }
  }

  const deliveryId = await createDeliveryLog(req);
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

      if (!result.linkVerified && attempt < MAX_RETRIES) {
        lastError = "Link verification failed — permission may not have propagated";
        console.warn(`[delivery] #${deliveryId} Link not verified on attempt ${attempt}, retrying...`);
        continue;
      }
      if (!result.linkVerified) {
        console.warn(`[delivery] #${deliveryId} Link not verified after ${attempt} attempts — proceeding anyway (file is uploaded)`);
      }

      // Stage bundle files in /uploads/ for retry/diagnostics, BEFORE email
      // so the bundleResults are available even if the customer doesn't get
      // an email (e.g. owner-only delivery).
      const bundleResults: BundleFileResult[] = (result.bundleResults || []).map(({ file, uploadResult: r }) => {
        if (!r.success) {
          return { fileName: file.fileName, description: file.description, success: false, error: r.error };
        }
        publishOneFileToOwnServer({ fileName: file.fileName, filePath: file.filePath, fileData: file.fileData }, deliveryId);
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
          await updateDeliveryLog(deliveryId, {
            emailSent: true,
            emailMessageId: (emailResult as any)?.id || (emailResult as any)?.messageId || null,
          });
          console.log(`[delivery] #${deliveryId} Email sent to ${redactEmail(req.customerEmail)}`);
        } catch (emailErr: any) {
          console.error(`[delivery] #${deliveryId} Email failed (delivery still succeeded): ${emailErr.message}`);
          await updateDeliveryLog(deliveryId, { errorMessage: `Email failed: ${emailErr.message}` });
        }
      }

      await updateDeliveryLog(deliveryId, {
        status: "completed",
        completedAt: new Date(),
      });

      console.log(`[delivery] #${deliveryId} COMPLETED: "${sanitizeDisplayField(req.productName, 80)}" → ${redactName(req.customerName)} (email: ${emailSent}, verified: ${result.linkVerified}, attempts: ${attempt})`);

      // Attention Bus v0: publish completion event (low salience by default).
      try {
        const { emitEvent } = await import("./event-bus");
        await emitEvent({
          type: "delivery.completed",
          source: "delivery-pipeline",
          tenantId: 1,
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
      tenantId: 1,
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

  console.log(`[delivery] Manual retry #${deliveryId}: ${log.productName}`);
  await updateDeliveryLog(deliveryId, { status: "retrying", errorMessage: null });

  const filePath = `uploads/${log.fileName}`;
  return deliverDigitalProduct({
    tenantId: log.tenantId,
    customerName: log.customerName,
    customerEmail: log.customerEmail || undefined,
    productName: log.productName,
    fileName: log.fileName,
    filePath,
    orderId: log.orderId || undefined,
    stripePaymentId: log.stripePaymentId || undefined,
    metadata: (log.metadata as Record<string, any>) || undefined,
  });
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
