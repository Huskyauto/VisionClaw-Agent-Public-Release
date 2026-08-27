/**
 * Income Products — operator admin endpoints.
 *
 * Lets the platform owner run every income-producing fulfillment pipeline
 * directly, with NO Stripe checkout and no charge:
 *   - Custom AI Research Report ($49 SKU)  → background job + PDF download
 *   - Digital product catalog              → free direct downloads
 *
 * (The AI Readiness Audit has its own admin runner in routes/audit.ts.)
 * All endpoints are double-gated: authMiddleware + admin-tenant + isAdminRequest.
 */
import type { Express, Request, Response } from "express";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { z } from "zod";
import { fulfillResearchReport } from "../research-report-fulfillment";
import { mirrorLocalState } from "../lib/local-state-durability";
import { lookupProduct, getPublicCatalog } from "../product-catalog";

interface ReportJob {
  id: string;
  status: "running" | "done" | "error";
  startedAt: number;
  finishedAt?: number;
  topic?: string;
  filePath?: string;
  fileName?: string;
  pages?: number;
  error?: string;
}

const JOBS = new Map<string, ReportJob>();
// State lives in data/local-state/ (gitignored, never synced to servable
// uploads/, and outside the boot-time uploads dotfile purge in seed.ts) so
// job/receipt state survives restarts; interrupted jobs are marked failed.
const STATE_DIR = path.join("data", "local-state");
const STORE = path.join(STATE_DIR, "income-report-jobs.json");
let loaded = false;
function loadJobs(): void {
  if (loaded) return;
  loaded = true;
  try {
    if (!fs.existsSync(STORE)) return;
    const raw = JSON.parse(fs.readFileSync(STORE, "utf-8"));
    if (!Array.isArray(raw)) return;
    for (const j of raw) {
      if (!j || typeof j.id !== "string") continue;
      if (j.status === "running") {
        j.status = "error";
        j.error = "The server restarted while this report was generating. Please run it again.";
        j.finishedAt = Date.now();
      }
      JOBS.set(j.id, j as ReportJob);
    }
  } catch (e: any) {
    console.warn("[income-admin] job store load failed (non-fatal):", e?.message);
  }
}
function saveJobs(): void {
  try {
    fs.mkdirSync(STATE_DIR, { recursive: true });
    const json = JSON.stringify([...JOBS.values()]);
    fs.writeFileSync(STORE, json);
    mirrorLocalState("income-report-jobs.json", json); // survives republish (fresh prod FS)
  } catch (e: any) {
    console.warn("[income-admin] job store save failed (non-fatal):", e?.message);
  }
}
function pruneJobs(): void {
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  for (const [k, j] of JOBS.entries()) if (j.startedAt < cutoff) JOBS.delete(k);
}

const paymentLinkBody = z.object({
  description: z.string().min(3).max(200),
  amountCents: z.number().int().min(50).max(2_000_000),
  customerEmail: z.string().email().max(320).optional().nullable(),
});

interface ReceiptRecord {
  id: string;
  receiptNo: string;
  createdAt: number;
  company: string;
  contactName: string;
  phone: string;
  email: string;
  description: string;
  amountCents: number;
  paymentMethod: "stripe" | "check";
  checkNumber?: string;
  paidDate: string;
  emailedTo: string;
  copiedTo: string | null;
  emailStatus: "sent" | "failed";
  emailError?: string;
}

const RECEIPTS: ReceiptRecord[] = [];
const RECEIPT_STORE = path.join(STATE_DIR, "income-receipts.json");
let receiptsLoaded = false;
function loadReceipts(): void {
  if (receiptsLoaded) return;
  receiptsLoaded = true;
  try {
    if (!fs.existsSync(RECEIPT_STORE)) return;
    const raw = JSON.parse(fs.readFileSync(RECEIPT_STORE, "utf-8"));
    if (Array.isArray(raw)) for (const r of raw) if (r && typeof r.id === "string") RECEIPTS.push(r as ReceiptRecord);
  } catch (e: any) {
    console.warn("[income-admin] receipt store load failed (non-fatal):", e?.message);
  }
}
function saveReceipts(): void {
  try {
    fs.mkdirSync(STATE_DIR, { recursive: true });
    const json = JSON.stringify(RECEIPTS.slice(-500));
    fs.writeFileSync(RECEIPT_STORE, json);
    mirrorLocalState("income-receipts.json", json); // survives republish (fresh prod FS)
  } catch (e: any) {
    console.warn("[income-admin] receipt store save failed (non-fatal):", e?.message);
  }
}

