import type { Express, Request, Response } from "express";
import { db } from "../db";
import { sql } from "drizzle-orm";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { z } from "zod";
import { sendEmailDirect } from "../email";
import { runAudit, AuditFetchError } from "../audit-engine";
import { enforceBotProtection } from "../lib/bot-protection";
import { fulfillReadinessAudit } from "../audit-fulfillment";

const AUDIT_TENANT_ID = 1; // platform-owner storefront

// In-memory IP rate limiter (mirrors archive-rescue.ts). The /run endpoint
// makes outbound fetches, so it MUST be throttled to prevent abuse as an
// SSRF-scan amplifier or DoS vector.
const RATE_BUCKETS = new Map<string, { count: number; resetAt: number }>();
function pruneRateBuckets(): void {
  const now = Date.now();
  for (const [k, v] of RATE_BUCKETS.entries()) if (v.resetAt < now) RATE_BUCKETS.delete(k);
  if (RATE_BUCKETS.size > 50_000) {
    let i = 0;
    const over = RATE_BUCKETS.size - 50_000;
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
  // SECURITY: key off the raw TCP socket source, NOT req.ip. req.ip honors
  // X-Forwarded-For when "trust proxy" is set, so an attacker could rotate that
  // header to defeat the per-IP cap on this abuse-sensitive public endpoint.
  // The TCP source can't be spoofed. (Matches orderLookupLimiter in routes.ts.)
  const src = req.socket?.remoteAddress || req.ip || "unknown";
  return crypto.createHash("sha256").update(src).digest("hex").slice(0, 16);
}
function ownerEmail(): string | null {
  return process.env.OWNER_ALERT_EMAIL || process.env.OWNER_EMAIL || process.env.SITE_OWNER_EMAIL || process.env.SITE_CONTACT_EMAIL || null;
}

const auditRunBody = z.object({
  url: z.string().min(4).max(2000),
  email: z.string().email().max(320).optional().nullable(),
});

const CACHE_TTL_MS = 60_000;
const PDF_CACHE_TTL_MS = 300_000;
const AUDIO_CACHE_TTL_MS = 600_000;
const SAMPLE_REPORT_PATH = "attached_assets/visionclaw-self-audit-2026-05-24.md";
const SAMPLE_PDF_PATH = "attached_assets/visionclaw-self-audit-2026-05-24.pdf";
const PITCH_AUDIO_PATH = "attached_assets/audit-pitch-bob.mp3";

let productsCache: { ts: number; payload: any } | null = null;
let sampleCache: { ts: number; body: string; mtimeMs: number } | null = null;
let samplePdfCache: { ts: number; buf: Buffer; mtimeMs: number } | null = null;
let pitchAudioCache: { ts: number; buf: Buffer; mtimeMs: number } | null = null;

interface AuditProduct {
  id: string;
  name: string;
  description: string | null;
  tier: "self-serve" | "done-for-you" | "enterprise" | "unknown";
  priceId: string | null;
  unitAmountCents: number | null;
  currency: string | null;
  mode: "payment" | "subscription";
}

function classifyTier(name: string, metadata: any): AuditProduct["tier"] {
  const meta = metadata && typeof metadata === "object" ? metadata : {};
  const tierMeta = String(meta.tier || "").toLowerCase();
  if (tierMeta === "self-serve" || tierMeta === "done-for-you" || tierMeta === "enterprise") {
    return tierMeta;
  }
  const n = (name || "").toLowerCase();
  if (n.includes("self-serve") || n.includes("self serve")) return "self-serve";
  if (n.includes("done-for-you") || n.includes("done for you") || n.includes("dfy")) return "done-for-you";
  if (n.includes("enterprise")) return "enterprise";
  return "unknown";
}

export function registerAuditRoutes(app: Express) {
  app.get("/api/public/audit/products", async (_req: Request, res: Response) => {
    try {
      if (productsCache && Date.now() - productsCache.ts < CACHE_TTL_MS) {
        res.setHeader("X-Cache", "HIT");
        return res.json(productsCache.payload);
      }
      const result: any = await db.execute(sql`
        SELECT
          p.id AS product_id,
          p.name AS product_name,
          p.description AS product_description,
          p.metadata AS product_metadata,
          pr.id AS price_id,
          pr.unit_amount,
          pr.currency,
          pr.recurring
        FROM stripe.products p
        LEFT JOIN stripe.prices pr ON pr.product = p.id AND pr.active = true
        WHERE p.active = true
          AND (
            p.metadata->>'kind' = 'audit'
            OR LOWER(p.name) LIKE '%audit%'
          )
        -- R125+11: deterministic ordering when multiple active prices exist
        -- per product (e.g. historical price rows that didn't get archived,
        -- or month/annual variants). Frontend picks the FIRST match per tier;
        -- lowest unit_amount wins so we never accidentally route a customer
        -- to a higher-priced variant of the same audit tier. metadata.canonical
        -- = 'true' provides an explicit override for future flexibility.
        ORDER BY
          (p.metadata->>'canonical' = 'true') DESC NULLS LAST,
          pr.unit_amount ASC NULLS LAST,
          p.id ASC
      `);
      const rows = (result.rows || result) as any[];
      const items: AuditProduct[] = rows.map((r) => ({
        id: r.product_id,
        name: r.product_name,
        description: r.product_description ?? null,
        tier: classifyTier(r.product_name, r.product_metadata),
        priceId: r.price_id ?? null,
        unitAmountCents: r.unit_amount === null || r.unit_amount === undefined ? null : Number(r.unit_amount),
        currency: r.currency ?? null,
        mode: r.recurring ? "subscription" : "payment",
      }));
      const payload = {
        generatedAt: new Date().toISOString(),
        count: items.length,
        products: items,
      };
      productsCache = { ts: Date.now(), payload };
      res.setHeader("X-Cache", "MISS");
      res.json(payload);
    } catch (err: any) {
      console.error("[audit] products fetch failed:", err?.message);
      res.status(500).json({ error: "products fetch failed" });
    }
  });

  app.get("/api/public/audit/sample", async (_req: Request, res: Response) => {
    try {
      const safeRel = SAMPLE_REPORT_PATH.replace(/[^a-zA-Z0-9._/-]/g, "");
      const cwd = process.cwd();
      const resolved = path.resolve(cwd, safeRel);
      const cwdSep = cwd + path.sep;
      if (!resolved.startsWith(cwdSep)) {
        return res.status(403).json({ error: "forbidden" });
      }
      if (!fs.existsSync(resolved)) {
        return res.status(404).json({ error: "sample report not found" });
      }
      const stat = fs.statSync(resolved);
      if (sampleCache && sampleCache.mtimeMs === stat.mtimeMs && Date.now() - sampleCache.ts < CACHE_TTL_MS) {
        res.setHeader("X-Cache", "HIT");
        res.setHeader("Content-Type", "text/markdown; charset=utf-8");
        res.setHeader("Cache-Control", "public, max-age=60");
        return res.send(sampleCache.body);
      }
      const body = fs.readFileSync(resolved, "utf-8");
      sampleCache = { ts: Date.now(), body, mtimeMs: stat.mtimeMs };
      res.setHeader("X-Cache", "MISS");
      res.setHeader("Content-Type", "text/markdown; charset=utf-8");
      res.setHeader("Cache-Control", "public, max-age=60");
      res.send(body);
    } catch (err: any) {
      console.error("[audit] sample fetch failed:", err?.message);
      res.status(500).json({ error: "sample fetch failed" });
    }
  });

  app.get("/api/public/audit/sample.pdf", async (req: Request, res: Response) => {
    // R125+12+sec (architect MEDIUM x2 closed 2026-05-24):
    //  1. Removed existsSync→statSync→readFileSync TOCTOU race; now uses
    //     async fs.promises.stat with explicit ENOENT handling (deterministic
    //     404 instead of transient 500 if file is deleted/replaced mid-flight).
    //  2. Replaced sync readFileSync (event-loop blocking on 1.4MB under load)
    //     with async fs.promises.readFile; added ETag + Last-Modified +
    //     If-None-Match conditional GET to cut repeat-visitor bandwidth.
    try {
      const resolved = path.resolve(process.cwd(), SAMPLE_PDF_PATH);
      let stat: import("fs").Stats;
      try {
        stat = await fs.promises.stat(resolved);
      } catch (e: any) {
        if (e?.code === "ENOENT") {
          return res.status(404).json({ error: "sample pdf not found" });
        }
        throw e;
      }
      const etag = `W/"${stat.size.toString(16)}-${Math.floor(stat.mtimeMs).toString(16)}"`;
      res.setHeader("ETag", etag);
      res.setHeader("Last-Modified", stat.mtime.toUTCString());
      if (req.headers["if-none-match"] === etag) {
        return res.status(304).end();
      }
      let buf: Buffer;
      if (samplePdfCache && samplePdfCache.mtimeMs === stat.mtimeMs && Date.now() - samplePdfCache.ts < PDF_CACHE_TTL_MS) {
        buf = samplePdfCache.buf;
        res.setHeader("X-Cache", "HIT");
      } else {
        buf = await fs.promises.readFile(resolved);
        samplePdfCache = { ts: Date.now(), buf, mtimeMs: stat.mtimeMs };
        res.setHeader("X-Cache", "MISS");
      }
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Cache-Control", "public, max-age=300");
      res.setHeader("Content-Disposition", 'inline; filename="visionclaw-self-audit-2026-05-24.pdf"');
      res.setHeader("Content-Length", String(buf.length));
      res.setHeader("Accept-Ranges", "bytes");
      res.send(buf);
    } catch (err: any) {
      console.error("[audit] sample pdf fetch failed:", err?.message);
      res.status(500).json({ error: "sample pdf fetch failed" });
    }
  });

  // R125+13.2: Founder-pitch audio (Bob Washburn voice via Fish Audio clone,
  // ref 675fecd02fcc4ad28cd84ca61501ca3e, ~60s, ~920KB MP3). Same async-stat +
  // ETag/304 + Accept-Ranges pattern as sample.pdf so mobile browsers can scrub
  // and repeat-visitors don't re-download.
  app.get("/api/public/audit/pitch.mp3", async (req: Request, res: Response) => {
    try {
      const resolved = path.resolve(process.cwd(), PITCH_AUDIO_PATH);
      let stat: import("fs").Stats;
      try {
        stat = await fs.promises.stat(resolved);
      } catch (e: any) {
        if (e?.code === "ENOENT") {
          return res.status(404).json({ error: "pitch audio not found" });
        }
        throw e;
      }
      const etag = `W/"${stat.size.toString(16)}-${Math.floor(stat.mtimeMs).toString(16)}"`;
      res.setHeader("ETag", etag);
      res.setHeader("Last-Modified", stat.mtime.toUTCString());
      if (req.headers["if-none-match"] === etag) {
        return res.status(304).end();
      }
      let buf: Buffer;
      if (pitchAudioCache && pitchAudioCache.mtimeMs === stat.mtimeMs && Date.now() - pitchAudioCache.ts < AUDIO_CACHE_TTL_MS) {
        buf = pitchAudioCache.buf;
        res.setHeader("X-Cache", "HIT");
      } else {
        buf = await fs.promises.readFile(resolved);
        pitchAudioCache = { ts: Date.now(), buf, mtimeMs: stat.mtimeMs };
        res.setHeader("X-Cache", "MISS");
      }
      res.setHeader("Content-Type", "audio/mpeg");
      res.setHeader("Cache-Control", "public, max-age=600");
      res.setHeader("Content-Disposition", 'inline; filename="audit-pitch-bob.mp3"');
      res.setHeader("Content-Length", String(buf.length));
      res.setHeader("Accept-Ranges", "bytes");
      res.send(buf);
    } catch (err: any) {
      console.error("[audit] pitch audio fetch failed:", err?.message);
      res.status(500).json({ error: "pitch audio fetch failed" });
    }
  });

  // R125+52.20 — Instant AI Readiness Audit (autonomous self-serve fulfillment).
  // Replaces the dead-end lead form: a visitor submits a URL, we fetch + score
  // their site live (server/audit-engine.ts) and return a real report on the
  // spot. Email is optional — when provided we persist it, mirror a lead into
  // audit_leads, and notify the owner. CSRF auto-skipped (/api/public/ prefix).
  app.post("/api/public/audit/run", async (req: Request, res: Response) => {
    if (!rateOk(`audit-run:${hashIp(req)}`, 6, 10 * 60 * 1000)) {
      return res.status(429).json({ error: "Too many audits from your network — please wait a few minutes and try again." });
    }
    // Honeypot + Turnstile (fails open until keys configured). This endpoint
    // does an expensive outbound fetch of a visitor-supplied URL, so it's the
    // prime abuse target — proof-of-human gates it once keys are set.
    if (!(await enforceBotProtection(req, res, { requireTurnstile: true }))) return;
    const parsed = auditRunBody.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Please provide a valid website URL." });
    }
    const { url, email } = parsed.data;
    try {
      const result = await runAudit(url);
      const ipHash = hashIp(req);
      const ua = String(req.headers["user-agent"] || "").slice(0, 500);
      const checksLit = JSON.stringify(result.checks);
      const recsLit = JSON.stringify(result.recommendations);
      let reportId: number | null = null;
      try {
        const ins: any = await db.execute(sql`
          INSERT INTO audit_reports
            (tenant_id, website_url, final_url, overall_score, grade, checks, recommendations, email, ip_hash, user_agent, status)
          VALUES
            (${AUDIT_TENANT_ID}, ${result.websiteUrl}, ${result.finalUrl}, ${result.overallScore}, ${result.grade},
             ${checksLit}::jsonb, ${recsLit}::jsonb, ${email || null}, ${ipHash}, ${ua}, 'completed')
          RETURNING id
        `);
        reportId = ((ins.rows || ins) as any[])[0]?.id ?? null;
      } catch (e: any) {
        console.error("[audit] persist failed:", e?.message);
      }

      // Lead capture + owner notify (only when an email was volunteered).
      if (email) {
        const note = `AI Readiness ${result.overallScore}/100 (${result.grade}) for ${result.websiteUrl}`;
        await db.execute(sql`
          INSERT INTO audit_leads (tenant_id, email, kind, notes)
          VALUES (${AUDIT_TENANT_ID}, ${email}, 'audit-run', ${note})
        `).catch((e: any) => console.error("[audit] lead insert failed:", e?.message));
        const to = ownerEmail();
        if (to) {
          const body = [
            `New Instant AI Readiness Audit lead.`,
            ``,
            `Email: ${email}`,
            `Site:  ${result.websiteUrl}`,
            `Score: ${result.overallScore}/100 (grade ${result.grade})`,
            ``,
            `Top fixes:`,
            ...result.recommendations.map((r) => `  - ${r}`),
            ``,
            `Report #${reportId ?? "?"}. Strong upsell target for the paid deep audit.`,
          ].join("\n");
          sendEmailDirect({ to, subject: `[AUDIT LEAD] ${result.websiteUrl} scored ${result.overallScore} (${result.grade})`, text: body })
            .catch((e: any) => console.error("[audit] owner notify failed:", e?.message));
        }
      }

      res.json({ id: reportId, ...result });
    } catch (err: any) {
      if (err instanceof AuditFetchError) {
        return res.status(422).json({ error: err.message });
      }
      console.error("[audit] run failed:", err?.message);
      res.status(500).json({ error: "The audit could not be completed. Please try again." });
    }
  });
}

