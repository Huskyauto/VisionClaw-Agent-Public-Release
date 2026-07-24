/**
 * Commerce catalog lib — DB-backed extension of the static product catalog
 * (server/product-catalog.ts). Owner-approved agents register sellable digital
 * products here via the commerce tools; the Stripe webhook resolves SKUs via
 * lookupAnyProduct() (static CATALOG first — it stays the trusted, code-reviewed
 * source — then DB rows created by the owner-only tools).
 *
 * SAFETY: file paths are validated with the same escape-proof project-root
 * check as the static catalog, at BOTH registration time and lookup time (the
 * file could vanish between the two). Stripe metadata never carries paths —
 * only the SKU — so a forged webhook can't point delivery at an arbitrary file.
 */
import path from "path";
import fs from "fs";
import { db } from "../db";
import { sql } from "drizzle-orm";
import { lookupProduct, type CatalogProduct, type IntakeField } from "../product-catalog";
import type { BundleFile } from "../delivery-pipeline";

const PROJECT_ROOT = process.cwd();
// Only these roots may hold sellable files — keeps agent-registered products
// out of server code, secrets, and config even though they're inside the repo.
const ALLOWED_FILE_ROOTS = ["project-assets/", "uploads/", "data/products/"];

export function validateSellableFilePath(relPath: string): string {
  const clean = String(relPath || "").trim();
  if (!clean) throw new Error("Empty file path");
  const abs = path.resolve(PROJECT_ROOT, clean);
  if (!abs.startsWith(PROJECT_ROOT + path.sep)) {
    throw new Error(`File path escapes project root: ${clean}`);
  }
  const rel = path.relative(PROJECT_ROOT, abs).replace(/\\/g, "/");
  if (!ALLOWED_FILE_ROOTS.some(root => rel.startsWith(root))) {
    throw new Error(`Sellable files must live under ${ALLOWED_FILE_ROOTS.join(" or ")} (got: ${rel})`);
  }
  if (rel.split("/").some(seg => seg.startsWith("."))) {
    throw new Error(`Dotfile path segments are not sellable: ${rel}`);
  }
  if (!fs.existsSync(abs)) throw new Error(`File does not exist on disk: ${rel}`);
  return rel;
}

const VALID_SERVICE_TYPES = new Set(["research-report", "readiness-audit"]);
const SKU_RE = /^[a-z0-9][a-z0-9-]{2,63}$/;

export interface RegisterProductInput {
  tenantId: number;
  sku: string;
  productName: string;
  priceCents: number;
  tagline?: string;
  description?: string;
  kind: "static" | "service";
  serviceType?: string;
  primaryFileName?: string;
  primaryFilePath?: string;
  primaryMimeType?: string;
  additionalFiles?: BundleFile[];
  intakeFields?: IntakeField[];
  missionId?: number;
  postPurchaseSequenceId?: number;
}

export async function registerProduct(input: RegisterProductInput) {
  const sku = String(input.sku || "").trim().toLowerCase();
  if (!SKU_RE.test(sku)) throw new Error("SKU must be 3-64 chars of lowercase letters, digits, and hyphens");
  if (lookupStaticSafe(sku)) throw new Error(`SKU '${sku}' collides with the built-in static catalog`);
  if (!input.productName?.trim()) throw new Error("productName is required");
  const priceCents = Number(input.priceCents);
  if (!Number.isSafeInteger(priceCents) || priceCents < 50 || priceCents > 500000) {
    throw new Error("priceCents must be an integer between 50 ($0.50) and 500000 ($5,000)");
  }
  if (input.kind === "service") {
    if (!VALID_SERVICE_TYPES.has(String(input.serviceType))) {
      throw new Error(`Service products require serviceType one of: ${[...VALID_SERVICE_TYPES].join(", ")}`);
    }
  } else if (input.kind === "static") {
    if (!input.primaryFilePath || !input.primaryFileName || !input.primaryMimeType) {
      throw new Error("Static products require primaryFileName, primaryFilePath, and primaryMimeType");
    }
    validateSellableFilePath(input.primaryFilePath);
    for (const f of input.additionalFiles || []) {
      if (f.filePath) validateSellableFilePath(f.filePath);
    }
  } else {
    throw new Error("kind must be 'static' or 'service'");
  }

  const additionalFilesJson = JSON.stringify(input.additionalFiles || []);
  const intakeFieldsJson = JSON.stringify(input.intakeFields || []);
  const result = await db.execute(sql`
    INSERT INTO commerce_products
      (tenant_id, sku, product_name, price_cents, tagline, description, kind, service_type,
       primary_file_name, primary_file_path, primary_mime_type, additional_files, intake_fields,
       mission_id, post_purchase_sequence_id)
    VALUES
      (${input.tenantId}, ${sku}, ${input.productName.trim()}, ${priceCents},
       ${(input.tagline || "").trim()}, ${(input.description || "").trim()},
       ${input.kind}, ${input.serviceType || null},
       ${input.primaryFileName || null}, ${input.primaryFilePath || null}, ${input.primaryMimeType || null},
       ${additionalFilesJson}::jsonb, ${intakeFieldsJson}::jsonb,
       ${input.missionId ?? null}, ${input.postPurchaseSequenceId ?? null})
    ON CONFLICT (sku) DO NOTHING
    RETURNING *
  `);
  const row = (result as any).rows?.[0];
  if (!row) throw new Error(`SKU '${sku}' already exists in commerce_products`);
  return row;
}

