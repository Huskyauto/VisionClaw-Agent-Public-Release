import crypto from "crypto";
import { db } from "./db";
import { sql } from "drizzle-orm";
import { encryptApiKey, decryptApiKey } from "./crypto";

export function getAppBaseUrl(req?: { headers: Record<string, any>; hostname?: string }): string {
  const replitDomains = process.env.REPLIT_DOMAINS || process.env.REPL_SLUG;
  if (replitDomains) {
    const domain = replitDomains.split(",")[0].trim();
    return `https://${domain}`;
  }
  if (req) {
    const proto = req.headers["x-forwarded-proto"] || "https";
    const host = req.headers.host || req.hostname || "localhost:5000";
    return `${proto}://${host}`;
  }
  return "https://localhost:5000";
}

export interface OAuthSubscription {
  id: number;
  provider: string;
  tenantId: number;
  accessToken: string;
  refreshToken: string | null;
  expiresAt: number;
  accountId: string | null;
  email: string | null;
  scope: string | null;
  tokenType: string;
  connectedAt: string;
  lastRefreshed: string | null;
  isActive: boolean;
}

export interface OAuthProviderConfig {
  authUrl: string;
  tokenUrl: string;
  clientId: string;
  clientSecret?: string;
  scopes: string[];
  audience?: string;
  extraAuthParams?: Record<string, string>;
}

const GOOGLE_OAUTH_CONFIG: OAuthProviderConfig = {
  authUrl: "https://accounts.google.com/o/oauth2/v2/auth",
  tokenUrl: "https://oauth2.googleapis.com/token",
  clientId: process.env.GOOGLE_OAUTH_CLIENT_ID || "",
  clientSecret: process.env.GOOGLE_OAUTH_CLIENT_SECRET || "",
  scopes: [
    "openid",
    "https://www.googleapis.com/auth/userinfo.email",
    "https://www.googleapis.com/auth/gmail.modify",
    "https://www.googleapis.com/auth/gmail.send",
    "https://www.googleapis.com/auth/calendar",
    "https://www.googleapis.com/auth/contacts",
    "https://www.googleapis.com/auth/spreadsheets",
    "https://www.googleapis.com/auth/documents",
    "https://www.googleapis.com/auth/presentations",
    "https://www.googleapis.com/auth/drive.file",
  ],
  extraAuthParams: {
    access_type: "offline",
    prompt: "consent",
  },
};

const OAUTH_PROVIDERS: Record<string, OAuthProviderConfig> = {
  openai: {
    authUrl: "https://auth.openai.com/oauth/authorize",
    tokenUrl: "https://auth.openai.com/oauth/token",
    clientId: process.env.OPENAI_OAUTH_CLIENT_ID || "",
    scopes: ["openid", "profile", "email", "offline_access", "model.request", "api.model.read", "api.connectors.read", "api.connectors.invoke"],
  },
  google: GOOGLE_OAUTH_CONFIG,
  "google-workspace": GOOGLE_OAUTH_CONFIG,
  youtube: {
    authUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: "https://oauth2.googleapis.com/token",
    clientId: process.env.YOUTUBE_CLIENT_ID || "",
    clientSecret: process.env.YOUTUBE_CLIENT_SECRET || "",
    scopes: [
      "https://www.googleapis.com/auth/youtube",
      "https://www.googleapis.com/auth/youtube.upload",
      "https://www.googleapis.com/auth/youtube.readonly",
      "https://www.googleapis.com/auth/youtubepartner",
    ],
    extraAuthParams: {
      access_type: "offline",
      prompt: "consent",
    },
  },
};

async function performStsExchange(config: OAuthProviderConfig, idToken: string): Promise<{ token: string; expiresAt: number } | null> {
  try {
    const resp = await fetch(config.tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:token-exchange",
        client_id: config.clientId,
        requested_token: "openai-api-key",
        subject_token: idToken,
        subject_token_type: "urn:ietf:params:oauth:token-type:id_token",
      }).toString(),
    });
    if (resp.ok) {
      const data = await resp.json();
      if (data.access_token) {
        console.log(`[oauth] STS exchange succeeded — got OpenAI API key`);
        return {
          token: data.access_token,
          expiresAt: Date.now() + (data.expires_in || 3600) * 1000,
        };
      }
    } else {
      console.warn(`[oauth] STS exchange failed (${resp.status}), using OAuth token directly`);
    }
  } catch (err: any) {
    console.warn(`[oauth] STS exchange error:`, err.message);
  }
  return null;
}

function generateCodeVerifier(): string {
  return crypto.randomBytes(32).toString("base64url");
}

function generateCodeChallenge(verifier: string): string {
  return crypto.createHash("sha256").update(verifier).digest("base64url");
}

function generateState(): string {
  return crypto.randomBytes(16).toString("hex");
}

export function getOAuthProviders(): string[] {
  return Object.keys(OAUTH_PROVIDERS);
}

export function getOAuthProviderInfo(provider: string): { name: string; description: string } | null {
  const info: Record<string, { name: string; description: string }> = {
    openai: { name: "OpenAI (ChatGPT)", description: "Use your ChatGPT Plus/Team/Enterprise subscription for inference" },
    google: { name: "Google Workspace + Gemini", description: "Connect via your Replit Google Drive integration for Drive, Sheets, Docs, and Gemini" },
  };
  return info[provider] || null;
}

