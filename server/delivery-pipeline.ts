import { db } from "./db";
import { deliveryLogs } from "@shared/schema";
import { eq, desc, sql } from "drizzle-orm";
import { uploadAndShare, uploadToDrive } from "./google-drive";
import { isEmailConfigured, getPrimaryInboxId, sendEmail } from "./email";
import type { DeliveryLog } from "@shared/schema";

const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 5000;
const LINK_VERIFY_TIMEOUT_MS = 8000;
const ADMIN_ALERT_EMAIL = process.env.ADMIN_ALERT_EMAIL || "";

function escapeHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

export interface DeliveryRequest {
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
}

export interface DeliveryResult {
  success: boolean;
  deliveryId: number;
  downloadLink?: string;
  folderLink?: string;
  shareableLink?: string;
  emailSent?: boolean;
  linkVerified?: boolean;
  attempts?: number;
  error?: string;
}

async function createDeliveryLog(req: DeliveryRequest): Promise<number> {
  const [row] = await db.insert(deliveryLogs).values({
    orderId: req.orderId || null,
    customerName: req.customerName,
    customerEmail: req.customerEmail || null,
    productName: req.productName,
    fileName: req.fileName,
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
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), LINK_VERIFY_TIMEOUT_MS);
    const resp = await fetch(url, {
      method: "HEAD",
      redirect: "follow",
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
      subject: `[ALERT] Delivery #${deliveryId} Failed — ${req.productName}`,
      text: [
        `Delivery #${deliveryId} has FAILED after ${MAX_RETRIES} retry attempts.`,
        ``,
        `Customer: ${req.customerName}`,
        `Email: ${req.customerEmail || "N/A"}`,
        `Product: ${req.productName}`,
        `File: ${req.fileName}`,
        `Order ID: ${req.orderId || "N/A"}`,
        `Stripe Payment: ${req.stripePaymentId || "N/A"}`,
        ``,
        `Error: ${error}`,
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

function buildDeliveryEmail(req: DeliveryRequest, links: { downloadLink: string; viewLink: string; folderLink: string }): { subject: string; text: string; html: string } {
  const subject = req.emailSubject || `Your order is ready: ${req.productName}`;
  const text = req.emailBody || [
    `Hi ${req.customerName},`,
    ``,
    `Your digital product "${req.productName}" is ready! Please use the links below for immediate access:`,
    ``,
    `Download Directly (PDF): ${links.downloadLink}`,
    `View PDF in Your Browser: ${links.viewLink}`,
    `All Files (Delivery Folder): ${links.folderLink}`,
    ``,
    `No login required — all links are publicly accessible.`,
    ``,
    `Thank you for your purchase!`,
    `— VisionClaw Digital Delivery`,
  ].join("\n");

  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px;">
      <div style="background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%); padding: 32px; border-radius: 12px; color: #fff; text-align: center; margin-bottom: 24px;">
        <h1 style="margin: 0 0 8px; font-size: 24px;">🦞 VisionClaw</h1>
        <p style="margin: 0; opacity: 0.8; font-size: 14px;">Your digital file is ready</p>
      </div>
      <div style="background: #f8f9fa; padding: 24px; border-radius: 8px; margin-bottom: 24px;">
        <p style="margin: 0 0 12px;">Hi <strong>${escapeHtml(req.customerName)}</strong>,</p>
        <p style="margin: 0 0 20px;">Your digital product <strong>"${escapeHtml(req.productName)}"</strong> is ready! Use the links below for immediate access:</p>
        <div style="text-align: center; margin: 24px 0;">
          <a href="${links.downloadLink}" style="display: inline-block; background: #2563eb; color: #fff; text-decoration: none; padding: 14px 32px; border-radius: 8px; font-weight: 600; font-size: 16px; margin-bottom: 12px;">⬇️ Download Directly (PDF)</a>
        </div>
        <div style="text-align: center; margin: 16px 0;">
          <a href="${links.viewLink}" style="display: inline-block; background: #059669; color: #fff; text-decoration: none; padding: 12px 28px; border-radius: 8px; font-weight: 600; font-size: 14px;">👁️ View PDF in Browser</a>
        </div>
        <div style="text-align: center; margin: 16px 0 0;">
          <a href="${links.folderLink}" style="color: #2563eb; font-size: 14px; font-weight: 500;">📁 View All Files in Delivery Folder</a>
        </div>
      </div>
      <p style="font-size: 12px; color: #999; text-align: center; margin: 0;">
        No login required — all links are publicly accessible.<br/>
        © ${new Date().getFullYear()} VisionClaw — Agentic AI Corporation
      </p>
    </div>
  `;

  return { subject, text, html };
}

async function attemptUpload(req: DeliveryRequest, deliveryId: number): Promise<{
  success: boolean;
  uploadResult?: any;
  linkVerified?: boolean;
  error?: string;
}> {
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

  return { success: true, uploadResult, linkVerified };
}

export async function deliverDigitalProduct(req: DeliveryRequest): Promise<DeliveryResult> {
  const deliveryId = await createDeliveryLog(req);
  console.log(`[delivery] #${deliveryId} Started: "${req.productName}" for ${req.customerName}`);

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

      let emailSent = false;
      if (req.sendEmail !== false && req.customerEmail && isEmailConfigured()) {
        try {
          await updateDeliveryLog(deliveryId, { status: "emailing" });
          const deliveryInboxId = await getPrimaryInboxId();
          const viewLink = uploadResult.shareableLink || (uploadResult.fileId ? `https://drive.google.com/file/d/${uploadResult.fileId}/view?usp=sharing` : "");
          const emailContent = buildDeliveryEmail(req, {
            downloadLink: uploadResult.directDownloadLink || "",
            viewLink,
            folderLink: uploadResult.customerFolderLink || "",
          });

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
          console.log(`[delivery] #${deliveryId} Email sent to ${req.customerEmail}`);
        } catch (emailErr: any) {
          console.error(`[delivery] #${deliveryId} Email failed (delivery still succeeded): ${emailErr.message}`);
          await updateDeliveryLog(deliveryId, { errorMessage: `Email failed: ${emailErr.message}` });
        }
      }

      await updateDeliveryLog(deliveryId, {
        status: "completed",
        completedAt: new Date(),
      });

      console.log(`[delivery] #${deliveryId} COMPLETED: ${req.productName} → ${req.customerName} (email: ${emailSent}, verified: ${result.linkVerified}, attempts: ${attempt})`);

      return {
        success: true,
        deliveryId,
        downloadLink: uploadResult.directDownloadLink || undefined,
        folderLink: uploadResult.customerFolderLink || undefined,
        shareableLink: uploadResult.shareableLink || undefined,
        emailSent,
        linkVerified: result.linkVerified,
        attempts: attempt,
      };
    } catch (err: any) {
      lastError = err.message || "Unknown delivery error";
      console.error(`[delivery] #${deliveryId} Attempt ${attempt} ERROR: ${lastError}`);
    }
  }

  await updateDeliveryLog(deliveryId, { status: "failed", errorMessage: `Failed after ${MAX_RETRIES} attempts: ${lastError}` });
  console.error(`[delivery] #${deliveryId} FAILED after ${MAX_RETRIES} attempts: ${lastError}`);

  sendAdminAlert(deliveryId, lastError, req).catch(() => {});

  return { success: false, deliveryId, error: lastError, attempts };
}

export async function retryDelivery(deliveryId: number, _tenantId?: number): Promise<DeliveryResult> {
  const [log] = await db.select().from(deliveryLogs).where(eq(deliveryLogs.id, deliveryId)).limit(1);
  if (!log) return { success: false, deliveryId, error: "Delivery not found" };
  if (log.status === "completed") return { success: true, deliveryId, downloadLink: log.downloadLink || undefined, folderLink: log.folderLink || undefined };

  console.log(`[delivery] Manual retry #${deliveryId}: ${log.productName}`);
  await updateDeliveryLog(deliveryId, { status: "retrying", errorMessage: null });

  const filePath = `uploads/${log.fileName}`;
  return deliverDigitalProduct({
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

export async function getDeliveryStatus(deliveryId: number, _tenantId?: number): Promise<DeliveryLog | null> {
  const [log] = await db.select().from(deliveryLogs).where(eq(deliveryLogs.id, deliveryId)).limit(1);
  return log || null;
}

export async function listDeliveries(limit = 50, offset = 0, _tenantId?: number): Promise<DeliveryLog[]> {
  return db.select().from(deliveryLogs).orderBy(desc(deliveryLogs.createdAt)).limit(limit).offset(offset);
}

export async function getDeliveryStats(_tenantId?: number): Promise<{
  total: number;
  completed: number;
  failed: number;
  pending: number;
  emailsSent: number;
  todayCount: number;
}> {
  const all = await db.select().from(deliveryLogs);
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
