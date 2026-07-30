import fs from "fs";
import path from "path";
import { Client } from "@microsoft/microsoft-graph-client";

const VISIONCLAW_FOLDER = "VisionClaw Agent";
let _connectionSettings: any = null;
let _lastTokenFetch = 0;
const TOKEN_CACHE_MS = 4 * 60 * 1000;

function log(msg: string, ...args: any[]) {
  const ts = new Date().toISOString().replace("T", " ").substring(0, 19);
  console.log(`[onedrive ${ts}] ${msg}`, ...args);
}

function warn(msg: string, ...args: any[]) {
  const ts = new Date().toISOString().replace("T", " ").substring(0, 19);
  console.warn(`[onedrive ${ts}] ⚠ ${msg}`, ...args);
}

async function getAccessToken(): Promise<string> {
  if (
    _connectionSettings &&
    _connectionSettings.settings?.expires_at &&
    new Date(_connectionSettings.settings.expires_at).getTime() > Date.now() &&
    Date.now() - _lastTokenFetch < TOKEN_CACHE_MS
  ) {
    return _connectionSettings.settings.access_token;
  }

  const hostname = process.env.REPLIT_CONNECTORS_HOSTNAME;
  const xReplitToken = process.env.REPL_IDENTITY
    ? "repl " + process.env.REPL_IDENTITY
    : process.env.WEB_REPL_RENEWAL
      ? "depl " + process.env.WEB_REPL_RENEWAL
      : null;

  if (!xReplitToken || !hostname) {
    throw new Error("OneDrive connector not available (missing Replit token or hostname)");
  }

  const resp = await fetch(
    `https://${hostname}/api/v2/connection?include_secrets=true&connector_names=onedrive`,
    {
      headers: {
        Accept: "application/json",
        "X-Replit-Token": xReplitToken,
      },
    }
  );

  const data = await resp.json() as any;
  _connectionSettings = data.items?.[0];

  const accessToken =
    _connectionSettings?.settings?.access_token ||
    _connectionSettings?.settings?.oauth?.credentials?.access_token;

  if (!_connectionSettings || !accessToken) {
    throw new Error("OneDrive not connected — no access token available");
  }

  _lastTokenFetch = Date.now();
  return accessToken;
}

async function getClient(): Promise<Client> {
  const accessToken = await getAccessToken();
  return Client.initWithMiddleware({
    authProvider: {
      getAccessToken: async () => accessToken,
    },
  });
}

async function findOrCreateFolder(
  client: Client,
  parentPath: string,
  folderName: string
): Promise<{ id: string; webUrl: string }> {
  try {
    const searchPath = parentPath === "root"
      ? `/me/drive/root/children`
      : `/me/drive/items/${parentPath}/children`;

    const existing = await client.api(searchPath)
      .filter(`name eq '${folderName.replace(/'/g, "''")}'`)
      .select("id,name,webUrl")
      .get();

    if (existing.value && existing.value.length > 0) {
      return { id: existing.value[0].id, webUrl: existing.value[0].webUrl };
    }
  } catch (err: any) {
    log(`Folder search failed (will create): ${err.message?.substring(0, 80)}`);
  }

  const createPath = parentPath === "root"
    ? `/me/drive/root/children`
    : `/me/drive/items/${parentPath}/children`;

  const folder = await client.api(createPath).post({
    name: folderName,
    folder: {},
    "@microsoft.graph.conflictBehavior": "rename",
  });

  return { id: folder.id, webUrl: folder.webUrl };
}

export async function isOneDriveConnected(): Promise<boolean> {
  try {
    await getAccessToken();
    return true;
  } catch {
    return false;
  }
}

export async function verifyOneDrive(): Promise<{
  connected: boolean;
  user?: string;
  email?: string;
  error?: string;
}> {
  try {
    const client = await getClient();
    const me = await client.api("/me").select("displayName,mail,userPrincipalName").get();
    return {
      connected: true,
      user: me.displayName,
      email: me.mail || me.userPrincipalName,
    };
  } catch (err: any) {
    return { connected: false, error: err.message };
  }
}

