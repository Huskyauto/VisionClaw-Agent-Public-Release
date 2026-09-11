import fs from "fs";
import path from "path";
import { db } from "./db";
import { providerKeys } from "@shared/schema";
import { eq } from "drizzle-orm";
import { encryptApiKey, decryptApiKey } from "./crypto";
import { driveErrorMessage as errorMessage, type DriveFileSummary, type DrivePermission } from "./google-drive-types";

import { logSilentCatch } from "./lib/silent-catch";
// R98.27.6 — bounded leaf timeouts so a stuck Drive call can't burn the
// entire chat-engine turn and trip Replit Temporal StartToClose.
import { fetchWithTimeout } from "./lib/fetch-with-timeout";
const VISIONCLAW_FOLDER_ID = process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID || "";
const VISIONCLAW_FOLDER_NAME = process.env.SITE_PLATFORM_NAME ? `${process.env.SITE_PLATFORM_NAME} Agent` : "VisionClaw Agent";
const CUSTOMER_DELIVERIES_FOLDER_NAME = "VisionClaw Customer Deliveries";
const CUSTOMER_DELIVERIES_ROOT_MARKER = "visionclaw_customer_delivery_root";
const DRIVE_API = "https://www.googleapis.com";
const GDRIVE_PROVIDER_KEY = "google_drive_token";

let _cachedToken: string | null = null;
let _tokenExpiry: number = 0;
let _refreshInterval: ReturnType<typeof setInterval> | null = null;
let _healthCheckInterval: ReturnType<typeof setInterval> | null = null;
let _consecutiveFailures: number = 0;
let _lastHealthStatus: "ok" | "fail" | "unknown" = "unknown";
let _lastHealthCheck: number = 0;
let _lastSuccessfulRefreshSource: string = "none";
let _alertSentAt: number = 0;

let TOKEN_REFRESH_INTERVAL_MS = 10 * 60 * 1000;
let HEALTH_CHECK_INTERVAL_MS = 30 * 60 * 1000;
const ALERT_COOLDOWN_MS = 2 * 60 * 60 * 1000;
let _demoMode = false;

function log(msg: string, ...args: unknown[]) {
  const ts = new Date().toISOString().replace("T", " ").substring(0, 19);
  console.log(`[gdrive ${ts}] ${msg}`, ...args);
}

function warn(msg: string, ...args: unknown[]) {
  const ts = new Date().toISOString().replace("T", " ").substring(0, 19);
  console.warn(`[gdrive ${ts}] ⚠ ${msg}`, ...args);
}

export function isDriveConfigured(): boolean {
  return !!VISIONCLAW_FOLDER_ID;
}

export function getDriveHealthStatus(detailed = false) {
  const base = {
    status: _lastHealthStatus,
    hasToken: !!_cachedToken,
    lastCheck: _lastHealthCheck ? new Date(_lastHealthCheck).toISOString() : "never",
  };
  if (!detailed) return base;
  return {
    ...base,
    tokenExpiresIn: _tokenExpiry > 0 ? Math.round((_tokenExpiry - Date.now()) / 1000) : 0,
    consecutiveFailures: _consecutiveFailures,
    lastRefreshSource: _lastSuccessfulRefreshSource,
  };
}

export async function setDriveToken(token: string, expiresInMs?: number) {
  _cachedToken = token;
  _tokenExpiry = Date.now() + (expiresInMs || 3500000);
  try {
    const encrypted = encryptApiKey(token);
    const { sql } = await import("drizzle-orm");
    await db.execute(sql`
      INSERT INTO provider_keys (provider, api_key, enabled)
      VALUES (${GDRIVE_PROVIDER_KEY}, ${encrypted}, true)
      ON CONFLICT (provider) DO UPDATE SET api_key = ${encrypted}, enabled = true
    `);
    log("Token saved to DB (encrypted), expires in", Math.round((_tokenExpiry - Date.now()) / 1000), "s");
  } catch (err: unknown) {
    warn("Failed to save token to DB:", errorMessage(err));
  }
}

async function tryConnectorRefresh(): Promise<string | null> {
  try {
    const hostname = process.env.REPLIT_CONNECTORS_HOSTNAME;
    if (!hostname) return null;

    const replIdentity = process.env.REPL_IDENTITY;
    const webReplRenewal = process.env.WEB_REPL_RENEWAL;
    const xReplitToken = replIdentity
      ? "repl " + replIdentity
      : webReplRenewal
        ? "depl " + webReplRenewal
        : null;

    if (!xReplitToken) return null;

    const isProduction = process.env.REPLIT_DEPLOYMENT === "1";
    const envOrder = isProduction ? ["production", "development"] : ["development", "production"];

    let conn: any = null;
    for (const env of envOrder) {
      const url = new URL(`https://${hostname}/api/v2/connection`);
      url.searchParams.set("include_secrets", "true");
      url.searchParams.set("connector_names", "google-drive");
      url.searchParams.set("environment", env);

      const resp = await fetchWithTimeout(url.toString(), {
        headers: { Accept: "application/json", "X-Replit-Token": xReplitToken },
        timeoutMs: 30_000,
      });

      if (!resp.ok) continue;

      const data = await resp.json();
      if (data?.items?.[0]) {
        conn = data.items[0];
        log("Found connector in", env, "environment");
        break;
      }
    }

    if (!conn) return null;

    const token = conn?.settings?.oauth?.credentials?.access_token;
    const expiryStr = conn?.settings?.oauth?.credentials?.expiry_date;
    const expiryMs = expiryStr ? new Date(expiryStr).getTime() - Date.now() : 3500000;

    if (token && typeof token === "string" && token.length > 20) {
      log("Got fresh token via connector (expires in:", Math.round(expiryMs / 1000), "s)");
      await setDriveToken(token, expiryMs > 0 ? expiryMs : 3500000);
      _lastSuccessfulRefreshSource = "replit-connector";
      return token;
    }

    return null;
  } catch (err: unknown) {
    log("Connector refresh error:", errorMessage(err).substring(0, 120));
    return null;
  }
}

async function tryOAuthSubscriptionRefresh(): Promise<string | null> {
  try {
    const { refreshAccessToken, getSubscriptionAccessToken } = await import("./oauth-subscriptions");
    for (const provider of ["google-workspace", "google"]) {
      const refreshed = await refreshAccessToken(provider, 1);
      if (refreshed) {
        _cachedToken = refreshed;
        _tokenExpiry = Date.now() + 3500000;
        _lastSuccessfulRefreshSource = `oauth-subscription:${provider}`;
        log(`Refreshed via oauth subscription (${provider})`);
        return refreshed;
      }
      const existing = await getSubscriptionAccessToken(provider, 1);
      if (existing) {
        _cachedToken = existing;
        _tokenExpiry = Date.now() + 3500000;
        _lastSuccessfulRefreshSource = `oauth-subscription:${provider}:existing`;
        log(`Loaded existing oauth subscription token (${provider})`);
        return existing;
      }
    }
  } catch (subErr: unknown) {
    log("OAuth subscription refresh failed:", errorMessage(subErr).substring(0, 100));
  }
  return null;
}

async function tryDatabaseToken(): Promise<string | null> {
  try {
    const rows = await db.select().from(providerKeys).where(eq(providerKeys.provider, GDRIVE_PROVIDER_KEY)).limit(1);
    if (rows.length > 0 && rows[0].apiKey && rows[0].enabled) {
      let dbToken = rows[0].apiKey;
      try { dbToken = decryptApiKey(dbToken); } catch (_silentErr) { logSilentCatch("server/google-drive.ts", _silentErr); }
      if (dbToken.length > 20 && !dbToken.startsWith("drizzle_test")) {
        _cachedToken = dbToken;
        _tokenExpiry = Date.now() + 3500000;
        _lastSuccessfulRefreshSource = "database";
        log("Token loaded from database (length:", dbToken.length, ")");
        return dbToken;
      }
    }
  } catch (dbErr: unknown) {
    log("DB token load failed:", errorMessage(dbErr));
  }
  return null;
}

async function tryEnvToken(): Promise<string | null> {
  const envToken = process.env.GOOGLE_DRIVE_TOKEN;
  if (envToken && envToken.length > 20) {
    await setDriveToken(envToken);
    _lastSuccessfulRefreshSource = "env-var";
    log("Token loaded from env var (fallback)");
    return envToken;
  }
  return null;
}

let _cascadeInFlight: Promise<string | null> | null = null;

async function fullRefreshCascade(reason: string): Promise<string | null> {
  if (_cascadeInFlight) {
    log(`Cascade already in-flight, joining existing refresh (reason: ${reason})`);
    return _cascadeInFlight;
  }

  _cascadeInFlight = (async () => {
    log(`Full refresh cascade triggered: ${reason}`);

    const sources: Array<[string, () => Promise<string | null>]> = [
      ["connector", tryConnectorRefresh],
      ["oauth-subscription", tryOAuthSubscriptionRefresh],
      ["database", tryDatabaseToken],
      ["env-var", tryEnvToken],
    ];

    for (const [name, fn] of sources) {
      try {
        const token = await fn();
        if (token) {
          log(`Cascade succeeded via: ${name}`);
          _consecutiveFailures = 0;
          return token;
        }
      } catch (err: unknown) {
        log(`Cascade source ${name} threw: ${errorMessage(err).substring(0, 80)}`);
      }
    }

    _consecutiveFailures++;
    warn(`Full refresh cascade FAILED (consecutive failures: ${_consecutiveFailures})`);
    return null;
  })();

  try {
    return await _cascadeInFlight;
  } finally {
    _cascadeInFlight = null;
  }
}

export async function forceTokenRefresh(): Promise<boolean> {
  _cachedToken = null;
  _tokenExpiry = 0;
  const token = await fullRefreshCascade("force-refresh");
  return !!token;
}

export async function getAccessToken(): Promise<string> {
  if (_cachedToken && Date.now() < _tokenExpiry - 60000) {
    return _cachedToken;
  }

  const reason = !_cachedToken ? "no-cached-token" : "token-expiring-soon";
  const token = await fullRefreshCascade(reason);
  if (token) return token;

  throw new Error("No Google Drive access token available. All sources exhausted (connector, oauth, database, env).");
}

async function verifyTokenWithApi(token: string): Promise<boolean> {
  try {
    const resp = await fetchWithTimeout(`${DRIVE_API}/drive/v3/about?fields=user`, {
      headers: { Authorization: `Bearer ${token}` },
      timeoutMs: 30_000,
    });
    if (resp.status === 200) {
      const data = await resp.json() as any;
      log(`Health check OK — connected as: ${data.user?.displayName || "unknown"} (${data.user?.emailAddress || "unknown"})`);
      return true;
    }
    log(`Health check returned HTTP ${resp.status}`);
    return false;
  } catch (err: unknown) {
    log(`Health check network error: ${errorMessage(err).substring(0, 80)}`);
    return false;
  }
}

