import fs from "fs/promises";
import { logSilentCatch } from "./silent-catch";
import path from "path";
import { eq } from "drizzle-orm";
import { isProductionRuntime } from "./runtime-env";
import { db } from "../db";
import { agentSettings } from "@shared/schema";
import { encryptApiKey, decryptApiKey } from "../crypto";

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

// Debounce for the owner-alert fired when the refresh token is permanently
// revoked (invalid_grant). Without this the daily ingest used to rot silently
// for weeks before anyone noticed; with it, the FIRST permanent failure pages
// the owner exactly once per cooldown window (transient errors never page).
let _lastTokenDeathAlert = 0;
const TOKEN_DEATH_ALERT_COOLDOWN_MS = 12 * 60 * 60 * 1000; // 12h

async function alertOwnerGmailTokenDead(detail: string): Promise<void> {
  const now = Date.now();
  if (now - _lastTokenDeathAlert < TOKEN_DEATH_ALERT_COOLDOWN_MS) return;
  _lastTokenDeathAlert = now;
  const subject = "⚠️ IdeaBrowser Gmail read-token revoked — daily idea ingest is DOWN";
  const body =
    `The Gmail read-only OAuth token used to ingest Greg Isenberg's "Idea of the Day" emails is no longer valid (${detail}).\n\n` +
    `Daily idea ingestion has STOPPED — new ideas are accumulating unread.\n\n` +
    `Most likely cause: the Google OAuth consent screen is still in "Testing" publishing status, which expires refresh tokens after 7 days.\n` +
    `Permanent fix: publish the consent screen to "In production" in Google Cloud Console (kills the 7-day expiry), then re-authorize once via GET /api/admin/gmail-direct/auth with the x-admin-pin request header.\n`;
  try {
    const { sendEmail, isEmailConfigured, getPrimaryInboxId } = await import("../email");
    const { resolveOwnerEmail } = await import("./owner-email");
    const to = resolveOwnerEmail();
    if (!isEmailConfigured() || !to) {
      console.error(`[gmail-direct][OWNER-ALERT] ${subject} :: ${body}`);
      return;
    }
    const inboxId = await getPrimaryInboxId();
    await sendEmail({ inboxId, to, subject, text: body });
    console.error(`[gmail-direct] owner alerted: Gmail read-token revoked (${detail})`);
  } catch (e: any) {
    console.error(`[gmail-direct][OWNER-ALERT] send failed: ${e?.message || e} (token death: ${detail})`);
  }
}

export async function loadGmailDirectRefreshToken(): Promise<GmailDirectToken | null> {
  if (process.env.GMAIL_REFRESH_TOKEN) {
    return {
      refresh_token: process.env.GMAIL_REFRESH_TOKEN,
      scope: process.env.GMAIL_REFRESH_SCOPE || "https://www.googleapis.com/auth/gmail.readonly",
      saved_at: "env",
    };
  }
  // 2) Shared DB (encrypted). Dev and prod share ONE database, so authorizing
  //    once anywhere (/api/admin/gmail-direct/auth) persists the token here and
  //    the prod ideabrowser_ingest task reads it on every run — surviving
  //    publishes with NO manual secret copy. This is the DB + network path.
  const fromDb = await loadGmailDirectTokenFromDb();
  if (fromDb) return fromDb;
  // 3) Workspace token FILE. In dev this is the normal local fallback. In
  //    PROD it is a one-time bootstrap: the deploy image ships the whole
  //    workspace FS (gitignore does not apply to publishes), so the dev
  //    token file IS present in a fresh prod container even though the prod
  //    FS is ephemeral. Dev and prod databases are SEPARATE (the old
  //    "shared DB" assumption is stale — prod's agent_settings row had a
  //    NULL token while dev's was populated, which silently broke the daily
  //    ideabrowser ingest in prod). On a successful prod file read we
  //    persist the token to the PROD DB immediately so subsequent boots and
  //    publishes are file-independent.
  try {
    const raw = await fs.readFile(TOKEN_FILE, "utf-8");
    const parsed = JSON.parse(raw) as GmailDirectToken;
    if (parsed?.refresh_token) {
      if (isProductionRuntime()) {
        console.log("[gmail-direct] prod bootstrap: importing Gmail token from shipped workspace file into the prod DB (one-time)");
        await saveGmailDirectTokenToDb(parsed);
        // Reduce residual exposure: once the token verifiably lives in the
        // prod DB (read-back check — save is fail-soft, so don't trust it
        // blindly), delete the plaintext file from the running container.
        // If the DB write silently failed, KEEP the file so the next boot
        // can retry the bootstrap.
        const verify = await loadGmailDirectTokenFromDb();
        if (verify?.refresh_token) {
          try {
            await fs.unlink(TOKEN_FILE);
            console.log("[gmail-direct] prod bootstrap complete — plaintext token file removed from container");
          } catch (e: any) {
            console.warn(`[gmail-direct] could not remove token file (non-fatal): ${e?.message || e}`);
          }
        } else {
          console.warn("[gmail-direct] prod bootstrap: DB read-back failed — keeping token file for retry on next boot");
        }
      }
      return parsed;
    }
  } catch (_silentErr) { logSilentCatch("server/lib/gmail-direct-token.ts", _silentErr); }
  // 4) No source anywhere. Fail SOFT with one actionable line so the
  //    heartbeat tick is never crashed.
  console.error(
    "[gmail-direct] no Gmail token in env, DB, or workspace file — ideabrowser ingest cannot authenticate. Authorize once via GET /api/admin/gmail-direct/auth (x-admin-pin header); the callback persists the token to the DB so it survives publishes.",
  );
  return null;
}

