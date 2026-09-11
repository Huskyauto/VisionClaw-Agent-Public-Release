// R74.13t — Stage 22 of routes.ts decomposition.
// 5 routes for Tenant BYOK ("Bring Your Own Key") — per-tenant provider key
// management (not platform-level keys; those live in platform-config.ts).
// /api/tenant/{provider-keys (GET, /:provider PUT, /:provider DELETE),
// provider-status (GET)}. All routes tenant-scoped via getTenantFromRequest
// (no platform-admin gate — each tenant manages their own keys).
// Preserves the exact unicode-sanitization pipeline (en-dash, em-dash, smart
// quotes → ASCII) from routes.ts; chars outside printable ASCII are stripped.
// Extracted verbatim from server/routes.ts L4567-L4653.
import type { Express, Request, Response } from "express";
import { storage } from "../storage";
import { maskApiKey, PROVIDER_CONFIG, clearClientCache } from "../providers";

type TenantBYOKHelpers = {
  getTenantFromRequest: (req: Request) => number | null;
};

export function registerTenantBYOKRoutes(app: Express, helpers: TenantBYOKHelpers) {
  const { getTenantFromRequest } = helpers;

  // ─── Tenant BYOK Keys (Bring Your Own Key) ──────────────
  app.get("/api/tenant/provider-keys", async (req, res) => {
    const tenantId = getTenantFromRequest(req);
    if (!tenantId) return res.status(401).json({ error: "Unauthorized" });
    const keys = await storage.getTenantProviderKeys(tenantId);
    const masked = keys.map((k: any) => ({
      id: k.id,
      provider: k.provider,
      label: k.label,
      enabled: k.enabled,
      apiKey: maskApiKey(k.api_key),
      lastVerifiedAt: k.last_verified_at,
      lastError: k.last_error,
      consecutiveFailures: k.consecutive_failures,
    }));
    res.json(masked);
  });

  app.put("/api/tenant/provider-keys/:provider", async (req, res) => {
    const tenantId = getTenantFromRequest(req);
    if (!tenantId) return res.status(401).json({ error: "Unauthorized" });
    const { provider } = req.params;
    const validProviders = Object.keys(PROVIDER_CONFIG).filter((p) => p !== "replit");
    if (!validProviders.includes(provider)) {
      return res.status(400).json({ error: "Invalid provider" });
    }
    const rawKey = typeof req.body.apiKey === "string" ? req.body.apiKey.trim() : "";
    if (!rawKey) return res.status(400).json({ error: "API key required" });
    const sanitizedKey = rawKey
      .replace(/\u2014/g, "-")
      .replace(/\u2013/g, "-")
      .replace(/\u2018|\u2019/g, "'")
      .replace(/\u201C|\u201D/g, '"')
      .replace(/[^\x20-\x7E]/g, "");
    if (!sanitizedKey) return res.status(400).json({ error: "Invalid API key format" });

    clearClientCache();
    const result = await storage.upsertTenantProviderKey(tenantId, provider, sanitizedKey, req.body.label);
    res.json({
      provider,
      label: result?.label,
      apiKey: maskApiKey(sanitizedKey),
      status: "saved",
    });
  });

  app.delete("/api/tenant/provider-keys/:provider", async (req, res) => {
    const tenantId = getTenantFromRequest(req);
    if (!tenantId) return res.status(401).json({ error: "Unauthorized" });
    clearClientCache();
    await storage.deleteTenantProviderKey(tenantId, (req.params.provider as string));
    res.json({ ok: true });
  });

  app.get("/api/tenant/provider-status", async (req, res) => {
    const tenantId = getTenantFromRequest(req);
    if (!tenantId) return res.status(401).json({ error: "Unauthorized" });
    const tenantKeys = await storage.getTenantProviderKeys(tenantId);
    const platformKeys = await storage.getProviderKeys();

    const providers = Object.keys(PROVIDER_CONFIG).filter(p => p !== "replit").map(provider => {
      const tenantKey = tenantKeys.find((k: any) => k.provider === provider && k.enabled);
      const platformKey = platformKeys.find(k => k.provider === provider && k.enabled && k.apiKey);
      // R74.13s — `isReplit` was always false (replit is filtered above), so the
      // built_in source branch and ||-fallback in `available` were dead code.
      return {
        provider,
        name: PROVIDER_CONFIG[provider]?.name || provider,
        source: tenantKey ? "your_key" : platformKey ? "platform" : "unavailable",
        available: !!(tenantKey || platformKey),
        hasCustomKey: !!tenantKey,
        maskedKey: tenantKey ? maskApiKey(tenantKey.api_key) : null,
      };
    });

    providers.unshift({
      provider: "replit",
      name: "Replit AI (Built-in)",
      source: "built_in",
      available: true,
      hasCustomKey: false,
      maskedKey: null,
    });

    res.json(providers);
  });

}
