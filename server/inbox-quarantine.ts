import { db } from "./db";
import { logSilentCatch } from "./lib/silent-catch";
import { sql } from "drizzle-orm";

export type AllowlistStatus = "approved" | "blocked";

export interface AllowlistEntry {
  tenantId: number;
  address: string;
  status: AllowlistStatus;
  addedBy: string | null;
  addedAt: Date;
  lastSeenAt: Date | null;
  notes: string | null;
}

const EMAIL_RE = /<([^>]+)>|([\w.+-]+@[\w-]+\.[\w.-]+)/;
const OWNER_EMAILS = new Set(
  [
    process.env.OWNER_EMAIL,
    process.env.OWNER_ALERT_EMAIL,
    process.env.SITE_OWNER_EMAIL,
    process.env.SITE_CONTACT_EMAIL,
    // R125+137.27: no hardcoded personal fallback — owner identity is env-driven.
  ]
    .filter(Boolean)
    .map((s) => String(s).toLowerCase().trim()),
);

function rowsOf(r: any): any[] { return (r?.rows || r) || []; }

// R104 architect-finding fix: normalized addresses must not carry SQL LIKE
// wildcards ("%", "_") that would let a crafted sender-pattern auto-approve
// or auto-unquarantine unrelated correspondents. We escape with backslash
// and pair every LIKE with `ESCAPE '\\'` below.
function escapeLike(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
}

export function normalizeAddress(raw: string): string {
  if (!raw) return "";
  const m = raw.match(EMAIL_RE);
  const email = m ? m[1] || m[2] || raw : raw;
  return String(email).toLowerCase().trim();
}

export async function isSenderApproved(tenantId: number, fromRaw: string): Promise<{ approved: boolean; reason: string }> {
  const addr = normalizeAddress(fromRaw);
  if (!addr) return { approved: false, reason: "no parseable from address" };
  if (OWNER_EMAILS.has(addr)) return { approved: true, reason: "owner-address" };
  try {
    const result = await db.execute(sql`
      SELECT status FROM inbox_sender_allowlist WHERE tenant_id = ${tenantId} AND address = ${addr} LIMIT 1
    `);
    const row = rowsOf(result)[0];
    if (row?.status === "approved") return { approved: true, reason: "explicit-allowlist" };
    if (row?.status === "blocked") return { approved: false, reason: "blocked" };
  } catch (_e) {
    return { approved: false, reason: "allowlist-lookup-failed" };
  }
  try {
    const safeAddr = escapeLike(addr);
    const result = await db.execute(sql`
      SELECT 1 FROM inbox_messages
      WHERE tenant_id = ${tenantId} AND direction = 'outbound'
        AND lower(to_address) LIKE ${"%" + safeAddr + "%"} ESCAPE '\\'
      LIMIT 1
    `);
    if (rowsOf(result).length > 0) return { approved: true, reason: "prior-correspondent" };
  } catch (_e) { logSilentCatch("server/inbox-quarantine.ts", _e); }
  return { approved: false, reason: "unknown-sender" };
}

export async function approveSender(tenantId: number, address: string, addedBy: string, notes?: string): Promise<AllowlistEntry> {
  const addr = normalizeAddress(address);
  if (!addr) throw new Error("approveSender: invalid address");
  const safeNotes = notes ? notes.slice(0, 500) : null;
  const result = await db.execute(sql`
    INSERT INTO inbox_sender_allowlist (tenant_id, address, status, added_by, notes)
    VALUES (${tenantId}, ${addr}, 'approved', ${addedBy}, ${safeNotes})
    ON CONFLICT (tenant_id, address) DO UPDATE
      SET status = 'approved', added_by = EXCLUDED.added_by, notes = COALESCE(EXCLUDED.notes, inbox_sender_allowlist.notes)
    RETURNING tenant_id AS "tenantId", address, status, added_by AS "addedBy",
              added_at AS "addedAt", last_seen_at AS "lastSeenAt", notes
  `);
  const safeAddr = escapeLike(addr);
  await db.execute(sql`
    UPDATE inbox_messages SET quarantined = FALSE
    WHERE tenant_id = ${tenantId} AND direction = 'inbound'
      AND lower(from_address) LIKE ${"%" + safeAddr + "%"} ESCAPE '\\'
      AND quarantined = TRUE
  `);
  return rowsOf(result)[0];
}

export async function blockSender(tenantId: number, address: string, addedBy: string, notes?: string): Promise<AllowlistEntry> {
  const addr = normalizeAddress(address);
  if (!addr) throw new Error("blockSender: invalid address");
  const safeNotes = notes ? notes.slice(0, 500) : null;
  const result = await db.execute(sql`
    INSERT INTO inbox_sender_allowlist (tenant_id, address, status, added_by, notes)
    VALUES (${tenantId}, ${addr}, 'blocked', ${addedBy}, ${safeNotes})
    ON CONFLICT (tenant_id, address) DO UPDATE
      SET status = 'blocked', added_by = EXCLUDED.added_by, notes = COALESCE(EXCLUDED.notes, inbox_sender_allowlist.notes)
    RETURNING tenant_id AS "tenantId", address, status, added_by AS "addedBy",
              added_at AS "addedAt", last_seen_at AS "lastSeenAt", notes
  `);
  return rowsOf(result)[0];
}

export async function listQuarantined(tenantId: number, limit = 100): Promise<any[]> {
  const result = await db.execute(sql`
    SELECT id, from_address AS "fromAddress", subject, received_at AS "receivedAt"
    FROM inbox_messages
    WHERE tenant_id = ${tenantId} AND direction = 'inbound' AND quarantined = TRUE
    ORDER BY received_at DESC LIMIT ${limit}
  `);
  return rowsOf(result);
}

export async function listAllowlist(tenantId: number): Promise<AllowlistEntry[]> {
  const result = await db.execute(sql`
    SELECT tenant_id AS "tenantId", address, status, added_by AS "addedBy",
           added_at AS "addedAt", last_seen_at AS "lastSeenAt", notes
    FROM inbox_sender_allowlist WHERE tenant_id = ${tenantId}
    ORDER BY status, address
  `);
  return rowsOf(result);
}

export async function touchLastSeen(tenantId: number, address: string): Promise<void> {
  const addr = normalizeAddress(address);
  if (!addr) return;
  try {
    await db.execute(sql`
      UPDATE inbox_sender_allowlist SET last_seen_at = NOW() WHERE tenant_id = ${tenantId} AND address = ${addr}
    `);
  } catch (_e) { logSilentCatch("server/inbox-quarantine.ts", _e); }
}