async function sendTokenAlert(status: string, details: string) {
  if (Date.now() - _alertSentAt < ALERT_COOLDOWN_MS) {
    log("Alert suppressed (cooldown active, last sent:", new Date(_alertSentAt).toISOString(), ")");
    return;
  }

  try {
    const { sendEmail, getOrCreateTenantInbox } = await import("./email");
    const inbox = await getOrCreateTenantInbox(1);
    const inboxId = inbox?.inboxId || "default";
    const isProduction = process.env.REPLIT_DEPLOYMENT === "1";
    const env = isProduction ? "PRODUCTION" : "DEVELOPMENT";

    await sendEmail({
      inboxId,
      to: process.env.SITE_OWNER_EMAIL || process.env.OWNER_ALERT_EMAIL || "",
      subject: `[${VISIONCLAW_FOLDER_NAME} ${env}] Google Drive Token Alert: ${status}`,
      text: `${VISIONCLAW_FOLDER_NAME} Platform - Google Drive Health Alert\n\nStatus: ${status}\nEnvironment: ${env}\nTime: ${new Date().toISOString()}\nConsecutive Failures: ${_consecutiveFailures}\nLast Successful Source: ${_lastSuccessfulRefreshSource}\n\nDetails:\n${details}\n\nAction Required:\n1. Go to your platform settings page\n2. Check the Google Workspace + Gemini connection\n3. If disconnected, click to reconnect`,
    });

    _alertSentAt = Date.now();
    log("Alert email sent to admin");
  } catch (err: unknown) {
    warn("Failed to send alert email:", errorMessage(err).substring(0, 100));
  }
}

async function runHealthCheck() {
  _lastHealthCheck = Date.now();

  if (!_cachedToken) {
    log("Health check: no cached token, attempting refresh...");
    const token = await fullRefreshCascade("health-check:no-token");
    if (!token) {
      _lastHealthStatus = "fail";
      if (_consecutiveFailures >= 2) {
        await sendTokenAlert("NO TOKEN", "No Google Drive token could be obtained from any source.");
      }
      return;
    }
  }

  const isValid = await verifyTokenWithApi(_cachedToken!);

  if (isValid) {
    _lastHealthStatus = "ok";
    _consecutiveFailures = 0;
    return;
  }

  log("Health check: token invalid, attempting full refresh...");
  _cachedToken = null;
  _tokenExpiry = 0;
  const newToken = await fullRefreshCascade("health-check:token-invalid");

  if (newToken) {
    const recheck = await verifyTokenWithApi(newToken);
    if (recheck) {
      _lastHealthStatus = "ok";
      _consecutiveFailures = 0;
      log("Health check: recovered after refresh");
      return;
    }
  }

  _lastHealthStatus = "fail";
  warn("Health check FAILED — token is invalid and refresh did not recover");

  if (_consecutiveFailures >= 2) {
    await sendTokenAlert(
      "TOKEN INVALID",
      `The Google Drive token has failed ${_consecutiveFailures} consecutive health checks.\nThe token was obtained but Google rejected it.\nThis usually means the OAuth grant was revoked or the connector needs to be reconnected.`
    );
  }
}

async function proactiveRefresh() {
  try {
    const timeUntilExpiry = _tokenExpiry - Date.now();
    if (timeUntilExpiry < 15 * 60 * 1000) {
      log("Proactive refresh — token expires in", Math.round(timeUntilExpiry / 1000), "s");
      const token = await fullRefreshCascade("proactive-refresh");
      if (token) {
        log("Proactive refresh succeeded via:", _lastSuccessfulRefreshSource);
      } else {
        warn("Proactive refresh failed — all sources exhausted");
      }
    }
  } catch (err: unknown) {
    warn("Proactive refresh error:", errorMessage(err).substring(0, 100));
  }
}

export async function driveRequest(endpoint: string, options?: { method?: string; headers?: Record<string, string>; body?: string | Buffer }, _retryCount = 0): Promise<Response> {
  const token = await getAccessToken();
  const url = endpoint.startsWith("http") ? endpoint : `${DRIVE_API}${endpoint}`;

  const resp = await fetchWithTimeout(url, {
    method: options?.method || "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      ...options?.headers,
    },
    body: options?.body,
    timeoutMs: 60_000,
  });

  if (resp.status === 401 && _retryCount < 2) {
    log(`401 on attempt ${_retryCount + 1} — forcing full refresh cascade...`);
    _cachedToken = null;
    _tokenExpiry = 0;
    const newToken = await fullRefreshCascade(`401-retry-${_retryCount + 1}`);
    if (newToken) {
      return driveRequest(endpoint, options, _retryCount + 1);
    }
    throw new Error("Google Drive authentication failed after exhausting all token sources. Please reconnect Google Drive in Settings or the Replit integrations panel.");
  }

  if (resp.status === 401) {
    throw new Error("Google Drive token expired after 2 retry attempts. Reconnect required.");
  }

  return resp;
}

export async function driveJson(endpoint: string, options?: { method?: string; headers?: Record<string, string>; body?: string }): Promise<any> {
  const resp = await driveRequest(endpoint, options);
  return resp.json();
}

async function driveJsonStrict(endpoint: string, options?: { method?: string; headers?: Record<string, string>; body?: string }): Promise<any> {
  const resp = await driveRequest(endpoint, options);
  const payload = await resp.json().catch(() => null);
  if (!resp.ok) {
    const message = payload?.error?.message || payload?.message || `Google Drive request failed with HTTP ${resp.status}`;
    throw new Error(String(message).slice(0, 500));
  }
  return payload;
}

async function listAllDrivePermissions(fileId: string): Promise<DrivePermission[]> {
  const permissions: DrivePermission[] = [];
  let pageToken: string | undefined;
  for (let page = 0; page < 20; page++) {
    const query = new URLSearchParams({
      // permissionDetails records inherited grants on shared drives.  Looking
      // only at the principal/role made a folder inherited from a project
      // appear safe even though a domain/group/organizer could still access it.
      fields: "permissions(id,type,role,deleted,permissionDetails(inherited,inheritedFrom,role,permissionType)),nextPageToken",
      pageSize: "100",
      supportsAllDrives: "true",
    });
    if (pageToken) query.set("pageToken", pageToken);
    const data = await driveJsonStrict(`/drive/v3/files/${encodeURIComponent(fileId)}/permissions?${query.toString()}`);
    if (!Array.isArray(data?.permissions)) throw new Error("Drive did not return a permissions list");
    permissions.push(...data.permissions);
    pageToken = typeof data.nextPageToken === "string" && data.nextPageToken ? data.nextPageToken : undefined;
    if (!pageToken) return permissions;
  }
  throw new Error("Drive permissions list exceeded the safe pagination limit");
}

async function listMarkedCustomerDeliveryRoots(): Promise<DriveFileSummary[]> {
  const roots: DriveFileSummary[] = [];
  const q = `appProperties has { key='${CUSTOMER_DELIVERIES_ROOT_MARKER}' and value='v1' } and 'root' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`;
  let pageToken: string | undefined;
  for (let page = 0; page < 20; page++) {
    const query = new URLSearchParams({
      q,
      fields: "files(id,name,ownedByMe),nextPageToken",
      pageSize: "100",
    });
    if (pageToken) query.set("pageToken", pageToken);
    const data = await driveJsonStrict(`/drive/v3/files?${query.toString()}`);
    if (!Array.isArray(data?.files)) throw new Error("Drive did not return a customer delivery root list");
    roots.push(...data.files);
    pageToken = typeof data.nextPageToken === "string" && data.nextPageToken ? data.nextPageToken : undefined;
    if (!pageToken) return roots;
  }
  throw new Error("Customer delivery root list exceeded the safe pagination limit");
}

export function getVisionClawFolderId(): string {
  return VISIONCLAW_FOLDER_ID;
}

