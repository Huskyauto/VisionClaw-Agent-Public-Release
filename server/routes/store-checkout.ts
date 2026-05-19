import type { Express, Request, Response } from "express";
import { getUncachableStripeClient, buildCheckoutIdempotencyKey } from "../stripeClient";
import { anonymousVisitorPartition } from "../anonymousVisitorPartition";
import { recordStorefrontHit } from "../storefront-rate-limit-store";

// Extracted from the inline /api/store/checkout handler that previously
// lived inside the giant registerRoutes() in server/routes.ts (~line 1688).
//
// Why a separate module: tests/security/storefront-checkout-double-click.test.ts
// needs to mount the REAL handler without booting the entire app (DB, every
// integration). Before this extraction the test had to copy the handler body,
// and the copy could silently drift from production. With the registrar
// pattern the test mounts this exact module instead.

// Per-shopper throttle for anonymous Stripe-session creation.
//
// Why NOT per-IP (the previous design):
// In production every storefront request reaches Express via Replit's
// reverse proxy, so `req.socket.remoteAddress` is the SAME value for every
// shopper on the planet. Keying off it lumps all customers into one bucket
// and a single attacker who burns the 30/min ceiling locks every real
// shopper out of the Buy button until the window slides. Switching to
// `req.ip` would honour X-Forwarded-For (under `trust proxy`) which an
// attacker can rotate freely, so that route is no improvement.
//
// Per-shopper keying preference order:
//   1. Lowercased `customerEmail` from the request body. Validation later in
//      the handler requires a real email, so the normal happy path always
//      reaches branch 1. Two real shoppers buying at the same moment cannot
//      collide because their emails differ. An attacker can only burn the
//      30/min budget for an email they themselves chose to use; rotating
//      emails just spawns fresh independent buckets that they then have to
//      fill themselves.
//   2. `anonymousVisitorPartition(req)` — session id / client idempotency
//      token / per-request UUID. Catches malformed requests that never
//      carried an email so they still throttle per-visitor rather than
//      against the shared proxy IP.
//
// SKU is mixed into the key so a shopper buying two different products in
// the same minute doesn't have one product's traffic eat the other's
// budget. The bookkeeping itself lives in Postgres
// (server/storefront-rate-limit-store.ts) so the throttle survives
// process restarts and stays consistent if the storefront is ever scaled
// to more than one instance — the previous in-process Map would reset to
// empty on every deploy and would diverge across workers.
const STORE_CHECKOUT_LIMIT_DEFAULT = 30;
const STORE_CHECKOUT_WINDOW_MS_DEFAULT = 60_000;

// In non-production the limit/window can be overridden per-request via
// headers so stress tests can exercise the boundary deterministically
// without waiting a full minute. Guarded by NODE_ENV !== 'production'
// so the test hooks cannot be used to amplify or weaken throttling
// on the live storefront.
function resolveRateLimitConfig(req: Request) {
  if (process.env.NODE_ENV !== 'production') {
    const lim = Number(req.header('x-test-rate-limit'));
    const win = Number(req.header('x-test-rate-window-ms'));
    if (Number.isFinite(lim) && lim > 0 && Number.isFinite(win) && win > 0) {
      return { limit: lim, windowMs: win };
    }
  }
  return { limit: STORE_CHECKOUT_LIMIT_DEFAULT, windowMs: STORE_CHECKOUT_WINDOW_MS_DEFAULT };
}

// Build the rate-limit key for this request. SAFE TO CALL with whatever
// shape `req.body` happens to have — `express.json()` may have parsed
// nothing, an array, or a primitive, so we coerce defensively.
function storefrontRateKey(req: Request): string {
  const body = (req.body && typeof req.body === 'object' && !Array.isArray(req.body))
    ? (req.body as Record<string, unknown>)
    : {};
  // Cap the SKU to bound key size so an attacker can't drive the table
  // wide by sending a multi-MB sku string per request.
  const skuRaw = typeof body.sku === 'string' ? body.sku : '';
  const sku = skuRaw ? skuRaw.toLowerCase().slice(0, 128) : 'no-sku';
  const emailRaw = typeof body.customerEmail === 'string'
    ? body.customerEmail.trim().toLowerCase()
    : '';
  if (emailRaw && emailRaw.includes('@')) {
    // 320 = practical max email length per RFC 5321/5322.
    return `email:${emailRaw.slice(0, 320)}:${sku}`;
  }
  // anonymousVisitorPartition prefers the per-mount client token, then the
  // express-session id, then a fresh UUID. None of these collapse two
  // distinct visitors into the same bucket, so the proxy-IP collateral
  // damage from the old design is gone here too.
  return `visitor:${anonymousVisitorPartition(req)}:${sku}`;
}