const receiptBody = z.object({
  company: z.string().trim().min(1).max(200),
  contactName: z.string().trim().min(1).max(200),
  phone: z.string().trim().min(3).max(50),
  email: z.string().trim().email().max(320),
  description: z.string().trim().min(3).max(300),
  amountCents: z.number().int().min(50).max(2_000_000),
  paymentMethod: z.enum(["stripe", "check"]),
  checkNumber: z.string().max(50).optional().nullable(),
  paidDate: z.string().max(30).optional().nullable(),
});

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function buildReceiptHtml(r: ReceiptRecord): string {
  const amount = `$${(r.amountCents / 100).toFixed(2)}`;
  const method = r.paymentMethod === "check"
    ? `Check${r.checkNumber ? ` #${esc(r.checkNumber)}` : ""}`
    : "Card (Stripe secure payment)";
  return `
  <div style="max-width:560px;margin:0 auto;font-family:Arial,Helvetica,sans-serif;color:#1a1a1a;border:1px solid #e2e2e2;border-radius:8px;overflow:hidden">
    <div style="background:#0f172a;color:#fff;padding:20px 24px">
      <div style="font-size:20px;font-weight:bold">Agentic Corporation</div>
      <div style="font-size:13px;opacity:.8">Payment Receipt</div>
    </div>
    <div style="padding:24px">
      <table style="width:100%;font-size:14px;border-collapse:collapse">
        <tr><td style="padding:6px 0;color:#666">Receipt #</td><td style="padding:6px 0;text-align:right;font-weight:bold">${esc(r.receiptNo)}</td></tr>
        <tr><td style="padding:6px 0;color:#666">Date paid</td><td style="padding:6px 0;text-align:right">${esc(r.paidDate)}</td></tr>
        <tr><td style="padding:6px 0;color:#666">Billed to</td><td style="padding:6px 0;text-align:right">${esc(r.company)}<br/>${esc(r.contactName)}<br/>${esc(r.email)}<br/>${esc(r.phone)}</td></tr>
        <tr><td style="padding:6px 0;color:#666">Payment method</td><td style="padding:6px 0;text-align:right">${method}</td></tr>
      </table>
      <hr style="border:none;border-top:1px solid #e2e2e2;margin:16px 0"/>
      <table style="width:100%;font-size:14px;border-collapse:collapse">
        <tr><td style="padding:6px 0">${esc(r.description)}</td><td style="padding:6px 0;text-align:right">${amount}</td></tr>
        <tr><td style="padding:10px 0;font-weight:bold;font-size:16px;border-top:2px solid #0f172a">Total paid</td><td style="padding:10px 0;text-align:right;font-weight:bold;font-size:16px;border-top:2px solid #0f172a">${amount}</td></tr>
      </table>
      <p style="font-size:12px;color:#888;margin-top:20px">Thank you for your business! Keep this receipt for your records. Questions? Just reply to this email.</p>
    </div>
  </div>`;
}

const reportBody = z.object({
  topic: z.string().min(3).max(500),
  audience: z.string().max(250).optional().nullable(),
  focus: z.string().max(350).optional().nullable(),
  depth: z.enum(["standard", "deep"]).optional(),
});

