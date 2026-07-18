import type { Express, Request, Response } from "express";
import { db } from "../db";
import { sql } from "drizzle-orm";
import crypto from "crypto";
import fs from "fs/promises";
import path from "path";
import { z } from "zod";
import { sendEmailDirect } from "../email";
import { pinThrottleCheck, pinThrottleRecord } from "../lib/pin-throttle";
import { enforceBotProtection } from "../lib/bot-protection";

const PLATFORM_OWNER_TENANT_ID = 1;
const UPLOAD_ROOT = path.resolve(process.cwd(), "uploads", "archive-rescue");
const MAX_DEMO_FILES = 5;
const MAX_FILE_BYTES = 6 * 1024 * 1024;

const TIER_QUOTAS: Record<string, number> = {
  demo: 5,
  starter: 500,
  standard: 2_500,
  pro: 10_000,
};

const RATE_BUCKETS = new Map<string, { count: number; resetAt: number }>();
const RATE_BUCKET_MAX = 50_000;
function pruneRateBuckets(): void {
  const now = Date.now();
  for (const [k, v] of RATE_BUCKETS.entries()) if (v.resetAt < now) RATE_BUCKETS.delete(k);
  if (RATE_BUCKETS.size > RATE_BUCKET_MAX) {
    const over = RATE_BUCKETS.size - RATE_BUCKET_MAX;
    let i = 0;
    for (const k of RATE_BUCKETS.keys()) { if (i++ >= over) break; RATE_BUCKETS.delete(k); }
  }
}
setInterval(pruneRateBuckets, 10 * 60 * 1000).unref();
function rateOk(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  const b = RATE_BUCKETS.get(key);
  if (!b || b.resetAt < now) { RATE_BUCKETS.set(key, { count: 1, resetAt: now + windowMs }); return true; }
  b.count += 1;
  return b.count <= limit;
}
function hashIp(req: Request): string {
  const ip = req.ip || "unknown";
  return crypto.createHash("sha256").update(ip).digest("hex").slice(0, 16);
}
function ownerEmail(): string | null {
  return process.env.OWNER_ALERT_EMAIL || process.env.OWNER_EMAIL || process.env.SITE_OWNER_EMAIL || process.env.SITE_CONTACT_EMAIL || null;
}

const demoBody = z.object({
  orgName: z.string().min(2).max(200),
  orgType: z.enum(["museum", "law-firm", "historical-society", "other"]).default("other"),
  contactEmail: z.string().email().max(320),
  contactName: z.string().max(200).optional().nullable(),
  notes: z.string().max(2000).optional().nullable(),
});

const checkoutBody = z.object({
  tier: z.enum(["starter", "standard", "pro"]),
  contactEmail: z.string().email().max(320),
  orgName: z.string().min(2).max(200),
  orgType: z.enum(["museum", "law-firm", "historical-society", "other"]).default("other"),
});

