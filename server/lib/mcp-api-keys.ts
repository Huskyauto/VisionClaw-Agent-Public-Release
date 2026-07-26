/**
 * MCP API key management — R113.7 Round C.
 *
 * Per-tenant API keys for external MCP clients (Claude Desktop, Cursor, custom
 * agents) to authenticate against VCA's MCP server endpoint. Keys are minted
 * once, displayed in plaintext exactly once at creation, and stored as a
 * SHA-256 hash (unsalted — the 240-bit secret half supplies sufficient entropy
 * that adding a salt offers no practical defense against offline brute-force).
 * A short prefix is stored in plaintext to enable O(1) lookup; the
 * constant-time hash comparison is what actually authenticates.
 *
 * Key format: `mcp_<8-char-prefix>_<32-char-secret>`
 *   - `mcp_` recognizable scheme tag
 *   - 8-char prefix is the lookup index (also helps Bob identify keys in the UI)
 *   - 32-char secret is what the hash protects
 *
 * Tenant isolation: every read/write pins by tenant_id. The verify path
 * resolves tenant_id FROM the key (not from any client-supplied header) —
 * a stolen key still only sees that tenant's data.
 */
import { db } from "../db";
import { sql } from "drizzle-orm";
import { randomBytes, createHash, timingSafeEqual } from "crypto";

export interface McpApiKeyRow {
  id: number;
  tenantId: number;
  name: string;
  keyPrefix: string;
  scopes: string[];
  createdAt: Date;
  lastUsedAt: Date | null;
  revokedAt: Date | null;
  createdBy: string | null;
}

export interface CreatedKey {
  id: number;
  name: string;
  keyPrefix: string;
  plaintext: string;
  scopes: string[];
  createdAt: Date;
}

function genKey(): { plaintext: string; prefix: string; hash: string } {
  // 24 random bytes → 32 base32-ish chars (using base64url, trimmed).
  const prefix = randomBytes(6).toString("base64url").slice(0, 8);
  const secret = randomBytes(24).toString("base64url").slice(0, 32);
  const plaintext = `mcp_${prefix}_${secret}`;
  const hash = createHash("sha256").update(plaintext).digest("hex");
  return { plaintext, prefix, hash };
}

export async function createApiKey(params: {
  tenantId: number;
  name: string;
  scopes?: string[];
  createdBy?: string;
}): Promise<{ ok: true; key: CreatedKey } | { ok: false; error: string }> {
  if (!Number.isInteger(params.tenantId) || params.tenantId <= 0) {
    return { ok: false, error: "tenantId required" };
  }
  const name = String(params.name || "").trim();
  if (!name || name.length > 100) {
    return { ok: false, error: "name required (1-100 chars)" };
  }
  const scopes = Array.isArray(params.scopes) ? params.scopes.map((s) => String(s)) : [];
  // Build Postgres text[] literal — Drizzle sql`` will NOT auto-cast a JS array.
  const scopesLit = `{${scopes.map((s) => `"${s.replace(/"/g, '\\"')}"`).join(",")}}`;

  // Retry up to 3 times on prefix collision (probability ~ 1/2^48, but the
  // UNIQUE index guarantees correctness — we just retry for UX).
  for (let attempt = 0; attempt < 3; attempt++) {
    const { plaintext, prefix, hash } = genKey();
    try {
      const r = await db.execute(sql`
        INSERT INTO mcp_api_keys (tenant_id, name, key_prefix, key_hash, scopes, created_by)
        VALUES (${params.tenantId}, ${name}, ${prefix}, ${hash}, ${scopesLit}::text[], ${params.createdBy || null})
        RETURNING id, name, key_prefix, scopes, created_at
      `);
      const row = ((r as any).rows || r)[0];
      return {
        ok: true,
        key: {
          id: row.id,
          name: row.name,
          keyPrefix: row.key_prefix,
          plaintext,
          scopes: row.scopes || [],
          createdAt: new Date(row.created_at),
        },
      };
    } catch (e: any) {
      if (e?.message?.includes("idx_mcp_api_keys_prefix") && attempt < 2) continue;
      return { ok: false, error: e?.message || "create failed" };
    }
  }
  return { ok: false, error: "could not allocate unique key prefix after 3 attempts" };
}