export async function makeFileShareable(fileId: string, options: { relocateToPrivateRoot?: boolean } = {}): Promise<{ success: boolean; webViewLink?: string; directDownloadLink?: string; folderId?: string; error?: string }> {
  try {
    let fileMetadata = await driveJsonStrict(`/drive/v3/files/${encodeURIComponent(fileId)}?fields=id,parents&supportsAllDrives=true`);
    let parents = Array.isArray(fileMetadata?.parents)
      ? fileMetadata.parents.filter((parent: unknown): parent is string => typeof parent === "string" && parent.length > 0)
      : [];
    let unsuitableParent: { id: string; reason: string } | undefined;
    let relocatedFolderId: string | undefined;
    if (options.relocateToPrivateRoot) {
      for (const parentId of parents) {
        const parentAccess = await verifyCustomerDeliveryParentPermissions(parentId);
        if (!parentAccess.suitable) {
          unsuitableParent = { id: parentId, reason: parentAccess.reason };
          break;
        }
      }
      // A file with no observable parent is not safe to publish: we cannot
      // prove where inherited access comes from. Relocation is the only safe
      // repair; never grant a link first and hope the parent is private.
      if (parents.length === 0) unsuitableParent = { id: "", reason: "missing-file-parent" };
      if (unsuitableParent) {
        const folderId = await relocateDriveFileToPrivateDeliveryRoot(fileId);
        relocatedFolderId = folderId;
        fileMetadata = await driveJsonStrict(`/drive/v3/files/${encodeURIComponent(fileId)}?fields=id,parents&supportsAllDrives=true`);
        parents = Array.isArray(fileMetadata?.parents)
          ? fileMetadata.parents.filter((parent: unknown): parent is string => typeof parent === "string" && parent.length > 0)
          : [];
        if (parents.length !== 1 || parents[0] !== folderId) {
          throw new Error(`Drive file relocation could not prove its private parent (${unsuitableParent.reason})`);
        }
        const parentAccess = await verifyCustomerDeliveryParentPermissions(folderId);
        if (!parentAccess.suitable) {
          throw new Error(`Drive file relocation left unsuitable parent permissions (${parentAccess.reason})`);
        }
      }
    }
    const permissions = await listAllDrivePermissions(fileId);
    if (options.relocateToPrivateRoot) {
      const unexpectedEffectiveAccess = permissions.some((permission) =>
        !permission?.deleted
        && permission?.type !== "anyone"
        && !(permission?.type === "user" && permission?.role === "owner"),
      );
      if (unexpectedEffectiveAccess) {
        throw new Error("Customer delivery file retains non-owner effective access after parent preflight");
      }
    }
    const activeAnyone = permissions.filter((permission) => permission?.type === "anyone" && !permission?.deleted);
    const broaderAnyone = activeAnyone.filter((permission) => permission?.role !== "reader");
    if (broaderAnyone.length > 0 && options.relocateToPrivateRoot && !unsuitableParent) {
      relocatedFolderId = await relocateDriveFileToPrivateDeliveryRoot(fileId);
    }
    const effectivePermissions = relocatedFolderId ? await listAllDrivePermissions(fileId) : activeAnyone;
    const effectiveBroaderAnyone = effectivePermissions.filter((permission) => permission?.type === "anyone" && !permission?.deleted && permission?.role !== "reader");
    for (const permission of effectiveBroaderAnyone) {
      if (!permission.id) throw new Error("Drive returned a broader public permission without an ID");
      // Drive keeps one permission per public principal; POSTing a second
      // anyone:reader grant does not narrow an existing writer/commenter
      // grant. Downgrade the existing grant, then prove the final state.
      await driveJsonStrict(`/drive/v3/files/${encodeURIComponent(fileId)}/permissions/${encodeURIComponent(permission.id)}?supportsAllDrives=true`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role: "reader" }),
      });
    }
    if (!effectivePermissions.some((permission) => permission?.type === "anyone" && !permission?.deleted && permission?.role === "reader")) {
      const permResult = await driveJsonStrict(`/drive/v3/files/${fileId}/permissions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role: "reader", type: "anyone" }),
      });
      if (permResult?.error) {
        throw new Error(permResult.error.message || JSON.stringify(permResult.error));
      }
      if (!permResult?.id) {
        throw new Error("Drive did not return a permission ID");
      }
    }
    const access = await verifyDriveFilePublicAccess(fileId);
    if (!access.verified) {
      throw new Error(`reader permission was not effective (${access.reason})`);
    }
    if (options.relocateToPrivateRoot) {
      const finalPermissions = await listAllDrivePermissions(fileId);
      const exactCustomerAccess = finalPermissions.every((permission) =>
        permission?.deleted
        || (permission?.type === "user" && permission?.role === "owner")
        || (permission?.type === "anyone" && permission?.role === "reader"),
      );
      if (!exactCustomerAccess) {
        throw new Error("Customer delivery file did not retain exact owner-only plus anyone-reader access");
      }
    }
    log("Permission set for", fileId);

    const webViewLink = `https://drive.google.com/file/d/${fileId}/view?usp=sharing`;
    const directDownloadLink = `https://drive.google.com/uc?export=download&id=${fileId}`;

    return { success: true, webViewLink, directDownloadLink, folderId: relocatedFolderId };
  } catch (err: unknown) {
    warn("makeFileShareable error:", errorMessage(err));
    return { success: false, error: errorMessage(err) };
  }
}

type RecoveredDriveFile = {
  fileId: string;
  viewUrl?: string;
  downloadUrl?: string;
  folderId?: string;
};

/**
 * A provider receipt proves an upload occurred, not that its customer-facing
 * permission step completed. Recovery must repair and prove file sharing
 * before returning the recovered identity to a caller that intends to share.
 */
export async function ensureRecoveredDriveFileSharing(
  recovered: RecoveredDriveFile,
  share: boolean | undefined,
  dependencies: {
    verifyPublicAccess?: (fileId: string) => Promise<{ verified: boolean; reason: string }>;
    makeShareable?: (fileId: string) => Promise<{ success: boolean; webViewLink?: string; directDownloadLink?: string; folderId?: string; error?: string }>;
    forcePermissionRepair?: boolean;
  } = {},
): Promise<{ success: true; file: RecoveredDriveFile } | { success: false; error: string }> {
  if (share === false) return { success: true, file: recovered };
  const verifyPublicAccess = dependencies.verifyPublicAccess || verifyDriveFilePublicAccess;
  const access = await verifyPublicAccess(recovered.fileId);
  if (access.verified && !dependencies.forcePermissionRepair) return { success: true, file: recovered };
  const makeShareable = dependencies.makeShareable || makeFileShareable;
  const shareResult = await makeShareable(recovered.fileId);
  if (!shareResult.success) {
    return {
      success: false,
      error: `Drive recovery found a file but sharing could not be verified: ${shareResult.error || "unknown error"}`,
    };
  }
  return {
    success: true,
    file: {
      ...recovered,
      ...(shareResult.folderId || recovered.folderId ? { folderId: shareResult.folderId || recovered.folderId } : {}),
      viewUrl: shareResult.webViewLink || recovered.viewUrl,
      downloadUrl: shareResult.directDownloadLink || recovered.downloadUrl,
    },
  };
}

// Verify a Drive/Docs/Slides/Sheets file ID actually resolves to a live, non-trashed
// file owned by / shared with this account. Used to gate deliverable links before they
// are surfaced to a user — a hallucinated URL (e.g. .../document/d/1-AI_Summary_Agent)
// otherwise reaches the user as a "Document lookup failed / was deleted" dead link.
// Failure mode is asymmetric ON PURPOSE: a definitive 4xx (not-found / no-access /
// bad-id) ⇒ exists:false (drop the link); a transient 5xx / network error / timeout
// ⇒ exists:true (fail-open, never drop a possibly-real deliverable on a Drive blip).
export async function verifyDriveFileExists(fileId: string): Promise<{ exists: boolean; reason: string }> {
  if (!fileId || !/^[a-zA-Z0-9_-]{10,}$/.test(fileId)) {
    return { exists: false, reason: "malformed-id" };
  }
  try {
    const resp = await driveRequest(`/drive/v3/files/${encodeURIComponent(fileId)}?fields=id,trashed&supportsAllDrives=true`);
    if (resp.status === 200) {
      const data = await resp.json().catch(() => null);
      if (data && data.id && !data.trashed) return { exists: true, reason: "ok" };
      if (data && data.trashed) return { exists: false, reason: "trashed" };
      return { exists: false, reason: "no-id-in-body" };
    }
    if (resp.status === 400 || resp.status === 403 || resp.status === 404) {
      return { exists: false, reason: `http-${resp.status}` };
    }
    // A link that cannot be proven must never become a mandatory deliverable.
    return { exists: false, reason: `transient-${resp.status}` };
  } catch (err: unknown) {
    return { exists: false, reason: `error-${errorMessage(err).slice(0, 60)}` };
  }
}