export async function listProducts(tenantId: number) {
  const result = await db.execute(sql`
    SELECT id, sku, product_name, price_cents, kind, service_type, mission_id,
           post_purchase_sequence_id, stripe_payment_link_url, active, created_at
    FROM commerce_products WHERE tenant_id = ${tenantId} ORDER BY id DESC LIMIT 100
  `);
  return (result as any).rows || [];
}

export async function getProductBySku(tenantId: number, sku: string) {
  const result = await db.execute(sql`
    SELECT * FROM commerce_products WHERE tenant_id = ${tenantId} AND sku = ${sku} LIMIT 1
  `);
  return (result as any).rows?.[0] || null;
}

export async function saveStripeRefs(tenantId: number, sku: string, refs: { productId?: string; priceId?: string; paymentLinkId?: string; paymentLinkUrl?: string }) {
  await db.execute(sql`
    UPDATE commerce_products SET
      stripe_product_id = COALESCE(${refs.productId ?? null}, stripe_product_id),
      stripe_price_id = COALESCE(${refs.priceId ?? null}, stripe_price_id),
      stripe_payment_link_id = COALESCE(${refs.paymentLinkId ?? null}, stripe_payment_link_id),
      stripe_payment_link_url = COALESCE(${refs.paymentLinkUrl ?? null}, stripe_payment_link_url),
      updated_at = NOW()
    WHERE tenant_id = ${tenantId} AND sku = ${sku}
  `);
}

function lookupStaticSafe(sku: string): CatalogProduct | null {
  try { return lookupProduct(sku); } catch { return null; }
}

function rowToCatalogProduct(row: any): CatalogProduct {
  const product: CatalogProduct = {
    sku: row.sku,
    productName: row.product_name,
    priceCents: row.price_cents,
    tagline: row.tagline || "",
    description: row.description || "",
    kind: row.kind === "service" ? "service" : "static",
    serviceType: row.service_type || undefined,
    intakeFields: Array.isArray(row.intake_fields) ? row.intake_fields : undefined,
  };
  if (row.primary_file_path && row.primary_file_name && row.primary_mime_type) {
    product.primary = {
      fileName: row.primary_file_name,
      filePath: row.primary_file_path,
      mimeType: row.primary_mime_type,
    };
  }
  const additional = Array.isArray(row.additional_files) ? row.additional_files : [];
  if (additional.length) product.additionalFiles = additional;
  return product;
}

/**
 * Unified SKU resolution for the webhook fulfillment bridge: static CATALOG
 * first (throws on missing files exactly like before), then active DB rows.
 * Static-file paths from DB rows are re-validated at lookup time (fail closed).
 */
export async function lookupAnyProduct(tenantId: number, sku: string): Promise<CatalogProduct | null> {
  const staticProduct = lookupProduct(sku);
  if (staticProduct) return staticProduct;
  const row = await getProductBySku(tenantId, sku);
  if (!row || row.active === false) return null;
  const product = rowToCatalogProduct(row);
  if (product.kind !== "service") {
    if (!product.primary) throw new Error(`Static commerce product ${sku} has no primary file`);
    validateSellableFilePath(product.primary.filePath);
    for (const f of product.additionalFiles || []) {
      if (f.filePath) validateSellableFilePath(f.filePath);
    }
  }
  return product;
}
