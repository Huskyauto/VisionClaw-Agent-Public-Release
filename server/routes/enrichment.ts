import type { Express, Request, Response } from "express";
import { db } from "../db";
import { sql } from "drizzle-orm";
import crypto from "crypto";
import { z } from "zod";
import { sendEmailDirect } from "../email";
import { runEnrichment, EnrichmentFetchError } from "../enrichment-engine";

const ENRICH_TENANT_ID = 1; // platform-owner storefront

// In-memory per-IP rate limiter (mirrors audit.ts). The /run endpoint makes
// outbound fetches + an LLM call, so it MUST be throttled to prevent abuse as
// an SSRF-scan amplifier, a cost-drain, or a DoS vector.
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
  // Key off the raw TCP socket source, NOT req.ip (which honors X-Forwarded-For
  // under "trust proxy" and is attacker-rotatable on this abuse-sensitive route).
  const src = req.socket?.remoteAddress || req.ip || "unknown";
  return crypto.createHash("sha256").update(src).digest("hex").slice(0, 16);
}
function ownerEmail(): string | null {
  return process.env.OWNER_ALERT_EMAIL || process.env.OWNER_EMAIL || process.env.SITE_OWNER_EMAIL || process.env.SITE_CONTACT_EMAIL || null;
}

const enrichRunBody = z.object({
  email: z.string().email().max(320),
  domain: z.string().max(253).optional().nullable(),
  utmSource: z.string().max(128).optional().nullable(),
  utmMedium: z.string().max(128).optional().nullable(),
  utmCampaign: z.string().max(256).optional().nullable(),
  utmTerm: z.string().max(256).optional().nullable(),
  utmContent: z.string().max(256).optional().nullable(),
  referer: z.string().max(2048).optional().nullable(),
});

export function registerEnrichmentRoutes(app: Express) {
  // Smart Lead Enrichment — autonomous self-serve fulfillment for the
  // /enrichment wedge (IdeaBrowser #247). A visitor submits a work email; we
  // derive the company domain, fetch the site (SSRF-jailed) and synthesize a
  // lead-intelligence card live. The email is always captured (this IS the
  // lead) — mirrored into audit_leads with kind='enrichment-run' + owner notify.
  // CSRF auto-skipped (/api/public/ prefix).
  app.post("/api/public/enrichment/run", async (req: Request, res: Response) => {
    if (!rateOk(`enrich-run:${hashIp(req)}`, 6, 10 * 60 * 1000)) {
      return res.status(429).json({ error: "Too many lookups from your network — please wait a few minutes and try again." });
    }
    const parsed = enrichRunBody.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Please provide a valid work email." });
    }
    const body = parsed.data;
    try {
      const result = await runEnrichment(body.email, { explicitDomain: body.domain, tenantId: ENRICH_TENANT_ID });
      const ipHash = hashIp(req);
      const ua = String(req.headers["user-agent"] || "").slice(0, 500);
      const signalsLit = JSON.stringify(result.signals);
      const talkingLit = JSON.stringify(result.talkingPoints);
      const dmLit = JSON.stringify(result.decisionMakers);

      let reportId: number | null = null;
      try {
        const ins: any = await db.execute(sql`
          INSERT INTO smart_enrichment_reports
            (tenant_id, input_email, company_domain, final_url, company_name, industry,
             estimated_size, icp_fit_score, routing, signals, talking_points, decision_makers,
             summary, ip_hash, user_agent, status)
          VALUES
            (${ENRICH_TENANT_ID}, ${result.inputEmail}, ${result.companyDomain}, ${result.finalUrl},
             ${result.companyName}, ${result.industry}, ${result.estimatedSize}, ${result.icpFitScore},
             ${result.routing}, ${signalsLit}::jsonb, ${talkingLit}::jsonb, ${dmLit}::jsonb,
             ${result.summary}, ${ipHash}, ${ua}, 'completed')
          RETURNING id
        `);
        reportId = ((ins.rows || ins) as any[])[0]?.id ?? null;
      } catch (e: any) {
        console.error("[enrichment] persist failed:", e?.message);
      }

      // Lead capture (the work email IS the lead) + owner notify.
      const note = `Enriched ${result.companyName} (${result.companyDomain}) — ICP fit ${result.icpFitScore}/100, routing ${result.routing.toUpperCase()}`;
      await db.execute(sql`
        INSERT INTO audit_leads
          (tenant_id, email, kind, utm_source, utm_medium, utm_campaign, utm_term, utm_content, referer, ip_hash, user_agent, notes)
        VALUES
          (${ENRICH_TENANT_ID}, ${body.email}, 'enrichment-run',
           ${body.utmSource ?? null}, ${body.utmMedium ?? null}, ${body.utmCampaign ?? null},
           ${body.utmTerm ?? null}, ${body.utmContent ?? null}, ${body.referer ?? null},
           ${ipHash}, ${ua}, ${note})
      `).catch((e: any) => console.error("[enrichment] lead insert failed:", e?.message));

      const to = ownerEmail();
      if (to) {
        const lines = [
          `New Smart Lead Enrichment lead.`,
          ``,
          `Email:    ${body.email}`,
          `Company:  ${result.companyName} (${result.companyDomain})`,
          `Industry: ${result.industry}`,
          `Size:     ${result.estimatedSize}`,
          `ICP fit:  ${result.icpFitScore}/100  →  ${result.routing.toUpperCase()}`,
          ``,
          `Summary: ${result.summary}`,
          ``,
          `Talking points:`,
          ...result.talkingPoints.map((t) => `  - ${t}`),
          ``,
          `Report #${reportId ?? "?"}.`,
        ].join("\n");
        sendEmailDirect({ to, subject: `[ENRICH LEAD] ${body.email} → ${result.companyName} (fit ${result.icpFitScore}, ${result.routing})`, text: lines })
          .catch((e: any) => console.error("[enrichment] owner notify failed:", e?.message));
      }

      res.json({ id: reportId, ...result });
    } catch (err: any) {
      if (err instanceof EnrichmentFetchError) {
        return res.status(422).json({ error: err.message });
      }
      console.error("[enrichment] run failed:", err?.message);
      res.status(500).json({ error: "The enrichment could not be completed. Please try again." });
    }
  });
}
