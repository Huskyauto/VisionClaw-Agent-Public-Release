import type { Express, Request, Response } from "express";
import { db } from "../db";
import { sql } from "drizzle-orm";
import crypto from "crypto";
import { z } from "zod";
import { sendEmailDirect } from "../email";
import { pinThrottleCheck, pinThrottleRecord } from "../lib/pin-throttle";
import { enforceBotProtection } from "../lib/bot-protection";

const PLATFORM_OWNER_TENANT_ID = 1;
const VALID_KINDS = [
  "sample-request",
  "monitoring-waitlist",
  "enterprise-inquiry",
  "buy-click-self-serve",
  "buy-click-done-for-you",
  "audit-run",
  "qualifier-result",
  "newsletter",
  "other",
] as const;

const leadBodySchema = z.object({
  email: z.string().email().max(320).optional().nullable(),
  kind: z.enum(VALID_KINDS),
  tierInterest: z.string().max(64).optional().nullable(),
  icpHint: z.string().max(64).optional().nullable(),
  utmSource: z.string().max(128).optional().nullable(),
  utmMedium: z.string().max(128).optional().nullable(),
  utmCampaign: z.string().max(256).optional().nullable(),
  utmTerm: z.string().max(256).optional().nullable(),
  utmContent: z.string().max(256).optional().nullable(),
  referer: z.string().max(2048).optional().nullable(),
  notes: z.string().max(2000).optional().nullable(),
});

