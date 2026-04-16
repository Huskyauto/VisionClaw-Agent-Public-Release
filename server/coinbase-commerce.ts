import { Router, Request, Response } from "express";
import { storage } from "./storage";
import { getTenantFromRequest, isAdminRequest, ADMIN_TENANT_ID } from "./auth";
import { db } from "./db";
import { sql } from "drizzle-orm";
import crypto from "crypto";

const router = Router();
const COMMERCE_API_BASE = "https://api.commerce.coinbase.com";

function getAdminApiKeyId(): string | null {
  return process.env.COINBASE_CDP_API_KEY_ID || null;
}

function getAdminApiKeySecret(): string | null {
  return process.env.COINBASE_COMMERCE_API_KEY || null;
}

function getAdminCommerceApiKey(): string | null {
  return process.env.COINBASE_COMMERCE_LEGACY_KEY || null;
}

interface TenantCoinbaseKeys {
  commerceApiKey: string | null;
  cdpApiKeyId: string | null;
  cdpApiKeySecret: string | null;
  webhookSecret: string | null;
}

async function getTenantCoinbaseKeys(tenantId: number): Promise<TenantCoinbaseKeys> {
  const result = await db.execute(sql`
    SELECT coinbase_commerce_api_key, coinbase_cdp_api_key_id, 
           coinbase_cdp_api_key_secret, coinbase_commerce_webhook_secret
    FROM tenants WHERE id = ${tenantId}
  `);
  const rows = (result as any).rows || result;
  const row = rows?.[0];
  return {
    commerceApiKey: row?.coinbase_commerce_api_key || null,
    cdpApiKeyId: row?.coinbase_cdp_api_key_id || null,
    cdpApiKeySecret: row?.coinbase_cdp_api_key_secret || null,
    webhookSecret: row?.coinbase_commerce_webhook_secret || null,
  };
}

function getEffectiveCommerceKey(tenantKeys: TenantCoinbaseKeys, isAdmin: boolean): string | null {
  if (tenantKeys.commerceApiKey) return tenantKeys.commerceApiKey;
  if (isAdmin) return getAdminCommerceApiKey();
  return null;
}

function getEffectiveCdpKeys(tenantKeys: TenantCoinbaseKeys, isAdmin: boolean): { keyId: string | null; keySecret: string | null } {
  if (tenantKeys.cdpApiKeyId && tenantKeys.cdpApiKeySecret) {
    return { keyId: tenantKeys.cdpApiKeyId, keySecret: tenantKeys.cdpApiKeySecret };
  }
  if (isAdmin) return { keyId: getAdminApiKeyId(), keySecret: getAdminApiKeySecret() };
  return { keyId: null, keySecret: null };
}

const tenantCdpClients = new Map<number | string, any>();

async function getCdpClientForTenant(tenantId: number | undefined, tenantKeys: TenantCoinbaseKeys, isAdmin: boolean) {
  const { keyId, keySecret } = getEffectiveCdpKeys(tenantKeys, isAdmin);
  if (!keyId || !keySecret) throw new Error("Coinbase CDP credentials not configured");

  const cacheKey = tenantKeys.cdpApiKeyId ? tenantId || "admin" : "admin";
  if (tenantCdpClients.has(cacheKey)) return tenantCdpClients.get(cacheKey);

  const cdpModule = await import("@coinbase/cdp-sdk");
  const CdpClient = cdpModule.CdpClient || (cdpModule as any).default?.CdpClient;
  if (!CdpClient) throw new Error("CdpClient not found in module");

  const client = new CdpClient({
    apiKeyId: keyId,
    apiKeySecret: keySecret,
    walletSecret: isAdmin ? (process.env.COINBASE_CDP_WALLET_SECRET || undefined) : undefined,
  });
  tenantCdpClients.set(cacheKey, client);
  return client;
}