export function registerStoreCheckoutRoutes(app: Express) {
  app.post("/api/store/checkout", async (req: Request, res: Response) => {
    try {
      const { limit, windowMs } = resolveRateLimitConfig(req);
      const key = storefrontRateKey(req);
      const limitOutcome = await recordStorefrontHit(key, limit, windowMs);
      if (!limitOutcome.allowed) {
        res.setHeader('Retry-After', String(limitOutcome.retryAfterSec));
        return res.status(429).json({
          error: `Too many checkout attempts. Try again in ${limitOutcome.retryAfterSec}s.`,
        });
      }

      const { sku, customerEmail, intake } = req.body || {};
      if (!sku || typeof sku !== "string") {
        return res.status(400).json({ error: "sku required" });
      }
      // customerEmail is required — we need it to deliver the product
      // after Stripe reports payment. Frontend already enforces this;
      // backend validation closes the door on direct API callers.
      if (!customerEmail || typeof customerEmail !== "string" || !customerEmail.includes("@")) {
        return res.status(400).json({ error: "customerEmail required" });
      }

      const { lookupProduct } = await import("../product-catalog");
      const product = lookupProduct(sku);
      if (!product) {
        return res.status(404).json({ error: `Unknown SKU: ${sku}` });
      }

      // Service products require an intake payload. Validate required fields
      // server-side so we don't accept a paid order we can't fulfill.
      const intakeMetadata: Record<string, string> = {};
      if (product.kind === "service") {
        if (!intake || typeof intake !== "object") {
          return res.status(400).json({ error: "intake required for this product" });
        }
        for (const field of product.intakeFields || []) {
          const raw = (intake as any)[field.key];
          const value = raw == null ? "" : String(raw).trim();
          if (field.required && !value) {
            return res.status(400).json({ error: `intake.${field.key} required` });
          }
          if (value) {
            const cap = field.maxLength || 500;
            // Stripe metadata values cap at 500 chars per key — enforce here.
            intakeMetadata[`intake_${field.key}`] = value.slice(0, Math.min(cap, 500));
          }
        }
      }

      const domains = process.env.REPLIT_DOMAINS || process.env.REPLIT_DEV_DOMAIN || "";
      const primaryDomain = domains.split(",")[0]?.trim();
      const baseUrl = primaryDomain ? `https://${primaryDomain}` : `${req.protocol}://${req.get('host')}`;

      const stripe = await getUncachableStripeClient();
      const sessionData: any = {
        payment_method_types: ['card'],
        line_items: [{
          price_data: {
            currency: 'usd',
            unit_amount: product.priceCents,
            product_data: {
              name: product.productName,
              description: product.tagline,
            },
          },
          quantity: 1,
        }],
        mode: 'payment',
        success_url: `${baseUrl}/store/success?sku=${encodeURIComponent(sku)}&session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${baseUrl}/store?cancelled=1`,
        metadata: {
          bundle_sku: sku,
          source: 'public-storefront',
          ...intakeMetadata,
        },
        // CRITICAL: bundle_sku must live on SESSION metadata (what
        // checkout.session.completed carries), NOT payment_intent_data.
        // Verified Round 9.
      };
      sessionData.customer_email = customerEmail;

      // customerEmail is required by validation above, so the email branch
      // is the normal path and dedups honest double-clicks per customer.
      // The fingerprint fallback is defense-in-depth: if validation ever
      // changes or two strangers somehow share the same email + SKU + line
      // items, the per-visitor partition (session id / client token / UUID)
      // still keeps their idempotency keys distinct.
      //
      // Email is normalized (trim + lowercase) before being used in the
      // partition so "Bob@Example.com" and " bob@example.com " produce the
      // SAME idempotency key — preventing a double-click that mutates the
      // email casing/whitespace from creating two Stripe sessions.
      const normalizedEmail = customerEmail.trim().toLowerCase();
      const partition = normalizedEmail
        ? `store_${sku}_email_${normalizedEmail}`
        : `store_${sku}_${anonymousVisitorPartition(req)}`;
      const session = await stripe.checkout.sessions.create(sessionData, {
        idempotencyKey: buildCheckoutIdempotencyKey(partition, "payment", sessionData),
      });
      console.log(`[store] Created Stripe session ${session.id} for sku=${sku} amount=${product.priceCents}c`);
      res.json({ url: session.url, sessionId: session.id });
    } catch (err: any) {
      console.error("[store] checkout error:", err.message);
      res.status(500).json({ error: "Failed to create checkout session", detail: err.message });
    }
  });
}