// Per-IP rate limit: 5 / 10 min for email-bearing submits, 30 / 10 min for
// anonymous buy-click intents (form-spam protection without breaking real
// usage). In-memory; fine for single-instance deploy. Self-pruning every
// 10 min so a sustained-traffic marketing campaign can't slowly leak the
// heap (R125+13.4 architect HIGH-3 close).
const RATE_BUCKETS = new Map<string, { count: number; resetAt: number }>();
const RATE_BUCKET_MAX = 50_000; // hard cap as a second safety net
function pruneRateBuckets(): void {
  const now = Date.now();
  for (const [k, v] of RATE_BUCKETS.entries()) {
    if (v.resetAt < now) RATE_BUCKETS.delete(k);
  }
  // Defensive: if a flood still pushes us past the cap, drop oldest entries.
  if (RATE_BUCKETS.size > RATE_BUCKET_MAX) {
    const overflow = RATE_BUCKETS.size - RATE_BUCKET_MAX;
    let i = 0;
    for (const k of RATE_BUCKETS.keys()) {
      if (i++ >= overflow) break;
      RATE_BUCKETS.delete(k);
    }
  }
}
setInterval(pruneRateBuckets, 10 * 60 * 1000).unref();
function rateOk(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  const bucket = RATE_BUCKETS.get(key);
  if (!bucket || bucket.resetAt < now) {
    RATE_BUCKETS.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  bucket.count += 1;
  return bucket.count <= limit;
}

function hashIp(req: Request): string {
  // R125+13.6-fix (architect H1): use req.ip ONLY. Express is configured with
  // `app.set("trust proxy", 1)` in server/replit_integrations/auth/replitAuth.ts,
  // so req.ip is the real client IP via the single trusted Replit proxy hop.
  // The previous `x-forwarded-for[0]` read was the leftmost (attacker-supplied)
  // token and was trivially spoofable by rotating the header per request,
  // bypassing the 5/30-per-10min limits and enabling owner-alert spam.
  const ip = req.ip || "unknown";
  return crypto.createHash("sha256").update(ip).digest("hex").slice(0, 16);
}

function ownerEmail(): string | null {
  return (
    process.env.OWNER_ALERT_EMAIL ||
    process.env.OWNER_EMAIL ||
    process.env.SITE_OWNER_EMAIL ||
    process.env.SITE_CONTACT_EMAIL ||
    null
  );
}

export function registerLeadsRoutes(app: Express) {
  app.post("/api/public/leads/audit", async (req: Request, res: Response) => {
    try {
      const parsed = leadBodySchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: "invalid payload", issues: parsed.error.format() });
      }
      const body = parsed.data;
      const ipHash = hashIp(req);
      const ua = String(req.headers["user-agent"] || "").slice(0, 512);

      const hasEmail = !!body.email;
      const limit = hasEmail ? 5 : 30;
      const window = 10 * 60 * 1000;
      const bucketKey = `${ipHash}:${hasEmail ? "email" : "anon"}`;
      if (!rateOk(bucketKey, limit, window)) {
        return res.status(429).json({ error: "rate limited" });
      }

      // Honeypot only (no Turnstile): some callers are background buy-click
      // telemetry beacons with no visible widget, so we keep this frictionless.
      if (!(await enforceBotProtection(req, res))) return;

      const result: any = await db.execute(sql`
        INSERT INTO audit_leads (
          tenant_id, email, kind, tier_interest, icp_hint,
          utm_source, utm_medium, utm_campaign, utm_term, utm_content,
          referer, ip_hash, user_agent, notes
        ) VALUES (
          ${PLATFORM_OWNER_TENANT_ID}, ${body.email ?? null}, ${body.kind},
          ${body.tierInterest ?? null}, ${body.icpHint ?? null},
          ${body.utmSource ?? null}, ${body.utmMedium ?? null}, ${body.utmCampaign ?? null},
          ${body.utmTerm ?? null}, ${body.utmContent ?? null},
          ${body.referer ?? null}, ${ipHash}, ${ua}, ${body.notes ?? null}
        )
        RETURNING id, created_at
      `);
      const rows = (result.rows || result) as any[];
      const row = rows[0];

      // Fire-and-forget owner notification for high-signal events (anything
      // with an email, OR an enterprise inquiry). Buy-click intents stay
      // silent — they're aggregate-only signal, would spam Bob.
      if (hasEmail || body.kind === "enterprise-inquiry") {
        const to = ownerEmail();
        if (to) {
          const subject = `[AUDIT LEAD] ${body.kind}${body.email ? ` — ${body.email}` : ""}`;
          const lines = [
            `Lead captured on /audit`,
            ``,
            `Kind:         ${body.kind}`,
            `Email:        ${body.email || "(none)"}`,
            `Tier:         ${body.tierInterest || "—"}`,
            `ICP hint:     ${body.icpHint || "—"}`,
            `UTM source:   ${body.utmSource || "—"}`,
            `UTM medium:   ${body.utmMedium || "—"}`,
            `UTM campaign: ${body.utmCampaign || "—"}`,
            `Referer:      ${body.referer || "—"}`,
            `Notes:        ${body.notes || "—"}`,
            ``,
            `Lead id #${row?.id}, captured ${row?.created_at}.`,
            `IP hash ${ipHash} · UA ${ua.slice(0, 80)}`,
          ];
          sendEmailDirect({ to, subject, text: lines.join("\n") }).catch(e =>
            console.warn(`[leads] owner-notify failed: ${e?.message}`)
          );
        }
      }

      return res.json({ ok: true, id: row?.id });
    } catch (err: any) {
      console.error("[leads] capture failed:", err?.message);
      return res.status(500).json({ error: "capture failed" });
    }
  });

  // Lightweight admin read endpoint — gated on x-admin-pin header matching
  // the env. Keeps the funnel observable without a full /admin UI page.
  app.get("/api/admin/leads/audit", async (req: Request, res: Response) => {
    // R125+13.8+sec (architect HIGH closed): per-IP PIN brute-force throttle.
    // Without this, /api/admin/leads/audit (public-prefix route, no session
    // gate, PIN is the only check) was brute-forceable in a loop. Mirrors
    // gmail-direct throttle (8 attempts / 10min window / 30min lockout).
    const throttle = pinThrottleCheck(req);
    if (!throttle.ok) {
      res.setHeader("Retry-After", String(throttle.retryAfterSec ?? 1800));
      return res.status(429).json({ error: "too many PIN attempts; locked out", retryAfterSec: throttle.retryAfterSec });
    }
    // Constant-time PIN compare to avoid char-by-char timing oracle
    // (R125+13.4 architect HIGH-1 close).
    const pin = String(req.headers["x-admin-pin"] || "");
    const expected = process.env.ADMIN_PIN || "";
    if (!expected) return res.status(403).json({ error: "forbidden" });
    const a = Buffer.from(pin);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
      pinThrottleRecord(req, false);
      return res.status(403).json({ error: "forbidden" });
    }
    pinThrottleRecord(req, true);
    try {
      const result: any = await db.execute(sql`
        SELECT id, email, kind, tier_interest, icp_hint, utm_source, utm_medium,
               utm_campaign, referer, ip_hash, created_at
        FROM audit_leads
        WHERE tenant_id = ${PLATFORM_OWNER_TENANT_ID}
        ORDER BY created_at DESC
        LIMIT 500
      `);
      const rows = (result.rows || result) as any[];
      const byKind: Record<string, number> = {};
      for (const r of rows) byKind[r.kind] = (byKind[r.kind] || 0) + 1;
      res.json({ total: rows.length, byKind, leads: rows });
    } catch (err: any) {
      console.error("[leads] fetch failed:", err?.message || err);
      res.status(500).json({ error: "fetch failed" });
    }
  });
}