export async function listApiKeys(tenantId: number): Promise<McpApiKeyRow[]> {
  if (!Number.isInteger(tenantId) || tenantId <= 0) return [];
  const r = await db.execute(sql`
    SELECT id, tenant_id, name, key_prefix, scopes, created_at, last_used_at, revoked_at, created_by
      FROM mcp_api_keys
     WHERE tenant_id = ${tenantId}
     ORDER BY created_at DESC
  `);
  const rows = (r as any).rows || r;
  return rows.map((row: any) => ({
    id: row.id,
    tenantId: row.tenant_id,
    name: row.name,
    keyPrefix: row.key_prefix,
    scopes: row.scopes || [],
    createdAt: new Date(row.created_at),
    lastUsedAt: row.last_used_at ? new Date(row.last_used_at) : null,
    revokedAt: row.revoked_at ? new Date(row.revoked_at) : null,
    createdBy: row.created_by,
  }));
}

export async function revokeApiKey(
  id: number,
  tenantId: number,
): Promise<{ ok: true; revoked: boolean } | { ok: false; error: string }> {
  if (!Number.isInteger(id) || id <= 0) return { ok: false, error: "valid id required" };
  if (!Number.isInteger(tenantId) || tenantId <= 0) return { ok: false, error: "tenantId required" };
  try {
    const r = await db.execute(sql`
      UPDATE mcp_api_keys
         SET revoked_at = NOW()
       WHERE id = ${id}
         AND tenant_id = ${tenantId}
         AND revoked_at IS NULL
      RETURNING id
    `);
    const rows = (r as any).rows || r;
    return { ok: true, revoked: (rows?.length || 0) > 0 };
  } catch (e: any) {
    return { ok: false, error: e?.message || "revoke failed" };
  }
}

export interface VerifiedKey {
  keyId: number;
  tenantId: number;
  scopes: string[];
}

/**
 * Verify a presented bearer token. Returns the tenantId + scopes if valid.
 * Returns null for any failure (invalid format, unknown prefix, hash mismatch,
 * revoked). Constant-time hash comparison; touches last_used_at best-effort.
 */
export async function verifyApiKey(presented: string): Promise<VerifiedKey | null> {
  if (typeof presented !== "string") return null;
  // Format check first — cheap.
  const m = presented.match(/^mcp_([A-Za-z0-9_-]{8})_([A-Za-z0-9_-]{32})$/);
  if (!m) return null;
  const prefix = m[1];
  const expectedHash = createHash("sha256").update(presented).digest("hex");

  try {
    const r = await db.execute(sql`
      SELECT id, tenant_id, key_hash, scopes, revoked_at
        FROM mcp_api_keys
       WHERE key_prefix = ${prefix}
       LIMIT 1
    `);
    const row = ((r as any).rows || r)[0];
    if (!row) return null;
    if (row.revoked_at) return null;

    const storedHash = String(row.key_hash);
    if (storedHash.length !== expectedHash.length) return null;
    const ok = timingSafeEqual(Buffer.from(storedHash), Buffer.from(expectedHash));
    if (!ok) return null;

    // Best-effort touch — do NOT block the request.
    db.execute(sql`UPDATE mcp_api_keys SET last_used_at = NOW() WHERE id = ${row.id}`)
      .catch((e) => console.warn("[mcp-api-keys] touch last_used_at failed:", e?.message));

    return {
      keyId: row.id,
      tenantId: row.tenant_id,
      scopes: row.scopes || [],
    };
  } catch (e: any) {
    console.error("[mcp-api-keys] verify error:", e?.message);
    return null;
  }
}
