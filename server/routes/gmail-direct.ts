import type { Express, Request, Response } from "express";
import { logSilentCatch } from "../lib/silent-catch";
import crypto from "crypto";
import {
  loadGmailDirectRefreshToken,
  saveGmailDirectRefreshToken,
  getGmailDirectAccessToken,
} from "../lib/gmail-direct-token";

const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GMAIL_READONLY = "https://www.googleapis.com/auth/gmail.readonly";

const STATE_STORE = new Map<string, { createdAt: number }>();
const STATE_TTL_MS = 10 * 60_000;
const STATE_MAX = 1000;

function pruneStates(): void {
  const now = Date.now();
  for (const [k, v] of STATE_STORE.entries()) {
    if (now - v.createdAt > STATE_TTL_MS) STATE_STORE.delete(k);
  }
}
setInterval(pruneStates, STATE_TTL_MS).unref?.();

function rememberState(state: string): void {
  // R125+13.5+sec (architect M3): bound the map. Prune on overflow,
  // then drop the oldest if still full.
  if (STATE_STORE.size >= STATE_MAX) {
    pruneStates();
    if (STATE_STORE.size >= STATE_MAX) {
      const oldestKey = STATE_STORE.keys().next().value;
      if (oldestKey) STATE_STORE.delete(oldestKey);
    }
  }
  STATE_STORE.set(state, { createdAt: Date.now() });
}

