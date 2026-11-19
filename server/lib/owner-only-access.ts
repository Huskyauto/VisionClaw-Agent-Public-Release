import type { Request, Response, NextFunction } from "express";
import { ADMIN_TENANT_ID } from "../tenant-constants";

/** Operator-only opt-out. Missing/malformed configuration stays private. */
export function ownerOnlyAccess(
  env: { APP_ACCESS_MODE?: string } = { APP_ACCESS_MODE: process.env.APP_ACCESS_MODE },
): boolean {
  return env.APP_ACCESS_MODE !== "multi-tenant";
}

export function tenantAccessAllowed(tenantId: unknown, privateMode = ownerOnlyAccess()): boolean {
  return !privateMode || tenantId === ADMIN_TENANT_ID;
}

export const PRIVATE_ACCESS_ERROR = {
  error: "This application is private. Only the owner can sign in.",
  code: "OWNER_ONLY",
};

type Access = "invalid" | "closed" | "public" | "service" | "owner";
const PUBLIC_GET = new Set([
  "/api/auth/status", "/api/auth/agentid/config", "/api/login", "/api/callback",
  "/api/logout", "/api/public/site-config", "/api/public/release-info",
]);
// These routes RETAIN their existing signature/state/credential checks.
// Never add a prefix exemption: future child handlers must default to owner.
const SERVICE_POST = new Set([
  "/api/stripe/webhook", "/api/coinbase/webhook", "/api/webhooks/agentmail",
  "/api/slack/commands", "/api/slack/events", "/api/hooks/twilio/sms",
  "/api/hooks/twilio/whatsapp",
  "/api/cron/refresh-oauth-tokens", "/api/cron/repair-loop-health",
  "/mcp", "/token", "/register", "/revoke",
]);
const SERVICE_GET = new Set([
  "/authorize", "/api/oauth-subscriptions/callback", "/api/youtube/callback",
  "/api/admin/gmail-direct/callback", "/api/cron/refresh-oauth-tokens",
  "/api/cron/repair-loop-health", "/mcp/health",
  "/api/admin/gmail-direct/auth", "/api/admin/gmail-direct/start",
  "/api/admin/gmail-direct/status", "/api/admin/archive-rescue/orders",
]);

export function classifyPrivateRequest(method: string, rawUrl: string): Access {
  const raw = rawUrl.split("?")[0];
  let path: string;
  try { path = decodeURIComponent(raw).toLowerCase(); } catch { return "invalid"; }
  if (!path.startsWith("/") || path.includes("\\") || path.includes("//")
    || /[\u0000-\u001f\u007f%]/.test(path)
    || path.split("/").some(segment => segment === "." || segment === "..")
    // Express matches un-decoded route prefixes; don't classify an encoded
    // alias as public and then let a later handler interpret it differently.
    || (raw.includes("%") && !raw.toLowerCase().startsWith("/uploads/"))) return "invalid";
  path = path.replace(/\/+$/, "") || "/";
  const read = method === "GET" || method === "HEAD";
  if (path === "/api/tenants/register" || path === "/api/tenants/login"
    || path.startsWith("/api/public-chat") || path.startsWith("/api/mcp/")
    || (path.startsWith("/api/auth/agentid/") && path !== "/api/auth/agentid/config")) return "closed";
  if (read && PUBLIC_GET.has(path)) return "public";
  if (method === "POST" && path === "/api/auth/login") return "public";
  if ((read && SERVICE_GET.has(path)) || (method === "POST" && SERVICE_POST.has(path))) return "service";
  if (method === "POST" && /^\/api\/admin\/archive-rescue\/orders\/[^/]+\/status$/.test(path)) return "service";
  if (path === "/internal/workspace-verifier" || path.startsWith("/internal/workspace-verifier/")) return "service";
  if (path === "/api" || path.startsWith("/api/") || path === "/mcp"
    || path === "/v1" || path.startsWith("/v1/")
    || ["/uploads", "/deliverables", "/play", "/v", "/watch"].some(p => path === p || path.startsWith(p + "/"))) return "owner";
  // Root OAuth metadata is informational; root mutation routes are NOT.
  return read ? "public" : "owner";
}

export function createOwnerOnlyGate(
  verifyOwner: (req: Request) => Promise<boolean>,
  privateMode: () => boolean = ownerOnlyAccess,
) {
  return async (req: Request, res: Response, next: NextFunction) => {
    if (!privateMode()) return next();
    const access = classifyPrivateRequest(req.method, req.originalUrl || req.url);
    if (access === "public" || access === "service") return next();
    res.setHeader("Cache-Control", "no-store");
    if (access === "invalid") return res.status(400).json({ error: "Invalid request path" });
    if (access !== "closed") {
      try { if (await verifyOwner(req)) return next(); } catch {
        // Keep verifier failures private and deny access without exposing errors.
        return res.status(403).json(PRIVATE_ACCESS_ERROR);
      }
    }
    return res.status(403).json(PRIVATE_ACCESS_ERROR);
  };
}