// Encrypted-at-rest persistence of the Gmail-direct refresh token in the shared
// agent_settings singleton. Both helpers are best-effort and fail SOFT (never
// throw) so a DB hiccup can't crash the OAuth callback or a heartbeat tick.
async function saveGmailDirectTokenToDb(t: GmailDirectToken): Promise<void> {
  try {
    const enc = encryptApiKey(JSON.stringify(t));
    const [row] = await db.select({ id: agentSettings.id }).from(agentSettings).limit(1);
    if (row) {
      await db.update(agentSettings).set({ gmailDirectToken: enc }).where(eq(agentSettings.id, row.id));
    } else {
      await db.insert(agentSettings).values({ gmailDirectToken: enc });
    }
  } catch (e: any) {
    console.error(`[gmail-direct] failed to persist refresh token to DB: ${e?.message || e}`);
  }
}

async function loadGmailDirectTokenFromDb(): Promise<GmailDirectToken | null> {
  try {
    const [row] = await db.select({ tok: agentSettings.gmailDirectToken }).from(agentSettings).limit(1);
    if (!row?.tok) return null;
    const parsed = JSON.parse(decryptApiKey(row.tok)) as GmailDirectToken;
    return parsed?.refresh_token ? parsed : null;
  } catch (e: any) {
    console.error(`[gmail-direct] failed to load refresh token from DB: ${e?.message || e}`);
    return null;
  }
}

export async function saveGmailDirectRefreshToken(t: GmailDirectToken): Promise<void> {
  // Persist to the shared DB (encrypted) FIRST — the durable, prod-safe store
  // that survives publishes and is shared dev↔prod. Set-and-forget after one
  // authorization. Best-effort: a DB failure must not blow up the callback.
  await saveGmailDirectTokenToDb(t);
  // Dev convenience only: mirror to the workspace file for local inspection.
  // Skipped in prod (ephemeral FS — a pointless, lost write).
  if (!isProductionRuntime()) {
    try {
      await fs.mkdir(path.dirname(TOKEN_FILE), { recursive: true });
      await fs.writeFile(TOKEN_FILE, JSON.stringify(t, null, 2), { mode: 0o600 });
    } catch (e: any) {
      console.warn(`[gmail-direct] dev token file write failed (non-fatal): ${e?.message || e}`);
    }
  }
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
        // Log ONLY allowlisted structured fields — never the raw response body
        // (token-endpoint error payloads are an avoidable sensitive log sink).
        let errCode = "unknown";
        let errDesc = "";
        try {
          const parsed = JSON.parse(text);
          if (typeof parsed?.error === "string") errCode = parsed.error.slice(0, 64);
          if (typeof parsed?.error_description === "string") errDesc = parsed.error_description.slice(0, 120);
        } catch (e) {
          console.warn(`[gmail-direct] refresh error body was non-JSON (status-only report): ${(e as any)?.message ?? e}`);
        }
        console.error(`[gmail-direct] refresh failed ${resp.status}: error=${errCode}${errDesc ? ` desc=${errDesc}` : ""}`);
        // A revoked/expired refresh token (invalid_grant) is PERMANENT — it will
        // never self-heal on retry and silently halts daily idea ingest. Page the
        // owner (debounced, fire-and-forget) so it can't rot unnoticed for weeks
        // again. Transient 5xx / network errors are NOT alerted (handled above /
        // recover on the next cron tick).
        if (resp.status === 400 && /invalid_grant/i.test(text)) {
          void alertOwnerGmailTokenDead(`invalid_grant (HTTP ${resp.status})`);
        }
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