function verifyPin(provided: string | undefined): boolean {
  // R125+13.5+sec (architect M1): SHA-256 both sides so timingSafeEqual
  // compares fixed-length buffers and length-mismatch never short-circuits.
  const expected = process.env.ADMIN_PIN;
  if (!expected || !provided) return false;
  try {
    const a = crypto.createHash("sha256").update(expected).digest();
    const b = crypto.createHash("sha256").update(provided).digest();
    return crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

// R125+13.6-fix (architect H1): per-IP brute-force throttle on PIN-gated
// admin endpoints. The routes live in PUBLIC_PATH_PREFIXES (no session
// cookie required, handler PIN is the only gate), so an attacker can hit
// /api/admin/gmail-direct/status?pin=XXXX in a loop. Without throttling,
// a numeric ADMIN_PIN is brute-forceable inside hours.
//
// Policy: 8 PIN attempts per 10-min window per source IP. On exceed, return
// 429 for 30 minutes regardless of subsequent PIN correctness (lockout).
// Successful PIN entry clears the bucket for that IP. In-memory by design —
// platform is single-instance Replit; clears on restart (acceptable).
const PIN_ATTEMPT_WINDOW_MS = 10 * 60_000;
const PIN_ATTEMPT_LIMIT = 8;
const PIN_LOCKOUT_MS = 30 * 60_000;
const PIN_BUCKETS = new Map<string, { count: number; resetAt: number; lockedUntil: number }>();
const PIN_BUCKET_MAX = 5000;

function pinIpKey(req: Request): string {
  // trust proxy=1 is set globally, so req.ip is the real client IP.
  return req.ip || "unknown";
}

function pinThrottleCheck(req: Request): { ok: boolean; retryAfterSec?: number } {
  const now = Date.now();
  // Bound the map: prune expired then drop oldest if still full.
  if (PIN_BUCKETS.size >= PIN_BUCKET_MAX) {
    for (const [k, v] of PIN_BUCKETS.entries()) {
      if (v.resetAt < now && v.lockedUntil < now) PIN_BUCKETS.delete(k);
    }
    if (PIN_BUCKETS.size >= PIN_BUCKET_MAX) {
      const oldest = PIN_BUCKETS.keys().next().value;
      if (oldest) PIN_BUCKETS.delete(oldest);
    }
  }
  const key = pinIpKey(req);
  const bucket = PIN_BUCKETS.get(key);
  if (!bucket) return { ok: true };
  if (bucket.lockedUntil > now) {
    return { ok: false, retryAfterSec: Math.ceil((bucket.lockedUntil - now) / 1000) };
  }
  if (bucket.resetAt < now) {
    PIN_BUCKETS.delete(key);
    return { ok: true };
  }
  return { ok: true };
}

function pinThrottleRecord(req: Request, success: boolean): void {
  const key = pinIpKey(req);
  if (success) {
    PIN_BUCKETS.delete(key);
    return;
  }
  const now = Date.now();
  const existing = PIN_BUCKETS.get(key);
  if (!existing || existing.resetAt < now) {
    PIN_BUCKETS.set(key, { count: 1, resetAt: now + PIN_ATTEMPT_WINDOW_MS, lockedUntil: 0 });
    return;
  }
  existing.count += 1;
  if (existing.count >= PIN_ATTEMPT_LIMIT) {
    existing.lockedUntil = now + PIN_LOCKOUT_MS;
  }
}

/**
 * R125+13.16+sec2 — extract the admin PIN from a header or POST body ONLY.
 * Reading `?pin=` from the query string leaks the secret into browser
 * history, reverse-proxy access logs, the `Referer` header, and any link
 * a Bob might paste. Centralized here so every entry point in this file
 * uses the same transport.
 */
function readPin(req: Request): string | undefined {
  const headerPin = req.headers["x-admin-pin"];
  if (typeof headerPin === "string" && headerPin) return headerPin;
  if (Array.isArray(headerPin) && headerPin[0]) return headerPin[0];
  const bodyPin = (req as any).body?.pin;
  if (typeof bodyPin === "string" && bodyPin) return bodyPin;
  return undefined;
}

function checkPinOr401(req: Request, res: Response): boolean {
  const throttle = pinThrottleCheck(req);
  if (!throttle.ok) {
    res.setHeader("Retry-After", String(throttle.retryAfterSec ?? 1800));
    res.status(429).json({ error: "too many PIN attempts; locked out", retryAfterSec: throttle.retryAfterSec });
    return false;
  }
  const ok = verifyPin(readPin(req));
  pinThrottleRecord(req, ok);
  if (!ok) {
    res.status(401).json({ error: "unauthorized — send PIN in the `x-admin-pin` header" });
    return false;
  }
  return true;
}

function getRedirectUri(_req: Request): string {
  // R125+13.5+sec (architect M2): pin to env, never trust forwarded headers.
  // Must match a URI registered in Google Cloud Console for the OAuth client.
  const domain =
    process.env.REPLIT_DOMAINS?.split(",")[0] ||
    process.env.REPLIT_DEV_DOMAIN ||
    "localhost:5000";
  const proto = domain.startsWith("localhost") ? "http" : "https";
  return `${proto}://${domain}/api/admin/gmail-direct/callback`;
}

export function registerGmailDirectRoutes(app: Express): void {
  app.get("/api/admin/gmail-direct/status", async (req: Request, res: Response) => {
    if (!checkPinOr401(req, res)) return;
    const stored = await loadGmailDirectRefreshToken();
    if (!stored) return res.json({ connected: false });
    const access = await getGmailDirectAccessToken();
    let profile: any = null;
    if (access) {
      try {
        const r = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/profile", {
          headers: { Authorization: `Bearer ${access}` },
        });
        profile = r.ok ? await r.json() : { error: r.status };
      } catch (e: any) {
        profile = { error: e.message };
      }
    }
    // R125+13.17+sec — removed `source: env|file` field. Even though this
    // endpoint is PIN-gated, leaking the storage backend of the refresh token
    // narrows an attacker's search surface if the PIN is ever compromised.
    res.json({
      connected: true,
      scope: stored.scope,
      saved_at: stored.saved_at,
      profile,
    });
  });

  app.get("/api/admin/gmail-direct/auth", (req: Request, res: Response) => {
    const throttle = pinThrottleCheck(req);
    if (!throttle.ok) {
      res.setHeader("Retry-After", String(throttle.retryAfterSec ?? 1800));
      return res.status(429).send(`Too many PIN attempts. Locked out for ${throttle.retryAfterSec}s.`);
    }
    // R125+13.16+sec2 — header-only PIN. See readPin() docstring; query-string
    // PINs leak into logs and Referer headers and were called out as HIGH
    // severity by the post-edit sensitive-surface architect pass.
    const ok = verifyPin(readPin(req));
    pinThrottleRecord(req, ok);
    if (!ok) {
      return res.status(401).send("Unauthorized. Send the admin PIN in the `x-admin-pin` request header (do NOT use a query string — it leaks into logs and browser history).");
    }
    const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
    if (!clientId) {
      return res.status(500).send("GOOGLE_OAUTH_CLIENT_ID not configured.");
    }
    const state = crypto.randomBytes(24).toString("hex");
    rememberState(state);

    const redirectUri = getRedirectUri(req);
    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: "code",
      scope: GMAIL_READONLY,
      access_type: "offline",
      prompt: "consent",
      state,
      include_granted_scopes: "true",
    });
    res.redirect(`${GOOGLE_AUTH_URL}?${params}`);
  });

  app.get("/api/admin/gmail-direct/callback", async (req: Request, res: Response) => {
    const { code, state, error: googleError } = req.query as Record<string, string>;
    if (googleError) {
      return res.status(400).send(`<h1>Google rejected the request</h1><pre>${escapeHtml(googleError)}</pre>`);
    }
    if (!state || !STATE_STORE.has(state)) {
      return res.status(400).send("<h1>Invalid or expired state</h1><p>Start over by GET-ing /api/admin/gmail-direct/auth with the `x-admin-pin` header set.</p>");
    }
    STATE_STORE.delete(state);
    if (!code) return res.status(400).send("Missing code");

    const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID!;
    const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET!;
    const redirectUri = getRedirectUri(req);

    const body = new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    });
    const tokenResp = await fetch(GOOGLE_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
    if (!tokenResp.ok) {
      const text = await tokenResp.text();
      return res.status(500).send(`<h1>Token exchange failed</h1><pre>${escapeHtml(text.slice(0, 1000))}</pre>`);
    }
    const tokenJson: any = await tokenResp.json();
    const refreshToken = tokenJson.refresh_token;
    const accessToken = tokenJson.access_token;
    const scope = tokenJson.scope || "";
    if (!refreshToken) {
      // R125+13.5+sec (architect H1): never echo tokenJson — it contains the
      // just-issued access_token + id_token. Show only safe field names.
      const safeKeys = Object.keys(tokenJson || {}).filter(
        (k) => k !== "access_token" && k !== "id_token" && k !== "refresh_token"
      );
      const safeView: Record<string, unknown> = {};
      for (const k of safeKeys) safeView[k] = tokenJson[k];
      return res.status(500).send(
        `<h1>No refresh token returned</h1><p>Google only returns a refresh token on first consent. Revoke the app at <a href="https://myaccount.google.com/permissions">myaccount.google.com/permissions</a>, then retry /api/admin/gmail-direct/auth with the <code>x-admin-pin</code> header set.</p><pre>${escapeHtml(JSON.stringify(safeView, null, 2))}</pre>`
      );
    }

    let emailAddress: string | undefined;
    try {
      const prof = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/profile", {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (prof.ok) emailAddress = (await prof.json()).emailAddress;
    } catch (_silentErr) { logSilentCatch("server/routes/gmail-direct.ts", _silentErr); }

    await saveGmailDirectRefreshToken({
      refresh_token: refreshToken,
      scope,
      saved_at: new Date().toISOString(),
      email_address: emailAddress,
    });

    res.send(`<!doctype html><html><head><meta charset="utf-8"><title>Gmail connected</title>
<style>body{font-family:-apple-system,system-ui,sans-serif;max-width:680px;margin:60px auto;padding:0 24px;color:#222;line-height:1.55}code{background:#f3f4f6;padding:2px 6px;border-radius:4px}.ok{color:#15803d;font-weight:600}</style>
</head><body>
<h1 class="ok">✓ Gmail read access connected</h1>
<p><strong>Account:</strong> ${escapeHtml(emailAddress || "(unknown)")}</p>
<p><strong>Scope granted:</strong> <code>${escapeHtml(scope)}</code></p>
<p>The refresh token has been saved to <code>data/.gmail-direct-token.json</code> (gitignored, mode 0600). The agents can now read your inbox.</p>
<p>You can close this tab. Tell Bob "done" in the agent chat and he'll run the smoke test.</p>
</body></html>`);
  });
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}