export function initiateOAuth(provider: string, callbackUrl: string, tenantId: number): { authUrl: string; state: string; verifier: string } | null {
  const config = OAUTH_PROVIDERS[provider];
  if (!config) return null;

  const state = generateState();
  const verifier = generateCodeVerifier();
  const challenge = generateCodeChallenge(verifier);

  const params = new URLSearchParams({
    client_id: config.clientId,
    response_type: "code",
    redirect_uri: callbackUrl,
    scope: config.scopes.join(" "),
    code_challenge: challenge,
    code_challenge_method: "S256",
    state,
  });

  if (config.audience) {
    params.set("audience", config.audience);
  }

  if (config.extraAuthParams) {
    for (const [k, v] of Object.entries(config.extraAuthParams)) {
      params.set(k, v);
    }
  }

  const authUrl = `${config.authUrl}?${params.toString()}`;
  return { authUrl, state, verifier };
}

export async function exchangeCodeForTokens(
  provider: string,
  code: string,
  callbackUrl: string,
  verifier: string,
  tenantId: number
): Promise<{ success: boolean; error?: string }> {
  const config = OAUTH_PROVIDERS[provider];
  if (!config) return { success: false, error: "Unknown provider" };

  try {
    const body: Record<string, string> = {
      grant_type: "authorization_code",
      client_id: config.clientId,
      code_verifier: verifier,
      code,
      redirect_uri: callbackUrl,
    };

    const resp = await fetch(config.tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(body).toString(),
    });

    if (!resp.ok) {
      const errText = await resp.text();
      console.error(`[oauth] Token exchange failed for ${provider}: ${resp.status} ${errText}`);
      return { success: false, error: `Token exchange failed: ${resp.status}` };
    }

    const data = await resp.json();
    let finalToken = data.access_token;
    let finalExpiresAt = Date.now() + (data.expires_in || 3600) * 1000;

    if (provider === "openai" && data.id_token) {
      const stsResult = await performStsExchange(config, data.id_token);
      if (stsResult) {
        finalToken = stsResult.token;
        finalExpiresAt = stsResult.expiresAt;
      }
    }

    const encryptedAccess = encryptApiKey(finalToken);
    const encryptedRefresh = data.refresh_token ? encryptApiKey(data.refresh_token) : null;

    await db.execute(sql`
      INSERT INTO oauth_subscriptions (provider, tenant_id, access_token, refresh_token, expires_at, token_type, scope, is_active)
      VALUES (${provider}, ${tenantId}, ${encryptedAccess}, ${encryptedRefresh}, ${finalExpiresAt}, ${data.token_type || "Bearer"}, ${data.scope || config.scopes.join(" ")}, TRUE)
      ON CONFLICT (provider, tenant_id) DO UPDATE SET
        access_token = ${encryptedAccess},
        refresh_token = COALESCE(${encryptedRefresh}, oauth_subscriptions.refresh_token),
        expires_at = ${finalExpiresAt},
        token_type = ${data.token_type || "Bearer"},
        scope = ${data.scope || config.scopes.join(" ")},
        is_active = TRUE,
        last_refreshed = CURRENT_TIMESTAMP
    `);

    console.log(`[oauth] Successfully connected ${provider} subscription for tenant ${tenantId}`);

    if (isGoogleProvider(provider)) {
      await syncGoogleTokenToDrive(finalToken, finalExpiresAt - Date.now());
    }

    return { success: true };
  } catch (err: any) {
    console.error(`[oauth] Exchange error for ${provider}:`, err.message);
    return { success: false, error: err.message };
  }
}

async function syncGoogleTokenToDrive(token: string, expiresInMs?: number): Promise<void> {
  try {
    const { setDriveToken } = await import("./google-drive");
    await setDriveToken(token, expiresInMs || 3500000);
    console.log("[oauth] Synced Google token to Drive module");
  } catch (err: any) {
    console.warn("[oauth] Drive sync failed (non-fatal):", err.message?.substring(0, 80));
  }
}

function isGoogleProvider(provider: string): boolean {
  return provider === "google" || provider === "google-workspace";
}

const _refreshInFlight = new Set<string>();

function getRefreshLockKey(provider: string, tenantId: number): string {
  return `${provider}:${tenantId}`;
}

const MAX_REFRESH_FAILURES = 3;

