import { Client } from "@replit/object-storage";
import crypto from "crypto";
import path from "path";

const client = new Client();

function tenantPrefix(tenantId: number): string {
  return `tenant-${tenantId}`;
}

function buildKey(tenantId: number, category: string, filename: string): string {
  return `${tenantPrefix(tenantId)}/${category}/${filename}`;
}

function generateUniqueFilename(originalName: string): string {
  const ext = path.extname(originalName);
  const base = path.basename(originalName, ext).replace(/[^a-zA-Z0-9_-]/g, "_").substring(0, 50);
  const unique = crypto.randomBytes(8).toString("hex");
  const timestamp = Date.now();
  return `${timestamp}_${unique}_${base}${ext}`;
}

export async function uploadTenantFile(
  tenantId: number,
  category: string,
  originalName: string,
  data: Buffer,
): Promise<{ storageKey: string; uniqueFilename: string }> {
  const uniqueFilename = generateUniqueFilename(originalName);
  const storageKey = buildKey(tenantId, category, uniqueFilename);
  await client.uploadFromBytes(storageKey, data);
  return { storageKey, uniqueFilename };
}

export async function downloadTenantFile(
  tenantId: number,
  storageKey: string,
): Promise<Buffer> {
  if (!storageKey.startsWith(tenantPrefix(tenantId) + "/")) {
    throw new Error("Access denied: file does not belong to this tenant");
  }
  const { value, ok } = await (client as any).downloadAsBytes(storageKey);
  if (!ok || !value) {
    throw new Error("File not found in storage");
  }
  return Buffer.from(value);
}

export async function deleteTenantFile(
  tenantId: number,
  storageKey: string,
): Promise<void> {
  if (!storageKey.startsWith(tenantPrefix(tenantId) + "/")) {
    throw new Error("Access denied: file does not belong to this tenant");
  }
  await client.delete(storageKey);
}

export async function listTenantFiles(
  tenantId: number,
  category?: string,
): Promise<string[]> {
  const prefix = category
    ? `${tenantPrefix(tenantId)}/${category}/`
    : `${tenantPrefix(tenantId)}/`;
  const result = await client.list({ prefix });
  if (!result.ok || !result.value) return [];
  return result.value.map((obj: any) => obj.key || obj.name || obj);
}

export { client as objectStorageClient };
