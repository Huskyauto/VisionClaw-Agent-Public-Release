import type { Express, Request, Response } from "express";
import { getUncachableStripeClient, getStripePublishableKey, buildCheckoutIdempotencyKey } from "../stripeClient";
import { anonymousVisitorPartition } from "../anonymousVisitorPartition";

interface Helpers {
  getTenantFromRequest: (req: Request) => number | null;
  requirePlatformAdmin: (req: Request, res: Response) => boolean;
  authMiddleware: any;
}

export function registerStripeCheckoutRoutes(app: Express, helpers: Helpers) {
  const { getTenantFromRequest, requirePlatformAdmin, authMiddleware } = helpers;

  app.get("/api/stripe/publishable-key", async (_req: Request, res: Response) => {
    try {
      const key = await getStripePublishableKey();
      res.json({ publishableKey: key });
    } catch (err: any) {
      res.status(500).json({ error: "Failed to get Stripe key" });
    }
  });

  app.get("/api/stripe/products", async (_req: Request, res: Response) => {
    try {
      const { db } = await import("../db");
      const { sql } = await import("drizzle-orm");
      const result = await db.execute(sql`
        SELECT 
          p.id as product_id,
          p.name as product_name,
          p.description as product_description,
          p.active as product_active,
          p.metadata as product_metadata,
          p.images as product_images,
          pr.id as price_id,
          pr.unit_amount,
          pr.currency,
          pr.recurring,
          pr.active as price_active
        FROM stripe.products p
        LEFT JOIN stripe.prices pr ON pr.product = p.id AND pr.active = true
        WHERE p.active = true
        ORDER BY p.name, pr.unit_amount
      `);

      const productsMap = new Map<string, any>();
      for (const row of result.rows) {
        const r = row as any;
        if (!productsMap.has(r.product_id)) {
          productsMap.set(r.product_id, {
            id: r.product_id,
            name: r.product_name,
            description: r.product_description,
            active: r.product_active,
            metadata: r.product_metadata,
            images: r.product_images,
            prices: [],
          });
        }
        if (r.price_id) {
          productsMap.get(r.product_id).prices.push({
            id: r.price_id,
            unit_amount: r.unit_amount,
            currency: r.currency,
            recurring: r.recurring,
            active: r.price_active,
          });
        }
      }

      res.json({ products: Array.from(productsMap.values()) });
    } catch (err: any) {
      console.error("[stripe] Products list error:", err.message);
      res.status(500).json({ error: "Failed to fetch products" });
    }
  });

  app.post("/api/stripe/checkout", async (req: Request, res: Response) => {
    try {
      const { priceId, mode, customerEmail } = req.body;
      if (!priceId || typeof priceId !== "string") return res.status(400).json({ error: "priceId required" });
      if (mode && !["payment", "subscription"].includes(mode)) return res.status(400).json({ error: "mode must be 'payment' or 'subscription'" });
      if (customerEmail && (typeof customerEmail !== "string" || !customerEmail.includes("@"))) return res.status(400).json({ error: "Invalid email" });

      // SECURITY (R74.13u-sec): server-side allowlist for priceId. Without this
      // a caller could pass any active price ID in your Stripe account (e.g. a
      // $0.01 trial price for an enterprise plan). Restrict to prices we have
      // synced into stripe.prices that are explicitly `active` AND whose
      // parent product is also `active`. The /api/stripe/products endpoint
      // above is the source of truth — anything not exposed there should be
      // rejected here too.
      {
        const { db } = await import("../db");
        const { sql } = await import("drizzle-orm");
        const allow = await db.execute(sql`
          SELECT pr.id
          FROM stripe.prices pr
          JOIN stripe.products p ON p.id = pr.product
          WHERE pr.id = ${priceId} AND pr.active = true AND p.active = true
          LIMIT 1
        `);
        if (((allow as any).rows || allow).length === 0) {
          return res.status(400).json({ error: "Unknown or inactive priceId" });
        }
      }

      // SECURITY (R74.13u-sec): require canonical base URL when configured —
      // never trust the Host header for success/cancel URLs in production.
      const domains = process.env.REPLIT_DOMAINS || process.env.REPLIT_DEV_DOMAIN || "";
      const primaryDomain = domains.split(",")[0]?.trim();
      if (!primaryDomain && process.env.NODE_ENV === "production") {
        return res.status(500).json({ error: "Checkout disabled: no canonical domain configured" });
      }
      const baseUrl = primaryDomain ? `https://${primaryDomain}` : `${req.protocol}://${req.get('host')}`;

      const stripe = await getUncachableStripeClient();
      const sessionData: any = {
        payment_method_types: ['card'],
        line_items: [{ price: priceId, quantity: 1 }],
        mode: mode || 'payment',
        success_url: `${baseUrl}/payments?status=success`,
        cancel_url: `${baseUrl}/payments?status=cancelled`,
      };
      if (customerEmail) sessionData.customer_email = customerEmail;

      // Logged-in callers stay partitioned by tenant id (preserves the prior
      // behavior). Anonymous visitors get a per-visitor partition derived
      // from their express-session id instead of the shared tenant `0` slot,
      // so two strangers with the same line items cannot collide on the same
      // Stripe idempotency key.
      const tenantId = getTenantFromRequest(req);
      const idempotencyPartition: number | string = tenantId ?? anonymousVisitorPartition(req);
      const session = await stripe.checkout.sessions.create(sessionData, {
        idempotencyKey: buildCheckoutIdempotencyKey(idempotencyPartition, mode || "payment", sessionData),
      });
      res.json({ url: session.url, sessionId: session.id });
    } catch (err: any) {
      console.error("[stripe] Checkout error:", err.message);
      res.status(500).json({ error: "Failed to create checkout session" });
    }
  });

  app.post("/api/stripe/create-product", authMiddleware, async (req: Request, res: Response) => {
    if (!requirePlatformAdmin(req, res)) return;
    try {
      const { name, description, price, currency, recurring, metadata } = req.body;
      if (!name || typeof name !== "string") return res.status(400).json({ error: "name required" });
      if (!price || typeof price !== "number" || price <= 0) return res.status(400).json({ error: "price must be a positive number" });
      const allowedCurrencies = ["usd", "eur", "gbp", "cad", "aud"];
      if (currency && !allowedCurrencies.includes(currency)) return res.status(400).json({ error: "unsupported currency" });
      if (recurring && !["month", "year"].includes(recurring)) return res.status(400).json({ error: "recurring must be 'month' or 'year'" });

      const stripe = await getUncachableStripeClient();
      const product = await stripe.products.create({
        name,
        description: description || undefined,
        metadata: metadata || {},
      });

      const priceData: any = {
        product: product.id,
        unit_amount: Math.round(price * 100),
        currency: currency || 'usd',
      };
      if (recurring) {
        priceData.recurring = { interval: recurring };
      }

      const stripePrice = await stripe.prices.create(priceData);

      res.json({
        product: { id: product.id, name: product.name },
        price: { id: stripePrice.id, unit_amount: stripePrice.unit_amount, currency: stripePrice.currency },
      });
    } catch (err: any) {
      console.error("[stripe] Create product error:", err.message);
      res.status(500).json({ error: "Failed to create product" });
    }
  });

  app.get("/api/stripe/payments", authMiddleware, async (req: Request, res: Response) => {
    if (!requirePlatformAdmin(req, res)) return;
    try {
      const { db } = await import("../db");
      const { sql } = await import("drizzle-orm");
      const result = await db.execute(sql`
        SELECT id, amount, currency, status, created
        FROM stripe.payment_intents
        ORDER BY created DESC
        LIMIT 50
      `);
      res.json({ payments: result.rows });
    } catch (err: any) {
      console.error("[stripe] Payments list error:", err.message);
      res.status(500).json({ error: "Failed to fetch payments" });
    }
  });
}