export async function refreshAccessToken(provider: string, tenantId: number): Promise<string | null> {
  const lockKey = getRefreshLockKey(provider, tenantId);
  if (_refreshInFlight.has(lockKey)) {
    console.log(`[oauth] Skipping refresh for ${lockKey} — already in progress`);
    return null;
  }
  _refreshInFlight.add(lockKey);
  try {
    const config = OAUTH_PROVIDERS[provider];
    if (!config) return null;

    const rows = await db.execute(sql`
      SELECT * FROM oauth_subscriptions
      WHERE provider = ${provider} AND tenant_id = ${tenantId} AND is_active = TRUE
      LIMIT 1
    `);
    const sub = (rows as any).rows?.[0];
    if (!sub || !sub.refresh_token) return null;

    let refreshToken: string;
    try {
      refreshToken = decryptApiKey(sub.refresh_token);
    } catch {
      console.warn(`[oauth] Refresh token decryption failed for ${provider} tenant ${tenantId} (stale after fork/restore), deactivating`);
      await db.execute(sql`
        UPDATE oauth_subscriptions SET is_active = FALSE
        WHERE provider = ${provider} AND tenant_id = ${tenantId}
      `).catch(() => {});
      return null;
    }
    const body: Record<string, string> = {
      grant_type: "refresh_token",
      client_id: config.clientId,
      refresh_token: refreshToken,
    };
    if (config.clientSecret) {
      body.client_secret = config.clientSecret;
    }

    const resp = await fetch(config.tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(body).toString(),
    });

    if (!resp.ok) {
      let errBody = "";
      try { errBody = await resp.text(); } catch {}
      const isInvalidGrant = errBody.includes("invalid_grant");
      const failures = (Number(sub.consecutive_failures) || 0) + 1;
      console.error(`[oauth] Refresh failed for ${provider} tenant ${tenantId}: ${resp.status} (failure ${failures}/${MAX_REFRESH_FAILURES})${isInvalidGrant ? " — invalid_grant (token revoked or expired)" : ""}`);

      if (isInvalidGrant || failures >= MAX_REFRESH_FAILURES) {
        await db.execute(sql`
          UPDATE oauth_subscriptions SET is_active = FALSE, consecutive_failures = ${failures}
          WHERE provider = ${provider} AND tenant_id = ${tenantId}
        `);
        console.error(`[oauth] Deactivated ${provider} subscription for tenant ${tenantId}${isInvalidGrant ? " — refresh token is permanently invalid, user must re-authorize" : ` after ${failures} consecutive failures`}`);
      } else {
        await db.execute(sql`
          UPDATE oauth_subscriptions SET consecutive_failures = ${failures}
          WHERE provider = ${provider} AND tenant_id = ${tenantId}
        `);
      }
      return null;
    }

    const data = await resp.json();
    let finalToken = data.access_token;
    let finalExpiresAt = Date.now() + (data.expires_in || 3600) * 1000;

    if (provider === "openai" && data.id_token) {
      const stsResult = await performStsExchange(config, data.id_token);
      if (stsResult) {
        finalToken = stsResult.token;
        finalExpiresAt = stsResult.expiresAt;
      }
    }

    const encryptedAccess = encryptApiKey(finalToken);
    const encryptedRefresh = data.refresh_token ? encryptApiKey(data.refresh_token) : null;

    await db.execute(sql`
      UPDATE oauth_subscriptions SET
        access_token = ${encryptedAccess},
        refresh_token = COALESCE(${encryptedRefresh}, refresh_token),
        expires_at = ${finalExpiresAt},
        last_refreshed = CURRENT_TIMESTAMP,
        consecutive_failures = 0
      WHERE provider = ${provider} AND tenant_id = ${tenantId}
    `);

    console.log(`[oauth] Refreshed ${provider} token for tenant ${tenantId}, next refresh in ~${Math.round((finalExpiresAt - Date.now()) / 60000)} min`);

    if (isGoogleProvider(provider)) {
      await syncGoogleTokenToDrive(finalToken, finalExpiresAt - Date.now());
    }

    return finalToken;
  } catch (err: any) {
    console.error(`[oauth] Refresh error for ${provider}:`, err.message);
    return null;
  } finally {
    _refreshInFlight.delete(lockKey);
  }
}

export async function getSubscriptionAccessToken(provider: string, tenantId: number): Promise<string | null> {
  const rows = await db.execute(sql`
    SELECT * FROM oauth_subscriptions
    WHERE provider = ${provider} AND tenant_id = ${tenantId} AND is_active = TRUE
    LIMIT 1
  `);
  const sub = (rows as any).rows?.[0];
  if (!sub) return null;

  const expiresAt = Number(sub.expires_at);
  const bufferMs = 5 * 60 * 1000;

  if (Date.now() + bufferMs >= expiresAt) {
    const refreshed = await refreshAccessToken(provider, tenantId);
    if (refreshed) return refreshed;

    if (isGoogleProvider(provider)) {
      console.log(`[oauth] Google subscription refresh failed — attempting connector fallback repair`);
      try {
        const result = await connectGoogleViaReplit(tenantId);
        if (result.success) {
          console.log(`[oauth] Google subscription auto-repaired via Replit connector`);
          const freshRows = await db.execute(sql`
            SELECT access_token FROM oauth_subscriptions
            WHERE provider = ${provider} AND tenant_id = ${tenantId} AND is_active = TRUE
            LIMIT 1
          `);
          const freshSub = (freshRows as any).rows?.[0];
          if (freshSub?.access_token) {
            return decryptApiKey(freshSub.access_token);
          }
        }
      } catch (repairErr: any) {
        console.warn(`[oauth] Google connector repair failed: ${repairErr.message?.slice(0, 80)}`);
      }
    }
    return null;
  }

  try {
    return decryptApiKey(sub.access_token);
  } catch (err: any) {
    console.warn(`[oauth] Token decryption failed for ${provider} tenant ${tenantId} (likely stale after fork/restore), deactivating`);
    await db.execute(sql`
      UPDATE oauth_subscriptions SET is_active = FALSE
      WHERE provider = ${provider} AND tenant_id = ${tenantId}
    `).catch(() => {});
    return null;
  }
}

