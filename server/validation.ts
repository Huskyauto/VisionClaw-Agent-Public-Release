import { z } from "zod";
import { Request, Response, NextFunction } from "express";
import crypto from "crypto";

export const adminTenantUpdateSchema = z.object({
  plan: z.enum(["trial", "starter", "starter-byok", "pro", "pro-byok", "enterprise", "enterprise-byok", "admin"]).optional(),
  unlimited: z.boolean().optional(),
  trialMaxConversations: z.number().int().min(0).max(1000).optional(),
  isActive: z.boolean().optional(),
});

export const stripeCheckoutSchema = z.object({
  priceId: z.string().min(1).max(200),
  customerEmail: z.string().email().max(200).optional(),
});

export const presenterSessionSchema = z.object({
  presentationId: z.union([z.string(), z.number()]),
  title: z.string().min(1).max(500),
  slides: z.array(z.any()).min(1),
  embedUrl: z.preprocess(v => (v === "" || v === undefined || v === null) ? undefined : v, z.string().url().max(2000).optional()),
  presentUrl: z.preprocess(v => (v === "" || v === undefined || v === null) ? undefined : v, z.string().url().max(2000).optional()),
  tenantId: z.number().int().positive().optional(),
});

export const contactFormSchema = z.object({
  name: z.string().transform(v => v.trim()).pipe(z.string().min(1, "Name is required").max(100)),
  email: z.string().transform(v => v.trim()).pipe(z.string().email().max(200)),
  subject: z.enum(["general", "sales", "support", "billing", "partnership", "enterprise", "bug", "other"]).default("general"),
  message: z.string().transform(v => v.trim()).pipe(z.string().min(1, "Message is required").max(5000)),
});

export const stripeBYOKSchema = z.object({
  secretKey: z.string().regex(/^sk_(live|test)_/, "Secret key must start with sk_live_ or sk_test_"),
  publishableKey: z.string().regex(/^pk_(live|test)_/, "Publishable key must start with pk_live_ or pk_test_"),
});

export const stripeSetupFeeSchema = z.object({
  setupType: z.enum(["managed", "byok"]).default("managed"),
});

export const mcpServerSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(1000).optional().default(""),
  serverUrl: z.string().url().max(2000),
  authType: z.enum(["none", "bearer", "api-key"]).optional().default("none"),
  authToken: z.string().max(500).optional(),
});

export const mcpToolCallSchema = z.object({
  serverId: z.number().int().positive(),
  toolName: z.string().min(1).max(200),
  args: z.record(z.any()).optional().default({}),
});

export const triggerSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(1000).optional(),
  personaId: z.number().int().positive().optional(),
});

export const channelRouteSchema = z.object({
  channel: z.string().min(1).max(100),
  personaId: z.number().int().positive(),
});

export const personalityFileSchema = z.object({
  fileType: z.string().min(1).max(50),
  content: z.string().max(100000),
});

export const marketplaceInstallSchema = z.object({
  templateId: z.union([z.string(), z.number()]),
});

export const trustEventSchema = z.object({
  personaId: z.number().int().positive(),
  event: z.string().min(1).max(200),
  reason: z.string().max(500).optional(),
});

export const expressLaneCheckSchema = z.object({
  fromPersonaId: z.number().int().positive(),
  toPersonaId: z.number().int().positive(),
  workType: z.string().min(1).max(100),
});

export const inboxReadSchema = z.object({
  is_read: z.boolean(),
});

export const inboxStarSchema = z.object({
  is_starred: z.boolean(),
});

export const toggleSchema = z.object({
  enabled: z.boolean(),
});

export function validate<T>(schema: z.ZodSchema<T>) {
  return (req: Request, res: Response, next: NextFunction) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      const firstError = result.error.errors[0];
      return res.status(400).json({
        error: `Validation failed: ${firstError.path.join(".")} — ${firstError.message}`,
        details: result.error.errors.map(e => ({
          field: e.path.join("."),
          message: e.message,
        })),
      });
    }
    req.body = result.data;
    next();
  };
}

const csrfTokens = new Map<string, { token: string; expiresAt: number }>();

export function generateCsrfToken(sessionId: string): string {
  const token = crypto.randomBytes(32).toString("hex");
  csrfTokens.set(sessionId, {
    token,
    expiresAt: Date.now() + 4 * 60 * 60 * 1000,
  });
  return token;
}

export function createCsrfMiddleware(getTenantId: (req: Request) => number | null) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (req.method === "GET" || req.method === "HEAD" || req.method === "OPTIONS") {
      return next();
    }

    const skipPaths = [
      "/api/public/",
      "/api/trigger/",
      "/api/webhooks/",
      "/api/auth/",
      "/api/tenants/register",
      "/api/tenants/login",
      "/api/tenants/forgot-password",
      "/api/tenants/reset-password",
      "/api/presenter",
      "/api/mcp/sse",
    ];
    if (skipPaths.some(p => req.path.startsWith(p))) {
      return next();
    }

    const tenantId = getTenantId(req);
    if (!tenantId) {
      const hasAuthHeader = req.headers.authorization?.startsWith("Bearer ");
      if (hasAuthHeader) {
        return res.status(403).json({ error: "CSRF validation failed: session not resolved. Please refresh and retry." });
      }
      return next();
    }

    const csrfToken = req.headers["x-csrf-token"] as string;
    const sessionId = String(tenantId);

    const stored = csrfTokens.get(sessionId);
    if (!stored || stored.expiresAt < Date.now()) {
      return res.status(403).json({ error: "CSRF token missing or expired. Please refresh the page." });
    }

    if (!csrfToken || csrfToken !== stored.token) {
      return res.status(403).json({ error: "Invalid CSRF token" });
    }

    next();
  };
}

setInterval(() => {
  const now = Date.now();
  for (const [key, val] of csrfTokens) {
    if (val.expiresAt < now) csrfTokens.delete(key);
  }
}, 15 * 60 * 1000);
