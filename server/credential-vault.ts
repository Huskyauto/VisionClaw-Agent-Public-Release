import { db } from "./db";
import { sql } from "drizzle-orm";
import { encryptApiKey, decryptApiKey } from "./crypto";

export interface Credential {
  id: number;
  tenantId: number;
  siteName: string;
  siteUrl: string;
  authType: "password" | "oauth" | "api_key";
  username: string | null;
  encryptedPassword: string | null;
  oauthProvider: string | null;
  oauthConfig: Record<string, any> | null;
  notes: string | null;
  lastUsedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CredentialSafe {
  id: number;
  siteName: string;
  siteUrl: string;
  authType: string;
  username: string | null;
  hasPassword: boolean;
  oauthProvider: string | null;
  notes: string | null;
  lastUsedAt: string | null;
  createdAt: string;
}

function rowToCredential(row: any): Credential {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    siteName: row.site_name,
    siteUrl: row.site_url,
    authType: row.auth_type,
    username: row.username,
    encryptedPassword: row.encrypted_password,
    oauthProvider: row.oauth_provider,
    oauthConfig: row.oauth_config,
    notes: row.notes,
    lastUsedAt: row.last_used_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toSafe(cred: Credential): CredentialSafe {
  return {
    id: cred.id,
    siteName: cred.siteName,
    siteUrl: cred.siteUrl,
    authType: cred.authType,
    username: cred.username,
    hasPassword: !!cred.encryptedPassword,
    oauthProvider: cred.oauthProvider,
    notes: cred.notes,
    lastUsedAt: cred.lastUsedAt,
    createdAt: cred.createdAt,
  };
}

export async function listCredentials(tenantId: number): Promise<CredentialSafe[]> {
  const result = await db.execute(
    sql`SELECT * FROM credential_vault WHERE tenant_id = ${tenantId} ORDER BY site_name ASC`
  );
  const rows = (result as any).rows || result;
  return rows.map((r: any) => toSafe(rowToCredential(r)));
}

export async function getCredential(id: number, tenantId: number): Promise<Credential | null> {
  const result = await db.execute(
    sql`SELECT * FROM credential_vault WHERE id = ${id} AND tenant_id = ${tenantId}`
  );
  const rows = (result as any).rows || result;
  if (!rows.length) return null;
  return rowToCredential(rows[0]);
}

export async function getCredentialForSite(siteUrl: string, tenantId: number): Promise<Credential | null> {
  let hostname: string;
  try {
    hostname = new URL(siteUrl).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return null;
  }
  const result = await db.execute(
    sql`SELECT * FROM credential_vault WHERE tenant_id = ${tenantId} ORDER BY last_used_at DESC NULLS LAST`
  );
  const rows = (result as any).rows || result;
  for (const row of rows) {
    try {
      const storedHost = new URL(row.site_url).hostname.replace(/^www\./, "").toLowerCase();
      if (storedHost === hostname || hostname.endsWith("." + storedHost)) {
        return rowToCredential(row);
      }
    } catch { continue; }
  }
  return null;
}

export async function createCredential(tenantId: number, data: {
  siteName: string;
  siteUrl: string;
  authType: "password" | "oauth" | "api_key";
  username?: string;
  password?: string;
  oauthProvider?: string;
  oauthConfig?: Record<string, any>;
  notes?: string;
}): Promise<CredentialSafe> {
  const encrypted = data.password ? encryptApiKey(data.password) : null;
  const result = await db.execute(sql`
    INSERT INTO credential_vault (tenant_id, site_name, site_url, auth_type, username, encrypted_password, oauth_provider, oauth_config, notes)
    VALUES (${tenantId}, ${data.siteName}, ${data.siteUrl}, ${data.authType}, ${data.username || null}, ${encrypted}, ${data.oauthProvider || null}, ${data.oauthConfig ? JSON.stringify(data.oauthConfig) : null}::jsonb, ${data.notes || null})
    RETURNING *
  `);
  const rows = (result as any).rows || result;
  return toSafe(rowToCredential(rows[0]));
}

export async function updateCredential(id: number, tenantId: number, data: {
  siteName?: string;
  siteUrl?: string;
  authType?: string;
  username?: string;
  password?: string;
  oauthProvider?: string;
  notes?: string;
}): Promise<CredentialSafe | null> {
  const existing = await getCredential(id, tenantId);
  if (!existing) return null;

  const siteName = data.siteName ?? existing.siteName;
  const siteUrl = data.siteUrl ?? existing.siteUrl;
  const authType = data.authType ?? existing.authType;
  const username = data.username ?? existing.username;
  const encrypted = data.password ? encryptApiKey(data.password) : existing.encryptedPassword;
  const oauthProvider = data.oauthProvider ?? existing.oauthProvider;
  const notes = data.notes ?? existing.notes;

  const result = await db.execute(sql`
    UPDATE credential_vault
    SET site_name = ${siteName}, site_url = ${siteUrl}, auth_type = ${authType},
        username = ${username}, encrypted_password = ${encrypted},
        oauth_provider = ${oauthProvider}, notes = ${notes}, updated_at = NOW()
    WHERE id = ${id} AND tenant_id = ${tenantId}
    RETURNING *
  `);
  const rows = (result as any).rows || result;
  return rows.length ? toSafe(rowToCredential(rows[0])) : null;
}

export async function deleteCredential(id: number, tenantId: number): Promise<boolean> {
  const result = await db.execute(
    sql`DELETE FROM credential_vault WHERE id = ${id} AND tenant_id = ${tenantId} RETURNING id`
  );
  const rows = (result as any).rows || result;
  return rows.length > 0;
}

export async function getDecryptedPassword(id: number, tenantId: number): Promise<string | null> {
  const cred = await getCredential(id, tenantId);
  if (!cred || !cred.encryptedPassword) return null;
  await db.execute(sql`UPDATE credential_vault SET last_used_at = NOW() WHERE id = ${id}`);
  return decryptApiKey(cred.encryptedPassword);
}

export async function getLoginCredentials(siteUrl: string, tenantId: number): Promise<{ username: string; password: string } | null> {
  const cred = await getCredentialForSite(siteUrl, tenantId);
  if (!cred || !cred.username || !cred.encryptedPassword) return null;
  await db.execute(sql`UPDATE credential_vault SET last_used_at = NOW() WHERE id = ${cred.id}`);
  return {
    username: cred.username,
    password: decryptApiKey(cred.encryptedPassword),
  };
}