export async function connectGoogleViaReplit(tenantId: number): Promise<{ success: boolean; error?: string }> {
  try {
    const hostname = process.env.REPLIT_CONNECTORS_HOSTNAME;
    if (!hostname) return { success: false, error: "Replit connector not available" };

    const replIdentity = process.env.REPL_IDENTITY;
    const webReplRenewal = process.env.WEB_REPL_RENEWAL;
    const xReplitToken = replIdentity
      ? 'repl ' + replIdentity
      : webReplRenewal
        ? 'depl ' + webReplRenewal
        : null;
    if (!xReplitToken) return { success: false, error: "Replit auth not available" };

    const isProduction = process.env.REPLIT_DEPLOYMENT === '1';
    const envOrder = isProduction ? ['production', 'development'] : ['development', 'production'];

    let conn: any = null;
    for (const env of envOrder) {
      const url = new URL(`https://${hostname}/api/v2/connection`);
      url.searchParams.set('include_secrets', 'true');
      url.searchParams.set('connector_names', 'google-drive');
      url.searchParams.set('environment', env);

      const resp = await fetch(url.toString(), {
        headers: { 'Accept': 'application/json', 'X-Replit-Token': xReplitToken },
      });
      if (!resp.ok) continue;
      const data = await resp.json();
      if (data?.items?.[0]) { conn = data.items[0]; break; }
    }

    if (!conn) return { success: false, error: "No Google Drive integration found. Please connect Google Drive in the Replit integrations panel first." };

    const token = conn?.settings?.oauth?.credentials?.access_token;
    const refreshToken = conn?.settings?.oauth?.credentials?.refresh_token;
    const expiryStr = conn?.settings?.oauth?.credentials?.expiry_date;
    const email = conn?.settings?.oauth?.credentials?.id_token_claims?.email;

    if (!token || typeof token !== 'string' || token.length < 20) {
      return { success: false, error: "Google Drive integration has no valid token. Try reconnecting in Replit integrations." };
    }

    const expiresAt = expiryStr ? new Date(expiryStr).getTime() : Date.now() + 3500000;
    const encryptedAccess = encryptApiKey(token);
    const encryptedRefresh = refreshToken ? encryptApiKey(refreshToken) : null;

    await db.execute(sql`
      INSERT INTO oauth_subscriptions (provider, tenant_id, access_token, refresh_token, expires_at, token_type, scope, email, is_active)
      VALUES ('google-workspace', ${tenantId}, ${encryptedAccess}, ${encryptedRefresh}, ${expiresAt}, 'Bearer', 'google-drive', ${email || null}, TRUE)
      ON CONFLICT (provider, tenant_id) DO UPDATE SET
        access_token = ${encryptedAccess},
        refresh_token = COALESCE(${encryptedRefresh}, oauth_subscriptions.refresh_token),
        expires_at = ${expiresAt},
        email = COALESCE(${email || null}, oauth_subscriptions.email),
        is_active = TRUE,
        last_refreshed = CURRENT_TIMESTAMP
    `);

    console.log(`[oauth] Connected Google via Replit integration for tenant ${tenantId}`);

    await syncGoogleTokenToDrive(token, expiresAt - Date.now());

    return { success: true };
  } catch (err: any) {
    console.error(`[oauth] Google Replit connect error:`, err.message);
    return { success: false, error: err.message };
  }
}

export async function getSubscriptionStatus(tenantId: number): Promise<Array<{
  provider: string;
  isActive: boolean;
  expiresAt: number;
  email: string | null;
  connectedAt: string;
  expiresIn: string;
}>> {
  const rows = await db.execute(sql`
    SELECT provider, is_active, expires_at, email, connected_at
    FROM oauth_subscriptions
    WHERE tenant_id = ${tenantId}
    ORDER BY provider
  `);
  const subs = (rows as any).rows || [];
  return subs.map((s: any) => {
    const expiresAt = Number(s.expires_at);
    const msLeft = expiresAt - Date.now();
    let expiresIn = "expired";
    if (msLeft > 0) {
      const hours = Math.floor(msLeft / 3600000);
      const mins = Math.floor((msLeft % 3600000) / 60000);
      expiresIn = hours > 0 ? `${hours}h ${mins}m` : `${mins}m`;
    }
    return {
      provider: s.provider,
      isActive: s.is_active,
      expiresAt,
      email: s.email,
      connectedAt: s.connected_at,
      expiresIn,
    };
  });
}

export async function disconnectSubscription(provider: string, tenantId: number): Promise<boolean> {
  await db.execute(sql`
    DELETE FROM oauth_subscriptions
    WHERE provider = ${provider} AND tenant_id = ${tenantId}
  `);
  return true;
}

const pendingDeviceFlows = new Map<string, {
  provider: string;
  tenantId: number;
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  verificationUriComplete: string;
  interval: number;
  expiresAt: number;
  createdAt: number;
}>();

export function initiateLocalRedirectOAuth(provider: string, tenantId: number, baseUrl?: string): {
  authUrl: string;
  state: string;
  verifier: string;
} | null {
  const config = OAUTH_PROVIDERS[provider];
  if (!config) return null;

  const state = generateState();
  const verifier = generateCodeVerifier();
  const challenge = generateCodeChallenge(verifier);

  const redirectUri = provider === "openai"
    ? "http://localhost:1455/auth/callback"
    : `${baseUrl || getAppBaseUrl()}/api/oauth-subscriptions/callback`;

  const params = new URLSearchParams({
    response_type: "code",
    client_id: config.clientId,
    redirect_uri: redirectUri,
    scope: config.scopes.join(" "),
    code_challenge: challenge,
    code_challenge_method: "S256",
    state,
  });

  if (provider === "openai") {
    params.set("id_token_add_organizations", "true");
    params.set("codex_cli_simplified_flow", "true");
    params.set("originator", "codex_vscode");
  }

  if (config.extraAuthParams) {
    for (const [k, v] of Object.entries(config.extraAuthParams)) {
      params.set(k, v);
    }
  }

  const authUrl = `${config.authUrl}?${params.toString()}`;
  return { authUrl, state, verifier };
}

