import fs from "node:fs";
import path from "node:path";
import { sql } from "drizzle-orm";
import { signUploadUrl } from "./upload-signing";
import type { DeliveryRequest } from "./delivery-pipeline";

export function getDeliveryBaseUrl(): string {
  const domain = process.env.REPLIT_DEV_DOMAIN || process.env.REPLIT_DOMAINS?.split(",")[0] || "localhost:5000";
  const protocol = domain.includes("localhost") ? "http" : "https";
  return `${protocol}://${domain}`;
}

export async function publishToOwnServer(req: DeliveryRequest, deliveryId: number): Promise<{ link: string | null; fileStorageId: number | null; fallbackPersistenceError?: string }> {
  if (!Number.isInteger(req.tenantId) || (req.tenantId as number) <= 0) {
    throw new Error("publishToOwnServer requires a positive tenantId");
  }
  return publishOneFileToOwnServer({
    fileName: req.fileName,
    filePath: req.filePath,
    fileData: req.fileData,
  }, deliveryId, req.tenantId as number);
}

// Cap DB persistence at 25MB — file_storage holds base64 text; anything larger
// (raw video etc.) stays disk/Drive-only with a loud log so we know it won't
// survive a republish.
const MAX_DB_PERSIST_BYTES = 25 * 1024 * 1024;

async function persistDeliveryAssetToDb(publicName: string, originalName: string, absPath: string, tenantId: number, deliveryId: number): Promise<number | null> {
  try {
    const bytes = fs.readFileSync(absPath);
    if (bytes.length === 0) return null;
    if (bytes.length > MAX_DB_PERSIST_BYTES) {
      console.warn(`[delivery] #${deliveryId} ${publicName} is ${(bytes.length / 1048576).toFixed(1)}MB — too large for DB backup; link will NOT survive a republish.`);
      return null;
    }
    const ext = path.extname(publicName).toLowerCase();
    const mimeMap: Record<string, string> = {
      ".pdf": "application/pdf", ".zip": "application/zip", ".png": "image/png",
      ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".txt": "text/plain",
      ".csv": "text/csv", ".json": "application/json", ".md": "text/markdown",
      ".html": "text/html", ".mp4": "video/mp4", ".mp3": "audio/mpeg",
      ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    };
    const { db } = await import("./db");
    const { fileStorage } = await import("@shared/schema");
    const values = {
      originalName,
      mimeType: mimeMap[ext] || "application/octet-stream",
      size: bytes.length,
      data: bytes.toString("base64"),
    };
    // Atomic upsert on the (tenant_id, filename) unique index — a retried
    // delivery or concurrent republish of the same asset can never duplicate.
    const [stored] = await db.insert(fileStorage)
      .values({ filename: publicName, tenantId, ...values })
      .onConflictDoUpdate({
        target: [fileStorage.tenantId, fileStorage.filename],
        // Matches the partial unique index file_storage_delivery_asset_uidx
        // (publicName is always "delivery-<id>-<name>").
        targetWhere: sql`filename LIKE 'delivery-%'`,
        set: values,
      }).returning({ id: fileStorage.id });
    if (!stored) throw new Error("DB asset persistence did not return a file ID");
    console.log(`[delivery] #${deliveryId} persisted ${publicName} to DB (${bytes.length} bytes) — survives republish.`);
    return stored.id;
  } catch (err: any) {
    console.error(`[delivery] #${deliveryId} DB persist FAILED for ${publicName} (disk copy intact): ${err.message}`);
    throw new Error(`Durable file-storage fallback could not be persisted: ${err.message}`);
  }
}

export async function publishOneFileToOwnServer(file: { fileName: string; filePath?: string; fileData?: Buffer }, deliveryId: number, tenantId: number): Promise<{ link: string | null; fileStorageId: number | null; fallbackPersistenceError?: string }> {
  try {
    const cwd = process.cwd();
    const uploadsDir = path.resolve(cwd, "uploads");
    if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
    const safeName = file.fileName.replace(/[^a-zA-Z0-9._-]/g, "_");
    const publicName = `delivery-${deliveryId}-${safeName}`;
    const dest = path.resolve(uploadsDir, publicName);

    if (file.fileData) {
      fs.writeFileSync(dest, file.fileData);
    } else if (file.filePath) {
      let candidate = file.filePath;
      if (candidate.startsWith("/uploads/") || candidate.startsWith("/attached_assets/") || candidate.startsWith("/stress-test-output/")) {
        candidate = candidate.slice(1);
      }
      const src = path.resolve(cwd, candidate);
      if (!src.startsWith(cwd + path.sep) || !fs.existsSync(src)) return { link: null, fileStorageId: null };
      if (src !== dest) fs.copyFileSync(src, dest);
    } else {
      return { link: null, fileStorageId: null };
    }

    // Republish durability (2026-08-14): /uploads is ephemeral on the prod FS
    // (resets on every publish), which used to 404 customer delivery links
    // after a deploy. Persist the published bytes to file_storage so the
    // /uploads route's DB fallback keeps serving them. This returns the
    // tenant-scoped backup row so a durable artifact can refer to it.
    let fileStorageId: number | null = null;
    let fallbackPersistenceError: string | undefined;
    try {
      fileStorageId = await persistDeliveryAssetToDb(publicName, file.fileName, dest, tenantId, deliveryId);
    } catch (error) {
      fallbackPersistenceError = error instanceof Error ? error.message : "Durable file-storage fallback could not be persisted";
    }

    // R74.13e — sign the URL so the /uploads/ auth gate accepts it without a
    // session cookie. Without this the customer gets {"error":"Authentication
    // required"} on every play/download attempt.
    // NOTE: we request 90 days here, but signUploadUrl() hard-clamps any ttl to
    // MAX_TTL_MS (7 days) as a leak-blast-radius bound — so the EFFECTIVE link
    // life is 7 days, not 90. If durable-delivery links are a product
    // requirement, raise the bound deliberately in upload-signing.ts (a security
    // tradeoff) rather than relying on this larger request value.
    // Uses static ESM import (signUploadUrl) at top of file — earlier require()
    // attempt failed with "require is not defined" in ESM context.
    try {
      const REQUESTED_TTL_MS = 90 * 24 * 60 * 60 * 1000; // clamped to MAX_TTL_MS (7d) by the signer
      // tid is part of the HMAC payload only — delivery assets carry no
      // file_storage owner row, so the /uploads gate authorizes them purely by
      // the signed capability URL (see routes.ts delivery-asset branch), never
      // by this tid. We still thread the real delivery tenant (defaults to the
      // owner/admin tenant 1) for telemetry + forward-correctness.
      const signed = signUploadUrl(publicName, tenantId, REQUESTED_TTL_MS);
      return { link: `${getDeliveryBaseUrl()}${signed}`, fileStorageId, fallbackPersistenceError };
    } catch (signErr: any) {
      // R98.22+sec — fail-closed. Previously fell back to an unsigned URL,
      // which bypassed the /uploads/ auth gate and could leak the file
      // publicly. Now we surface the failure so delivery retries and the
      // caller can alert; never ship an unauthenticated download URL.
      console.error(`[delivery] #${deliveryId} signing FAILED (${signErr.message}) — refusing to ship unsigned URL`);
      return { link: null, fileStorageId, fallbackPersistenceError };
    }
  } catch (err: any) {
    console.warn(`[delivery] #${deliveryId} publishOneFileToOwnServer failed for ${file.fileName}: ${err.message}`);
    return { link: null, fileStorageId: null };
  }
}