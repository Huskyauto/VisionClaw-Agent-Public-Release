import fs from "fs/promises";
import path from "path";

const TOKEN_FILE = path.join(process.cwd(), "data", ".gmail-direct-token.json");
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";

export interface GmailDirectToken {
  refresh_token: string;
  scope: string;
  saved_at: string;
  email_address?: string;
}

let _accessCache: { token: string; expiresAt: number } | null = null;
// R125+13.7 (architect LOW closed): single-flight lock so two concurrent
// callers don't fire two refresh requests at Google when the cache expires.
let _refreshInflight: Promise<string | null> | null = null;

export async function loadGmailDirectRefreshToken(): Promise<GmailDirectToken | null> {
  if (process.env.GMAIL_REFRESH_TOKEN) {
    return {
      refresh_token: process.env.GMAIL_REFRESH_TOKEN,
      scope: process.env.GMAIL_REFRESH_SCOPE || "https://www.googleapis.com/auth/gmail.readonly",
      saved_at: "env",
    };
  }
  try {
    const raw = await fs.readFile(TOKEN_FILE, "utf-8");
    return JSON.parse(raw) as GmailDirectToken;
  } catch {
    return null;
  }
}

export async function saveGmailDirectRefreshToken(t: GmailDirectToken): Promise<void> {
  await fs.mkdir(path.dirname(TOKEN_FILE), { recursive: true });
  await fs.writeFile(TOKEN_FILE, JSON.stringify(t, null, 2), { mode: 0o600 });
  _accessCache = null;
}

export async function getGmailDirectAccessToken(): Promise<string | null> {
  if (_accessCache && _accessCache.expiresAt > Date.now() + 30_000) {
    return _accessCache.token;
  }
  // Single-flight: if a refresh is already in progress, await its result.
  if (_refreshInflight) return _refreshInflight;
  _refreshInflight = (async () => {
    try {
      const stored = await loadGmailDirectRefreshToken();
      if (!stored) return null;

      const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
      const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
      if (!clientId || !clientSecret) {
        console.warn("[gmail-direct] GOOGLE_OAUTH_CLIENT_ID/SECRET not set — cannot refresh");
        return null;
      }

      const body = new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: stored.refresh_token,
        grant_type: "refresh_token",
      });

      // R125+13.7 (architect regression fix): bound the refresh fetch with an
      // AbortController so a hung Google socket can't wedge the single-flight
      // lock indefinitely. The outer try/finally clears _refreshInflight on
      // both timeout and error, so subsequent callers can retry.
      const ac = new AbortController();
      const timer = setTimeout(() => ac.abort(), 10_000);
      let resp: Response;
      try {
        resp = await fetch(GOOGLE_TOKEN_URL, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body,
          signal: ac.signal,
        });
      } catch (e: any) {
        console.error(`[gmail-direct] refresh fetch failed: ${e?.message || e}`);
        return null;
      } finally {
        clearTimeout(timer);
      }
      if (!resp.ok) {
        const text = await resp.text();
        console.error(`[gmail-direct] refresh failed ${resp.status}: ${text.slice(0, 300)}`);
        return null;
      }
      const json: any = await resp.json();
      const accessToken = json?.access_token;
      // R125+13.8+sec (architect MEDIUM closed): validate token shape BEFORE
      // caching. A malformed 200 (provider degradation, partial response)
      // could otherwise pin `undefined` into the cache and serve it as
      // success for the full TTL.
      if (typeof accessToken !== "string" || accessToken.length === 0) {
        console.error(`[gmail-direct] refresh returned invalid access_token shape; not caching`);
        return null;
      }
      const expiresIn = Number(json.expires_in || 3600);
      _accessCache = { token: accessToken, expiresAt: Date.now() + expiresIn * 1000 };
      return accessToken;
    } finally {
      _refreshInflight = null;
    }
  })();
  return _refreshInflight;
}

export function clearGmailDirectCache(): void {
  _accessCache = null;
}