export async function exchangeCodeWithLocalRedirect(
  provider: string,
  code: string,
  verifier: string,
  tenantId: number,
  baseUrl?: string
): Promise<{ success: boolean; error?: string }> {
  const config = OAUTH_PROVIDERS[provider];
  if (!config) return { success: false, error: "Unknown provider" };

  try {
    const redirectUri = provider === "openai"
      ? "http://localhost:1455/auth/callback"
      : `${baseUrl || getAppBaseUrl()}/api/oauth-subscriptions/callback`;

    const body: Record<string, string> = {
      grant_type: "authorization_code",
      client_id: config.clientId,
      code_verifier: verifier,
      code,
      redirect_uri: redirectUri,
    };
    if (config.clientSecret) {
      body.client_secret = config.clientSecret;
    }

    const resp = await fetch(config.tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(body).toString(),
    });

    if (!resp.ok) {
      const errText = await resp.text();
      console.error(`[oauth] Local redirect token exchange failed for ${provider}: ${resp.status} ${errText}`);
      return { success: false, error: `Token exchange failed: ${resp.status}` };
    }

    const data = await resp.json();
    let finalAccessToken = data.access_token;
    let finalExpiresAt = Date.now() + (data.expires_in || 3600) * 1000;

    if (provider === "openai" && data.id_token) {
      const stsResult = await performStsExchange(config, data.id_token);
      if (stsResult) {
        finalAccessToken = stsResult.token;
        finalExpiresAt = stsResult.expiresAt;
      }
    }

    const encryptedAccess = encryptApiKey(finalAccessToken);
    const encryptedRefresh = data.refresh_token ? encryptApiKey(data.refresh_token) : null;
    const idTokenEncrypted = data.id_token ? encryptApiKey(data.id_token) : null;

    await db.execute(sql`
      INSERT INTO oauth_subscriptions (provider, tenant_id, access_token, refresh_token, expires_at, token_type, scope, is_active)
      VALUES (${provider}, ${tenantId}, ${encryptedAccess}, ${encryptedRefresh}, ${finalExpiresAt}, ${data.token_type || "Bearer"}, ${data.scope || config.scopes.join(" ")}, TRUE)
      ON CONFLICT (provider, tenant_id) DO UPDATE SET
        access_token = ${encryptedAccess},
        refresh_token = COALESCE(${encryptedRefresh}, oauth_subscriptions.refresh_token),
        expires_at = ${finalExpiresAt},
        token_type = ${data.token_type || "Bearer"},
        scope = ${data.scope || config.scopes.join(" ")},
        is_active = TRUE,
        last_refreshed = CURRENT_TIMESTAMP
    `);

    console.log(`[oauth] Successfully connected ${provider} via code paste for tenant ${tenantId}`);

    if (isGoogleProvider(provider)) {
      await syncGoogleTokenToDrive(finalAccessToken, finalExpiresAt - Date.now());
    }

    return { success: true };
  } catch (err: any) {
    console.error(`[oauth] Code paste exchange error for ${provider}:`, err.message);
    return { success: false, error: err.message };
  }
}

export async function pollDeviceCode(flowId: string): Promise<{
  status: "pending" | "success" | "expired" | "error";
  error?: string;
}> {
  const flow = pendingDeviceFlows.get(flowId);
  if (!flow) return { status: "error", error: "Flow not found or expired" };

  if (Date.now() >= flow.expiresAt) {
    pendingDeviceFlows.delete(flowId);
    return { status: "expired", error: "Device code expired" };
  }

  const config = OAUTH_PROVIDERS[flow.provider];
  if (!config) return { status: "error", error: "Unknown provider" };

  try {
    const resp = await fetch(config.tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:device_code",
        device_code: flow.deviceCode,
        client_id: config.clientId,
      }).toString(),
    });

    if (!resp.ok) {
      const data = await resp.json().catch(() => ({ error: "unknown" }));
      if (data.error === "authorization_pending") {
        return { status: "pending" };
      }
      if (data.error === "slow_down") {
        flow.interval = Math.min(flow.interval + 5, 30);
        return { status: "pending" };
      }
      if (data.error === "expired_token") {
        pendingDeviceFlows.delete(flowId);
        return { status: "expired", error: "Device code expired" };
      }
      return { status: "error", error: data.error_description || data.error || "Token exchange failed" };
    }

    const data = await resp.json();
    const expiresAt = Date.now() + (data.expires_in || 3600) * 1000;

    const encryptedAccess = encryptApiKey(data.access_token);
    const encryptedRefresh = data.refresh_token ? encryptApiKey(data.refresh_token) : null;

    await db.execute(sql`
      INSERT INTO oauth_subscriptions (provider, tenant_id, access_token, refresh_token, expires_at, token_type, scope, is_active)
      VALUES (${flow.provider}, ${flow.tenantId}, ${encryptedAccess}, ${encryptedRefresh}, ${expiresAt}, ${data.token_type || "Bearer"}, ${data.scope || config.scopes.join(" ")}, TRUE)
      ON CONFLICT (provider, tenant_id) DO UPDATE SET
        access_token = ${encryptedAccess},
        refresh_token = COALESCE(${encryptedRefresh}, oauth_subscriptions.refresh_token),
        expires_at = ${expiresAt},
        token_type = ${data.token_type || "Bearer"},
        scope = ${data.scope || config.scopes.join(" ")},
        is_active = TRUE,
        last_refreshed = CURRENT_TIMESTAMP
    `);

    pendingDeviceFlows.delete(flowId);
    console.log(`[oauth] Device code flow completed for ${flow.provider} tenant ${flow.tenantId}`);
    return { status: "success" };
  } catch (err: any) {
    console.error(`[oauth] Device code poll error:`, err.message);
    return { status: "error", error: err.message };
  }
}