export function registerIncomeAdminRoutes(app: Express, helpers: {
  authMiddleware: any;
  getTenantFromRequest: (req: Request) => number | null | Promise<number | null>;
  isAdminRequest: (req: Request) => boolean;
  ADMIN_TENANT_ID: number;
}) {
  const { authMiddleware, getTenantFromRequest, isAdminRequest, ADMIN_TENANT_ID } = helpers;
  loadJobs();
  loadReceipts();

  async function requireAdmin(req: Request, res: Response): Promise<number | null> {
    const tenantId = await getTenantFromRequest(req);
    if (tenantId === null || tenantId !== ADMIN_TENANT_ID || !isAdminRequest(req)) {
      res.status(403).json({ error: "Admin access required" });
      return null;
    }
    return tenantId;
  }

  // ---- Custom AI Research Report (free admin run) -------------------------
  app.post("/api/admin/income/research-report", authMiddleware, async (req: Request, res: Response) => {
    const tenantId = await requireAdmin(req, res);
    if (tenantId === null) return;
    const parsed = reportBody.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "A topic (3+ characters) is required." });
    pruneJobs();
    for (const j of JOBS.values()) {
      if (j.status === "running") {
        return res.status(409).json({ error: "A research report is already generating. Wait for it to finish.", jobId: j.id });
      }
    }
    const { topic, audience, focus, depth } = parsed.data;
    const jobId = crypto.randomUUID();
    const job: ReportJob = { id: jobId, status: "running", startedAt: Date.now(), topic };
    JOBS.set(jobId, job);
    saveJobs();
    fulfillResearchReport({
      intake: { topic, audience: audience || undefined, focus: focus || undefined, depth: depth || "standard" },
      customerEmail: process.env.OWNER_ALERT_EMAIL || process.env.OWNER_EMAIL || "operator@visionclaw",
      orderId: `manual-${jobId.slice(0, 8)}`,
      tenantId,
    }).then((result) => {
      job.finishedAt = Date.now();
      if (result.success && result.filePath) {
        job.status = "done";
        job.filePath = result.filePath;
        job.fileName = result.fileName;
        job.pages = result.pages;
      } else {
        job.status = "error";
        job.error = result.error || "PDF generation failed";
      }
      saveJobs();
    }).catch((err: any) => {
      job.finishedAt = Date.now();
      job.status = "error";
      job.error = err?.message?.slice(0, 300) || "unknown error";
      saveJobs();
    });
    res.json({ jobId, status: "running" });
  });

  app.get("/api/admin/income/research-report/:jobId", authMiddleware, async (req: Request, res: Response) => {
    const tenantId = await requireAdmin(req, res);
    if (tenantId === null) return;
    const job = JOBS.get(String(req.params.jobId));
    if (!job) return res.status(404).json({ error: "Job not found (jobs are kept for 24h)." });
    res.json({
      jobId: job.id,
      status: job.status,
      topic: job.topic,
      startedAt: new Date(job.startedAt).toISOString(),
      finishedAt: job.finishedAt ? new Date(job.finishedAt).toISOString() : null,
      pages: job.pages ?? null,
      fileName: job.fileName ?? null,
      error: job.error ?? null,
    });
  });

  app.get("/api/admin/income/research-report/:jobId/download", authMiddleware, async (req: Request, res: Response) => {
    const tenantId = await requireAdmin(req, res);
    if (tenantId === null) return;
    const job = JOBS.get(String(req.params.jobId));
    if (!job || job.status !== "done" || !job.filePath) {
      return res.status(404).json({ error: "PDF not ready or job not found." });
    }
    const uploadsRoot = path.resolve(process.cwd(), "uploads") + path.sep;
    const resolved = path.resolve(process.cwd(), job.filePath);
    if (!resolved.startsWith(uploadsRoot)) {
      return res.status(404).json({ error: "PDF file not found on disk." });
    }
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${(job.fileName || "research-report.pdf").replace(/[^a-zA-Z0-9._-]/g, "_")}"`);
    const stream = fs.createReadStream(resolved);
    stream.on("error", (err: any) => {
      console.error("[income-admin] report download stream failed:", err?.message);
      if (!res.headersSent) {
        res.status(err?.code === "ENOENT" ? 404 : 500).json({ error: "PDF could not be read from disk." });
      } else {
        res.destroy();
      }
    });
    stream.pipe(res);
  });

  // ---- Get Paid: payment links for work delivered up-front ----------------
  // The operator delivers the report/product first (free admin run), then
  // mints a Stripe payment link to email the customer. Metadata marks it as
  // manual-collection so the delivery webhook does NOT try to auto-fulfill
  // (no bundle_sku → webhook refuses delivery by design; money just lands).
  app.post("/api/admin/income/payment-link", authMiddleware, async (req: Request, res: Response) => {
    const tenantId = await requireAdmin(req, res);
    if (tenantId === null) return;
    const parsed = paymentLinkBody.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Need a description (3+ chars) and an amount between $0.50 and $20,000." });
    }
    const { description, amountCents, customerEmail } = parsed.data;
    try {
      const { getUncachableStripeClient, withLedgerIdempotency } = await import("../stripeClient");
      const stripe = await getUncachableStripeClient();
      const linkKey = crypto.randomUUID().slice(0, 18);
      const price = await stripe.prices.create({
        currency: "usd",
        unit_amount: amountCents,
        product_data: { name: description.slice(0, 200) },
      }, withLedgerIdempotency({ idempotencyKey: `vc-manual-price-${linkKey}` }));
      const link = await stripe.paymentLinks.create({
        line_items: [{ price: price.id, quantity: 1 }],
        metadata: {
          kind: "manual-collection",
          delivered_up_front: "true",
          created_by: "income-admin",
          ...(customerEmail ? { intended_customer: customerEmail } : {}),
        },
      }, withLedgerIdempotency({ idempotencyKey: `vc-manual-paylink-${linkKey}` }));
      res.json({
        url: link.url,
        amountCents,
        description,
        emailSubject: `Payment link — ${description}`,
        emailBody: [
          `Hi${customerEmail ? "" : " there"},`,
          ``,
          `Great working with you! As discussed, here is the secure payment link for "${description}" ($${(amountCents / 100).toFixed(2)}):`,
          ``,
          link.url,
          ``,
          `You can pay by card, Apple Pay, or Google Pay — it takes under a minute.`,
          `If you'd rather pay by check, just reply to this email and I'll send you the mailing details.`,
          ``,
          `Thank you!`,
        ].join("\n"),
      });
    } catch (err: any) {
      console.error("[income-admin] payment link failed:", err?.message);
      res.status(500).json({ error: `Could not create the payment link: ${err?.message?.slice(0, 200) || "unknown error"}` });
    }
  });

  // ---- Receipts: emailed to the customer + duplicate copy to the owner ----
  app.post("/api/admin/income/receipt", authMiddleware, async (req: Request, res: Response) => {
    const tenantId = await requireAdmin(req, res);
    if (tenantId === null) return;
    const parsed = receiptBody.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Receipt needs company, contact name, phone, a valid email, description, and an amount between $0.50 and $20,000." });
    }
    const d = parsed.data;
    const ownerEmail = process.env.OWNER_ALERT_EMAIL || process.env.OWNER_EMAIL || null;
    const receipt: ReceiptRecord = {
      id: crypto.randomUUID(),
      receiptNo: `VC-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}-${crypto.randomUUID().slice(0, 4).toUpperCase()}`,
      createdAt: Date.now(),
      company: d.company.trim(),
      contactName: d.contactName.trim(),
      phone: d.phone.trim(),
      email: d.email.trim(),
      description: d.description.trim(),
      amountCents: d.amountCents,
      paymentMethod: d.paymentMethod,
      checkNumber: d.checkNumber?.trim() || undefined,
      paidDate: d.paidDate?.trim() || new Date().toISOString().slice(0, 10),
      emailedTo: d.email.trim(),
      copiedTo: ownerEmail,
      emailStatus: "sent",
    };
    const html = buildReceiptHtml(receipt);
    const amount = `$${(receipt.amountCents / 100).toFixed(2)}`;
    const subject = `Receipt ${receipt.receiptNo} — ${amount} — ${receipt.description.slice(0, 80)}`;
    const text = [
      `RECEIPT ${receipt.receiptNo}`,
      `Date paid: ${receipt.paidDate}`,
      `Billed to: ${receipt.company} / ${receipt.contactName} / ${receipt.email} / ${receipt.phone}`,
      `Payment method: ${receipt.paymentMethod === "check" ? `Check${receipt.checkNumber ? " #" + receipt.checkNumber : ""}` : "Card (Stripe)"}`,
      ``,
      `${receipt.description} — ${amount}`,
      `TOTAL PAID: ${amount}`,
      ``,
      `Thank you for your business!`,
    ].join("\n");
    try {
      const { sendEmailDirect } = await import("../email");
      await sendEmailDirect({
        to: receipt.email,
        ...(ownerEmail ? { bcc: ownerEmail } : {}),
        subject,
        text,
        html,
      });
    } catch (err: any) {
      receipt.emailStatus = "failed";
      receipt.emailError = err?.message?.slice(0, 300) || "unknown email error";
      console.error("[income-admin] receipt email failed:", err?.message);
    }
    RECEIPTS.push(receipt);
    saveReceipts();
    if (receipt.emailStatus === "failed") {
      return res.status(502).json({ error: `Receipt was saved, but the email could not be sent: ${receipt.emailError}`, receipt });
    }
    res.json({ receipt });
  });

  app.get("/api/admin/income/receipts", authMiddleware, async (req: Request, res: Response) => {
    const tenantId = await requireAdmin(req, res);
    if (tenantId === null) return;
    res.json({ receipts: RECEIPTS.slice(-50).reverse() });
  });

  // ---- Digital products (free admin downloads) ----------------------------
  app.get("/api/admin/income/products", authMiddleware, async (req: Request, res: Response) => {
    const tenantId = await requireAdmin(req, res);
    if (tenantId === null) return;
    const catalog = getPublicCatalog();
    // Enrich with per-file download descriptors (index-based, server-defined paths only).
    const products = catalog.map((p) => {
      const full = lookupProduct(p.sku);
      const files: { index: number; fileName: string; description?: string }[] = [];
      if (full?.primary) files.push({ index: 0, fileName: full.primary.fileName });
      (full?.additionalFiles || []).forEach((f, i) => files.push({ index: i + 1, fileName: f.fileName, description: f.description }));
      return { ...p, files };
    });
    res.json({ products });
  });

  app.get("/api/admin/income/products/:sku/download/:fileIndex", authMiddleware, async (req: Request, res: Response) => {
    const tenantId = await requireAdmin(req, res);
    if (tenantId === null) return;
    const product = lookupProduct(String(req.params.sku));
    if (!product) return res.status(404).json({ error: "Unknown product." });
    const idx = Number(req.params.fileIndex);
    const files = [
      ...(product.primary ? [{ fileName: product.primary.fileName, filePath: product.primary.filePath, mimeType: product.primary.mimeType }] : []),
      ...(product.additionalFiles || []),
    ];
    if (!Number.isInteger(idx) || idx < 0 || idx >= files.length) {
      return res.status(404).json({ error: "Unknown file." });
    }
    const file = files[idx];
    if (!file.filePath) return res.status(404).json({ error: "File not available." });
    // Paths come exclusively from the server-defined catalog; still confine to project root.
    const root = process.cwd() + path.sep;
    const resolved = path.resolve(process.cwd(), file.filePath);
    if (!resolved.startsWith(root)) return res.status(404).json({ error: "File not available." });
    res.setHeader("Content-Type", file.mimeType || "application/octet-stream");
    res.setHeader("Content-Disposition", `attachment; filename="${file.fileName.replace(/[^a-zA-Z0-9._-]/g, "_")}"`);
    const stream = fs.createReadStream(resolved);
    stream.on("error", (err: any) => {
      console.error("[income-admin] product download stream failed:", err?.message);
      if (!res.headersSent) {
        res.status(err?.code === "ENOENT" ? 404 : 500).json({ error: "File could not be read from disk." });
      } else {
        res.destroy();
      }
    });
    stream.pipe(res);
  });
}