async function runOcrInBackground(orderId: number, imagePaths: string[]): Promise<void> {
  try {
    const { default: Anthropic } = await import("@anthropic-ai/sdk");
    if (!process.env.ANTHROPIC_API_KEY) {
      console.warn(`[archive-rescue] order ${orderId}: ANTHROPIC_API_KEY missing, skipping OCR`);
      await db.execute(sql`UPDATE archive_rescue_orders SET status = 'ocr_failed', updated_at = NOW() WHERE id = ${orderId} AND tenant_id = ${PLATFORM_OWNER_TENANT_ID}`).catch(() => {});
      return;
    }
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const sections: string[] = [];
    for (let i = 0; i < imagePaths.length; i++) {
      const p = imagePaths[i];
      try {
        const buf = await fs.readFile(p);
        if (buf.length > 5 * 1024 * 1024) {
          sections.push(`--- Page ${i + 1} (${path.basename(p)}) ---\n[SKIPPED: file too large for OCR; resize upstream]`);
          continue;
        }
        const ext = p.toLowerCase().endsWith(".png") ? "image/png" : "image/jpeg";
        const resp = await client.messages.create({
          model: "claude-sonnet-4-20250514",
          max_tokens: 4000,
          messages: [{
            role: "user",
            content: [
              { type: "image", source: { type: "base64", media_type: ext, data: buf.toString("base64") } },
              { type: "text", text: "Transcribe ALL printed text on this page verbatim. Preserve columns. Mark unreadable as [?]. Return ONLY the transcribed text." },
            ],
          }],
        });
        const text = (resp.content as any[]).filter(c => c.type === "text").map(c => c.text).join("");
        sections.push(`--- Page ${i + 1} (${path.basename(p)}) ---\n${text}`);
      } catch (e: any) {
        sections.push(`--- Page ${i + 1} (${path.basename(p)}) ---\n[OCR ERROR: ${e?.message || "unknown"}]`);
      }
    }
    const summary = sections.join("\n\n");
    await db.execute(sql`UPDATE archive_rescue_orders SET demo_ocr_summary = ${summary}, status = 'demo_delivered', updated_at = NOW() WHERE id = ${orderId} AND tenant_id = ${PLATFORM_OWNER_TENANT_ID}`);
    const to = ownerEmail();
    if (to) {
      const orderRes: any = await db.execute(sql`SELECT org_name, contact_email, contact_name, org_type, notes FROM archive_rescue_orders WHERE id = ${orderId} AND tenant_id = ${PLATFORM_OWNER_TENANT_ID}`);
      const o = ((orderRes.rows || orderRes) as any[])[0] || {};
      const lines = [
        `Archive Rescue demo request — OCR complete`,
        ``,
        `Org:     ${o.org_name} (${o.org_type})`,
        `Contact: ${o.contact_name || "—"} <${o.contact_email}>`,
        `Notes:   ${o.notes || "—"}`,
        ``,
        `Order #${orderId}, ${imagePaths.length} pages OCR'd.`,
        `Reply to customer with the transcript below + a portal sample.`,
        ``,
        `═══════════════════════════════════════════`,
        summary.slice(0, 50_000),
      ];
      await sendEmailDirect({ to, subject: `[ARCHIVE RESCUE DEMO] ${o.org_name} — ${imagePaths.length} pages OCR'd`, text: lines.join("\n") }).catch((e: any) =>
        console.warn(`[archive-rescue] owner-notify failed: ${e?.message}`)
      );
    }
  } catch (e: any) {
    console.error(`[archive-rescue] background OCR failed for order ${orderId}:`, e?.message);
    await db.execute(sql`UPDATE archive_rescue_orders SET status = 'ocr_failed', updated_at = NOW() WHERE id = ${orderId} AND tenant_id = ${PLATFORM_OWNER_TENANT_ID}`).catch(() => {});
    const to = ownerEmail();
    if (to) {
      sendEmailDirect({ to, subject: `[ARCHIVE RESCUE] OCR FAILED for order #${orderId}`, text: `Background OCR threw for order #${orderId}: ${e?.message || "unknown"}\n\nFollow up manually — customer is still waiting.` }).catch(() => {});
    }
  }
}

// R125+13.16+sec2 — guard against NaN. `Number("abc")` returns NaN, which
// makes every `usedToday >= OCR_DAILY_CAP` check fail-open and lets the demo
// cap be silently bypassed if the env var is mis-set.
const OCR_DAILY_CAP_RAW = parseInt(process.env.ARCHIVE_RESCUE_OCR_DAILY_CAP || "100", 10);
const OCR_DAILY_CAP = Number.isFinite(OCR_DAILY_CAP_RAW) && OCR_DAILY_CAP_RAW > 0 ? OCR_DAILY_CAP_RAW : 100;
// R125+13.16+sec2 architect HIGH: do NOT count `ocr_failed` against the daily
// cap — when Anthropic OCR is down/rate-limited, every retry would otherwise
// burn the quota and lock out legitimate demos for the rest of the 24h window.
// Cap reflects *delivered value*, not *system load*.
async function dailyOcrUsedToday(): Promise<number> {
  const r: any = await db.execute(sql`SELECT COUNT(*)::int AS n FROM archive_rescue_orders WHERE tenant_id = ${PLATFORM_OWNER_TENANT_ID} AND status IN ('demo_requested','demo_delivered') AND created_at >= NOW() - INTERVAL '24 hours'`);
  const rows = (r.rows || r) as any[];
  return Number(rows[0]?.n || 0);
}
async function emailRecentlyUsedDemo(emailLower: string): Promise<boolean> {
  const r: any = await db.execute(sql`SELECT 1 FROM archive_rescue_orders WHERE tenant_id = ${PLATFORM_OWNER_TENANT_ID} AND LOWER(contact_email) = ${emailLower} AND created_at >= NOW() - INTERVAL '24 hours' LIMIT 1`);
  const rows = (r.rows || r) as any[];
  return rows.length > 0;
}

