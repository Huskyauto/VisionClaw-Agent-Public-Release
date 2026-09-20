import type { Express, Request, Response } from "express";
import { logSilentCatch } from "../lib/silent-catch";
import crypto from "crypto";
import {
  loadGmailDirectRefreshToken,
  saveGmailDirectRefreshToken,
  getGmailDirectAccessToken,
} from "../lib/gmail-direct-token";
import { resolveOwnerEmail } from "../lib/owner-email";
import { hasDirectGmailSendAndReadScopes } from "../google-workspace";

const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
// The weekly IdeaBrowser report is complete only when the exact sent message
// is visible in Bob's Inbox. That requires sending plus read-only access to
// message metadata and labels; mailbox modification is intentionally not part
// of this owner-report consent grant.
const GMAIL_DIRECT_SCOPES = [
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.send",
].join(" ");

const STATE_TTL_MS = 10 * 60_000;
const USED_STATES = new Map<string, number>();

function stateSecret(): string {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error("SESSION_SECRET is required for Gmail OAuth state");
  return secret;
}

function signedState(): string {
  const payload = `${Date.now()}.${crypto.randomBytes(24).toString("hex")}`;
  const signature = crypto.createHmac("sha256", stateSecret()).update(payload).digest("hex");
  return `${payload}.${signature}`;
}

function consumeSignedState(state: string): boolean {
  const parts = state.split(".");
  if (parts.length !== 3) return false;
  const createdAt = Number(parts[0]);
  if (!Number.isFinite(createdAt) || Date.now() - createdAt < 0 || Date.now() - createdAt > STATE_TTL_MS) return false;
  const expected = crypto.createHmac("sha256", stateSecret()).update(`${parts[0]}.${parts[1]}`).digest("hex");
  const supplied = parts[2];
  if (supplied.length !== expected.length) return false;
  if (!crypto.timingSafeEqual(Buffer.from(supplied), Buffer.from(expected))) return false;
  if (USED_STATES.has(state)) return false;
  USED_STATES.set(state, Date.now());
  for (const [used, usedAt] of USED_STATES) {
    if (Date.now() - usedAt > STATE_TTL_MS) USED_STATES.delete(used);
  }
  return true;
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

  const beginGmailAuth = (req: Request, res: Response) => {
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
    const state = signedState();

    const redirectUri = getRedirectUri(req);
    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: "code",
      scope: GMAIL_DIRECT_SCOPES,
      access_type: "offline",
      prompt: "consent",
      state,
      include_granted_scopes: "false",
    });
    res.redirect(`${GOOGLE_AUTH_URL}?${params}`);
  };

  app.get("/api/admin/gmail-direct/start", (_req: Request, res: Response) => {
    res.type("html").send(`<!doctype html><html><head><meta charset="utf-8"><title>Connect owner Gmail</title>
<style>body{font-family:system-ui,sans-serif;max-width:520px;margin:60px auto;padding:0 24px;color:#222}input,button{font:inherit;padding:10px 12px;margin-top:8px}input{width:100%;box-sizing:border-box}button{cursor:pointer}</style>
</head><body><h1>Connect owner Gmail</h1><p>Enter the admin PIN to start Google authorization. The PIN is sent only in the secure form body and is not placed in the URL.</p>
<form method="post" action="/api/admin/gmail-direct/auth" target="_top"><label for="pin">Admin PIN</label><input id="pin" name="pin" type="password" autocomplete="off" required><button type="submit">Continue to Google</button></form></body></html>`);
  });
  app.get("/api/admin/gmail-direct/auth", beginGmailAuth);
  app.post("/api/admin/gmail-direct/auth", beginGmailAuth);

  app.get("/api/admin/gmail-direct/callback", async (req: Request, res: Response) => {
    const { code, state, error: googleError } = req.query as Record<string, string>;
    if (googleError) {
      return res.status(400).send(`<h1>Google rejected the request</h1><pre>${escapeHtml(googleError)}</pre>`);
    }
    if (!state || !consumeSignedState(state)) {
      return res.status(400).send("<h1>Invalid or expired state</h1><p>Start over by GET-ing /api/admin/gmail-direct/auth with the `x-admin-pin` header set.</p>");
    }
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
    if (!hasDirectGmailSendAndReadScopes(scope)) {
      return res.status(403).send("<h1>Too much Gmail access granted</h1><p>Revoke the existing Gmail grant and authorize again with only read-only inbox verification and sending.</p>");
    }
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
    const ownerEmail = resolveOwnerEmail().toLowerCase();
    if (!ownerEmail || String(emailAddress || "").trim().toLowerCase() !== ownerEmail) {
      return res.status(403).send("<h1>Wrong Gmail account</h1><p>Authorize the configured owner Gmail account only. No token was saved.</p>");
    }

    await saveGmailDirectRefreshToken({
      refresh_token: refreshToken,
      scope,
      saved_at: new Date().toISOString(),
      email_address: emailAddress,
    });

    res.send(`<!doctype html><html><head><meta charset="utf-8"><title>Gmail connected</title>
<style>body{font-family:-apple-system,system-ui,sans-serif;max-width:680px;margin:60px auto;padding:0 24px;color:#222;line-height:1.55}code{background:#f3f4f6;padding:2px 6px;border-radius:4px}.ok{color:#15803d;font-weight:600}</style>
</head><body>
<h1 class="ok">✓ Gmail report-delivery access connected</h1>
<p><strong>Account:</strong> ${escapeHtml(emailAddress || "(unknown)")}</p>
<p><strong>Scope granted:</strong> <code>${escapeHtml(scope)}</code></p>
<p>The refresh token has been saved securely. The weekly IdeaBrowser report can now be sent to and verified in this Gmail inbox.</p>
<p>You can close this tab. Tell Bob "done" in the agent chat and he'll run the smoke test.</p>
</body></html>`);
  });
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}
