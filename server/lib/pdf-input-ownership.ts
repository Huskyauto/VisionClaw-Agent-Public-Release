import path from "node:path";
import { randomUUID } from "node:crypto";
import { UPLOADS_DIR } from "../uploads-path";

type StoredPdf = { data: string; storageKey?: string | null; size?: number };
type StoredPdfLookup = (filename: string, tenantId: number) => Promise<StoredPdf[]>;
type OwnedDownload = (tenantId: number, storageKey: string) => Promise<Uint8Array>;
const MAX_BASE64_CHARS = 70 * 1024 * 1024;
const MAX_PDF_BYTES = 50 * 1024 * 1024;

function pdfTenant(tenantId: number): number {
  if (!Number.isSafeInteger(tenantId) || tenantId <= 0) throw new Error("PDF tenantId is required");
  return tenantId;
}

function uploadFilename(input: string): string {
  if (typeof input !== "string" || !input || /[\\\u0000-\u001f\u007f]/.test(input) ||
      input.split("/").some(part => part === "." || part === "..")) {
    throw new Error("PDF input must identify an owned upload");
  }
  let name = input;
  if (input.startsWith("/uploads/") || input.startsWith("uploads/")) {
    name = input.replace(/^\/?uploads\//, "");
  } else if (path.isAbsolute(input)) {
    const relative = path.relative(UPLOADS_DIR, input);
    if (relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("PDF input must identify an owned upload");
    name = relative;
  }
  if (!name || name.includes("/") || name === "." || name === "..") throw new Error("PDF input must identify an owned upload");
  return name;
}

async function lookupStoredPdf(filename: string, tenantId: number): Promise<StoredPdf[]> {
  const [{ db }, { and, eq }, { fileStorage }] = await Promise.all([
    import("../db"), import("drizzle-orm"), import("../../shared/schema"),
  ]);
  return db.select({ data: fileStorage.data, storageKey: fileStorage.storageKey, size: fileStorage.size }).from(fileStorage)
    .where(and(eq(fileStorage.filename, filename), eq(fileStorage.tenantId, tenantId))).limit(2);
}

async function downloadStoredPdf(tenantId: number, storageKey: string): Promise<Uint8Array> {
  const { downloadTenantFile } = await import("../object-storage");
  return downloadTenantFile(tenantId, storageKey);
}

/** Authorize before reading bytes; filesystem paths and signed tid claims are not ownership. */
export async function readTenantPdfInput(
  input: string, tenantId: number, lookup: StoredPdfLookup = lookupStoredPdf,
  download: OwnedDownload = downloadStoredPdf,
): Promise<Uint8Array> {
  const tid = pdfTenant(tenantId), filename = uploadFilename(input);
  const rows = await lookup(filename, tid);
  if (rows.length !== 1) throw new Error("PDF input must identify an owned upload");
  const row = rows[0];
  if (row.storageKey) {
    if (typeof row.storageKey !== "string" || !row.storageKey.startsWith(`tenant-${tid}/`))
      throw new Error("PDF input must identify an owned upload");
    if (!Number.isSafeInteger(row.size) || row.size! <= 0 || row.size! > MAX_PDF_BYTES)
      throw new Error("Invalid or oversized stored PDF");
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const bytes = await Promise.race([
        download(tid, row.storageKey),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error("Stored PDF download timed out")), 30_000);
        }),
      ]);
      if (!(bytes instanceof Uint8Array) || bytes.byteLength !== row.size || bytes.byteLength > MAX_PDF_BYTES)
        throw new Error("Invalid or oversized stored PDF");
      return bytes;
    } finally { if (timer) clearTimeout(timer); }
  }
  const data = row.data;
  if (typeof data !== "string" || !data || data.length > MAX_BASE64_CHARS)
    throw new Error("Invalid or oversized stored PDF");
  const bytes = Buffer.from(data, "base64");
  if (!bytes.length || bytes.length > MAX_PDF_BYTES) throw new Error("Invalid or oversized stored PDF");
  return bytes;
}

export function uniquePdfOutputName(requested: string, tenantId: number): string {
  const tid = pdfTenant(tenantId);
  const leaf = path.basename(requested).replace(/[^a-zA-Z0-9._-]/g, "_").slice(-100);
  const pdfName = /\.pdf$/i.test(leaf) ? leaf : `${leaf || "document"}.pdf`;
  return `pdf-${tid}-${randomUUID()}-${pdfName}`;
}