export async function uploadToOneDrive(params: {
  filePath?: string;
  fileData?: Buffer;
  fileName: string;
  folderLabel?: string;
  description?: string;
}): Promise<{
  success: boolean;
  fileId?: string;
  viewUrl?: string;
  downloadUrl?: string;
  shareUrl?: string;
  error?: string;
}> {
  try {
    const client = await getClient();

    let fileBuffer: Buffer;
    if (params.fileData) {
      fileBuffer = params.fileData;
    } else if (params.filePath) {
      const resolved = path.resolve(process.cwd(), params.filePath);
      if (!fs.existsSync(resolved)) {
        return { success: false, error: `File not found: ${params.filePath}` };
      }
      fileBuffer = fs.readFileSync(resolved);
    } else {
      return { success: false, error: "Either filePath or fileData is required" };
    }

    const rootFolder = await findOrCreateFolder(client, "root", VISIONCLAW_FOLDER);
    log(`Root folder: ${rootFolder.id}`);

    let targetFolderId = rootFolder.id;
    if (params.folderLabel) {
      const segments = params.folderLabel.split("/").map(s => s.trim()).filter(Boolean);
      let currentParentId = rootFolder.id;
      for (const segment of segments) {
        const safeName = segment.replace(/[<>:"|?*\\]/g, "_").substring(0, 200);
        const sub = await findOrCreateFolder(client, currentParentId, safeName);
        currentParentId = sub.id;
      }
      targetFolderId = currentParentId;
      log(`Subfolder "${params.folderLabel}": ${targetFolderId}`);
    }

    const uploadPath = `/me/drive/items/${targetFolderId}:/${encodeURIComponent(params.fileName)}:/content`;

    let uploadResult: any;
    if (fileBuffer.length < 4 * 1024 * 1024) {
      uploadResult = await client.api(uploadPath)
        .putStream(fileBuffer);
    } else {
      const session = await client
        .api(`/me/drive/items/${targetFolderId}:/${encodeURIComponent(params.fileName)}:/createUploadSession`)
        .post({
          item: {
            "@microsoft.graph.conflictBehavior": "replace",
            name: params.fileName,
            description: params.description || "Uploaded by VisionClaw Agent",
          },
        });

      const chunkSize = 5 * 1024 * 1024;
      let offset = 0;
      while (offset < fileBuffer.length) {
        const end = Math.min(offset + chunkSize, fileBuffer.length);
        const chunk = fileBuffer.subarray(offset, end);
        const resp = await fetch(session.uploadUrl, {
          method: "PUT",
          headers: {
            "Content-Length": chunk.length.toString(),
            "Content-Range": `bytes ${offset}-${end - 1}/${fileBuffer.length}`,
          },
          body: chunk,
        });
        const respData = await resp.json() as any;
        if (respData.id) {
          uploadResult = respData;
        }
        offset = end;
      }
    }

    if (!uploadResult?.id) {
      return { success: false, error: "Upload completed but no file ID returned" };
    }

    let shareUrl: string | undefined;
    try {
      const link = await client.api(`/me/drive/items/${uploadResult.id}/createLink`).post({
        type: "view",
        scope: "anonymous",
      });
      shareUrl = link.link?.webUrl;
    } catch (shareErr: any) {
      warn(`Share link creation failed: ${shareErr.message?.substring(0, 80)}`);
    }

    log(`Upload complete: ${uploadResult.id} — ${params.fileName}`);

    return {
      success: true,
      fileId: uploadResult.id,
      viewUrl: shareUrl || uploadResult.webUrl,
      downloadUrl: uploadResult["@microsoft.graph.downloadUrl"],
      shareUrl,
    };
  } catch (err: any) {
    warn(`Upload failed: ${err.message}`);
    return { success: false, error: err.message };
  }
}

export async function uploadAndShareOneDrive(params: {
  filePath?: string;
  fileData?: Buffer;
  fileName: string;
  folderLabel?: string;
  description?: string;
}): Promise<{
  success: boolean;
  fileId?: string;
  viewUrl?: string;
  downloadUrl?: string;
  error?: string;
}> {
  return uploadToOneDrive({
    ...params,
    folderLabel: params.folderLabel || "deliverables",
  });
}

export async function listOneDriveFiles(folderLabel?: string): Promise<{
  success: boolean;
  files?: Array<{ name: string; id: string; size: number; lastModified: string; webUrl: string }>;
  error?: string;
}> {
  try {
    const client = await getClient();
    const rootFolder = await findOrCreateFolder(client, "root", VISIONCLAW_FOLDER);

    let targetId = rootFolder.id;
    if (folderLabel) {
      const sub = await findOrCreateFolder(client, rootFolder.id, folderLabel);
      targetId = sub.id;
    }

    const result = await client
      .api(`/me/drive/items/${targetId}/children`)
      .select("id,name,size,lastModifiedDateTime,webUrl")
      .top(100)
      .get();

    return {
      success: true,
      files: (result.value || []).map((f: any) => ({
        name: f.name,
        id: f.id,
        size: f.size,
        lastModified: f.lastModifiedDateTime,
        webUrl: f.webUrl,
      })),
    };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

export async function getOneDriveHealth(): Promise<{
  connected: boolean;
  user?: string;
  email?: string;
  folderExists?: boolean;
  fileCount?: number;
  error?: string;
}> {
  try {
    const client = await getClient();
    const me = await client.api("/me").select("displayName,mail,userPrincipalName").get();

    let folderExists = false;
    let fileCount = 0;
    try {
      const rootFolder = await findOrCreateFolder(client, "root", VISIONCLAW_FOLDER);
      folderExists = !!rootFolder.id;
      const listing = await client
        .api(`/me/drive/items/${rootFolder.id}/children`)
        .select("id")
        .top(200)
        .get();
      fileCount = listing.value?.length || 0;
    } catch {
      folderExists = false;
    }

    return {
      connected: true,
      user: me.displayName,
      email: me.mail || me.userPrincipalName,
      folderExists,
      fileCount,
    };
  } catch (err: any) {
    return { connected: false, error: err.message };
  }
}