export async function validateSubscriptionsOnStartup(): Promise<void> {
  try {
    const rows = await db.execute(sql`
      SELECT id, provider, tenant_id, expires_at, refresh_token, consecutive_failures
      FROM oauth_subscriptions WHERE is_active = TRUE
    `);
    const subs = (rows as any).rows || [];

    const hasActiveGoogleWs = subs.some((s: any) => s.provider === "google-workspace");
    if (!hasActiveGoogleWs && process.env.REPLIT_CONNECTORS_HOSTNAME) {
      try {
        const existingGoogle = await db.execute(sql`SELECT tenant_id, is_active FROM oauth_subscriptions WHERE provider = 'google-workspace'`);
        const googleRows = ((existingGoogle as any).rows || []);
        const tenantIds = googleRows.length > 0
          ? googleRows.filter((r: any) => r.is_active !== false).map((r: any) => Number(r.tenant_id))
          : [1];
        for (const tid of tenantIds) {
          const result = await connectGoogleViaReplit(tid);
          if (result.success) {
            console.log(`[oauth] Auto-reconnected Google for tenant ${tid} on startup`);
          }
        }
      } catch (e: any) {
        console.log(`[oauth] Auto-reconnect Google on startup failed: ${e.message}`);
      }
    }

    if (subs.length === 0 && !hasActiveGoogleWs) {
      console.log("[oauth] No active subscriptions to validate");
      return;
    }

    let deactivated = 0;
    let refreshed = 0;
    let valid = 0;

    for (const sub of subs) {
      const expiresAt = Number(sub.expires_at);
      const provider = sub.provider;
      const tenantId = Number(sub.tenant_id);
      const bufferMs = 5 * 60 * 1000;

      if (Date.now() + bufferMs >= expiresAt) {
        if (provider === "google-workspace" && !sub.refresh_token) {
          try {
            const reconnected = await connectGoogleViaReplit(tenantId);
            if (reconnected.success) {
              refreshed++;
              console.log(`[oauth] Auto-reconnected Google for tenant ${tenantId} via Replit connector`);
              continue;
            }
          } catch {}
          await db.execute(sql`
            UPDATE oauth_subscriptions SET is_active = FALSE
            WHERE id = ${sub.id}
          `);
          deactivated++;
          console.log(`[oauth] Deactivated expired ${provider} subscription for tenant ${tenantId} (no refresh token, connector unavailable)`);
          continue;
        }

        if (!sub.refresh_token) {
          await db.execute(sql`
            UPDATE oauth_subscriptions SET is_active = FALSE
            WHERE id = ${sub.id}
          `);
          deactivated++;
          console.log(`[oauth] Deactivated expired ${provider} subscription for tenant ${tenantId} (no refresh token)`);
          continue;
        }

        const result = await refreshAccessToken(provider, tenantId);
        if (result) {
          refreshed++;
        } else {
          const failures = Number(sub.consecutive_failures) || 0;
          if (failures >= 2) {
            await db.execute(sql`
              UPDATE oauth_subscriptions SET is_active = FALSE
              WHERE id = ${sub.id}
            `);
            deactivated++;
            console.log(`[oauth] Deactivated stale ${provider} subscription for tenant ${tenantId} (refresh failed, ${failures} prior failures)`);
          }
        }
      } else {
        valid++;
      }
    }

    console.log(`[oauth] Startup validation: ${valid} valid, ${refreshed} refreshed, ${deactivated} deactivated (of ${subs.length} total)`);
  } catch (err: any) {
    console.log("[oauth] Startup validation (non-fatal):", err.message);
  }
}

let oauthRefreshInterval: ReturnType<typeof setInterval> | null = null;

export function startOAuthRefreshLoop(): void {
  if (oauthRefreshInterval) return;
  console.log("[oauth] Legacy refresh loop skipped — handled by unified auto-refresh system");
}

export function stopOAuthRefreshLoop(): void {
  if (oauthRefreshInterval) {
    clearInterval(oauthRefreshInterval);
    oauthRefreshInterval = null;
  }
}

const pendingOAuthFlows = new Map<string, { provider: string; verifier: string; tenantId: number; createdAt: number }>();

export function storePendingFlow(state: string, provider: string, verifier: string, tenantId: number): void {
  pendingOAuthFlows.set(state, { provider, verifier, tenantId, createdAt: Date.now() });
  setTimeout(() => pendingOAuthFlows.delete(state), 10 * 60 * 1000);
}

export function getPendingFlow(state: string): { provider: string; verifier: string; tenantId: number } | null {
  const flow = pendingOAuthFlows.get(state);
  if (!flow) return null;
  pendingOAuthFlows.delete(state);
  if (Date.now() - flow.createdAt > 10 * 60 * 1000) return null;
  return flow;
}

export function initiateYouTubeOAuth(tenantId: number, baseUrl: string): { authUrl: string; state: string; verifier: string } | null {
  const clientId = process.env.YOUTUBE_CLIENT_ID;
  if (!clientId) return null;

  const state = generateState();
  const verifier = generateCodeVerifier();
  const challenge = generateCodeChallenge(verifier);

  const redirectUri = `${baseUrl}/api/youtube/callback`;

  const params = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: [
      "https://www.googleapis.com/auth/youtube",
      "https://www.googleapis.com/auth/youtube.upload",
      "https://www.googleapis.com/auth/youtube.readonly",
      "https://www.googleapis.com/auth/youtubepartner",
    ].join(" "),
    code_challenge: challenge,
    code_challenge_method: "S256",
    state,
    access_type: "offline",
    prompt: "consent",
  });

  const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
  storePendingFlow(state, "youtube", verifier, tenantId);
  return { authUrl, state, verifier };
}