interface Helpers {
  upload: any;
  getTenantFromRequest: (req: Request) => number | null;
}

export function registerArchiveRescueRoutes(app: Express, helpers: Helpers) {
  const { upload, getTenantFromRequest } = helpers;

  app.get("/api/public/archive-rescue/products", async (_req: Request, res: Response) => {
    try {
      const result: any = await db.execute(sql`
        SELECT p.id AS product_id, p.name AS product_name, p.description AS product_description, p.metadata AS product_metadata,
               pr.id AS price_id, pr.unit_amount, pr.currency, pr.recurring
        FROM stripe.products p
        LEFT JOIN stripe.prices pr ON pr.product = p.id AND pr.active = true
        WHERE p.active = true AND p.metadata->>'kind' = 'archive-rescue'
        ORDER BY (p.metadata->>'canonical' = 'true') DESC NULLS LAST, pr.unit_amount ASC NULLS LAST, p.id ASC
      `);
      const rows = (result.rows || result) as any[];
      const products = rows.map((r) => ({
        id: r.product_id,
        name: r.product_name,
        description: r.product_description ?? null,
        tier: String((r.product_metadata && r.product_metadata.tier) || "").toLowerCase() || "unknown",
        priceId: r.price_id ?? null,
        unitAmountCents: r.unit_amount == null ? null : Number(r.unit_amount),
        currency: r.currency ?? null,
        mode: r.recurring ? "subscription" : "payment",
      }));
      res.setHeader("Cache-Control", "public, max-age=60");
      res.json({ generatedAt: new Date().toISOString(), count: products.length, products });
    } catch (err: any) {
      console.error("[archive-rescue] products fetch failed:", err?.message);
      res.status(500).json({ error: "products fetch failed" });
    }
  });

  app.post("/api/public/archive-rescue/demo", upload.array("photos", MAX_DEMO_FILES), async (req: any, res: Response) => {
    // R125+13.16+sec2 — unified cleanup. Multer writes temp files to disk
    // BEFORE the handler runs, so every early return (bad payload, oversize,
    // wrong mime, rate-limit, dedup, cap) leaves temp files behind. Track
    // every path we touch and unlink on any non-success exit.
    const tempPathsToCleanup = new Set<string>();
    let orderDirToCleanup: string | null = null;
    let success = false;
    try {
      const rawFiles: any[] = Array.isArray(req.files) ? req.files : [];
      for (const f of rawFiles) if (f?.path) tempPathsToCleanup.add(f.path);

      const parsed = demoBody.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: "invalid payload", issues: parsed.error.format() });
      const body = parsed.data;
      const ipHash = hashIp(req);
      const ua = String(req.headers["user-agent"] || "").slice(0, 512);
      if (!rateOk(`${ipHash}:demo`, 3, 60 * 60 * 1000)) return res.status(429).json({ error: "rate limited; try again in 1 hour" });

      // Honeypot + Turnstile (fails open until keys configured). Anonymous file
      // upload + OCR is expensive, so proof-of-human gates it once keys are set.
      // Multer has already parsed text fields into req.body at this point.
      if (!(await enforceBotProtection(req, res, { requireTurnstile: true }))) return;

      const emailLower = body.contactEmail.trim().toLowerCase();

      // Validate inputs BEFORE acquiring the lock so we don't hold a transaction during disk I/O
      const files: any[] = rawFiles;
      if (files.length === 0) return res.status(400).json({ error: "at least 1 photo required" });
      if (files.length > MAX_DEMO_FILES) return res.status(400).json({ error: `max ${MAX_DEMO_FILES} photos per demo` });
      for (const f of files) {
        if (f.size > MAX_FILE_BYTES) return res.status(400).json({ error: `file ${f.originalname} exceeds ${MAX_FILE_BYTES / 1024 / 1024}MB` });
        const ct = String(f.mimetype || "").toLowerCase();
        if (!ct.startsWith("image/")) return res.status(400).json({ error: `file ${f.originalname} is not an image` });
      }

      await fs.mkdir(UPLOAD_ROOT, { recursive: true });
      const orderTmp = `demo-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;
      const orderDir = path.resolve(UPLOAD_ROOT, orderTmp);
      const orderDirSep = orderDir + path.sep;
      if (!orderDir.startsWith(UPLOAD_ROOT + path.sep)) return res.status(500).json({ error: "path resolution error" });
      await fs.mkdir(orderDir, { recursive: true });
      orderDirToCleanup = orderDir;
      const savedPaths: string[] = [];
      for (let i = 0; i < files.length; i++) {
        const f = files[i];
        const safeName = `page-${i + 1}-${String(f.originalname || "img").replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 80)}`;
        const dest = path.resolve(orderDir, safeName);
        if (!dest.startsWith(orderDirSep)) continue;
        await fs.rename(f.path, dest);
        tempPathsToCleanup.delete(f.path); // moved successfully
        savedPaths.push(dest);
      }

      // R125+13.12+sec: atomic dedup + cap + insert under pg advisory xact lock.
      // Single global key (42) serializes the free-demo path so the SELECT/INSERT race
      // can't oversubscribe the cap or let two concurrent same-email requests both pass.
      // Free-demo is low-QPS (cap is 100/day) so serializing is fine.
      const txResult = await db.transaction(async (tx: any) => {
        await tx.execute(sql`SELECT pg_advisory_xact_lock(42)`);
        const dupRes: any = await tx.execute(sql`SELECT 1 FROM archive_rescue_orders WHERE tenant_id = ${PLATFORM_OWNER_TENANT_ID} AND LOWER(contact_email) = ${emailLower} AND created_at >= NOW() - INTERVAL '24 hours' LIMIT 1`);
        if (((dupRes.rows || dupRes) as any[]).length > 0) {
          return { kind: "duplicate" as const };
        }
        // R125+13.16+sec3 (architect): the transactional cap check MUST
        // exclude 'ocr_failed' to match dailyOcrUsedToday() — cap reflects
        // delivered value, not system load. Including ocr_failed would let an
        // Anthropic outage burn the quota and lock out legitimate demos.
        const capRes: any = await tx.execute(sql`SELECT COUNT(*)::int AS n FROM archive_rescue_orders WHERE tenant_id = ${PLATFORM_OWNER_TENANT_ID} AND status IN ('demo_requested','demo_delivered') AND created_at >= NOW() - INTERVAL '24 hours'`);
        const usedToday = Number(((capRes.rows || capRes) as any[])[0]?.n || 0);
        if (usedToday >= OCR_DAILY_CAP) {
          return { kind: "cap_hit" as const, usedToday };
        }
        const insertRes: any = await tx.execute(sql`
          INSERT INTO archive_rescue_orders (
            tenant_id, org_name, org_type, contact_email, contact_name,
            tier, status, pages_quota, demo_image_paths, notes, ip_hash, user_agent
          ) VALUES (
            ${PLATFORM_OWNER_TENANT_ID}, ${body.orgName}, ${body.orgType}, ${body.contactEmail}, ${body.contactName ?? null},
            'demo', 'demo_requested', ${TIER_QUOTAS.demo}, ${`{${savedPaths.map(p => `"${p.replace(/"/g, '\\"')}"`).join(",")}}`}::text[], ${body.notes ?? null}, ${ipHash}, ${ua}
          )
          RETURNING id, created_at
        `);
        const row = ((insertRes.rows || insertRes) as any[])[0];
        return { kind: "ok" as const, row };
      });

      // R125+13.12+sec2: on rejection paths, the unified finally{} cleans up
      // tempPathsToCleanup + orderDirToCleanup. We just need to return the
      // correct HTTP status — no per-branch cleanup boilerplate.
      if (txResult.kind === "duplicate") {
        return res.status(429).json({ error: "this email already used a free demo in the last 24 hours; reply to your demo email to continue, or pick a paid tier" });
      }
      if (txResult.kind === "cap_hit") {
        const to = ownerEmail();
        if (to) sendEmailDirect({ to, subject: `[ARCHIVE RESCUE] daily OCR cap hit (${txResult.usedToday}/${OCR_DAILY_CAP})`, text: `Demo request from ${body.orgName} <${body.contactEmail}> declined — daily cap reached. Raise ARCHIVE_RESCUE_OCR_DAILY_CAP or investigate.` }).catch(() => {});
        return res.status(503).json({ error: "free demo capacity exhausted for today; email us at the address on our pricing page and we'll OCR your sample manually" });
      }
      const row = txResult.row;

      const to = ownerEmail();
      if (to) {
        sendEmailDirect({
          to,
          subject: `[ARCHIVE RESCUE] new demo request — ${body.orgName} (${files.length} pages)`,
          text: [
            `New Archive Rescue demo request received.`,
            ``,
            `Org:     ${body.orgName} (${body.orgType})`,
            `Contact: ${body.contactName || "—"} <${body.contactEmail}>`,
            `Pages:   ${files.length}`,
            `Notes:   ${body.notes || "—"}`,
            ``,
            `Order #${row?.id}. OCR running in background; you'll get a second email with the transcripts when complete (~2-3 min).`,
            `IP hash ${ipHash} · UA ${ua.slice(0, 80)}`,
          ].join("\n"),
        }).catch((e: any) => console.warn(`[archive-rescue] owner-notify failed: ${e?.message}`));
      }

      runOcrInBackground(row.id, savedPaths).catch(e => console.error(`[archive-rescue] bg OCR threw:`, e?.message));

      success = true; // accepted — keep orderDir + files for the background OCR worker
      return res.json({ ok: true, orderId: row.id, message: "Demo received. We'll email your OCR'd transcripts within 24 hours." });
    } catch (err: any) {
      console.error("[archive-rescue] demo capture failed:", err?.message);
      return res.status(500).json({ error: "demo capture failed" });
    } finally {
      if (!success) {
        for (const p of tempPathsToCleanup) {
          await fs.unlink(p).catch(() => {});
        }
        if (orderDirToCleanup) {
          await fs.rm(orderDirToCleanup, { recursive: true, force: true }).catch(() => {});
        }
      }
    }
  });

  app.post("/api/public/archive-rescue/checkout", async (req: Request, res: Response) => {
    try {
      const parsed = checkoutBody.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: "invalid payload", issues: parsed.error.format() });
      const body = parsed.data;
      const ipHash = hashIp(req);
      const ua = String(req.headers["user-agent"] || "").slice(0, 512);
      if (!rateOk(`${ipHash}:checkout`, 10, 10 * 60 * 1000)) return res.status(429).json({ error: "rate limited" });

      // Honeypot only — checkout is button-triggered from the pricing cards
      // (no visible widget); Stripe + rate-limit are the heavier backstops.
      if (!(await enforceBotProtection(req, res))) return;

      const priceRes: any = await db.execute(sql`
        SELECT pr.id AS price_id FROM stripe.prices pr
        JOIN stripe.products p ON p.id = pr.product
        WHERE p.active = true AND pr.active = true
          AND p.metadata->>'kind' = 'archive-rescue'
          AND p.metadata->>'tier' = ${body.tier}
        ORDER BY pr.unit_amount ASC LIMIT 1
      `);
      const priceRow = ((priceRes.rows || priceRes) as any[])[0];
      if (!priceRow) {
        return res.status(503).json({
          error: "checkout not yet wired",
          fallback: `Email us at ${ownerEmail() || "the contact below"} to purchase the ${body.tier} tier.`,
        });
      }

      // SECURITY: require canonical base URL in production — never trust the
      // Host header for Stripe success/cancel URLs (host-header poisoning).
      // Checked BEFORE the order INSERT so a missing-domain 500 can't orphan a row.
      const domains = process.env.REPLIT_DOMAINS || process.env.REPLIT_DEV_DOMAIN || "";
      const primaryDomain = domains.split(",")[0]?.trim();
      if (!primaryDomain && process.env.NODE_ENV === "production") {
        return res.status(500).json({ error: "Checkout disabled: no canonical domain configured" });
      }
      const baseUrl = primaryDomain ? `https://${primaryDomain}` : `${req.protocol}://${req.get("host")}`;

      // R125+13.12+sec2: insert as 'checkout_initiated'; webhook flips to 'paid'
      // on verified checkout.session.completed (see server/webhookHandlers.ts).
      // Pre-fix bug marked abandoned-checkout orders as paid → polluted fulfillment queue.
      const orderRes: any = await db.execute(sql`
        INSERT INTO archive_rescue_orders (
          tenant_id, org_name, org_type, contact_email, tier, status,
          pages_quota, ip_hash, user_agent
        ) VALUES (
          ${PLATFORM_OWNER_TENANT_ID}, ${body.orgName}, ${body.orgType}, ${body.contactEmail},
          ${body.tier}, 'checkout_initiated', ${TIER_QUOTAS[body.tier]}, ${ipHash}, ${ua}
        ) RETURNING id
      `);
      const orderId = ((orderRes.rows || orderRes) as any[])[0]?.id;

      const { getUncachableStripeClient, buildCheckoutIdempotencyKey } = await import("../stripeClient");
      const { anonymousVisitorPartition } = await import("../anonymousVisitorPartition");
      const stripe = await getUncachableStripeClient();
      const isSubscription = body.tier === "pro";

      const sessionData: any = {
        payment_method_types: ["card"],
        line_items: [{ price: priceRow.price_id, quantity: 1 }],
        mode: isSubscription ? "subscription" : "payment",
        customer_email: body.contactEmail,
        success_url: `${baseUrl}/archive-rescue?status=success&order=${orderId}`,
        cancel_url: `${baseUrl}/archive-rescue?status=cancelled`,
        metadata: { kind: "archive-rescue", tier: body.tier, archiveRescueOrderId: String(orderId) },
      };
      const tenantId = getTenantFromRequest(req);
      const partition: number | string = tenantId ?? anonymousVisitorPartition(req);
      const session = await stripe.checkout.sessions.create(sessionData, {
        idempotencyKey: buildCheckoutIdempotencyKey(partition, sessionData.mode, sessionData),
      });
      await db.execute(sql`UPDATE archive_rescue_orders SET stripe_session_id = ${session.id}, updated_at = NOW() WHERE id = ${orderId} AND tenant_id = ${PLATFORM_OWNER_TENANT_ID}`);

      const to = ownerEmail();
      if (to) {
        sendEmailDirect({
          to,
          subject: `[ARCHIVE RESCUE] checkout initiated — ${body.orgName} (${body.tier})`,
          text: [`${body.orgName} (${body.orgType}) started checkout for the ${body.tier} tier.`, `Contact: ${body.contactEmail}`, `Order #${orderId}, Stripe session ${session.id}.`].join("\n"),
        }).catch((e: any) => console.warn(`[archive-rescue] owner-notify failed: ${e?.message}`));
      }
      return res.json({ url: session.url, sessionId: session.id, orderId });
    } catch (err: any) {
      // R125+13.12+sec2: don't leak Stripe/internal error detail to anonymous callers.
      console.error("[archive-rescue] checkout failed:", err?.message);
      return res.status(500).json({ error: "checkout failed" });
    }
  });

  app.get("/api/admin/archive-rescue/orders", async (req: Request, res: Response) => {
    const throttle = pinThrottleCheck(req);
    if (!throttle.ok) { res.setHeader("Retry-After", String(throttle.retryAfterSec ?? 1800)); return res.status(429).json({ error: "too many PIN attempts; locked out", retryAfterSec: throttle.retryAfterSec }); }
    const pin = String(req.headers["x-admin-pin"] || "");
    const expected = process.env.ADMIN_PIN || "";
    if (!expected) return res.status(403).json({ error: "forbidden" });
    const a = Buffer.from(pin); const b = Buffer.from(expected);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) { pinThrottleRecord(req, false); return res.status(403).json({ error: "forbidden" }); }
    pinThrottleRecord(req, true);
    try {
      const result: any = await db.execute(sql`
        SELECT id, org_name, org_type, contact_email, contact_name, tier, status,
               pages_quota, pages_used, stripe_session_id, notes, created_at, updated_at, delivered_at,
               LENGTH(COALESCE(demo_ocr_summary, '')) AS demo_chars
        FROM archive_rescue_orders
        WHERE tenant_id = ${PLATFORM_OWNER_TENANT_ID}
        ORDER BY created_at DESC LIMIT 500
      `);
      const rows = (result.rows || result) as any[];
      const byStatus: Record<string, number> = {};
      const byTier: Record<string, number> = {};
      for (const r of rows) { byStatus[r.status] = (byStatus[r.status] || 0) + 1; byTier[r.tier] = (byTier[r.tier] || 0) + 1; }
      res.json({ total: rows.length, byStatus, byTier, orders: rows });
    } catch (err: any) {
      console.error("[archive-rescue] orders fetch failed:", err?.message || err);
      res.status(500).json({ error: "fetch failed" });
    }
  });

  app.post("/api/admin/archive-rescue/orders/:id/status", async (req: Request, res: Response) => {
    const throttle = pinThrottleCheck(req);
    if (!throttle.ok) { res.setHeader("Retry-After", String(throttle.retryAfterSec ?? 1800)); return res.status(429).json({ error: "too many PIN attempts; locked out", retryAfterSec: throttle.retryAfterSec }); }
    const pin = String(req.headers["x-admin-pin"] || "");
    const expected = process.env.ADMIN_PIN || "";
    if (!expected) return res.status(403).json({ error: "forbidden" });
    const a = Buffer.from(pin); const b = Buffer.from(expected);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) { pinThrottleRecord(req, false); return res.status(403).json({ error: "forbidden" }); }
    pinThrottleRecord(req, true);
    const id = parseInt(String(req.params.id), 10);
    if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ error: "invalid id" });
    const status = String(req.body?.status || "").trim();
    const VALID = ["demo_requested", "demo_delivered", "ocr_failed", "checkout_initiated", "paid", "in_progress", "delivered", "cancelled"];
    if (!VALID.includes(status)) return res.status(400).json({ error: "invalid status" });
    const notes = req.body?.notes != null ? String(req.body.notes).slice(0, 5000) : null;
    try {
      const deliveredClause = status === "delivered" ? sql`, delivered_at = NOW()` : sql``;
      const notesClause = notes != null ? sql`, notes = ${notes}` : sql``;
      await db.execute(sql`UPDATE archive_rescue_orders SET status = ${status} ${deliveredClause} ${notesClause}, updated_at = NOW() WHERE id = ${id} AND tenant_id = ${PLATFORM_OWNER_TENANT_ID}`);
      res.json({ ok: true });
    } catch (err: any) {
      console.error("[archive-rescue] order status update failed:", err?.message || err);
      res.status(500).json({ error: "update failed" });
    }
  });
}