// ---------------------------------------------------------------------------
// Operator-facing admin endpoints (/admin/website-audit page).
// Lets the platform owner run the instant audit AND generate the full paid
// comprehensive PDF deliverable manually (no Stripe checkout required).
// ---------------------------------------------------------------------------

interface FullAuditJob {
  id: string;
  status: "running" | "done" | "error";
  startedAt: number;
  finishedAt?: number;
  company?: string;
  website?: string;
  filePath?: string;
  fileName?: string;
  pages?: number;
  error?: string;
  customerEmail?: string;
  customerName?: string;
  /** Set when the finished PDF was enqueued into the service review queue. */
  queuedReviewId?: string;
}
const FULL_AUDIT_JOBS = new Map<string, FullAuditJob>();
// Durable job metadata (same dotfile-in-uploads pattern as the service review
// queue). Dotfiles are excluded from the servable-uploads sync, so this is
// never publicly reachable. Survives server restarts within a deploy; jobs
// found still "running" after a restart are marked failed (the generation
// process died with the old process).
// data/local-state/ is gitignored, never synced to servable uploads/, and
// outside the boot-time uploads dotfile purge in seed.ts.
const JOBS_STORE_PATH = path.join("data", "local-state", "website-audit-jobs.json");
let jobsLoaded = false;
function loadFullAuditJobs(): void {
  if (jobsLoaded) return;
  jobsLoaded = true;
  try {
    if (!fs.existsSync(JOBS_STORE_PATH)) return;
    const raw = JSON.parse(fs.readFileSync(JOBS_STORE_PATH, "utf-8"));
    if (!Array.isArray(raw)) return;
    for (const j of raw) {
      if (!j || typeof j.id !== "string") continue;
      if (j.status === "running") {
        j.status = "error";
        j.error = "The server restarted while this audit was generating. Please run it again.";
        j.finishedAt = Date.now();
      }
      FULL_AUDIT_JOBS.set(j.id, j as FullAuditJob);
    }
  } catch (e: any) {
    console.warn("[audit-admin] job store load failed (non-fatal):", e?.message);
  }
}
function saveFullAuditJobs(): void {
  try {
    fs.mkdirSync(path.dirname(JOBS_STORE_PATH), { recursive: true });
    fs.writeFileSync(JOBS_STORE_PATH, JSON.stringify([...FULL_AUDIT_JOBS.values()]));
  } catch (e: any) {
    console.warn("[audit-admin] job store save failed (non-fatal):", e?.message);
  }
}
function pruneFullAuditJobs(): void {
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  for (const [k, j] of FULL_AUDIT_JOBS.entries()) {
    if (j.startedAt < cutoff) FULL_AUDIT_JOBS.delete(k);
  }
}

