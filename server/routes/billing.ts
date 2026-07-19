import type { Express, Request, Response } from "express";
import { sql } from "drizzle-orm";
import { db } from "../db";
import { storage } from "../storage";
import { getUncachableStripeClient } from "../stripeClient";

type BillingHelpers = {
  getTenantFromRequest: (req: Request) => number | null;
  mutateLimiter: any;
};

export function registerBillingRoutes(app: Express, helpers: BillingHelpers) {
  const { getTenantFromRequest, mutateLimiter } = helpers;

  // ─── Subscription Management ─────────────────────────
  // R74.13v: mutateLimiter wired in to throttle Stripe-side product/price/session
  // creation bursts. Pre-extraction monolith was unthrottled — verbatim cut
  // preserved that gap; now closed. /api/subscribe creates a fresh Stripe
  // product+price+checkout-session each call, so unbounded retries are costly.
  app.post("/api/subscribe", mutateLimiter, async (req: Request, res: Response) => {
    try {
      const tenantId = getTenantFromRequest(req);
      if (!tenantId) return res.status(401).json({ error: "Unauthorized" });

      const { plan } = req.body;
      if (!plan || !["starter", "pro", "enterprise"].includes(plan)) {
        return res.status(400).json({ error: "Invalid plan. Choose: starter, pro, or enterprise" });
      }

      const priceMap: Record<string, number> = { starter: 2900, pro: 9900, enterprise: 29900 };
      const tenant = await storage.getTenant(tenantId);
      if (!tenant) return res.status(404).json({ error: "Tenant not found" });

      const stripe = await getUncachableStripeClient();
      const domains = process.env.REPLIT_DOMAINS || process.env.REPLIT_DEV_DOMAIN || "";
      const primaryDomain = domains.split(",")[0]?.trim();
      const baseUrl = primaryDomain ? `https://${primaryDomain}` : `${req.protocol}://${req.get('host')}`;

      // Idempotency key keyed on (tenantId, plan) so a double-click or retry
      // reuses the SAME product/price/session within Stripe's 24h window —
      // otherwise each retry creates a fresh duplicate product+price+session.
      const subIdempBase = `vc_subscribe_${tenantId}_${plan}`;
      const product = await stripe.products.create({
        name: `VisionClaw ${plan.charAt(0).toUpperCase() + plan.slice(1)} Plan`,
        metadata: { plan, tenantId: String(tenantId) },
      }, { idempotencyKey: `${subIdempBase}_product` });

      const price = await stripe.prices.create({
        product: product.id,
        unit_amount: priceMap[plan],
        currency: "usd",
        recurring: { interval: "month" },
      }, { idempotencyKey: `${subIdempBase}_price` });

      const subscribeSessionData: any = {
        payment_method_types: ["card"],
        line_items: [{ price: price.id, quantity: 1 }],
        mode: "subscription",
        success_url: `${baseUrl}/?subscription=success&plan=${plan}`,
        cancel_url: `${baseUrl}/?subscription=cancelled`,
        customer_email: tenant.email || undefined,
        metadata: { tenantId: String(tenantId), plan },
        subscription_data: {
          metadata: { tenantId: String(tenantId), plan },
        },
      };

      const session = await stripe.checkout.sessions.create(subscribeSessionData, {
        idempotencyKey: `${subIdempBase}_session`,
      });

      res.json({ url: session.url, sessionId: session.id });
    } catch (err: any) {
      console.error("[subscribe] Error:", err.message);
      res.status(500).json({ error: "Failed to create subscription checkout" });
    }
  });

  app.post("/api/subscribe/activate", mutateLimiter, async (req: Request, res: Response) => {
    try {
      const tenantId = getTenantFromRequest(req);
      if (!tenantId) return res.status(401).json({ error: "Unauthorized" });

      const { plan, sessionId } = req.body;
      if (!plan || !["starter", "pro", "enterprise"].includes(plan)) {
        return res.status(400).json({ error: "Invalid plan" });
      }
      if (!sessionId || typeof sessionId !== "string") {
        return res.status(400).json({ error: "sessionId required" });
      }

      const stripe = await getUncachableStripeClient();
      const session = await stripe.checkout.sessions.retrieve(sessionId);

      if (session.payment_status !== "paid" && session.status !== "complete") {
        return res.status(402).json({ error: "Payment not completed" });
      }

      const sessionTenantId = session.metadata?.tenantId;
      if (!sessionTenantId || parseInt(sessionTenantId, 10) !== tenantId) {
        return res.status(403).json({ error: "Session does not belong to this account" });
      }

      const sessionPlan = session.metadata?.plan;
      if (sessionPlan !== plan) {
        return res.status(400).json({ error: "Plan mismatch" });
      }

      await db.execute(sql`
        UPDATE tenants SET plan = ${plan} WHERE id = ${tenantId}
      `);

      console.log(`[subscribe] Tenant ${tenantId} upgraded to ${plan} (verified session: ${sessionId})`);
      res.json({ success: true, plan });
    } catch (err: any) {
      console.error("[subscribe/activate] Error:", err.message);
      res.status(500).json({ error: "Failed to verify and activate plan" });
    }
  });

  app.get("/api/subscription", async (req: Request, res: Response) => {
    try {
      const tenantId = getTenantFromRequest(req);
      if (!tenantId) return res.status(401).json({ error: "Unauthorized" });

      const result = await db.execute(sql`
        SELECT plan, trial_max_conversations, trial_conversations_used FROM tenants WHERE id = ${tenantId}
      `);
      const row = (result as any).rows?.[0];
      if (!row) return res.status(404).json({ error: "Tenant not found" });

      const { PLAN_LIMITS, hasByokKeys, getEffectivePlan } = await import("../usage-metering");
      const basePlan = row.plan || "trial";
      const byokActive = await hasByokKeys(tenantId);
      const effectivePlan = getEffectivePlan(basePlan, byokActive);
      const limits = PLAN_LIMITS[effectivePlan] || PLAN_LIMITS.trial;

      res.json({
        plan: basePlan,
        effectivePlan,
        byokActive,
        limits,
        trialMaxConversations: row.trial_max_conversations,
        trialConversationsUsed: row.trial_conversations_used,
      });
    } catch (err: any) {
      res.json({ plan: "trial", limits: {}, byokActive: false });
    }
  });

  // ─── Usage Metering ──────────────────────────────────
  app.get("/api/usage", async (req: Request, res: Response) => {
    try {
      const tenantId = getTenantFromRequest(req);
      if (!tenantId) return res.status(401).json({ error: "Unauthorized" });
      const { getUsageSummary } = await import("../usage-metering");
      const summary = await getUsageSummary(tenantId);
      res.json(summary);
    } catch (err: any) {
      res.json({ messagestoday: 0, toolCallsToday: 0, conversationsThisMonth: 0, limits: { messagesPerDay: -1, toolCallsPerDay: -1, conversationsPerMonth: -1, maxPersonas: 12 }, plan: "trial" });
    }
  });
}
