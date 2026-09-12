import { db } from "./db";
import { sql } from "drizzle-orm";
import * as baileysModule from "@whiskeysockets/baileys";
import { encryptApiKey, decryptApiKey } from "./crypto";

const baileys = (baileysModule as any).default || baileysModule;
const { initAuthCreds, proto, BufferJSON } = baileys;

let tableReady = false;

async function ensureTable(): Promise<void> {
  if (tableReady) return;
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS whatsapp_auth (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )
  `);
  tableReady = true;
}

function tenantKey(key: string, tenantId?: number): string {
  if (tenantId != null) return `t${tenantId}_${key}`;
  return key;
}

// R74.13d C2: encrypt the WhatsApp/Baileys session creds (Signal protocol
// keys, identity keys, signed pre-keys) at rest using AES-256-GCM. These are
// equivalent in security weight to a password — leakage = full WhatsApp
// account takeover. decryptApiKey is backward compatible: legacy plaintext
// rows pass through unchanged, then get re-encrypted on next save.
async function dbGet(key: string): Promise<any | null> {
  await ensureTable();
  const result = await db.execute(sql`SELECT value FROM whatsapp_auth WHERE key = ${key}`);
  const rows = (result as any).rows || result;
  if (rows?.[0]?.value) {
    try {
      const plain = decryptApiKey(rows[0].value);
      return JSON.parse(plain, BufferJSON.reviver);
    } catch {
      return null;
    }
  }
  return null;
}

async function dbSet(key: string, value: any): Promise<void> {
  await ensureTable();
  const json = JSON.stringify(value, BufferJSON.replacer);
  const encrypted = encryptApiKey(json);
  await db.execute(sql`
    INSERT INTO whatsapp_auth (key, value)
    VALUES (${key}, ${encrypted})
    ON CONFLICT (key) DO UPDATE SET value = ${encrypted}
  `);
}

async function dbDelete(key: string): Promise<void> {
  await ensureTable();
  await db.execute(sql`DELETE FROM whatsapp_auth WHERE key = ${key}`);
}

export async function useDbAuthState(tenantId?: number) {
  await ensureTable();

  const credsKey = tenantKey("creds", tenantId);
  const storedCreds = await dbGet(credsKey);
  const creds = storedCreds || initAuthCreds();

  return {
    state: {
      creds,
      keys: {
        get: async (type: string, ids: string[]) => {
          const result: Record<string, any> = {};
          for (const id of ids) {
            const val = await dbGet(tenantKey(`keys_${type}_${id}`, tenantId));
            if (val) result[id] = val;
          }
          return result;
        },
        set: async (data: Record<string, Record<string, any>>) => {
          for (const [type, entries] of Object.entries(data)) {
            for (const [id, value] of Object.entries(entries)) {
              if (value) {
                await dbSet(tenantKey(`keys_${type}_${id}`, tenantId), value);
              } else {
                await dbDelete(tenantKey(`keys_${type}_${id}`, tenantId));
              }
            }
          }
        },
      },
    },
    saveCreds: async () => {
      await dbSet(credsKey, creds);
    },
  };
}

export async function clearDbAuthState(tenantId?: number): Promise<void> {
  await ensureTable();
  if (tenantId != null) {
    const prefix = `t${tenantId}_%`;
    await db.execute(sql`DELETE FROM whatsapp_auth WHERE key LIKE ${prefix}`);
  } else {
    await db.execute(sql`DELETE FROM whatsapp_auth WHERE key NOT LIKE 't%'`);
  }
}

export async function hasStoredSession(tenantId?: number): Promise<boolean> {
  try {
    const creds = await dbGet(tenantKey("creds", tenantId));
    return !!(creds?.me?.id);
  } catch {
    return false;
  }
}

export async function getStoredTenantIds(): Promise<number[]> {
  await ensureTable();
  const result = await db.execute(sql`SELECT DISTINCT key FROM whatsapp_auth WHERE key LIKE 't%_creds'`);
  const rows = (result as any).rows || result;
  const ids: number[] = [];
  for (const row of rows || []) {
    const match = row.key?.match(/^t(\d+)_creds$/);
    if (match) ids.push(parseInt(match[1]));
  }
  return ids;
}