async function commerceRequestForTenant(method: string, endpoint: string, commerceKey: string, body?: any): Promise<any> {
  const url = `${COMMERCE_API_BASE}${endpoint}`;
  const response = await fetch(url, {
    method,
    headers: {
      "Content-Type": "application/json",
      "Accept": "application/json",
      "X-CC-Api-Key": commerceKey,
      "X-CC-Version": "2018-03-22",
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Commerce API error (${response.status}): ${text.substring(0, 200)}`);
  }

  return JSON.parse(text);
}

router.get("/status", async (req: Request, res: Response) => {
  try {
    const tenantId = getTenantFromRequest(req);
    if (!tenantId) return res.status(401).json({ error: "Unauthorized" });

    const isAdmin = tenantId === ADMIN_TENANT_ID;
    const tenantKeys = await getTenantCoinbaseKeys(tenantId);
    const commerceKey = getEffectiveCommerceKey(tenantKeys, isAdmin);
    const { keyId, keySecret } = getEffectiveCdpKeys(tenantKeys, isAdmin);

    const hasOwnKeys = !!(tenantKeys.commerceApiKey || tenantKeys.cdpApiKeyId);

    if (!keyId && !keySecret && !commerceKey) {
      return res.json({
        configured: false,
        hasOwnKeys: false,
        message: "No Coinbase credentials configured",
      });
    }

    let cdpConnected = false;
    let commerceConnected = false;
    const errors: string[] = [];
    let walletAddress: string | null = null;

    if (keyId && keySecret) {
      try {
        const client = await getCdpClientForTenant(tenantId, tenantKeys, isAdmin);
        const accounts = await client.evm.listAccounts();
        cdpConnected = true;
        if (accounts?.accounts?.length > 0) {
          walletAddress = accounts.accounts[0].address;
        }
      } catch (err: any) {
        errors.push(`CDP: ${err.message}`);
      }
    }

    if (commerceKey) {
      try {
        await commerceRequestForTenant("GET", "/charges?limit=1", commerceKey);
        commerceConnected = true;
      } catch (err: any) {
        errors.push(`Commerce: ${err.message}`);
      }
    }

    return res.json({
      configured: true,
      hasOwnKeys,
      cdpConnected,
      commerceConnected,
      connected: cdpConnected || commerceConnected,
      walletAddress,
      errors: errors.length > 0 ? errors : undefined,
      message: cdpConnected
        ? commerceConnected
          ? "CDP Wallet + Commerce both connected"
          : "CDP Wallet connected — receive crypto directly"
        : commerceConnected
          ? "Commerce checkout connected"
          : "Credentials set but connection failed",
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/keys", async (req: Request, res: Response) => {
  try {
    const tenantId = getTenantFromRequest(req);
    if (!tenantId) return res.status(401).json({ error: "Unauthorized" });

    const tenantKeys = await getTenantCoinbaseKeys(tenantId);

    res.json({
      hasCommerceKey: !!tenantKeys.commerceApiKey,
      hasCdpKeys: !!(tenantKeys.cdpApiKeyId && tenantKeys.cdpApiKeySecret),
      hasWebhookSecret: !!tenantKeys.webhookSecret,
      commerceKeyPreview: tenantKeys.commerceApiKey ? `${tenantKeys.commerceApiKey.slice(0, 8)}...` : null,
      cdpKeyIdPreview: tenantKeys.cdpApiKeyId ? `${tenantKeys.cdpApiKeyId.slice(0, 8)}...` : null,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.put("/keys", async (req: Request, res: Response) => {
  try {
    const tenantId = getTenantFromRequest(req);
    if (!tenantId) return res.status(401).json({ error: "Unauthorized" });

    const { commerceApiKey, cdpApiKeyId, cdpApiKeySecret, webhookSecret } = req.body;

    if (commerceApiKey !== undefined) {
      await db.execute(sql`UPDATE tenants SET coinbase_commerce_api_key = ${commerceApiKey || null} WHERE id = ${tenantId}`);
    }
    if (cdpApiKeyId !== undefined) {
      await db.execute(sql`UPDATE tenants SET coinbase_cdp_api_key_id = ${cdpApiKeyId || null} WHERE id = ${tenantId}`);
    }
    if (cdpApiKeySecret !== undefined) {
      await db.execute(sql`UPDATE tenants SET coinbase_cdp_api_key_secret = ${cdpApiKeySecret || null} WHERE id = ${tenantId}`);
    }
    if (webhookSecret !== undefined) {
      await db.execute(sql`UPDATE tenants SET coinbase_commerce_webhook_secret = ${webhookSecret || null} WHERE id = ${tenantId}`);
    }

    tenantCdpClients.delete(tenantId);

    console.log(`[coinbase] Tenant ${tenantId} updated Coinbase keys`);
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.delete("/keys", async (req: Request, res: Response) => {
  try {
    const tenantId = getTenantFromRequest(req);
    if (!tenantId) return res.status(401).json({ error: "Unauthorized" });

    await db.execute(sql`
      UPDATE tenants SET 
        coinbase_commerce_api_key = NULL,
        coinbase_cdp_api_key_id = NULL,
        coinbase_cdp_api_key_secret = NULL,
        coinbase_commerce_webhook_secret = NULL
      WHERE id = ${tenantId}
    `);

    tenantCdpClients.delete(tenantId);

    console.log(`[coinbase] Tenant ${tenantId} cleared all Coinbase keys`);
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/wallet/create", async (req: Request, res: Response) => {
  try {
    const tenantId = getTenantFromRequest(req);
    if (!tenantId) return res.status(401).json({ error: "Unauthorized" });

    const isAdmin = tenantId === ADMIN_TENANT_ID;
    const tenantKeys = await getTenantCoinbaseKeys(tenantId);

    const { name = "visionclaw-primary", network = "base" } = req.body;
    const client = await getCdpClientForTenant(tenantId, tenantKeys, isAdmin);

    if (isAdmin && !process.env.COINBASE_CDP_WALLET_SECRET) {
      return res.status(400).json({
        error: "Wallet Secret required",
        message: "To create wallets, add COINBASE_CDP_WALLET_SECRET in your Coinbase CDP portal under 'Server Wallet' settings.",
        needsWalletSecret: true,
      });
    }

    const account = await client.evm.getOrCreateAccount({ name });
    const address = account.address;

    let balances: any[] = [];
    try {
      const balanceResult = await client.evm.listTokenBalances({ address, network });
      balances = (balanceResult?.balances || []).map((b: any) => ({
        token: b.token?.symbol || "Unknown",
        amount: b.amount || "0",
        decimals: b.token?.decimals,
      }));
    } catch {}

    res.json({
      address,
      name,
      network,
      balances,
    });
  } catch (err: any) {
    console.error("[coinbase] Wallet create error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

router.get("/wallet/balance", async (req: Request, res: Response) => {
  try {
    const tenantId = getTenantFromRequest(req);
    if (!tenantId) return res.status(401).json({ error: "Unauthorized" });

    const isAdmin = tenantId === ADMIN_TENANT_ID;
    const tenantKeys = await getTenantCoinbaseKeys(tenantId);

    const { address, network = "base" } = req.query as { address?: string; network?: string };
    const client = await getCdpClientForTenant(tenantId, tenantKeys, isAdmin);

    let walletAddress = address;
    if (!walletAddress) {
      const accounts = await client.evm.listAccounts();
      if (accounts?.accounts?.length > 0) {
        walletAddress = accounts.accounts[0].address;
      } else {
        return res.json({ address: null, network, balances: [] });
      }
    }

    const balanceResult = await client.evm.listTokenBalances({
      address: walletAddress,
      network,
    });

    const balances = (balanceResult?.balances || []).map((b: any) => ({
      token: b.token?.symbol || "Unknown",
      name: b.token?.name || "Unknown",
      amount: b.amount || "0",
      decimals: b.token?.decimals,
      network,
    }));

    res.json({
      address: walletAddress,
      network,
      balances,
    });
  } catch (err: any) {
    console.error("[coinbase] Balance error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

router.get("/wallet/accounts", async (req: Request, res: Response) => {
  try {
    const tenantId = getTenantFromRequest(req);
    if (!tenantId) return res.status(401).json({ error: "Unauthorized" });

    const isAdmin = tenantId === ADMIN_TENANT_ID;
    const tenantKeys = await getTenantCoinbaseKeys(tenantId);

    const client = await getCdpClientForTenant(tenantId, tenantKeys, isAdmin);
    const accounts = await client.evm.listAccounts();

    const formatted = (accounts || []).map((a: any) => ({
      address: a.address,
      name: a.name,
    }));

    res.json({ accounts: formatted });
  } catch (err: any) {
    console.error("[coinbase] List accounts error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

router.post("/create-charge", async (req: Request, res: Response) => {
  try {
    const tenantId = getTenantFromRequest(req);
    if (!tenantId) return res.status(401).json({ error: "Unauthorized" });

    const tenant = await storage.getTenant(tenantId);
    if (!tenant) return res.status(404).json({ error: "Tenant not found" });

    const isAdmin = tenantId === ADMIN_TENANT_ID;
    const tenantKeys = await getTenantCoinbaseKeys(tenantId);
    const commerceKey = getEffectiveCommerceKey(tenantKeys, isAdmin);
    if (!commerceKey) {
      return res.status(400).json({ error: "Commerce API key not configured. Add your Coinbase Commerce API key in Settings." });
    }

    const { name, description, amount, currency = "USD", metadata = {} } = req.body;

    if (!name || !amount) {
      return res.status(400).json({ error: "name and amount are required" });
    }

    const parsedAmount = parseFloat(amount);
    if (isNaN(parsedAmount) || parsedAmount <= 0) {
      return res.status(400).json({ error: "amount must be a positive number" });
    }

    const domain = process.env.REPLIT_DOMAINS?.split(",")[0];
    const baseUrl = domain ? `https://${domain}` : `${req.protocol}://${req.get("host")}`;

    const chargeData = {
      name,
      description: description || `Payment for ${name}`,
      pricing_type: "fixed_price",
      local_price: {
        amount: parsedAmount.toFixed(2),
        currency: currency.toUpperCase(),
      },
      metadata: {
        ...metadata,
        visionclaw_tenant_id: String(tenantId),
        tenant_email: tenant.email || "",
      },
      redirect_url: `${baseUrl}/settings#payments`,
      cancel_url: `${baseUrl}/settings#payments`,
    };

    const result = await commerceRequestForTenant("POST", "/charges", commerceKey, chargeData);

    res.json({
      id: result.data.id,
      code: result.data.code,
      hosted_url: result.data.hosted_url,
      expires_at: result.data.expires_at,
      pricing: result.data.pricing,
    });
  } catch (err: any) {
    console.error("[coinbase] Create charge error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

router.get("/charges", async (req: Request, res: Response) => {
  try {
    const tenantId = getTenantFromRequest(req);
    if (!tenantId) return res.status(401).json({ error: "Unauthorized" });

    const isAdmin = tenantId === ADMIN_TENANT_ID;
    const tenantKeys = await getTenantCoinbaseKeys(tenantId);
    const commerceKey = getEffectiveCommerceKey(tenantKeys, isAdmin);
    if (!commerceKey) {
      return res.json({ charges: [] });
    }

    const result = await commerceRequestForTenant("GET", "/charges?limit=25&order=desc", commerceKey);

    const charges = (result.data || []).map((c: any) => ({
      id: c.id,
      code: c.code,
      name: c.name,
      description: c.description,
      status: c.timeline?.[c.timeline.length - 1]?.status || "NEW",
      amount: c.pricing?.local?.amount,
      currency: c.pricing?.local?.currency,
      hosted_url: c.hosted_url,
      created_at: c.created_at,
      expires_at: c.expires_at,
    }));

    res.json({ charges });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/webhook", async (req: Request, res: Response) => {
  try {
    const signature = req.headers["x-cc-webhook-signature"] as string;

    const event = req.body;
    const eventType = event?.event?.type;
    const chargeData = event?.event?.data;
    const tenantIdStr = chargeData?.metadata?.visionclaw_tenant_id;

    let webhookSecret = process.env.COINBASE_COMMERCE_WEBHOOK_SECRET || null;

    if (tenantIdStr) {
      const tId = parseInt(tenantIdStr, 10);
      if (!isNaN(tId)) {
        const tenantKeys = await getTenantCoinbaseKeys(tId);
        if (tenantKeys.webhookSecret) {
          webhookSecret = tenantKeys.webhookSecret;
        }
      }
    }

    if (webhookSecret) {
      if (!signature) {
        console.warn("[coinbase] Webhook rejected: signature header missing");
        return res.status(400).json({ error: "Missing webhook signature" });
      }
      const rawBody = JSON.stringify(req.body);
      const expectedSig = crypto
        .createHmac("sha256", webhookSecret)
        .update(rawBody)
        .digest("hex");

      if (signature !== expectedSig) {
        return res.status(400).json({ error: "Invalid signature" });
      }
    } else {
      console.warn("[coinbase] Webhook processed without signature verification — no webhook secret configured");
    }

    console.log(`[coinbase] Webhook event: ${eventType}`, chargeData?.code);

    if (eventType === "charge:confirmed" || eventType === "charge:resolved") {
      if (tenantIdStr) {
        const tenantId = parseInt(tenantIdStr, 10);
        console.log(`[coinbase] Payment confirmed for tenant ${tenantId}: ${chargeData?.code}`);
      }
    }

    res.json({ received: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
