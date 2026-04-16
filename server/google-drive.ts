import fs from "fs";
import path from "path";
import { db } from "./db";
import { providerKeys } from "@shared/schema";
import { eq } from "drizzle-orm";
import { encryptApiKey, decryptApiKey } from "./crypto";

const VISIONCLAW_FOLDER_ID = process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID || "";
const VISIONCLAW_FOLDER_NAME = process.env.SITE_PLATFORM_NAME ? `${process.env.SITE_PLATFORM_NAME} Agent` : "VisionClaw Agent";
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

function log(msg: string, ...args: any[]) {
  const ts = new Date().toISOString().replace("T", " ").substring(0, 19);
  console.log(`[gdrive ${ts}] ${msg}`, ...args);
}

function warn(msg: string, ...args: any[]) {
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
  } catch (err: any) {
    warn("Failed to save token to DB:", err.message);
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

      const resp = await fetch(url.toString(), {
        headers: { Accept: "application/json", "X-Replit-Token": xReplitToken },
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
  } catch (err: any) {
    log("Connector refresh error:", err.message?.substring(0, 120));
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
  } catch (subErr: any) {
    log("OAuth subscription refresh failed:", subErr.message?.substring(0, 100));
  }
  return null;
}

async function tryDatabaseToken(): Promise<string | null> {
  try {
    const rows = await db.select().from(providerKeys).where(eq(providerKeys.provider, GDRIVE_PROVIDER_KEY)).limit(1);
    if (rows.length > 0 && rows[0].apiKey && rows[0].enabled) {
      let dbToken = rows[0].apiKey;
      try { dbToken = decryptApiKey(dbToken); } catch {}
      if (dbToken.length > 20 && !dbToken.startsWith("drizzle_test")) {
        _cachedToken = dbToken;
        _tokenExpiry = Date.now() + 3500000;
        _lastSuccessfulRefreshSource = "database";
        log("Token loaded from database (length:", dbToken.length, ")");
        return dbToken;
      }
    }
  } catch (dbErr: any) {
    log("DB token load failed:", dbErr.message);
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
      } catch (err: any) {
        log(`Cascade source ${name} threw: ${err.message?.substring(0, 80)}`);
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
    const resp = await fetch(`${DRIVE_API}/drive/v3/about?fields=user`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (resp.status === 200) {
      const data = await resp.json() as any;
      log(`Health check OK — connected as: ${data.user?.displayName || "unknown"} (${data.user?.emailAddress || "unknown"})`);
      return true;
    }
    log(`Health check returned HTTP ${resp.status}`);
    return false;
  } catch (err: any) {
    log(`Health check network error: ${err.message?.substring(0, 80)}`);
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
  } catch (err: any) {
    warn("Failed to send alert email:", err.message?.substring(0, 100));
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
  } catch (err: any) {
    warn("Proactive refresh error:", err.message?.substring(0, 100));
  }
}

export async function driveRequest(endpoint: string, options?: { method?: string; headers?: Record<string, string>; body?: string | Buffer }, _retryCount = 0): Promise<Response> {
  const token = await getAccessToken();
  const url = endpoint.startsWith("http") ? endpoint : `${DRIVE_API}${endpoint}`;

  const resp = await fetch(url, {
    method: options?.method || "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      ...options?.headers,
    },
    body: options?.body,
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

export function getVisionClawFolderId(): string {
  return VISIONCLAW_FOLDER_ID;
}

export async function makeFileShareable(fileId: string): Promise<{ success: boolean; webViewLink?: string; directDownloadLink?: string; error?: string }> {
  try {
    const permResult = await driveJson(`/drive/v3/files/${fileId}/permissions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role: "reader", type: "anyone" }),
    });
    log("Permission set for", fileId);

    const webViewLink = `https://drive.google.com/file/d/${fileId}/view?usp=sharing`;
    const directDownloadLink = `https://drive.google.com/uc?export=download&id=${fileId}`;

    return { success: true, webViewLink, directDownloadLink };
  } catch (err: any) {
    warn("makeFileShareable error:", err.message);
    return { success: false, error: err.message };
  }
}

async function findOrCreateFolder(parentFolderId: string, folderName: string): Promise<{ id: string; webViewLink: string }> {
  const q = `name='${folderName.replace(/'/g, "\\'")}' and '${parentFolderId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`;
  const searchResult = await driveJson(`/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id,name,webViewLink)&pageSize=1`);
  if (searchResult.files && searchResult.files.length > 0) {
    return { id: searchResult.files[0].id, webViewLink: searchResult.files[0].webViewLink || `https://drive.google.com/drive/folders/${searchResult.files[0].id}` };
  }
  return createSubfolder(parentFolderId, folderName);
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
  const createResult = await driveJson("/drive/v3/files?fields=id,name,webViewLink", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: folderName,
      mimeType: "application/vnd.google-apps.folder",
      parents: [parentFolderId],
    }),
  });

  if (!createResult.id) {
    throw new Error("Failed to create subfolder: " + JSON.stringify(createResult));
  }

  await driveJson(`/drive/v3/files/${createResult.id}/permissions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ role: "reader", type: "anyone" }),
  });

  const webViewLink = `https://drive.google.com/drive/folders/${createResult.id}?usp=sharing`;
  log(`Created shareable subfolder: ${folderName} (${createResult.id})`);

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

  const [project] = await db.select({ driveFolderId: projects.driveFolderId, driveFolderUrl: projects.driveFolderUrl }).from(projects).where(eq(projects.id, projectId)).limit(1);
  if (project?.driveFolderId) {
    return { id: project.driveFolderId, url: project.driveFolderUrl || `https://drive.google.com/drive/folders/${project.driveFolderId}` };
  }

  const tenantFolder = await ensureTenantFolder(tenantId, tenantName);
  const folder = await createSubfolder(tenantFolder.id, projectName);
  await db.update(projects).set({ driveFolderId: folder.id, driveFolderUrl: folder.webViewLink }).where(eq(projects.id, projectId));
  log(`Created project Drive folder: ${projectName} (${folder.id}) under tenant ${tenantId}`);
  return { id: folder.id, url: folder.webViewLink };
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
  _retryCount?: number;
}): Promise<{ success: boolean; fileId?: string; webViewLink?: string; webContentLink?: string; shareableLink?: string; directDownloadLink?: string; customerFolderId?: string; customerFolderLink?: string; error?: string }> {
  try {
    const rootFolderId = params.parentFolderId || getVisionClawFolderId();

    let fileBuffer: Buffer;
    if (params.fileData) {
      fileBuffer = params.fileData;
    } else if (params.filePath) {
      const resolved = path.resolve(process.cwd(), params.filePath);
      const cwd = process.cwd();
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

    const label = params.folderLabel || params.customerName || params.fileName.replace(/\.[^.]+$/, "");
    let subfolder: { id: string; webViewLink: string };

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

    const metadata = {
      name: params.fileName,
      parents: [subfolder.id],
      description: params.description || `Uploaded by ${VISIONCLAW_FOLDER_NAME} on ${new Date().toISOString().split("T")[0]}`,
    };

    const boundary = "visionclaw_boundary_" + Date.now();
    const delimiter = `--${boundary}`;
    const closeDelimiter = `--${boundary}--`;

    const metaPart = `${delimiter}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n`;
    const mediaPart = `${delimiter}\r\nContent-Type: ${params.mimeType}\r\nContent-Transfer-Encoding: base64\r\n\r\n${fileBuffer.toString("base64")}\r\n${closeDelimiter}`;

    const body = metaPart + mediaPart;

    const token = await getAccessToken();
    const response = await fetch(`${DRIVE_API}/upload/drive/v3/files?uploadType=multipart&fields=id,name,webViewLink,webContentLink`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": `multipart/related; boundary=${boundary}`,
      },
      body,
    });

    const result = await response.json() as any;

    if (result.error) {
      if (result.error.code === 401 && !params._retryCount) {
        _cachedToken = null;
        _tokenExpiry = 0;
        log("Upload got 401 — attempting recovery (retry 1 of 1)...");
        const recovered = await fullRefreshCascade("upload-401");
        if (recovered) {
          return uploadToDrive({ ...params, _retryCount: 1 });
        }
        return { success: false, error: "Google Drive token expired during upload. All recovery attempts failed." };
      }
      if (result.error.code === 401 && params._retryCount) {
        return { success: false, error: "Google Drive token expired during upload. Retry also failed — check token sources." };
      }
      return { success: false, error: result.error.message || JSON.stringify(result.error) };
    }

    let shareableLink = `https://drive.google.com/file/d/${result.id}/view?usp=sharing`;
    let directDownloadLink = `https://drive.google.com/uc?export=download&id=${result.id}`;

    if (result.id && params.share !== false) {
      const shareResult = await makeFileShareable(result.id);
      if (!shareResult.success) {
        warn("Share permission failed (file still uploaded):", shareResult.error);
      }
    }

    log("Upload complete. File:", result.id, "Folder:", subfolder.id);

    return {
      success: true,
      fileId: result.id,
      webViewLink: shareableLink,
      webContentLink: directDownloadLink,
      shareableLink,
      directDownloadLink,
      customerFolderId: subfolder.id,
      customerFolderLink: subfolder.webViewLink,
    };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
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
  viewUrl?: string;
  downloadUrl?: string;
  imageUrl?: string;
  folderUrl?: string;
  error?: string;
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

  const result = await uploadToDrive({
    filePath: params.filePath,
    fileData: params.fileData,
    fileName: params.fileName,
    mimeType,
    description: params.description,
    share: params.share !== false,
    customerName: params.customerName,
    folderLabel: params.folderLabel || "deliverables",
    parentFolderId: params.parentFolderId,
  });

  if (!result.success || !result.fileId) {
    if (_demoMode && params.filePath) {
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
    return { success: false, error: result.error || "Upload failed" };
  }

  const isImage = mimeType.startsWith("image/");

  backupToOneDrive(params).catch(() => {});

  return {
    success: true,
    fileId: result.fileId,
    viewUrl: result.shareableLink,
    downloadUrl: result.directDownloadLink,
    imageUrl: isImage ? `https://lh3.googleusercontent.com/d/${result.fileId}` : undefined,
    slidesEmbedUrl: isImage ? `https://drive.google.com/uc?export=download&id=${result.fileId}` : undefined,
    folderUrl: result.customerFolderLink,
  };
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
  };
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
