import Stripe from 'stripe';
import crypto from 'crypto';
import { decryptApiKey } from './crypto';

// Canonical JSON.stringify — recursively sorts object keys so that two
// equivalent intents built with different key insertion orders produce the
// same fingerprint. Without this, the same logical checkout could generate
// different idempotency keys across server restarts or code paths and
// silently miss Stripe's 24h dedup window.
function canonicalStringify(value: any): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(canonicalStringify).join(",") + "]";
  const keys = Object.keys(value).sort();
  return "{" + keys.map(k => JSON.stringify(k) + ":" + canonicalStringify(value[k])).join(",") + "}";
}

// Build a deterministic Stripe idempotency key for a checkout request. Stripe
// dedupes identical requests within 24h, so a double-clicked checkout button
// (or network retry) returns the SAME session instead of creating a duplicate.
// Different intents (different items / amounts / urls) produce different keys.
export function buildCheckoutIdempotencyKey(tenantId: number | string, mode: string, sessionData: any): string {
  const fingerprint = crypto.createHash("sha256")
    .update(canonicalStringify({
      lineItems: sessionData.line_items,
      successUrl: sessionData.success_url,
      cancelUrl: sessionData.cancel_url,
      mode: sessionData.mode,
      payment_intent_data: sessionData.payment_intent_data,
      metadata: sessionData.metadata,
      customer: sessionData.customer,
      customer_email: sessionData.customer_email,
    }))
    .digest("hex")
    .slice(0, 24);
  return `vc_checkout_${mode}_${tenantId}_${fingerprint}`;
}

let connectionSettings: any;

async function getCredentials() {
  if (process.env.STRIPE_LIVE_SECRET_KEY) {
    return {
      publishableKey: process.env.STRIPE_LIVE_PUBLISHABLE_KEY || '',
      secretKey: process.env.STRIPE_LIVE_SECRET_KEY,
    };
  }

  const hostname = process.env.REPLIT_CONNECTORS_HOSTNAME;
  const xReplitToken = process.env.REPL_IDENTITY
    ? 'repl ' + process.env.REPL_IDENTITY
    : process.env.WEB_REPL_RENEWAL
      ? 'depl ' + process.env.WEB_REPL_RENEWAL
      : null;

  if (!xReplitToken) {
    throw new Error('X-Replit-Token not found for repl/depl');
  }

  const connectorName = 'stripe';
  const isProduction = process.env.REPLIT_DEPLOYMENT === '1';
  const targetEnvironment = isProduction ? 'production' : 'development';

  const url = new URL(`https://${hostname}/api/v2/connection`);
  url.searchParams.set('include_secrets', 'true');
  url.searchParams.set('connector_names', connectorName);
  url.searchParams.set('environment', targetEnvironment);

  const response = await fetch(url.toString(), {
    headers: {
      'Accept': 'application/json',
      'X-Replit-Token': xReplitToken
    }
  });

  const data = await response.json();

  connectionSettings = data.items?.[0];

  if (!connectionSettings || (!connectionSettings.settings.publishable || !connectionSettings.settings.secret)) {
    throw new Error(`Stripe ${targetEnvironment} connection not found`);
  }

  return {
    publishableKey: connectionSettings.settings.publishable,
    secretKey: connectionSettings.settings.secret,
  };
}

export async function getUncachableStripeClient() {
  const { secretKey } = await getCredentials();

  return new Stripe(secretKey, {
    apiVersion: '2025-08-27.basil' as any,
  });
}

export async function getStripePublishableKey() {
  const { publishableKey } = await getCredentials();
  return publishableKey;
}

export async function getStripeSecretKey() {
  const { secretKey } = await getCredentials();
  return secretKey;
}

export async function getTenantStripeClient(tenantId: number): Promise<{ stripe: Stripe; mode: string } | null> {
  const { storage } = await import('./storage');
  const tenant = await storage.getTenant(tenantId);
  if (!tenant) return null;

  if (tenant.stripePaymentMode === "managed" && tenant.stripeConnectAccountId && tenant.stripeConnectEnabled) {
    const platformStripe = await getUncachableStripeClient();
    return { stripe: platformStripe, mode: "managed" };
  }

  if (tenant.stripePaymentMode === "byok" && tenant.stripeBYOKSecretKey) {
    const decryptedKey = decryptApiKey(tenant.stripeBYOKSecretKey);
    const byokStripe = new Stripe(decryptedKey, {
      apiVersion: '2025-08-27.basil' as any,
    });
    return { stripe: byokStripe, mode: "byok" };
  }

  return null;
}

export async function createTenantCheckoutSession(
  tenantId: number,
  params: {
    lineItems: Array<{ name: string; description?: string; amount: number; currency?: string; quantity?: number }>;
    successUrl: string;
    cancelUrl: string;
    customerEmail?: string;
    metadata?: Record<string, string>;
  }
): Promise<{ url: string | null; sessionId: string } | null> {
  const { storage } = await import('./storage');
  const tenant = await storage.getTenant(tenantId);
  if (!tenant) return null;

  const lineItems = params.lineItems.map(item => ({
    price_data: {
      currency: item.currency || "usd",
      product_data: {
        name: item.name,
        ...(item.description ? { description: item.description } : {}),
      },
      unit_amount: item.amount,
    },
    quantity: item.quantity || 1,
  }));

  const sessionData: any = {
    payment_method_types: ["card"],
    line_items: lineItems,
    mode: "payment",
    success_url: params.successUrl,
    cancel_url: params.cancelUrl,
    metadata: {
      ...params.metadata,
      visionclaw_tenant_id: String(tenantId),
    },
  };

  if (params.customerEmail) {
    sessionData.customer_email = params.customerEmail;
  }

  if (tenant.stripePaymentMode === "managed" && tenant.stripeConnectAccountId && tenant.stripeConnectEnabled) {
    const platformStripe = await getUncachableStripeClient();
    const applicationFeePercent = 3;
    const totalAmount = params.lineItems.reduce((sum, item) => sum + item.amount * (item.quantity || 1), 0);
    const applicationFeeAmount = Math.round(totalAmount * applicationFeePercent / 100);

    sessionData.payment_intent_data = {
      application_fee_amount: applicationFeeAmount,
      transfer_data: {
        destination: tenant.stripeConnectAccountId,
      },
    };

    const session = await platformStripe.checkout.sessions.create(sessionData, {
      idempotencyKey: buildCheckoutIdempotencyKey(tenantId, "managed", sessionData),
    });
    return { url: session.url, sessionId: session.id };
  }

  if (tenant.stripePaymentMode === "byok" && tenant.stripeBYOKSecretKey) {
    const decryptedKey = decryptApiKey(tenant.stripeBYOKSecretKey);
    const byokStripe = new Stripe(decryptedKey, {
      apiVersion: '2025-08-27.basil' as any,
    });
    const session = await byokStripe.checkout.sessions.create(sessionData, {
      idempotencyKey: buildCheckoutIdempotencyKey(tenantId, "byok", sessionData),
    });
    return { url: session.url, sessionId: session.id };
  }

  return null;
}

let stripeSync: any = null;

export async function getStripeSync() {
  if (!stripeSync) {
    const { StripeSync } = await import('stripe-replit-sync');
    const secretKey = await getStripeSecretKey();

    stripeSync = new StripeSync({
      poolConfig: {
        connectionString: process.env.DATABASE_URL!,
        max: 2,
      },
      stripeSecretKey: secretKey,
    });
  }
  return stripeSync;
}
