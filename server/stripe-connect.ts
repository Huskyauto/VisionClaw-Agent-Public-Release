import { Router, Request, Response } from "express";
import { getUncachableStripeClient } from "./stripeClient";
import { storage } from "./storage";
import { getTenantFromRequest } from "./auth";

const router = Router();

function getBaseUrl(req: Request): string {
  const domain = process.env.REPLIT_DOMAINS?.split(",")[0];
  if (domain) return `https://${domain}`;
  return `${req.protocol}://${req.get("host")}`;
}

router.get("/status", async (req: Request, res: Response) => {
  try {
    const tenantId = getTenantFromRequest(req);
    const tenant = await storage.getTenant(tenantId);
    if (!tenant) return res.status(404).json({ error: "Tenant not found" });

    const result: any = {
      paymentMode: tenant.stripePaymentMode,
      setupFeePaid: tenant.stripeSetupFeePaid,
      connectEnabled: tenant.stripeConnectEnabled,
      connectAccountId: tenant.stripeConnectAccountId || null,
      hasBYOKKeys: !!(tenant.stripeBYOKSecretKey && tenant.stripeBYOKPublishableKey),
    };

    if (tenant.stripeConnectAccountId) {
      try {
        const stripe = await getUncachableStripeClient();
        const account = await stripe.accounts.retrieve(tenant.stripeConnectAccountId);
        result.connectDetails = {
          chargesEnabled: account.charges_enabled,
          payoutsEnabled: account.payouts_enabled,
          detailsSubmitted: account.details_submitted,
          businessType: account.business_type,
          country: account.country,
        };
      } catch (err: any) {
        result.connectDetails = null;
        result.connectError = err.message;
      }
    }

    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/create-account", async (req: Request, res: Response) => {
  try {
    const tenantId = getTenantFromRequest(req);
    const tenant = await storage.getTenant(tenantId);
    if (!tenant) return res.status(404).json({ error: "Tenant not found" });

    if (tenant.plan === "trial") {
      return res.status(403).json({ error: "Upgrade to a paid plan to use Stripe Connect" });
    }

    if (!tenant.stripeSetupFeePaid) {
      return res.status(403).json({ error: "Setup fee must be paid before connecting Stripe" });
    }

    if (tenant.stripeConnectAccountId) {
      return res.status(400).json({ error: "Stripe Connect account already exists", accountId: tenant.stripeConnectAccountId });
    }

    const stripe = await getUncachableStripeClient();

    const account = await stripe.accounts.create({
      type: "express",
      email: tenant.email,
      metadata: {
        visionclaw_tenant_id: String(tenantId),
      },
      capabilities: {
        card_payments: { requested: true },
        transfers: { requested: true },
      },
    });

    await storage.updateTenant(tenantId, {
      stripeConnectAccountId: account.id,
    });

    res.json({ accountId: account.id });
  } catch (err: any) {
    console.error("[stripe-connect] Create account error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

router.get("/onboarding-link", async (req: Request, res: Response) => {
  try {
    const tenantId = getTenantFromRequest(req);
    const tenant = await storage.getTenant(tenantId);
    if (!tenant) return res.status(404).json({ error: "Tenant not found" });

    if (!tenant.stripeConnectAccountId) {
      return res.status(400).json({ error: "No Connect account. Create one first." });
    }

    const stripe = await getUncachableStripeClient();
    const baseUrl = getBaseUrl(req);

    const accountLink = await stripe.accountLinks.create({
      account: tenant.stripeConnectAccountId,
      refresh_url: `${baseUrl}/settings?stripe_connect=refresh`,
      return_url: `${baseUrl}/settings?stripe_connect=complete`,
      type: "account_onboarding",
    });

    res.json({ url: accountLink.url });
  } catch (err: any) {
    console.error("[stripe-connect] Onboarding link error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

router.post("/complete-onboarding", async (req: Request, res: Response) => {
  try {
    const tenantId = getTenantFromRequest(req);
    const tenant = await storage.getTenant(tenantId);
    if (!tenant || !tenant.stripeConnectAccountId) {
      return res.status(400).json({ error: "No Connect account found" });
    }

    const stripe = await getUncachableStripeClient();
    const account = await stripe.accounts.retrieve(tenant.stripeConnectAccountId);

    if (account.charges_enabled && account.details_submitted) {
      await storage.updateTenant(tenantId, {
        stripeConnectEnabled: true,
        stripePaymentMode: "managed",
      });

      return res.json({
        success: true,
        chargesEnabled: true,
        payoutsEnabled: account.payouts_enabled,
      });
    }

    res.json({
      success: false,
      chargesEnabled: account.charges_enabled,
      detailsSubmitted: account.details_submitted,
      message: "Onboarding not yet complete. Please finish all required steps in Stripe.",
    });
  } catch (err: any) {
    console.error("[stripe-connect] Complete onboarding error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

router.delete("/disconnect", async (req: Request, res: Response) => {
  try {
    const tenantId = getTenantFromRequest(req);
    const tenant = await storage.getTenant(tenantId);
    if (!tenant) return res.status(404).json({ error: "Tenant not found" });

    if (!tenant.stripeConnectAccountId) {
      return res.status(400).json({ error: "No Connect account to disconnect" });
    }

    await storage.updateTenant(tenantId, {
      stripeConnectAccountId: null,
      stripeConnectEnabled: false,
      stripePaymentMode: tenant.stripeBYOKSecretKey ? "byok" : "none",
    });

    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