/** Extract a durable Drive identity from either a stored URL or a raw file ID. */
export function extractDriveFileId(value: unknown): string | null {
  const candidate = typeof value === "string" ? value.trim() : "";
  if (/^[A-Za-z0-9_-]{10,}$/.test(candidate)) return candidate;
  const match = candidate.match(/\/(?:file\/)?d\/([A-Za-z0-9_-]{10,})(?:[/?]|$)|[?&]id=([A-Za-z0-9_-]{10,})(?:[&#]|$)/);
  return match ? (match[1] || match[2]) : null;
}

/**
 * Proves that a Drive file exists, is not trashed, and has the exact
 * anyone-with-the-link reader permission required for customer delivery.
 * This uses the authenticated Drive API rather than probing a redirecting
 * Google download URL from the server, which is not a reliable access check.
 */
export async function verifyDriveFilePublicAccess(fileId: string): Promise<{ verified: boolean; reason: string }> {
  if (!fileId || !/^[a-zA-Z0-9_-]{10,}$/.test(fileId)) {
    return { verified: false, reason: "malformed-id" };
  }
  try {
    const data = await driveJsonStrict(`/drive/v3/files/${encodeURIComponent(fileId)}?fields=id,trashed&supportsAllDrives=true`);
    if (!data?.id) return { verified: false, reason: "no-id-in-body" };
    if (data.trashed) return { verified: false, reason: "trashed" };
    return evaluatePublicDrivePermissions(await listAllDrivePermissions(fileId));
  } catch (err: unknown) {
    return { verified: false, reason: `api-error-${errorMessage(err).slice(0, 80)}` };
  }
}

export function evaluatePublicDrivePermissions(permissions: unknown): { verified: boolean; reason: string } {
  const activeAnyonePermissions = Array.isArray(permissions)
    ? (permissions as DrivePermission[]).filter((permission) => permission?.type === "anyone" && !permission?.deleted)
    : [];
  if (activeAnyonePermissions.some((permission) => permission?.role !== "reader")) {
    return { verified: false, reason: "broader-anyone-permission" };
  }
  return activeAnyonePermissions.some((permission) => permission?.role === "reader")
    ? { verified: true, reason: "anyone-reader" }
    : { verified: false, reason: "missing-anyone-reader" };
}

export function isPrivateCustomerDeliveryRootPermissions(permissions: unknown): boolean {
  return Array.isArray(permissions)
    && permissions.length > 0
    && permissions.every((permission: any) =>
      !permission?.deleted && permission?.type === "user" && permission?.role === "owner",
    );
}

/**
 * Customer-delivery staging parents must be private before the individual
 * anyone:reader grant is added to a child.  A reader grant on a file cannot
 * reduce inherited domain, group, organizer, commenter, or writer access.
 * Keep this deliberately stricter than final public-link verification: the
 * only permitted pre-share access is an active owner user.
 */
export function isSuitableCustomerDeliveryParentPermissions(permissions: unknown): { suitable: boolean; reason: string } {
  const active = Array.isArray(permissions)
    ? permissions.filter((permission: any) => !permission?.deleted)
    : [];
  if (active.length === 0) {
    return { suitable: false, reason: "missing-parent-permissions" };
  }
  return active.every((permission: any) =>
    permission?.type === "user" && permission?.role === "owner",
  )
    ? { suitable: true, reason: "owner-only" }
    : { suitable: false, reason: "non-owner-parent-permission" };
}

async function verifyCustomerDeliveryParentPermissions(folderId: string): Promise<{ suitable: boolean; reason: string }> {
  if (!folderId || !/^[a-zA-Z0-9_-]{10,}$/.test(folderId)) {
    return { suitable: false, reason: "malformed-parent-id" };
  }
  try {
    return isSuitableCustomerDeliveryParentPermissions(await listAllDrivePermissions(folderId));
  } catch (error: any) {
    return { suitable: false, reason: `parent-permissions-unverifiable-${String(error?.message || error).slice(0, 80)}` };
  }
}

function sanitizeDriveFolderName(name: string): string {
  const cleaned = String(name ?? "")
    .replace(/[\x00-\x1f\x7f]/g, " ")
    .replace(/[\\/]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
  const safe = cleaned.length > 0 ? cleaned : "Untitled";
  return safe.length > 200 ? safe.slice(0, 197) + "..." : safe;
}

async function findOrCreateFolder(parentFolderId: string, folderName: string): Promise<{ id: string; webViewLink: string }> {
  const safeName = sanitizeDriveFolderName(folderName);
  const q = `name='${safeName.replace(/'/g, "\\'")}' and '${parentFolderId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`;
  const searchResult = await driveJson(`/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id,name,webViewLink)&pageSize=1`);
  if (searchResult.files && searchResult.files.length > 0) {
    return { id: searchResult.files[0].id, webViewLink: searchResult.files[0].webViewLink || `https://drive.google.com/drive/folders/${searchResult.files[0].id}` };
  }
  return createSubfolder(parentFolderId, safeName);
}

async function ensurePrivateCustomerDeliveryRoot(): Promise<string> {
  for (const folder of await listMarkedCustomerDeliveryRoots()) {
    if (!folder?.id || folder.ownedByMe !== true) continue;
    if (isPrivateCustomerDeliveryRootPermissions(await listAllDrivePermissions(folder.id))) return folder.id;
  }

  const created = await driveJsonStrict("/drive/v3/files?fields=id,name", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: CUSTOMER_DELIVERIES_FOLDER_NAME,
      mimeType: "application/vnd.google-apps.folder",
      appProperties: { [CUSTOMER_DELIVERIES_ROOT_MARKER]: "v1" },
    }),
  });
  if (created?.error) throw new Error(created.error.message || JSON.stringify(created.error));
  if (!created?.id) throw new Error("Drive did not return a private customer-delivery folder ID");
  if (!isPrivateCustomerDeliveryRootPermissions(await listAllDrivePermissions(created.id))) {
    throw new Error("Drive created a customer delivery root with unexpected permissions");
  }
  log(`Created private customer delivery root: ${created.id}`);
  return created.id;
}

async function relocateDriveFileToPrivateDeliveryRoot(fileId: string): Promise<string> {
  const metadata = await driveJsonStrict(`/drive/v3/files/${encodeURIComponent(fileId)}?fields=id,parents&supportsAllDrives=true`);
  const parents = Array.isArray(metadata?.parents) ? metadata.parents.filter((parent: unknown): parent is string => typeof parent === "string" && parent.length > 0) : [];
  const privateRootId = await ensurePrivateCustomerDeliveryRoot();
  const privateRootAccess = await verifyCustomerDeliveryParentPermissions(privateRootId);
  if (!privateRootAccess.suitable) {
    throw new Error(`Private customer-delivery root permissions are unsuitable (${privateRootAccess.reason})`);
  }
  if (parents.includes(privateRootId)) return privateRootId;
  const query = new URLSearchParams({
    addParents: privateRootId,
    removeParents: parents.join(","),
    supportsAllDrives: "true",
    fields: "id,parents",
  });
  const moved = await driveJsonStrict(`/drive/v3/files/${encodeURIComponent(fileId)}?${query.toString()}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });
  if (moved?.id !== fileId || !Array.isArray(moved.parents) || !moved.parents.includes(privateRootId)) {
    throw new Error("Drive file could not be moved to the private customer-delivery root");
  }
  const finalParentAccess = await verifyCustomerDeliveryParentPermissions(privateRootId);
  if (!finalParentAccess.suitable) {
    throw new Error(`Relocated file parent permissions are unsuitable (${finalParentAccess.reason})`);
  }
  log(`Relocated customer delivery file ${fileId} to private root ${privateRootId}`);
  return privateRootId;
}

async function findOrCreateNestedFolder(rootFolderId: string, pathParts: string[]): Promise<{ id: string; webViewLink: string }> {
  let currentParent = rootFolderId;
  let result = { id: rootFolderId, webViewLink: "" };
  for (const part of pathParts) {
    result = await findOrCreateFolder(currentParent, part);
    currentParent = result.id;
  }
  return result;
}

async function createSubfolder(parentFolderId: string, folderName: string): Promise<{ id: string; webViewLink: string }> {
  const safeName = sanitizeDriveFolderName(folderName);
  const createResult = await driveJson("/drive/v3/files?fields=id,name,webViewLink", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: safeName,
      mimeType: "application/vnd.google-apps.folder",
      parents: [parentFolderId],
    }),
  });

  if (!createResult.id) {
    throw new Error("Failed to create subfolder: " + JSON.stringify(createResult));
  }

  // R64.C — DELIVERY HARDENING: subfolders are no longer auto-granted
  // public-link access. A public folder URL lets anyone enumerate every
  // file inside, which is a cross-tenant exposure surface. Files that
  // need to be shared get individual file-level permission grants via
  // makeFileShareable() (called by uploadAndShare when share=true).
  // The folder itself stays private to the workspace.
  const webViewLink = `https://drive.google.com/drive/folders/${createResult.id}`;
  log(`Created subfolder (private): ${folderName} (${createResult.id})`);

  return { id: createResult.id, webViewLink };
}

export async function ensureTenantFolder(tenantId: number, tenantName: string): Promise<{ id: string; url: string }> {
  if (!isDriveConfigured()) {
    throw new Error("Google Drive is not configured. Set GOOGLE_DRIVE_ROOT_FOLDER_ID environment variable to enable Drive features.");
  }

  const { db } = await import("./db");
  const { tenants } = await import("@shared/schema");
  const { eq } = await import("drizzle-orm");

  const [tenant] = await db.select({ driveFolderId: tenants.driveFolderId }).from(tenants).where(eq(tenants.id, tenantId)).limit(1);
  if (tenant?.driveFolderId) {
    return { id: tenant.driveFolderId, url: `https://drive.google.com/drive/folders/${tenant.driveFolderId}` };
  }

  const rootId = getVisionClawFolderId();
  const folderName = `User - ${tenantName}`;
  const folder = await createSubfolder(rootId, folderName);
  await db.update(tenants).set({ driveFolderId: folder.id }).where(eq(tenants.id, tenantId));
  log(`Created tenant Drive folder: ${folderName} (${folder.id}) for tenant ${tenantId}`);
  return { id: folder.id, url: folder.webViewLink };
}

export async function ensureProjectFolder(projectId: number, projectName: string, tenantId: number, tenantName: string): Promise<{ id: string; url: string }> {
  const { db } = await import("./db");
  const { projects } = await import("@shared/schema");
  const { eq } = await import("drizzle-orm");

  // R98 hardening: enforce tenant ownership. Without this check a caller
  // could pass any projectId and mint/return another tenant's Drive folder.
  const [project] = await db.select({ tenantId: projects.tenantId, driveFolderId: projects.driveFolderId, driveFolderUrl: projects.driveFolderUrl }).from(projects).where(eq(projects.id, projectId)).limit(1);
  if (!project) {
    throw new Error(`ensureProjectFolder: project ${projectId} not found`);
  }
  if (project.tenantId !== tenantId) {
    throw new Error(`ensureProjectFolder: tenant mismatch — project ${projectId} belongs to tenant ${project.tenantId}, caller is tenant ${tenantId}`);
  }
  if (project.driveFolderId) {
    return { id: project.driveFolderId, url: project.driveFolderUrl || `https://drive.google.com/drive/folders/${project.driveFolderId}` };
  }

  const tenantFolder = await ensureTenantFolder(tenantId, tenantName);
  const folder = await createSubfolder(tenantFolder.id, projectName);
  await db.update(projects).set({ driveFolderId: folder.id, driveFolderUrl: folder.webViewLink }).where(eq(projects.id, projectId));
  log(`Created project Drive folder: ${projectName} (${folder.id}) under tenant ${tenantId}`);
  return { id: folder.id, url: folder.webViewLink };
}

export function buildDriveMultipartUploadBody(params: {
  boundary: string;
  metadata: Record<string, unknown>;
  mimeType: string;
  fileBuffer: Buffer;
}): Buffer {
  if (!params.boundary || /[\r\n]/.test(params.boundary)) {
    throw new Error("Drive multipart boundary is invalid");
  }
  if (!Buffer.isBuffer(params.fileBuffer) || params.fileBuffer.length === 0) {
    throw new Error("Drive multipart media bytes are invalid");
  }
  if (typeof params.mimeType !== "string" || /[\r\n]/.test(params.mimeType)) {
    throw new Error("Drive multipart MIME type is invalid");
  }
  const mimeType = params.mimeType.trim();
  const token = "[!#$%&'*+.^_`|~0-9A-Za-z-]+";
  const mimeTypePattern = new RegExp(`^${token}\\/${token}(?:[ \\t]*;[ \\t]*${token}[ \\t]*=[ \\t]*(?:${token}|\"[^\"\\r\\n]*\"))*$`);
  if (!mimeTypePattern.test(mimeType)) {
    throw new Error("Drive multipart MIME type is invalid");
  }

  const delimiter = `--${params.boundary}`;
  return Buffer.concat([
    Buffer.from(`${delimiter}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(params.metadata)}\r\n`, "utf8"),
    Buffer.from(`${delimiter}\r\nContent-Type: ${mimeType}\r\n\r\n`, "utf8"),
    params.fileBuffer,
    Buffer.from(`\r\n${delimiter}--\r\n`, "utf8"),
  ]);
}

export async function uploadToDrive(params: {
  filePath?: string;
  fileData?: Buffer;
  fileName: string;
  mimeType: string;
  description?: string;
  share?: boolean;
  customerName?: string;
  folderLabel?: string;
  parentFolderId?: string;
  // When true, place the file directly in parentFolderId (no auto-created
  // dated subfolder). Used for bundle deliveries where multiple files
  // need to land in the same per-customer folder created by the first
  // upload of the batch.
  skipSubfolder?: boolean;
  /** Customer reports must never inherit the configured workspace root's sharing policy. */
  customerDelivery?: boolean;
  /** Server-issued artifact identity used to recover a provider-success/local-crash gap. */
  durableArtifactKey?: string;
  _retryCount?: number;
}): Promise<{ success: boolean; fileId?: string; webViewLink?: string; webContentLink?: string; shareableLink?: string; directDownloadLink?: string; customerFolderId?: string; customerFolderLink?: string; completionUncertain?: boolean; error?: string }> {
  try {
    if (params.durableArtifactKey) {
      const recovered = await findDriveFileByDurableArtifactKey(params.durableArtifactKey);
      if (recovered) {
        const sharing = await ensureRecoveredDriveFileSharing(recovered, params.share, {
          forcePermissionRepair: params.customerDelivery,
          makeShareable: params.customerDelivery
            ? (fileId) => makeFileShareable(fileId, { relocateToPrivateRoot: true })
            : undefined,
        });
        if (!sharing.success) {
          return {
            success: false,
            completionUncertain: true,
            fileId: recovered.fileId,
            error: sharing.error,
          };
        }
        const recoveredFile = sharing.file;
        return {
          success: true,
          fileId: recoveredFile.fileId,
          webViewLink: recoveredFile.viewUrl,
          webContentLink: recoveredFile.downloadUrl,
          shareableLink: recoveredFile.viewUrl,
          directDownloadLink: recoveredFile.downloadUrl,
          customerFolderId: recoveredFile.folderId,
          customerFolderLink: recoveredFile.folderId ? `https://drive.google.com/drive/folders/${recoveredFile.folderId}` : undefined,
        };
      }
    }
    let rootFolderId = params.parentFolderId
      || (params.customerDelivery ? await ensurePrivateCustomerDeliveryRoot() : getVisionClawFolderId());
    let useRequestedParent = Boolean(params.parentFolderId);
    if (params.customerDelivery) {
      const parentAccess = await verifyCustomerDeliveryParentPermissions(rootFolderId);
      if (!parentAccess.suitable) {
        // Do this before dispatching multipart bytes.  The existing marked
        // direct-My-Drive root is the safe fallback when a project/customer
        // folder inherited domain/group/organizer access.
        rootFolderId = await ensurePrivateCustomerDeliveryRoot();
        const privateAccess = await verifyCustomerDeliveryParentPermissions(rootFolderId);
        if (!privateAccess.suitable) {
          return { success: false, error: `Customer delivery parent permissions are unsuitable (${privateAccess.reason})` };
        }
        useRequestedParent = false;
      }
    }

    let fileBuffer: Buffer;
    if (params.fileData) {
      fileBuffer = params.fileData;
    } else if (params.filePath) {
      // Normalize web-style absolute paths like "/uploads/foo.pdf" (returned by
      // generateStyledPdf and other helpers) into project-relative paths so the
      // path-traversal check doesn't reject them as filesystem-absolute.
      const cwd = process.cwd();
      let candidate = params.filePath;
      if (candidate.startsWith("/uploads/") || candidate.startsWith("/attached_assets/") || candidate.startsWith("/stress-test-output/")) {
        candidate = candidate.slice(1);
      }
      const resolved = path.resolve(cwd, candidate);
      if (!resolved.startsWith(cwd + path.sep) && resolved !== cwd) {
        return { success: false, error: `Path traversal blocked: ${params.filePath}` };
      }
      if (!fs.existsSync(resolved)) {
        return { success: false, error: `File not found: ${params.filePath}` };
      }
      fileBuffer = fs.readFileSync(resolved);
    } else {
      return { success: false, error: "Either filePath or fileData is required" };
    }

    let subfolder: { id: string; webViewLink: string };

    if (params.skipSubfolder && useRequestedParent) {
      // Bundle mode: drop the file directly into the supplied parent folder
      // (which is already a per-customer dated subfolder created by an
      // earlier upload in the same batch).
      const requestedParentId = params.parentFolderId;
      if (!requestedParentId) {
        return { success: false, error: "parentFolderId is required when skipSubfolder is enabled" };
      }
      subfolder = { id: requestedParentId, webViewLink: `https://drive.google.com/drive/folders/${requestedParentId}` };
    } else {
      const label = params.folderLabel || params.customerName || params.fileName.replace(/\.[^.]+$/, "");
      if (label.includes("/")) {
        const pathParts = label.split("/").filter(Boolean);
        subfolder = await findOrCreateNestedFolder(rootFolderId, pathParts);
      } else {
        const now = new Date();
        const dateStr = now.toISOString().split("T")[0];
        const timeStr = now.toTimeString().split(" ")[0].replace(/:/g, "-");
        const subfolderName = `${dateStr}_${timeStr}_${label}`;
        subfolder = await createSubfolder(rootFolderId, subfolderName);
      }
    }
    if (params.customerDelivery) {
      const uploadParentAccess = await verifyCustomerDeliveryParentPermissions(subfolder.id);
      if (!uploadParentAccess.suitable) {
        // A raced folder-policy change (or a pre-existing subfolder with
        // inherited access) must not receive customer bytes.  Re-stage under
        // the known owner-only root; no upload has been dispatched yet.
        const privateRootId = await ensurePrivateCustomerDeliveryRoot();
        const privateAccess = await verifyCustomerDeliveryParentPermissions(privateRootId);
        if (!privateAccess.suitable) {
          return { success: false, error: `Customer delivery fallback root permissions are unsuitable (${privateAccess.reason})` };
        }
        subfolder = { id: privateRootId, webViewLink: `https://drive.google.com/drive/folders/${privateRootId}` };
      }
    }

    const metadata = {
      name: params.fileName,
      parents: [subfolder.id],
      description: params.description || `Uploaded by ${VISIONCLAW_FOLDER_NAME} on ${new Date().toISOString().split("T")[0]}`,
      ...(params.durableArtifactKey ? { appProperties: { visionclawArtifactKey: params.durableArtifactKey } } : {}),
    };

    const boundary = "visionclaw_boundary_" + Date.now();
    const body = buildDriveMultipartUploadBody({
      boundary,
      metadata,
      mimeType: params.mimeType,
      fileBuffer,
    });

    const token = await getAccessToken();
    let response: Response;
    try {
      response = await fetchWithTimeout(`${DRIVE_API}/upload/drive/v3/files?uploadType=multipart&fields=id,name,webViewLink,webContentLink`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": `multipart/related; boundary=${boundary}`,
        },
        body,
        timeoutMs: 120_000,
      });
    } catch (error: any) {
      return {
        success: false,
        completionUncertain: true,
        error: `Drive upload outcome is uncertain after request dispatch: ${String(error?.message || error).slice(0, 500)}`,
      };
    }

    const retryUnauthorizedUpload = async (): Promise<{
      success: boolean;
      fileId?: string;
      webViewLink?: string;
      webContentLink?: string;
      shareableLink?: string;
      directDownloadLink?: string;
      customerFolderId?: string;
      customerFolderLink?: string;
      completionUncertain?: boolean;
      error?: string;
    }> => {
      if (!params._retryCount) {
        _cachedToken = null;
        _tokenExpiry = 0;
        log("Upload got 401 — attempting recovery (retry 1 of 1)...");
        const recovered = await fullRefreshCascade("upload-401");
        if (recovered) return uploadToDrive({ ...params, _retryCount: 1 });
        return { success: false, error: "Google Drive token expired during upload. All recovery attempts failed." };
      }
      return { success: false, error: "Google Drive token expired during upload. Retry also failed — check token sources." };
    };
    // A received HTTP 401 proves Drive rejected the request before creating a
    // file, even when a proxy sends an empty or non-JSON error body.
    if (response.status === 401) return retryUnauthorizedUpload();

    let result: any;
    try {
      result = await response.json();
    } catch {
      return {
        success: false,
        completionUncertain: true,
        error: "Drive upload response could not be read; outcome is uncertain",
      };
    }
    if (!response.ok) {
      return {
        success: false,
        completionUncertain: true,
        error: result?.error?.message || result?.message || `Drive upload returned HTTP ${response.status}; outcome is uncertain`,
      };
    }

    if (result?.error) {
      return {
        success: false,
        completionUncertain: true,
        error: result.error.message || "Drive upload returned an error payload; outcome is uncertain",
      };
    }
    if (!result?.id || typeof result.id !== "string") {
      return {
        success: false,
        completionUncertain: true,
        error: "Drive upload response did not include a valid file ID; outcome is uncertain",
      };
    }

    let shareableLink: string | undefined;
    let directDownloadLink: string | undefined;

    if (result.id && params.share !== false) {
      // A normal project/write_file upload can also land beneath a folder
      // whose inherited access is broader than the exact anyone-reader grant
      // required for a durable customer link. In that case Drive rejects the
      // attempted downgrade ("Cannot modify a permission ... less than the
      // inherited access"). Always allow the sharing helper to inspect the
      // parent and relocate only when necessary; suitable parents stay put.
      const shareResult = await makeFileShareable(result.id, { relocateToPrivateRoot: true });
      if (!shareResult.success) {
        warn("Share permission failed (file still uploaded):", shareResult.error);
        return {
          success: false,
          completionUncertain: true,
          fileId: result.id,
          // The file ID is preserved for reconciliation, but links are never
          // surfaced until exact public-reader access has been proved.
          customerFolderId: subfolder.id,
          error: `Drive upload completed but sharing could not be verified: ${shareResult.error || "unknown error"}`,
        };
      }
      shareableLink = shareResult.webViewLink;
      directDownloadLink = shareResult.directDownloadLink;
      if (shareResult.folderId) {
        subfolder = {
          id: shareResult.folderId,
          webViewLink: `https://drive.google.com/drive/folders/${shareResult.folderId}`,
        };
      }
    }

    log("Upload complete. File:", result.id, "Folder:", subfolder.id);

    return {
      success: true,
      fileId: result.id,
      webViewLink: shareableLink || result.webViewLink,
      webContentLink: directDownloadLink || result.webContentLink,
      shareableLink: shareableLink || result.webViewLink,
      directDownloadLink: directDownloadLink || result.webContentLink,
      customerFolderId: subfolder.id,
      customerFolderLink: subfolder.webViewLink,
    };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

async function findDriveFileByDurableArtifactKey(key: string): Promise<{ fileId: string; viewUrl?: string; downloadUrl?: string; folderId?: string } | null> {
  // Bare artifact row IDs are recycled/collide across historical runs. Every
  // new key binds its namespace and artifact content before Drive can reuse it.
  if (!/^(?:delivery|artifact):[A-Za-z0-9:_-]{8,180}$/.test(key)) {
    throw new Error("Invalid durable artifact recovery key");
  }
  const token = await getAccessToken();
  const query = `appProperties has { key='visionclawArtifactKey' and value='${key}' } and trashed = false`;
  const url = `${DRIVE_API}/drive/v3/files?${new URLSearchParams({
    q: query,
    pageSize: "2",
    fields: "files(id,webViewLink,webContentLink,parents)",
  }).toString()}`;
  const response = await fetchWithTimeout(url, {
    headers: { Authorization: `Bearer ${token}` },
    timeoutMs: 30_000,
  });
  const payload = await response.json().catch(() => null) as any;
  if (!response.ok) throw new Error(payload?.error?.message || `Drive artifact recovery search failed with HTTP ${response.status}`);
  if (!Array.isArray(payload?.files) || payload.files.length === 0) return null;
  if (payload.files.length !== 1 || !payload.files[0]?.id) throw new Error("Drive artifact recovery found an ambiguous receipt");
  const file = payload.files[0];
  return {
    fileId: file.id,
    viewUrl: file.webViewLink || `https://drive.google.com/file/d/${file.id}/view`,
    downloadUrl: file.webContentLink || `https://drive.google.com/uc?export=download&id=${file.id}`,
    folderId: Array.isArray(file.parents) ? file.parents[0] : undefined,
  };
}

export async function listDriveFiles(params?: {
  query?: string;
  pageSize?: number;
  folderId?: string;
}): Promise<{ success: boolean; files?: any[]; error?: string }> {
  try {
    const folderId = params?.folderId || getVisionClawFolderId();
    const pageSize = params?.pageSize || 50;

    let q = `'${folderId}' in parents and trashed=false`;
    if (params?.query) {
      q += ` and name contains '${params.query.replace(/'/g, "\\'")}'`;
    }

    const url = `/drive/v3/files?q=${encodeURIComponent(q)}&pageSize=${pageSize}&fields=files(id,name,mimeType,size,createdTime,modifiedTime,webViewLink,webContentLink)&orderBy=modifiedTime desc`;
    const result = await driveJson(url);

    return {
      success: true,
      files: result.files || [],
    };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

export async function downloadFromDrive(params: {
  fileId: string;
  savePath?: string;
}): Promise<{ success: boolean; path?: string; size?: number; error?: string }> {
  try {
    const metaResult = await driveJson(`/drive/v3/files/${params.fileId}?fields=id,name,mimeType,size`);
    if (metaResult.error) {
      return { success: false, error: metaResult.error.message || JSON.stringify(metaResult.error) };
    }

    const response = await driveRequest(`/drive/v3/files/${params.fileId}?alt=media`);
    const arrayBuf = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuf);

    const uploadsDir = path.resolve(process.cwd(), "uploads");
    if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

    const savePath = params.savePath || `uploads/${metaResult.name || `drive_${params.fileId}`}`;
    const resolved = path.resolve(process.cwd(), savePath);
    const cwd = process.cwd();
    if (!resolved.startsWith(cwd + path.sep) && resolved !== cwd) {
      return { success: false, error: `Path traversal blocked: ${savePath}` };
    }
    fs.writeFileSync(resolved, buffer);

    return {
      success: true,
      path: savePath,
      size: buffer.length,
    };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

/**
 * Read raw Drive bytes without writing a local staging file. Durable-record
 * verification uses this immediately after upload so a successful HTTP upload
 * response cannot be mistaken for a complete, retrievable file.
 */
export async function readDriveFileBytes(fileId: string): Promise<Buffer> {
  if (!/^[a-zA-Z0-9_-]{10,}$/.test(fileId)) throw new Error("Drive file id is malformed");
  const response = await driveRequest(`/drive/v3/files/${encodeURIComponent(fileId)}?alt=media`);
  if (!response.ok) throw new Error(`Drive file read failed with HTTP ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length === 0) throw new Error("Drive returned an empty file");
  return bytes;
}

export async function deleteDriveFile(fileId: string): Promise<{ success: boolean; error?: string }> {
  try {
    await driveRequest(`/drive/v3/files/${fileId}`, { method: "DELETE" });
    return { success: true };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

export interface ShareableLinkResult {
  success: boolean;
  fileId?: string;
  artifactId?: number;
  viewUrl?: string;
  downloadUrl?: string;
  imageUrl?: string;
  folderUrl?: string;
  error?: string;
  projectFilesWarning?: string;
}

export async function uploadAndShare(params: {
  filePath?: string;
  fileData?: Buffer;
  fileName: string;
  mimeType?: string;
  description?: string;
  customerName?: string;
  folderLabel?: string;
  share?: boolean;
  parentFolderId?: string;
  // R98: project-folder-aware upload. When projectId is supplied, the file
  // lands DIRECTLY in the project's named Drive folder (no auto-created
  // timestamped subfolder), and a project_files row is written automatically.
  projectId?: number;
  tenantId?: number;
  /** Internal callers with a stronger conflict-safe registration boundary may opt out. */
  registerProjectFile?: boolean;
  /**
   * Opt in only for system-generated outputs. Ordinary user/project uploads
   * deliberately omit this so inputs do not masquerade as agent work.
   */
  generatedArtifact?: {
    artifactKind: string;
    logicalName?: string;
    sourceRunKey?: string;
    sourceRequestId?: string;
    idempotencyKey?: string;
    metadata?: Record<string, unknown>;
  };
}): Promise<ShareableLinkResult> {
  if (!isDriveConfigured()) {
    return { success: false, error: "Google Drive is not configured. Set GOOGLE_DRIVE_ROOT_FOLDER_ID environment variable." };
  }
  const ext = path.extname(params.fileName).toLowerCase();
  const mimeMap: Record<string, string> = {
    ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
    ".gif": "image/gif", ".webp": "image/webp", ".svg": "image/svg+xml",
    ".pdf": "application/pdf", ".csv": "text/csv",
    ".json": "application/json", ".txt": "text/plain",
    ".html": "text/html", ".mp3": "audio/mpeg", ".wav": "audio/wav",
    ".mp4": "video/mp4", ".zip": "application/zip",
    ".doc": "application/msword",
    ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  };
  const mimeType = params.mimeType || mimeMap[ext] || "application/octet-stream";
  let artifactId: number | undefined;
  let artifactTenantId: number | undefined;
  let artifactBytes: Buffer | undefined;
  let artifactRecoveryKey: string | undefined;
  if (params.generatedArtifact) {
    if (!Number.isSafeInteger(params.tenantId) || (params.tenantId as number) <= 0) {
      return { success: false, error: "Generated artifact upload requires a trusted tenant ID" };
    }
    try {
      if (params.fileData) {
        artifactBytes = params.fileData;
      } else if (params.filePath) {
        const cwd = process.cwd();
        const candidate = params.filePath.startsWith("/uploads/") || params.filePath.startsWith("/attached_assets/") || params.filePath.startsWith("/stress-test-output/")
          ? params.filePath.slice(1)
          : params.filePath;
        const resolved = path.resolve(cwd, candidate);
        if (!resolved.startsWith(cwd + path.sep) || !fs.existsSync(resolved)) {
          return { success: false, error: "Generated artifact source file is unavailable" };
        }
        const stat = fs.lstatSync(resolved);
        if (!stat.isFile() || stat.isSymbolicLink()) {
          return { success: false, error: "Generated artifact source must be a regular workspace file" };
        }
        const realPath = fs.realpathSync(resolved);
        if (!realPath.startsWith(cwd + path.sep)) {
          return { success: false, error: "Generated artifact source resolves outside the workspace" };
        }
        artifactBytes = fs.readFileSync(realPath);
      }
      if (!artifactBytes?.length) return { success: false, error: "Generated artifact is empty" };
      const durable = await import("./durable-artifacts");
      artifactTenantId = Number(params.tenantId);
      const digest = durable.sha256Artifact(artifactBytes);
      const sourceKey = params.generatedArtifact.sourceRunKey || params.generatedArtifact.sourceRequestId || params.fileName;
      const artifact = await durable.createArtifactIntent({
        tenantId: artifactTenantId,
        projectId: params.projectId,
        logicalName: params.generatedArtifact.logicalName || params.fileName,
        artifactKind: params.generatedArtifact.artifactKind,
        mimeType,
        bytes: artifactBytes,
        sourceRunKey: params.generatedArtifact.sourceRunKey,
        sourceRequestId: params.generatedArtifact.sourceRequestId,
        idempotencyKey: params.generatedArtifact.idempotencyKey || `generated:${sourceKey}:${digest}`,
        metadata: params.generatedArtifact.metadata,
      });
      artifactId = artifact.id;
      artifactRecoveryKey = `artifact:${artifactTenantId}:${artifactId}:${artifact.sha256.slice(0, 32)}`;
      // A prior process may have uploaded successfully and then lost its local
      // completion step. Re-verify the persisted receipt instead of uploading
      // a second Drive copy on retry.
      if (artifact.driveFileId) {
        const sharing = await ensureRecoveredDriveFileSharing({
          fileId: artifact.driveFileId,
          viewUrl: artifact.driveViewUrl || undefined,
          downloadUrl: artifact.driveDownloadUrl || undefined,
          folderId: artifact.driveFolderId || undefined,
        }, params.share);
        if (!sharing.success) throw new Error(sharing.error);
        const recoveredFile = sharing.file;
        await durable.verifyAndMarkArtifactDurable({
          tenantId: artifactTenantId,
          artifactId,
          driveFileId: recoveredFile.fileId,
          driveFolderId: recoveredFile.folderId,
          driveViewUrl: recoveredFile.viewUrl,
          driveDownloadUrl: recoveredFile.downloadUrl,
        });
        return {
          success: true,
          artifactId,
          fileId: recoveredFile.fileId,
          viewUrl: recoveredFile.viewUrl,
          downloadUrl: recoveredFile.downloadUrl,
          folderUrl: recoveredFile.folderId ? `https://drive.google.com/drive/folders/${recoveredFile.folderId}` : undefined,
        };
      }
      const recovered = await findDriveFileByDurableArtifactKey(artifactRecoveryKey);
      if (recovered) {
        const sharing = await ensureRecoveredDriveFileSharing(recovered, params.share);
        if (!sharing.success) throw new Error(sharing.error);
        const recoveredFile = sharing.file;
        await durable.verifyAndMarkArtifactDurable({
          tenantId: artifactTenantId,
          artifactId,
          driveFileId: recoveredFile.fileId,
          driveFolderId: recoveredFile.folderId,
          driveViewUrl: recoveredFile.viewUrl,
          driveDownloadUrl: recoveredFile.downloadUrl,
        });
        return { success: true, artifactId, fileId: recoveredFile.fileId, viewUrl: recoveredFile.viewUrl, downloadUrl: recoveredFile.downloadUrl };
      }
    } catch (error) {
      return { success: false, error: `Generated artifact intent could not be recorded: ${error instanceof Error ? error.message : "unknown error"}` };
    }
  }

  // R98: resolve project Drive folder when projectId given. This routes the
  // file into the named project folder (e.g. "[Your Product]") instead of
  // a generic "2026-05-03_HH-MM-SS_deliverables" subfolder, which is what
  // broke Felix's Real_Weight_Loss video delivery.
  let resolvedParentFolderId = params.parentFolderId;
  let resolvedSkipSubfolder = false;
  let resolvedProjectName: string | undefined;
  let resolvedTenantId: number | undefined = params.tenantId;
  if (params.projectId && !resolvedParentFolderId) {
    try {
      const { projects, tenants } = await import("@shared/schema");
      const [proj] = await db
        .select({ id: projects.id, name: projects.name, tenantId: projects.tenantId })
        .from(projects)
        .where(eq(projects.id, params.projectId))
        .limit(1);
      if (!proj) {
        return { success: false, error: `uploadAndShare: project ${params.projectId} not found` } as any;
      }
      // R98 hardening: enforce tenant ownership AT THE CALLER too. If
      // ensureProjectFolder's own tenant check throws below we ALSO fail-closed,
      // but doing it here lets us return a clean error and skip the Drive call
      // entirely. Without this, a tenant-mismatch caught by the catch-all would
      // silently proceed to upload + project_files INSERT against a foreign
      // project — exactly the cross-tenant write architect flagged.
      if (params.tenantId != null && proj.tenantId !== params.tenantId) {
        return { success: false, error: `uploadAndShare: tenant mismatch — project ${params.projectId} belongs to tenant ${proj.tenantId}, caller is tenant ${params.tenantId}` } as any;
      }
      resolvedProjectName = proj.name;
      resolvedTenantId = resolvedTenantId || proj.tenantId || 1;
      const [tenant] = await db
        .select({ name: tenants.name })
        .from(tenants)
        .where(eq(tenants.id, resolvedTenantId))
        .limit(1);
      const projectFolder = await ensureProjectFolder(
        params.projectId,
        proj.name,
        resolvedTenantId,
        tenant?.name || `tenant-${resolvedTenantId}`
      );
      resolvedParentFolderId = projectFolder.id;
      resolvedSkipSubfolder = true;
    } catch (e: any) {
      // R98 hardening: fail-CLOSED. If the user asked for project-folder
      // routing and we can't satisfy it, refuse rather than silently dropping
      // the file into the default VisionClaw folder + writing a project_files
      // row for a project we never validated ownership of.
      const msg = `uploadAndShare: project folder resolve failed for project ${params.projectId}: ${e?.message || e}`;
      warn(`[uploadAndShare] ${msg}`);
      return { success: false, error: msg } as any;
    }
  }

  if (artifactId && artifactTenantId) {
    try {
      const { markArtifactDriveUploadDispatchPending } = await import("./durable-artifacts");
      await markArtifactDriveUploadDispatchPending(artifactTenantId, artifactId);
    } catch (error) {
      return {
        success: false,
        error: `Generated artifact Drive upload requires reconciliation: ${error instanceof Error ? error.message : "unknown error"}`,
      };
    }
  }

  const result = await uploadToDrive({
    filePath: params.filePath,
    fileData: params.fileData,
    fileName: params.fileName,
    mimeType,
    description: params.description,
    share: params.share !== false,
    customerName: params.customerName,
    folderLabel: params.folderLabel || "deliverables",
    parentFolderId: resolvedParentFolderId,
    skipSubfolder: resolvedSkipSubfolder,
    durableArtifactKey: artifactRecoveryKey,
  });

  if (!result.success || !result.fileId) {
    if (artifactId && artifactTenantId) {
      if (result.completionUncertain) {
        if (result.fileId) {
          try {
            const { verifyAndMarkArtifactDurable } = await import("./durable-artifacts");
            await verifyAndMarkArtifactDurable({
              tenantId: artifactTenantId,
              artifactId,
              driveFileId: result.fileId,
              driveFolderId: result.customerFolderId || null,
              driveViewUrl: result.shareableLink || null,
              driveDownloadUrl: result.directDownloadLink || null,
            });
          } catch (receiptError) {
            warn("[uploadAndShare] known generated artifact receipt could not be verified:", receiptError);
          }
        }
      } else {
        try {
          const { clearArtifactDriveUploadDispatchPending, markArtifactDegraded } = await import("./durable-artifacts");
          await clearArtifactDriveUploadDispatchPending(artifactTenantId, artifactId);
          await markArtifactDegraded({
            tenantId: artifactTenantId,
            artifactId,
            message: result.error || "Drive upload failed before a durable receipt was returned",
            eventType: "drive_upload_failed",
          });
        } catch (cleanupError) {
          return {
            success: false,
            error: `Generated artifact Drive upload outcome requires reconciliation: ${cleanupError instanceof Error ? cleanupError.message : "unknown error"}`,
          };
        }
      }
    }
    if (_demoMode && params.filePath && !params.generatedArtifact) {
      const localName = path.basename(params.filePath);
      const localServePath = `/uploads/${localName}`;
      const dest = path.resolve(process.cwd(), "uploads", localName);
      const src = path.resolve(process.cwd(), params.filePath);
      const cwdCheck = process.cwd();
      try {
        if (!src.startsWith(cwdCheck + path.sep)) throw new Error("Path traversal blocked");
        if (!dest.startsWith(cwdCheck + path.sep)) throw new Error("Path traversal blocked");
        if (!fs.existsSync(path.dirname(dest))) fs.mkdirSync(path.dirname(dest), { recursive: true });
        if (src !== dest) fs.copyFileSync(src, dest);
        const domain = process.env.REPLIT_DEV_DOMAIN || process.env.REPLIT_DOMAINS?.split(",")[0] || "localhost:5000";
        const protocol = domain.includes("localhost") ? "http" : "https";
        const localUrl = `${protocol}://${domain}${localServePath}`;
        warn(`Demo fallback: Drive upload failed, serving locally at ${localUrl}`);
        return {
          success: true,
          fileId: `local-${Date.now()}`,
          viewUrl: localUrl,
          downloadUrl: localUrl,
          folderUrl: undefined,
          imageUrl: undefined,
          error: `Drive upload failed (${result.error}), serving via local fallback`,
        };
      } catch (fallbackErr: any) {
        warn("Demo fallback also failed:", fallbackErr.message);
      }
    }
    return { success: false, artifactId, error: result.error || "Upload failed" };
  }

  if (artifactId && artifactTenantId) {
    try {
      const { verifyAndMarkArtifactDurable } = await import("./durable-artifacts");
      await verifyAndMarkArtifactDurable({
        tenantId: artifactTenantId,
        artifactId,
        driveFileId: result.fileId,
        driveFolderId: result.customerFolderId,
        driveViewUrl: result.shareableLink,
        driveDownloadUrl: result.directDownloadLink,
      });
    } catch (error) {
      return {
        success: false,
        artifactId,
        fileId: result.fileId,
        viewUrl: result.shareableLink,
        downloadUrl: result.directDownloadLink,
        error: error instanceof Error ? error.message : "Generated artifact could not be verified",
      };
    }
  }

  const isImage = mimeType.startsWith("image/");

  backupToOneDrive(params).catch(() => {});

  // R98: auto-register in project_files when projectId given. Makes it
  // physically impossible to upload a deliverable without a lookup record,
  // which is what caused Felix to flail when Bob asked for the link again.
  let projectFilesRegistered = false;
  let projectFilesWarning: string | undefined;
  if (params.registerProjectFile !== false && params.projectId && result.fileId && result.shareableLink) {
    try {
      const { sql } = await import("drizzle-orm");
      let fileSize = params.fileData?.length || 0;
      if (!fileSize && params.filePath) {
        try {
          const cwd = process.cwd();
          const candidate = params.filePath.startsWith("/uploads/") || params.filePath.startsWith("/attached_assets/") || params.filePath.startsWith("/stress-test-output/")
            ? params.filePath.slice(1)
            : params.filePath;
          const resolved = path.resolve(cwd, candidate);
          if (resolved.startsWith(cwd + path.sep) && fs.existsSync(resolved)) {
            fileSize = fs.statSync(resolved).size;
          }
        } catch (_silentErr) { logSilentCatch("server/google-drive.ts", _silentErr); }
      }
      // SECURITY (tenant isolation): projectId is caller-supplied and the Drive
      // folder-resolution tenant check (ensureProjectFolder) is SKIPPED when an
      // explicit parentFolderId is passed alongside projectId — so re-validate
      // ownership here before writing the project_files row. Fail-CLOSED: with no
      // validated tenant we skip the registration rather than trust the caller.
      const { assertProjectInTenant } = await import("./storage-helpers/project-tenant-guard");
      if (typeof resolvedTenantId === "number" && (await assertProjectInTenant(params.projectId, resolvedTenantId))) {
        await db.execute(sql`
          INSERT INTO project_files (project_id, file_name, file_path, file_url, file_type, file_size, uploaded_by)
          VALUES (${params.projectId}, ${params.fileName}, ${result.shareableLink}, ${result.shareableLink}, ${mimeType}, ${fileSize}, ${'VisionClaw Agent'})
        `);
        projectFilesRegistered = true;
        log(`[uploadAndShare] Registered in project_files for project ${params.projectId}: ${params.fileName}`);
      } else {
        projectFilesWarning = `project_files registration skipped — project #${params.projectId} not owned by tenant ${resolvedTenantId ?? "(unknown)"}`;
        log(`[uploadAndShare] ${projectFilesWarning}`);
      }
    } catch (e: any) {
      // R98 hardening: surface partial success so caller knows the DB
      // binding is missing — file is still on Drive (and recoverable via
      // searchDriveFiles pass 2), but the cheap project_files lookup path
      // won't find it. Caller should log/escalate, not assume success.
      projectFilesWarning = `project_files INSERT failed for project ${params.projectId}: ${e?.message || e}. File is on Drive but not registered — recoverable via google_drive search (Drive API pass).`;
      warn(`[uploadAndShare] ${projectFilesWarning}`);
    }
  }

  return {
    success: true,
    fileId: result.fileId,
    artifactId,
    viewUrl: result.shareableLink,
    downloadUrl: result.directDownloadLink,
    imageUrl: isImage ? `https://lh3.googleusercontent.com/d/${result.fileId}` : undefined,
    slidesEmbedUrl: isImage ? `https://drive.google.com/uc?export=download&id=${result.fileId}` : undefined,
    folderUrl: result.customerFolderLink,
    projectFilesRegistered,
    projectFilesWarning,
  } as any;
}

// R98: search_drive_files — the missing recovery path. Agents call this
// when they need to resurface a previously-uploaded file by name. Tries
// the project_files DB first (cheap, authoritative), then falls back to
// the Drive API name search. This closes the loop where Felix uploaded a
// binary, lost the link, and had no way to find it again because read_file
// only handles text and the DB row was never written.
export async function searchDriveFiles(params: {
  namePattern: string;
  tenantId: number;
  projectId?: number;
  mimeType?: string;
  limit?: number;
}): Promise<{ success: boolean; matches?: any[]; source?: string; error?: string }> {
  try {
    if (!params.tenantId || typeof params.tenantId !== "number") {
      return { success: false, error: "searchDriveFiles: tenantId is required (cross-tenant searches blocked)" };
    }
    const limit = Math.max(1, Math.min(50, params.limit || 10));
    const matches: any[] = [];
    const pattern = params.namePattern.toLowerCase();

    // R98 hardening: if projectId given, verify it belongs to the calling tenant
    // BEFORE running any query. Same pattern as ensureProjectFolder.
    if (params.projectId) {
      const { projects } = await import("@shared/schema");
      const [proj] = await db.select({ tenantId: projects.tenantId }).from(projects).where(eq(projects.id, params.projectId)).limit(1);
      if (!proj) {
        return { success: false, error: `searchDriveFiles: project ${params.projectId} not found` };
      }
      if (proj.tenantId !== params.tenantId) {
        return { success: false, error: `searchDriveFiles: tenant mismatch — project ${params.projectId} not owned by tenant ${params.tenantId}` };
      }
    }

    // Pass 1 — project_files DB (authoritative, cheap, includes view + download URLs).
    // R98 hardening: ALWAYS scope by tenant via JOIN on projects.tenant_id, even
    // when projectId not given. Without this, a name-only search could surface
    // another tenant's deliverables.
    try {
      const { sql } = await import("drizzle-orm");
      const dbRows: any = params.projectId
        ? await db.execute(sql`
            SELECT pf.id, pf.project_id, pf.file_name, pf.file_url, pf.file_path, pf.file_type, pf.file_size, pf.created_at
            FROM project_files pf
            INNER JOIN projects p ON p.id = pf.project_id
            WHERE pf.project_id = ${params.projectId}
              AND p.tenant_id = ${params.tenantId}
              AND LOWER(pf.file_name) LIKE ${'%' + pattern + '%'}
            ORDER BY pf.created_at DESC
            LIMIT ${limit}
          `)
        : await db.execute(sql`
            SELECT pf.id, pf.project_id, pf.file_name, pf.file_url, pf.file_path, pf.file_type, pf.file_size, pf.created_at
            FROM project_files pf
            INNER JOIN projects p ON p.id = pf.project_id
            WHERE p.tenant_id = ${params.tenantId}
              AND LOWER(pf.file_name) LIKE ${'%' + pattern + '%'}
            ORDER BY pf.created_at DESC
            LIMIT ${limit}
          `);
      const rows = (dbRows.rows || dbRows) as any[];
      for (const r of rows) {
        const url = r.file_url || r.file_path;
        const fileIdMatch = url && /\/d\/([a-zA-Z0-9_-]+)/.exec(url);
        const fileId = fileIdMatch ? fileIdMatch[1] : null;
        matches.push({
          source: "project_files",
          projectId: r.project_id,
          fileName: r.file_name,
          mimeType: r.file_type,
          size: r.file_size,
          viewUrl: url,
          downloadUrl: fileId ? `https://drive.google.com/uc?export=download&id=${fileId}` : url,
          fileId,
          createdAt: r.created_at,
        });
      }
    } catch (e: any) {
      warn(`[searchDriveFiles] DB pass failed: ${e?.message}`);
    }

    // Pass 2 — Drive API name search (catches files that were uploaded but
    // not registered, including pre-R98 uploads).
    if (matches.length < limit && isDriveConfigured()) {
      try {
        let folderScope = "";
        if (params.projectId) {
          const { projects } = await import("@shared/schema");
          const { and } = await import("drizzle-orm");
          const [proj] = await db.select({ driveFolderId: projects.driveFolderId }).from(projects).where(
            and(eq(projects.id, params.projectId), eq(projects.tenantId, params.tenantId)),
          ).limit(1);
          if (proj?.driveFolderId) {
            folderScope = ` and '${proj.driveFolderId}' in parents`;
          }
        }
        const safePattern = params.namePattern.replace(/['\\]/g, "\\$&");
        let q = `name contains '${safePattern}' and trashed=false${folderScope}`;
        if (params.mimeType) q += ` and mimeType='${params.mimeType}'`;
        const url = `/drive/v3/files?q=${encodeURIComponent(q)}&pageSize=${limit}&fields=files(id,name,mimeType,size,createdTime,webViewLink,webContentLink,parents)&orderBy=modifiedTime desc`;
        const result = await driveJson(url);
        for (const f of result.files || []) {
          if (matches.some(m => m.fileId === f.id)) continue;
          matches.push({
            source: "drive_api",
            fileName: f.name,
            mimeType: f.mimeType,
            size: f.size ? Number(f.size) : undefined,
            viewUrl: f.webViewLink || `https://drive.google.com/file/d/${f.id}/view?usp=sharing`,
            downloadUrl: `https://drive.google.com/uc?export=download&id=${f.id}`,
            fileId: f.id,
            createdAt: f.createdTime,
          });
          if (matches.length >= limit) break;
        }
      } catch (e: any) {
        warn(`[searchDriveFiles] Drive API pass failed: ${e?.message}`);
      }
    }

    return {
      success: true,
      matches: matches.slice(0, limit),
      source: matches.length ? "found" : "no_matches",
    };
  } catch (err: any) {
    return { success: false, error: err.message || String(err) };
  }
}

async function backupToOneDrive(params: {
  filePath?: string;
  fileData?: Buffer;
  fileName: string;
  folderLabel?: string;
  description?: string;
}) {
  try {
    const { isOneDriveConnected, uploadToOneDrive } = await import("./onedrive");
    const connected = await isOneDriveConnected();
    if (!connected) return;
    const result = await uploadToOneDrive({
      filePath: params.filePath,
      fileData: params.fileData,
      fileName: params.fileName,
      folderLabel: params.folderLabel || "deliverables",
      description: params.description,
    });
    if (result.success) {
      log(`OneDrive backup: ${params.fileName} → ${result.viewUrl}`);
    } else {
      warn(`OneDrive backup failed for ${params.fileName}: ${result.error}`);
    }
  } catch (err: any) {
    warn(`OneDrive backup error: ${err.message?.substring(0, 100)}`);
  }
}

export async function getDriveFolderInfo(): Promise<{ success: boolean; folderId?: string; folderName?: string; fileCount?: number; error?: string }> {
  try {
    const folderId = getVisionClawFolderId();
    const listing = await listDriveFiles({ folderId });
    return {
      success: true,
      folderId,
      folderName: VISIONCLAW_FOLDER_NAME,
      fileCount: listing.files?.length || 0,
    };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

export function startDriveTokenRefreshLoop() {
  if (_refreshInterval) return;

  _refreshInterval = setInterval(proactiveRefresh, TOKEN_REFRESH_INTERVAL_MS);
  log(`Token refresh loop started (every ${TOKEN_REFRESH_INTERVAL_MS / 60000} min)`);

  if (!_healthCheckInterval) {
    _healthCheckInterval = setInterval(runHealthCheck, HEALTH_CHECK_INTERVAL_MS);
    log(`Health check loop started (every ${HEALTH_CHECK_INTERVAL_MS / 60000} min)`);

    setTimeout(() => runHealthCheck(), 30000);
  }
}

export function stopDriveTokenRefreshLoop() {
  if (_refreshInterval) {
    clearInterval(_refreshInterval);
    _refreshInterval = null;
  }
  if (_healthCheckInterval) {
    clearInterval(_healthCheckInterval);
    _healthCheckInterval = null;
  }
}

export function isDriveTokenValid(): boolean {
  return !!_cachedToken && Date.now() < _tokenExpiry - 30000;
}

export async function demoWarmup(): Promise<{
  ready: boolean;
  tokenSource: string;
  tokenExpiresIn: number;
  healthStatus: string;
  driveVerified: boolean;
  demoMode: boolean;
  details: string[];
}> {
  const details: string[] = [];
  log("Demo warm-up starting...");

  _cachedToken = null;
  _tokenExpiry = 0;
  details.push("Cleared cached token");

  const token = await fullRefreshCascade("demo-warmup");
  if (!token) {
    details.push("CRITICAL: No token obtained from any source");
    return {
      ready: false,
      tokenSource: "none",
      tokenExpiresIn: 0,
      healthStatus: "fail",
      driveVerified: false,
      demoMode: _demoMode,
      details,
    };
  }
  details.push(`Fresh token obtained via: ${_lastSuccessfulRefreshSource}`);

  const verified = await verifyTokenWithApi(token);
  if (!verified) {
    details.push("WARNING: Token obtained but Google rejected it");
  } else {
    details.push("Token verified against Google Drive API");
  }

  if (!_demoMode) {
    _demoMode = true;
    stopDriveTokenRefreshLoop();
    TOKEN_REFRESH_INTERVAL_MS = 5 * 60 * 1000;
    HEALTH_CHECK_INTERVAL_MS = 5 * 60 * 1000;
    startDriveTokenRefreshLoop();
    details.push("Demo mode ACTIVATED: refresh interval → 5min, health check → 5min");
  } else {
    details.push("Demo mode already active");
  }

  _lastHealthStatus = verified ? "ok" : "fail";
  _lastHealthCheck = Date.now();
  _consecutiveFailures = verified ? 0 : _consecutiveFailures;

  const expiresIn = Math.round((_tokenExpiry - Date.now()) / 1000);
  details.push(`Token expires in ${expiresIn}s (${Math.round(expiresIn / 60)}min)`);

  let oneDriveReady = false;
  try {
    const { verifyOneDrive } = await import("./onedrive");
    const odResult = await verifyOneDrive();
    oneDriveReady = odResult.connected;
    if (odResult.connected) {
      details.push(`OneDrive backup verified — connected as ${odResult.user} (${odResult.email})`);
    } else {
      details.push(`OneDrive backup unavailable: ${odResult.error}`);
    }
  } catch (err: any) {
    details.push(`OneDrive check failed: ${err.message?.substring(0, 60)}`);
  }

  log(`Demo warm-up complete: ready=${verified}, source=${_lastSuccessfulRefreshSource}, expires=${expiresIn}s, onedrive=${oneDriveReady}`);

  return {
    ready: verified,
    tokenSource: _lastSuccessfulRefreshSource,
    tokenExpiresIn: expiresIn,
    healthStatus: _lastHealthStatus,
    driveVerified: verified,
    oneDriveReady,
    demoMode: _demoMode,
    details,
  } as any;
}

export function exitDemoMode() {
  if (!_demoMode) return;
  _demoMode = false;
  stopDriveTokenRefreshLoop();
  TOKEN_REFRESH_INTERVAL_MS = 10 * 60 * 1000;
  HEALTH_CHECK_INTERVAL_MS = 30 * 60 * 1000;
  startDriveTokenRefreshLoop();
  log("Demo mode deactivated — restored normal intervals");
}

export function isDemoMode(): boolean {
  return _demoMode;
}
