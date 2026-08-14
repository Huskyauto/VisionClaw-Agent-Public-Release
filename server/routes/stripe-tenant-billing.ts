import type { Express, Request, Response } from "express";
import { storage } from "../storage";
import { getUncachableStripeClient, buildCheckoutIdempotencyKey } from "../stripeClient";
import { encryptApiKey } from "../crypto";
import { validate, stripeBYOKSchema, stripeSetupFeeSchema } from "../validation";

interface Helpers {
  getTenantFromRequest: (req: Request) => number | null;
  requirePlatformAdmin: (req: Request, res: Response) => boolean;
  mutateLimiter: any;
}

export function registerStripeTenantBillingRoutes(app: Express, helpers: Helpers) {
  // R74.13s SECURITY — seed-products mutates the platform's global Stripe catalog,
  // so it's process-global control plane. Upgraded from `isAdminRequest` (weak
  // header check) to `requirePlatformAdmin` (header + ADMIN_TENANT_ID session).
  const { getTenantFromRequest, requirePlatformAdmin, mutateLimiter } = helpers;

  app.post("/api/stripe/billing-portal", mutateLimiter, async (req: Request, res: Response) => {
    try {
      const tenantId = getTenantFromRequest(req);
      if (!tenantId) return res.status(401).json({ error: "Authentication required" });
      const tenant = await storage.getTenant(tenantId);
      if (!tenant) return res.status(404).json({ error: "Tenant not found" });
      const stripeCustomerId = (tenant as any).stripe_customer_id || (tenant as any).stripeCustomerId;
      if (!stripeCustomerId) return res.status(400).json({ error: "No Stripe customer ID found. Please subscribe to a plan first." });
      const stripe = await getUncachableStripeClient();
      if (!stripe) return res.status(500).json({ error: "Stripe not configured" });
      const returnUrl = `${req.protocol}://${req.get("host")}/settings`;
      const session = await stripe.billingPortal.sessions.create({ customer: stripeCustomerId, return_url: returnUrl });
      res.json({ url: session.url });
    } catch (err: any) {
      console.error("[billing-portal] Error:", err.message);
      res.status(500).json({ error: "Unable to open billing portal. Please try again later." });
    }
  });

  app.get("/api/stripe/payment-config", async (req: Request, res: Response) => {
    try {
      const tenantId = getTenantFromRequest(req);
      if (!tenantId) return res.status(401).json({ error: "Authentication required" });
      const tenant = await storage.getTenant(tenantId);
      if (!tenant) return res.status(404).json({ error: "Tenant not found" });

      res.json({
        paymentMode: tenant.stripePaymentMode,
        setupFeePaid: tenant.stripeSetupFeePaid,
        connectEnabled: tenant.stripeConnectEnabled,
        connectAccountId: tenant.stripeConnectAccountId || null,
        hasBYOKKeys: !!(tenant.stripeBYOKSecretKey && tenant.stripeBYOKPublishableKey),
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.put("/api/stripe/byok", mutateLimiter, validate(stripeBYOKSchema), async (req: Request, res: Response) => {
    try {
      const tenantId = getTenantFromRequest(req);
      if (!tenantId) return res.status(401).json({ error: "Authentication required" });
      const tenant = await storage.getTenant(tenantId);
      if (!tenant) return res.status(404).json({ error: "Tenant not found" });

      if (tenant.plan === "trial") {
        return res.status(403).json({ error: "Upgrade to a paid plan to use BYOK Stripe" });
      }

      if (!tenant.stripeSetupFeePaid) {
        return res.status(403).json({ error: "Setup fee must be paid before configuring BYOK Stripe" });
      }

      const { secretKey, publishableKey } = req.body;

      if (!secretKey.startsWith("sk_live_") && !secretKey.startsWith("sk_test_")) {
        return res.status(400).json({ error: "Secret key must start with sk_live_ or sk_test_" });
      }
      if (!publishableKey.startsWith("pk_live_") && !publishableKey.startsWith("pk_test_")) {
        return res.status(400).json({ error: "Publishable key must start with pk_live_ or pk_test_" });
      }

      try {
        const Stripe = (await import("stripe")).default;
        const testClient = new Stripe(secretKey, { apiVersion: "2025-08-27.basil" as any });
        await testClient.balance.retrieve();
      } catch (valErr: any) {
        return res.status(400).json({ error: "Invalid Stripe keys: " + valErr.message });
      }

      await storage.updateTenant(tenantId, {
        stripeBYOKSecretKey: encryptApiKey(secretKey),
        stripeBYOKPublishableKey: encryptApiKey(publishableKey),
        stripePaymentMode: "byok",
      });

      res.json({ success: true, message: "BYOK Stripe keys saved and validated" });
    } catch (err: any) {
      console.error("[stripe-byok] Error:", err.message);
      res.status(500).json({ error: err.message });
    }
  });

  app.delete("/api/stripe/byok", mutateLimiter, async (req: Request, res: Response) => {
    try {
      const tenantId = getTenantFromRequest(req);
      if (!tenantId) return res.status(401).json({ error: "Authentication required" });
      const tenant = await storage.getTenant(tenantId);
      if (!tenant) return res.status(404).json({ error: "Tenant not found" });

      await storage.updateTenant(tenantId, {
        stripeBYOKSecretKey: null,
        stripeBYOKPublishableKey: null,
        stripePaymentMode: tenant.stripeConnectEnabled ? "managed" : "none",
      });

      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/stripe/setup-fee-checkout", validate(stripeSetupFeeSchema), async (req: Request, res: Response) => {
    try {
      const tenantId = getTenantFromRequest(req);
      if (!tenantId) return res.status(401).json({ error: "Authentication required" });
      const tenant = await storage.getTenant(tenantId);
      if (!tenant) return res.status(404).json({ error: "Tenant not found" });

      if (tenant.stripeSetupFeePaid) {
        return res.status(400).json({ error: "Setup fee already paid" });
      }

      const { setupType } = req.body;

      const stripe = await getUncachableStripeClient();
      const baseUrl = (() => {
        const domain = process.env.REPLIT_DOMAINS?.split(",")[0];
        if (domain) return `https://${domain}`;
        return `${req.protocol}://${req.get("host")}`;
      })();

      const setupSessionData: any = {
        payment_method_types: ["card"],
        line_items: [{
          price_data: {
            currency: "usd",
            product_data: {
              name: setupType === "managed" ? `${(await import("../site-config")).siteConfig.platformName} Managed Stripe Setup` : `${(await import("../site-config")).siteConfig.platformName} BYOK Stripe Assistance`,
              description: setupType === "managed"
                ? "One-time setup fee for managed Stripe Connect integration with 3% platform fee"
                : "One-time setup assistance fee for Bring Your Own Key Stripe configuration",
            },
            unit_amount: setupType === "managed" ? 9900 : 2900,
          },
          quantity: 1,
        }],
        mode: "payment",
        success_url: `${baseUrl}/settings?setup_fee=success&type=${setupType}`,
        cancel_url: `${baseUrl}/settings?setup_fee=cancelled`,
        customer_email: tenant.email,
        metadata: {
          visionclaw_tenant_id: String(tenantId),
          setup_type: setupType,
          fee_type: "stripe_setup",
        },
      };

      const session = await stripe.checkout.sessions.create(setupSessionData, {
        idempotencyKey: buildCheckoutIdempotencyKey(tenantId, `setup_fee_${setupType}`, setupSessionData),
      });

      res.json({ url: session.url, sessionId: session.id });
    } catch (err: any) {
      console.error("[stripe-setup-fee] Error:", err.message);
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/stripe/seed-products", async (_req: Request, res: Response) => {
    if (!requirePlatformAdmin(_req, res)) return;
    try {
      const stripe = await getUncachableStripeClient();

      const tierDefs = [
        {
          name: "Starter",
          description: "1 AI persona, 100 conversations/mo, basic memory",
          price: 2900,
          metadata: { tier: "starter", personas: "1", conversations: "100", features: "basic_memory" },
        },
        {
          name: "Pro",
          description: "5 AI personas, unlimited conversations, full memory + knowledge, voice",
          price: 9900,
          metadata: { tier: "pro", personas: "5", conversations: "unlimited", features: "full_memory,knowledge,voice" },
        },
        {
          name: "Enterprise",
          description: "Full 12-agent team, autonomous heartbeat, analytics, priority support",
          price: 29900,
          metadata: { tier: "enterprise", personas: "12", conversations: "unlimited", features: "full_memory,knowledge,voice,heartbeat,analytics,priority_support" },
        },
      ];

      const created = [];
      for (const tier of tierDefs) {
        const product = await stripe.products.create({
          name: `VisionClaw ${tier.name}`,
          description: tier.description,
          metadata: tier.metadata,
        });

        const price = await stripe.prices.create({
          product: product.id,
          unit_amount: tier.price,
          currency: "usd",
          recurring: { interval: "month" },
        });

        created.push({
          product: { id: product.id, name: product.name },
          price: { id: price.id, unit_amount: price.unit_amount, currency: price.currency },
        });
      }

      res.json({ success: true, created });
    } catch (err: any) {
      console.error("[stripe-seed] Error:", err.message);
      res.status(500).json({ error: "Failed to seed Stripe products: " + err.message });
    }
  });
}