export async function exchangeYouTubeCode(
  code: string,
  verifier: string,
  tenantId: number,
  baseUrl: string
): Promise<{ success: boolean; error?: string; channelName?: string }> {
  const clientId = process.env.YOUTUBE_CLIENT_ID;
  const clientSecret = process.env.YOUTUBE_CLIENT_SECRET;
  if (!clientId || !clientSecret) return { success: false, error: "YouTube credentials not configured" };

  try {
    const redirectUri = `${baseUrl}/api/youtube/callback`;
    const resp = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        client_id: clientId,
        client_secret: clientSecret,
        code_verifier: verifier,
        code,
        redirect_uri: redirectUri,
      }).toString(),
    });

    if (!resp.ok) {
      const errText = await resp.text();
      console.error(`[youtube] Token exchange failed: ${resp.status} ${errText}`);
      return { success: false, error: `Token exchange failed: ${resp.status}` };
    }

    const data = await resp.json();
    const encryptedAccess = encryptApiKey(data.access_token);
    const encryptedRefresh = data.refresh_token ? encryptApiKey(data.refresh_token) : null;
    const expiresAt = Date.now() + (data.expires_in || 3600) * 1000;

    await db.execute(sql`
      INSERT INTO oauth_subscriptions (provider, tenant_id, access_token, refresh_token, expires_at, token_type, scope, is_active)
      VALUES ('youtube', ${tenantId}, ${encryptedAccess}, ${encryptedRefresh}, ${expiresAt}, ${data.token_type || "Bearer"}, ${data.scope || ""}, TRUE)
      ON CONFLICT (provider, tenant_id) DO UPDATE SET
        access_token = ${encryptedAccess},
        refresh_token = COALESCE(${encryptedRefresh}, oauth_subscriptions.refresh_token),
        expires_at = ${expiresAt},
        token_type = ${data.token_type || "Bearer"},
        scope = ${data.scope || ""},
        is_active = TRUE,
        last_refreshed = CURRENT_TIMESTAMP
    `);

    let channelName: string | undefined;
    try {
      const channelResp = await fetch("https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true", {
        headers: { Authorization: `Bearer ${data.access_token}` },
      });
      if (channelResp.ok) {
        const channelData = await channelResp.json();
        channelName = channelData.items?.[0]?.snippet?.title;
        if (channelName) {
          await db.execute(sql`
            UPDATE oauth_subscriptions SET email = ${channelName}
            WHERE provider = 'youtube' AND tenant_id = ${tenantId}
          `);
        }
      }
    } catch {}

    console.log(`[youtube] Successfully connected YouTube for tenant ${tenantId}${channelName ? ` (channel: ${channelName})` : ""}`);
    return { success: true, channelName };
  } catch (err: any) {
    console.error(`[youtube] OAuth exchange error:`, err.message);
    return { success: false, error: err.message };
  }
}

export async function seedYouTubeIfMissing(tenantId: number = 1): Promise<void> {
  try {
    const existing = await db.execute(sql`
      SELECT id FROM oauth_subscriptions WHERE provider = 'youtube' AND tenant_id = ${tenantId}
    `);
    const rows = (existing as any).rows || existing;
    if (rows.length > 0) return;

    const refreshTokenPlain = process.env.YOUTUBE_REFRESH_TOKEN;
    const clientId = process.env.YOUTUBE_CLIENT_ID;
    const clientSecret = process.env.YOUTUBE_CLIENT_SECRET;
    if (!refreshTokenPlain || !clientId || !clientSecret) {
      console.log("[youtube] Seed skipped: missing YOUTUBE_REFRESH_TOKEN, YOUTUBE_CLIENT_ID, or YOUTUBE_CLIENT_SECRET");
      return;
    }

    const resp = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: refreshTokenPlain,
      }).toString(),
    });

    if (!resp.ok) {
      console.error(`[youtube] Seed token refresh failed: ${resp.status} ${await resp.text()}`);
      return;
    }

    const data = await resp.json();
    const expiresAt = Date.now() + (data.expires_in || 3600) * 1000;
    const encAccess = encryptApiKey(data.access_token);
    const encRefresh = encryptApiKey(refreshTokenPlain);
    const scope = "https://www.googleapis.com/auth/youtubepartner https://www.googleapis.com/auth/youtube https://www.googleapis.com/auth/youtube.readonly https://www.googleapis.com/auth/youtube.upload";

    await db.execute(sql`
      INSERT INTO oauth_subscriptions (provider, tenant_id, access_token, refresh_token, expires_at, is_active, scope, email, token_type)
      VALUES ('youtube', ${tenantId}, ${encAccess}, ${encRefresh}, ${expiresAt}, true, ${scope}, 'Channel Owner', 'Bearer')
    `);
    console.log(`[youtube] Seeded YouTube OAuth for tenant ${tenantId} (token valid for ${data.expires_in}s)`);
  } catch (err: any) {
    console.error("[youtube] Seed error:", err.message);
  }
}

