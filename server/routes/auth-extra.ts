// Routes-split Tier 1 — inline auth endpoints extracted from server/routes.ts.
// Two register functions preserve original registration ORDER relative to the
// /api middleware gates (tenantRateLimiter + csrf at ~1331-1334, global
// authMiddleware app.use at ~2672):
//   registerAuthPublicRoutes    — pre-gate (login/status/csrf-token/password+email flows)
//   registerAuthMonitoringRoutes — post-gate (/api/auth/health pair, explicit authMiddleware)
// Pure move — zero behavior change (no-fix-during-refactor rule).
import { type Express, type Request, type Response } from "express";
import {
  handleLogin,
  handleAuthStatus,
  handleForgotPassword,
  handleResetPassword,
  handleVerifyEmail,
  handleResendVerification,
} from "../auth";
import { generateCsrfToken, getCsrfSessionKey } from "../validation";

type AuthPublicHelpers = {
  loginLimiter: any;
  getTenantFromRequestAsync: (req: Request) => number | null | Promise<number | null>;
};

export function registerAuthPublicRoutes(app: Express, helpers: AuthPublicHelpers) {
  const { loginLimiter, getTenantFromRequestAsync } = helpers;

  app.post("/api/auth/login", loginLimiter, handleLogin);
  app.get("/api/auth/status", handleAuthStatus);

  app.get("/api/auth/csrf-token", async (req: Request, res: Response) => {
    // A 304 has no body. This endpoint returns the per-session token the next
    // mutation needs, so revalidation can otherwise turn a valid browser
    // session into a guaranteed CSRF 403.
    res.set("Cache-Control", "no-store");
    const tenantId = await getTenantFromRequestAsync(req);
    if (!tenantId) return res.json({ csrfToken: null });
    // SECURITY (R74.13u-sec): key CSRF tokens by per-session id (Bearer token
    // hash or Replit OIDC sub) so two browser sessions in the same tenant
    // can't share/replay each other's tokens. Falls back to tenant id only
    // when no session signal is available.
    const sessionKey = getCsrfSessionKey(req, tenantId);
    if (!sessionKey) return res.json({ csrfToken: null });
    const token = generateCsrfToken(sessionKey);
    res.json({ csrfToken: token });
  });

  app.post("/api/auth/forgot-password", loginLimiter, handleForgotPassword);
  app.post("/api/auth/reset-password", loginLimiter, handleResetPassword);
  app.post("/api/auth/verify-email", loginLimiter, handleVerifyEmail);
  app.post("/api/auth/resend-verification", loginLimiter, handleResendVerification);
}

type AuthMonitoringHelpers = {
  authMiddleware: any;
};

export function registerAuthMonitoringRoutes(app: Express, helpers: AuthMonitoringHelpers) {
  const { authMiddleware } = helpers;

  // ─── Auth Monitoring ──────────────────────────────────────
  app.get("/api/auth/health", authMiddleware, async (req, res) => {
    const { getProviderHealth, getAuthStatusCode } = await import("../auth-monitor");
    const force = req.query.refresh === "true";
    const health = await getProviderHealth(force);
    const exitCode = getAuthStatusCode(health);
    res.json({ providers: health, exitCode, exitLabel: exitCode === 0 ? "ok" : exitCode === 1 ? "expired" : "expiring_soon" });
  });

  app.get("/api/auth/health/check", authMiddleware, async (_req, res) => {
    const { getAuthStatusCode, getCachedHealth } = await import("../auth-monitor");
    const health = getCachedHealth();
    const exitCode = getAuthStatusCode(health);
    res.json({ exitCode, exitLabel: exitCode === 0 ? "ok" : exitCode === 1 ? "expired" : "expiring_soon" });
  });
}