const adminInstantBody = z.object({ url: z.string().min(4).max(2000) });
const adminFullBody = z.object({
  company: z.string().min(1).max(200),
  website: z.string().min(4).max(300),
  industry: z.string().max(200).optional().nullable(),
  crm: z.string().max(120).optional().nullable(),
  notes: z.string().max(500).optional().nullable(),
  // Optional customer contact. When an email is provided, the finished PDF
  // lands in the service review queue as an offline-paid order so the admin
  // can proofread + "Approve & ship" (delivery email with download link)
  // exactly like a Stripe order — no manual download/attach/send dance.
  customerName: z.string().max(200).optional().nullable(),
  customerEmail: z.string().email().max(320).optional().nullable().or(z.literal("")),
});

export function registerAuditAdminRoutes(app: Express, helpers: {
  authMiddleware: any;
  getTenantFromRequest: (req: Request) => number | null | Promise<number | null>;
  isAdminRequest: (req: Request) => boolean;
  ADMIN_TENANT_ID: number;
}) {
  const { authMiddleware, getTenantFromRequest, isAdminRequest, ADMIN_TENANT_ID } = helpers;
  loadFullAuditJobs();

  async function requireAdmin(req: Request, res: Response): Promise<number | null> {
    const tenantId = await getTenantFromRequest(req);
    if (tenantId === null || tenantId !== ADMIN_TENANT_ID || !isAdminRequest(req)) {
      res.status(403).json({ error: "Admin access required" });
      return null;
    }
    return tenantId;
  }

  // Instant audit (same engine as the public /audit page, no Turnstile /
  // public rate limits — operator is authenticated).
  app.post("/api/admin/audit/run", authMiddleware, async (req: Request, res: Response) => {
    const tenantId = await requireAdmin(req, res);
    if (tenantId === null) return;
    const parsed = adminInstantBody.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Please provide a valid website URL." });
    try {
      const result = await runAudit(parsed.data.url);
      res.json(result);
    } catch (err: any) {
      if (err instanceof AuditFetchError) return res.status(422).json({ error: err.message });
      console.error("[audit-admin] run failed:", err?.message);
      res.status(500).json({ error: "The audit could not be completed. Please try again." });
    }
  });

  // Kick off the full comprehensive PDF audit (the $497 deliverable) as a
  // background job — generation takes several minutes (7 sections + CoVe).
  app.post("/api/admin/audit/full", authMiddleware, async (req: Request, res: Response) => {
    const tenantId = await requireAdmin(req, res);
    if (tenantId === null) return;
    const parsed = adminFullBody.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Company name and website are required." });
    }
    pruneFullAuditJobs();
    // One at a time — this is an expensive multi-minute LLM pipeline.
    for (const j of FULL_AUDIT_JOBS.values()) {
      if (j.status === "running") {
        return res.status(409).json({ error: "A comprehensive audit is already running. Wait for it to finish.", jobId: j.id });
      }
    }
    const { company, website, industry, crm, notes } = parsed.data;
    const custEmail = (parsed.data.customerEmail || "").trim();
    const custName = (parsed.data.customerName || "").trim();
    const jobId = crypto.randomUUID();
    const job: FullAuditJob = {
      id: jobId, status: "running", startedAt: Date.now(), company, website,
      customerEmail: custEmail || undefined, customerName: custName || undefined,
    };
    FULL_AUDIT_JOBS.set(jobId, job);
    saveFullAuditJobs();
    const customerEmail = custEmail || ownerEmail() || "operator@visionclaw";
    fulfillReadinessAudit({
      intake: { company, website, industry: industry || undefined, crm: crm || undefined, notes: notes || undefined },
      customerEmail,
      orderId: `manual-${jobId.slice(0, 8)}`,
      tenantId,
    }).then(async (result) => {
      job.finishedAt = Date.now();
      if (result.success && result.filePath) {
        job.status = "done";
        job.filePath = result.filePath;
        job.fileName = result.fileName;
        job.pages = result.pages;
        // Customer email provided → land the finished PDF in the service
        // review queue as an offline-paid order so the admin can proofread
        // and "Approve & ship" (delivery email + verified download link)
        // exactly like a Stripe order. No email → old behavior (download).
        if (custEmail) {
          try {
            const { addReviewItem, runQualityChecks } = await import("../service-review-queue");
            const qa = runQualityChecks({
              filePath: result.filePath,
              pageCount: result.pages,
              depth: "standard",
              sections: result.sections || [],
            });
            const queued = await addReviewItem({
              sessionId: `manual-${jobId}`,
              sku: "sample-audit-sku-001",
              tier: "self-serve",
              productName: `AI Readiness Audit — ${company}`,
              customerEmail: custEmail,
              customerName: custName || custEmail,
              intake: { company, website, industry: industry || undefined, crm: crm || undefined, notes: notes || undefined },
              filePath: result.filePath,
              fileName: result.fileName || "",
              qa,
              modelUsed: result.modelUsed,
              pages: result.pages,
              payment: "offline (check/cash/invoice)",
            });
            job.queuedReviewId = queued.id;
            console.log(`[audit-admin] Job ${jobId} queued for review as ${queued.id} (customer ${custEmail})`);
          } catch (queueErr: any) {
            // Fail-soft: the PDF still exists and is downloadable from the
            // job card — surface the queue failure instead of losing it.
            job.error = `PDF generated, but adding to review queue failed: ${String(queueErr?.message || "unknown").slice(0, 200)}`;
            console.error(`[audit-admin] Queue enqueue failed for job ${jobId}: ${queueErr?.message}`);
          }
        }
      } else {
        job.status = "error";
        job.error = result.error || "PDF generation failed";
      }
      saveFullAuditJobs();
    }).catch((err: any) => {
      job.finishedAt = Date.now();
      job.status = "error";
      job.error = err?.message?.slice(0, 300) || "unknown error";
      saveFullAuditJobs();
    });
    res.json({ jobId, status: "running" });
  });

  app.get("/api/admin/audit/full/:jobId", authMiddleware, async (req: Request, res: Response) => {
    const tenantId = await requireAdmin(req, res);
    if (tenantId === null) return;
    const job = FULL_AUDIT_JOBS.get(String(req.params.jobId));
    if (!job) return res.status(404).json({ error: "Job not found (jobs are kept for 24h)." });
    res.json({
      jobId: job.id,
      status: job.status,
      company: job.company,
      website: job.website,
      startedAt: new Date(job.startedAt).toISOString(),
      finishedAt: job.finishedAt ? new Date(job.finishedAt).toISOString() : null,
      pages: job.pages ?? null,
      fileName: job.fileName ?? null,
      error: job.error ?? null,
      customerEmail: job.customerEmail ?? null,
      queuedReviewId: job.queuedReviewId ?? null,
    });
  });

  app.get("/api/admin/audit/full/:jobId/download", authMiddleware, async (req: Request, res: Response) => {
    const tenantId = await requireAdmin(req, res);
    if (tenantId === null) return;
    const job = FULL_AUDIT_JOBS.get(String(req.params.jobId));
    if (!job || job.status !== "done" || !job.filePath) {
      return res.status(404).json({ error: "PDF not ready or job not found." });
    }
    // Path confinement: only serve the exact file the job produced, and only
    // from inside uploads/ — never a caller-supplied path.
    const uploadsRoot = path.resolve(process.cwd(), "uploads") + path.sep;
    const resolved = path.resolve(process.cwd(), job.filePath);
    if (!resolved.startsWith(uploadsRoot) || !fs.existsSync(resolved)) {
      return res.status(404).json({ error: "PDF file not found on disk." });
    }
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${(job.fileName || "ai-readiness-audit.pdf").replace(/[^a-zA-Z0-9._-]/g, "_")}"`);
    const stream = fs.createReadStream(resolved);
    stream.on("error", (err: any) => {
      console.error("[audit-admin] download stream failed:", err?.message);
      if (!res.headersSent) {
        res.status(err?.code === "ENOENT" ? 404 : 500).json({ error: "PDF could not be read from disk." });
      } else {
        res.destroy();
      }
    });
    stream.pipe(res);
  });
}