export async function getYouTubeAccessToken(tenantId: number, forceRefresh?: boolean): Promise<string | null> {
  try {
    let result = await db.execute(sql`
      SELECT access_token, refresh_token, expires_at FROM oauth_subscriptions
      WHERE provider = 'youtube' AND tenant_id = ${tenantId} AND is_active = TRUE
    `);
    let rows = (result as any).rows || result;

    if (!rows || rows.length === 0) {
      await seedYouTubeIfMissing(tenantId);
      result = await db.execute(sql`
        SELECT access_token, refresh_token, expires_at FROM oauth_subscriptions
        WHERE provider = 'youtube' AND tenant_id = ${tenantId} AND is_active = TRUE
      `);
      rows = (result as any).rows || result;
    }
    if (!rows || rows.length === 0) return null;

    const row = rows[0];
    const expiresAt = Number(row.expires_at);

    if (!forceRefresh && Date.now() < expiresAt - 60000) {
      return decryptApiKey(row.access_token);
    }

    if (!row.refresh_token) return null;
    const refreshToken = decryptApiKey(row.refresh_token);
    const clientId = process.env.YOUTUBE_CLIENT_ID;
    const clientSecret = process.env.YOUTUBE_CLIENT_SECRET;
    if (!clientId || !clientSecret) return null;

    const resp = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: refreshToken,
      }).toString(),
    });

    if (!resp.ok) {
      console.error(`[youtube] Token refresh failed: ${resp.status}`);
      return null;
    }

    const data = await resp.json();
    const newExpiresAt = Date.now() + (data.expires_in || 3600) * 1000;
    const encryptedAccess = encryptApiKey(data.access_token);

    await db.execute(sql`
      UPDATE oauth_subscriptions
      SET access_token = ${encryptedAccess}, expires_at = ${newExpiresAt}, last_refreshed = CURRENT_TIMESTAMP
      WHERE provider = 'youtube' AND tenant_id = ${tenantId}
    `);

    console.log(`[youtube] Token refreshed for tenant ${tenantId}`);
    return data.access_token;
  } catch (err: any) {
    console.error(`[youtube] getYouTubeAccessToken error:`, err.message);
    return null;
  }
}

let _autoRefreshInterval: ReturnType<typeof setInterval> | null = null;
const AUTO_REFRESH_INTERVAL_MS = 5 * 60 * 1000;
const REFRESH_BUFFER_MS = 45 * 60 * 1000;

export async function proactiveTokenRefresh(): Promise<{ refreshed: string[]; failed: string[]; skipped: string[] }> {
  const refreshed: string[] = [];
  const failed: string[] = [];
  const skipped: string[] = [];

  try {
    const rows = await db.execute(sql`
      SELECT provider, tenant_id, expires_at, is_active, consecutive_failures
      FROM oauth_subscriptions
      WHERE is_active = TRUE
    `);
    const subs = (rows as any).rows || [];

    for (const sub of subs) {
      const provider = sub.provider as string;
      const tenantId = Number(sub.tenant_id);
      const expiresAt = Number(sub.expires_at);
      const timeLeft = expiresAt - Date.now();
      const label = `${provider}:t${tenantId}`;

      if (timeLeft > REFRESH_BUFFER_MS) {
        skipped.push(label);
        continue;
      }

      console.log(`[auto-refresh] ${label} expires in ${Math.round(timeLeft / 1000)}s — refreshing...`);

      const config = OAUTH_PROVIDERS[provider];
      if (!config) {
        console.warn(`[auto-refresh] No provider config for ${provider}, skipping`);
        skipped.push(label);
        continue;
      }

      const result = await refreshAccessToken(provider, tenantId);
      if (result) {
        refreshed.push(label);
        console.log(`[auto-refresh] ${label} refreshed successfully`);
      } else if (isGoogleProvider(provider)) {
        try {
          const repair = await connectGoogleViaReplit(tenantId);
          if (repair.success) {
            refreshed.push(label);
            console.log(`[auto-refresh] ${label} auto-repaired via Replit connector`);
          } else {
            failed.push(label);
            console.warn(`[auto-refresh] ${label} refresh FAILED (connector repair also failed: ${repair.error})`);
          }
        } catch (repairErr: any) {
          failed.push(label);
          console.warn(`[auto-refresh] ${label} refresh FAILED (connector repair error: ${repairErr.message?.slice(0, 60)})`);
        }
      } else {
        failed.push(label);
        console.warn(`[auto-refresh] ${label} refresh FAILED`);
      }
    }
  } catch (err: any) {
    console.error(`[auto-refresh] Error during proactive refresh:`, err.message);
  }

  return { refreshed, failed, skipped };
}

export function startAutoTokenRefresh() {
  if (_autoRefreshInterval) return;

  setTimeout(() => proactiveTokenRefresh().catch(() => {}), 10000);

  _autoRefreshInterval = setInterval(async () => {
    try {
      const result = await proactiveTokenRefresh();
      if (result.refreshed.length > 0 || result.failed.length > 0) {
        console.log(`[auto-refresh] Cycle complete — refreshed: [${result.refreshed.join(", ")}], failed: [${result.failed.join(", ")}], skipped: ${result.skipped.length}`);
      }
    } catch (err: any) {
      console.warn(`[auto-refresh] Cycle error:`, err.message?.substring(0, 100));
    }
  }, AUTO_REFRESH_INTERVAL_MS);
  console.log(`[auto-refresh] Background token refresh started (checks every ${AUTO_REFRESH_INTERVAL_MS / 60000} min, refreshes tokens with <${REFRESH_BUFFER_MS / 60000} min remaining)`);
}

export function stopAutoTokenRefresh() {
  if (_autoRefreshInterval) {
    clearInterval(_autoRefreshInterval);
    _autoRefreshInterval = null;
    console.log("[auto-refresh] Background token refresh stopped");
  }
}
