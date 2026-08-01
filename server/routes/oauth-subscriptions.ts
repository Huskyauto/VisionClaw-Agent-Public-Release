// R74.13t — Stage 20 of routes.ts decomposition.
// 5 routes for OAuth Subscription Connections (cross-vendor OAuth glue —
// Google Workspace, Microsoft Graph, Notion, etc.):
// /api/oauth-subscriptions/{status, initiate/:provider, exchange-code,
// callback, /:provider (DELETE)}. All routes tenant-scoped via
// getTenantFromRequest (no platform-admin gate — these are per-tenant
// integrations).
// Extracted verbatim from server/routes.ts L5231-L5488.
import type { Express, Request, Response } from "express";
import { exchangeCodeForTokens, getSubscriptionStatus, disconnectSubscription, storePendingFlow, getPendingFlow, getOAuthProviderInfo, getAppBaseUrl, initiateLocalRedirectOAuth, exchangeCodeWithLocalRedirect, proactiveTokenRefresh, forceRefreshAllSubscriptions } from "../oauth-subscriptions";
import { logSilentCatch } from "../lib/silent-catch";
import crypto from "crypto";

function timingSafeEqualStr(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

type OAuthSubsHelpers = {
  getTenantFromRequest: (req: Request) => number | null;
};

export function registerOAuthSubscriptionsRoutes(app: Express, helpers: OAuthSubsHelpers) {
  const { getTenantFromRequest } = helpers;

  // ─── OAuth Subscription Connections ──────────────────────
  app.get("/api/oauth-subscriptions/status", async (req, res) => {
    try {
      const tenantId = getTenantFromRequest(req);
      if (!tenantId) return res.status(401).json({ error: "Authentication required" });
      let status = await getSubscriptionStatus(tenantId);

      const googleWsSub = status.find(s => s.provider === "google-workspace");
      if (!googleWsSub || !googleWsSub.isActive) {
        try {
          const { connectGoogleViaReplit } = await import("../oauth-subscriptions");
          const result = await connectGoogleViaReplit(tenantId);
          if (result.success) {
            status = await getSubscriptionStatus(tenantId);
          }
        } catch (_silentErr) { logSilentCatch("server/routes.ts", _silentErr); }
      }

      const googleGeminiSub = status.find(s => s.provider === "google");
      const googleWsSubResult = status.find(s => s.provider === "google-workspace");

      const providers = [
        (() => {
          const info = getOAuthProviderInfo("openai");
          const sub = status.find(s => s.provider === "openai");
          return {
            provider: "openai",
            name: info?.name || "OpenAI",
            description: info?.description || "",
            connected: !!sub?.isActive,
            expiresIn: sub?.expiresIn || null,
            email: sub?.email || null,
            connectedAt: sub?.connectedAt || null,
          };
        })(),
        (() => {
          const info = getOAuthProviderInfo("google");
          const geminiActive = !!googleGeminiSub?.isActive;
          const driveActive = !!googleWsSubResult?.isActive;
          return {
            provider: "google",
            name: info?.name || "Google",
            description: info?.description || "",
            connected: geminiActive || driveActive,
            geminiConnected: geminiActive,
            driveConnected: driveActive,
            expiresIn: googleGeminiSub?.expiresIn || googleWsSubResult?.expiresIn || null,
            email: googleGeminiSub?.email || googleWsSubResult?.email || null,
            connectedAt: googleGeminiSub?.connectedAt || googleWsSubResult?.connectedAt || null,
          };
        })(),
      ];
      res.json(providers);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/oauth-subscriptions/initiate/:provider", async (req, res) => {
    try {
      const { provider } = req.params;
      const tenantId = getTenantFromRequest(req);
      if (!tenantId) return res.status(401).json({ error: "Authentication required" });

      if (provider === "google") {
        const { connectGoogleViaReplit } = await import("../oauth-subscriptions");
        connectGoogleViaReplit(tenantId).catch(() => {});

        const baseUrl = getAppBaseUrl(req);
        const result = initiateLocalRedirectOAuth(provider, tenantId, baseUrl);
        if (!result) return res.status(400).json({ error: "Unsupported provider" });
        storePendingFlow(result.state, provider, result.verifier, tenantId);
        return res.json({
          redirect: true,
          authUrl: result.authUrl,
        });
      }

      if (provider === "openai") {
        const result = initiateLocalRedirectOAuth(provider, tenantId);
        if (!result) return res.status(400).json({ error: "Unsupported provider" });
        storePendingFlow(result.state, provider, result.verifier, tenantId);
        return res.json({
          codePaste: true,
          authUrl: result.authUrl,
          state: result.state,
        });
      }

      return res.status(400).json({ error: "Unsupported provider" });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/oauth-subscriptions/exchange-code", async (req, res) => {
    try {
      const tenantId = getTenantFromRequest(req);
      if (!tenantId) return res.status(401).json({ error: "Authentication required" });
      const { code, state } = req.body;
      if (!code || !state) {
        return res.status(400).json({ error: "Missing code or state" });
      }
      const flow = getPendingFlow(state);
      if (!flow) {
        return res.status(400).json({ error: "Invalid or expired state. Please try connecting again." });
      }
      // R74.3 SECURITY — Bind tokens to the tenant captured when the OAuth
      // flow was initiated, NOT the tenant making the exchange call. If
      // `state` were leaked or intercepted by a different session, the old
      // code would happily mis-bind provider tokens to the requester's
      // tenant. Enforce flow.tenantId === requester tenantId for defense-
      // in-depth, then use flow.tenantId for the actual token persistence.
      if (flow.tenantId !== tenantId) {
        console.warn(`[oauth] state-tenant mismatch: flow=${flow.tenantId} requester=${tenantId}`);
        return res.status(403).json({ error: "OAuth state does not belong to this session" });
      }
      const baseUrl = getAppBaseUrl(req);
      const result = await exchangeCodeWithLocalRedirect(flow.provider, code, flow.verifier, flow.tenantId, baseUrl);
      if (result.success) {
        res.json({ success: true });
      } else {
        res.status(400).json({ error: result.error });
      }
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/oauth-subscriptions/callback", async (req, res) => {
    try {
      const { code, state, error } = req.query;
      if (error) {
        return res.redirect(`/settings#general&oauth_error=${encodeURIComponent(String(error))}`);
      }
      if (!code || !state) {
        return res.redirect("/settings#general&oauth_error=missing_params");
      }

      const flow = getPendingFlow(String(state));
      if (!flow) {
        return res.redirect("/settings#general&oauth_error=invalid_state");
      }

      const baseUrl = getAppBaseUrl(req);
      let result;
      if (flow.verifier) {
        result = await exchangeCodeWithLocalRedirect(
          flow.provider,
          String(code),
          flow.verifier,
          flow.tenantId,
          baseUrl
        );
      } else {
        const callbackUrl = `${baseUrl}/api/oauth-subscriptions/callback`;
        result = await exchangeCodeForTokens(
          flow.provider,
          String(code),
          callbackUrl,
          flow.verifier,
          flow.tenantId
        );
      }

      if (result.success) {
        res.redirect(`/settings#general&oauth_success=${flow.provider}`);
      } else {
        res.redirect(`/settings#general&oauth_error=${encodeURIComponent(result.error || "unknown")}`);
      }
    } catch (err: any) {
      console.error("[oauth] Callback error:", err);
      res.redirect(`/settings#general&oauth_error=${encodeURIComponent(err.message)}`);
    }
  });

  app.get("/api/youtube/connect", async (req, res) => {
    try {
      const tenantId = getTenantFromRequest(req);
      if (!tenantId) return res.status(401).json({ error: "Authentication required" });
      const { initiateYouTubeOAuth } = await import("../oauth-subscriptions");
      const baseUrl = getAppBaseUrl(req);
      const result = initiateYouTubeOAuth(tenantId, baseUrl);
      if (!result) return res.status(400).json({ error: "YouTube credentials not configured. Set YOUTUBE_CLIENT_ID and YOUTUBE_CLIENT_SECRET." });
      res.redirect(result.authUrl);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/youtube/callback", async (req, res) => {
    try {
      const { code, state, error } = req.query;
      if (error) return res.redirect(`/settings#general&youtube_error=${encodeURIComponent(String(error))}`);
      if (!code || !state) return res.redirect("/settings#general&youtube_error=missing_params");

      const { getPendingFlow, exchangeYouTubeCode } = await import("../oauth-subscriptions");
      const flow = getPendingFlow(String(state));
      if (!flow) return res.redirect("/settings#general&youtube_error=invalid_state");

      const baseUrl = getAppBaseUrl(req);
      const result = await exchangeYouTubeCode(String(code), flow.verifier, flow.tenantId, baseUrl);
      if (result.success) {
        const msg = result.channelName ? `youtube_connected&channel=${encodeURIComponent(result.channelName)}` : "youtube_connected";
        res.redirect(`/settings#general&youtube_success=${msg}`);
      } else {
        res.redirect(`/settings#general&youtube_error=${encodeURIComponent(result.error || "unknown")}`);
      }
    } catch (err: any) {
      console.error("[youtube] Callback error:", err);
      res.redirect(`/settings#general&youtube_error=${encodeURIComponent(err.message)}`);
    }
  });

  app.get("/api/youtube/status", async (req, res) => {
    try {
      const tenantId = getTenantFromRequest(req);
      if (!tenantId) return res.status(401).json({ error: "Authentication required" });
      const { getYouTubeAccessToken } = await import("../oauth-subscriptions");
      const token = await getYouTubeAccessToken(tenantId);
      if (!token) return res.json({ connected: false });

      let channelName: string | null = null;
      let subscriberCount: string | null = null;
      let videoCount: string | null = null;
      try {
        const resp = await fetch("https://www.googleapis.com/youtube/v3/channels?part=snippet,statistics&mine=true", {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (resp.ok) {
          const data = await resp.json();
          const ch = data.items?.[0];
          channelName = ch?.snippet?.title || null;
          subscriberCount = ch?.statistics?.subscriberCount || null;
          videoCount = ch?.statistics?.videoCount || null;
        }
      } catch (_silentErr) { logSilentCatch("server/routes.ts", _silentErr); }
      res.json({ connected: true, channelName, subscriberCount, videoCount });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.delete("/api/oauth-subscriptions/:provider", async (req, res) => {
    try {
      const tenantId = getTenantFromRequest(req);
      if (!tenantId) return res.status(401).json({ error: "Authentication required" });
      if (req.params.provider === "google") {
        await disconnectSubscription("google", tenantId);
        await disconnectSubscription("google-workspace", tenantId);
      } else {
        await disconnectSubscription((req.params.provider as string), tenantId);
      }
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // R74.13z-quint+8 — Externally-pingable OAuth refresh endpoint.
  // On Autoscale deployments the in-process scheduler doesn't run while the
  // container is asleep. An external cron (UptimeRobot / cron-job.org / Replit
  // Scheduled Deployments) hits this every 5 min to keep tokens warm and the
  // container hot. Auth via shared CRON_SECRET to prevent random pingers from
  // triggering refreshes. Accepts GET (for simple uptime checks) and POST.
  // The `force=1` query forces refresh of ALL active subs regardless of
  // expiry — use this sparingly (e.g. once a day) to exercise refresh tokens.
  const cronRefreshHandler = async (req: Request, res: Response) => {
    try {
      const secret = process.env.CRON_SECRET;
      if (!secret) {
        return res.status(503).json({ error: "CRON_SECRET not configured on server" });
      }
      // Only accept the secret via Authorization header, never via query
      // string — query strings get logged by proxies/browsers/access logs
      // and leak the secret. External cron services (UptimeRobot,
      // cron-job.org, Replit Scheduled Deployments) all support custom
      // request headers.
      const auth = String(req.headers.authorization || "");
      const provided = auth.startsWith("Bearer ") ? auth.slice(7) : "";
      if (!provided || !timingSafeEqualStr(provided, secret)) {
        return res.status(401).json({ error: "Invalid or missing cron secret (use Authorization: Bearer header)" });
      }
      const force = String(req.query.force || "") === "1";
      // Heal-deactivated mode: if ?heal=1, also walk the deactivated Google
      // rows and try to revive them via the Replit connector. This is the
      // self-healing path for tenants whose google subs got knocked offline
      // during prior cron runs (e.g. when invalid_grant fired before the
      // connector-first refresh path was deployed).
      const heal = String(req.query.heal || "") === "1";
      let healed: string[] = [];
      let healFailed: string[] = [];
      if (heal) {
        try {
          const { connectGoogleViaReplit } = await import("../oauth-subscriptions");
          const { db } = await import("../db");
          const { sql } = await import("drizzle-orm");
          const dead = await db.execute(sql`
            SELECT DISTINCT tenant_id FROM oauth_subscriptions
            WHERE provider IN ('google','google-workspace') AND is_active = FALSE
          `);
          const tenantIds = ((dead as any).rows || []).map((r: any) => Number(r.tenant_id));
          for (const tid of tenantIds) {
            try {
              const r = await connectGoogleViaReplit(tid);
              if (r.success) healed.push(`google:t${tid}`); else healFailed.push(`google:t${tid}:${(r.error || "unknown").slice(0, 40)}`);
            } catch (e: any) {
              healFailed.push(`google:t${tid}:${(e.message || "err").slice(0, 40)}`);
            }
          }
        } catch (hErr: any) {
          console.warn(`[cron] Heal step errored: ${hErr.message?.slice(0, 100)}`);
        }
      }
      const result = force
        ? await forceRefreshAllSubscriptions()
        : await proactiveTokenRefresh();
      res.json({ ok: true, mode: force ? "force" : "proactive", heal, healed, healFailed, ...result, ts: Date.now() });
    } catch (err: any) {
      res.status(500).json({ error: err.message?.slice(0, 200) || "internal error" });
    }
  };
  app.get("/api/cron/refresh-oauth-tokens", cronRefreshHandler);
  app.post("/api/cron/refresh-oauth-tokens", cronRefreshHandler);
}
