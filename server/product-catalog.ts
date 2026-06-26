import path from 'path';
import fs from 'fs';
import type { BundleFile } from './delivery-pipeline';

export interface IntakeField {
  key: string;
  label: string;
  placeholder?: string;
  type: 'text' | 'textarea' | 'select';
  required?: boolean;
  maxLength?: number;
  options?: { value: string; label: string }[];
}

export interface CatalogProduct {
  sku: string;
  productName: string;
  priceCents: number;
  tagline: string;
  description: string;
  kind?: 'static' | 'service';
  serviceType?: 'research-report';
  intakeFields?: IntakeField[];
  primary?: { fileName: string; filePath: string; mimeType: string };
  additionalFiles?: BundleFile[];
}

export interface PublicCatalogEntry {
  sku: string;
  productName: string;
  priceCents: number;
  priceFormatted: string;
  tagline: string;
  description: string;
  kind: 'static' | 'service';
  intakeFields?: IntakeField[];
  fileCount: number;
  primaryFileName: string;
  primaryFileType: string;
}

const PROJECT_ROOT = process.cwd();

function resolveAndCheck(relPath: string): string {
  const abs = path.resolve(PROJECT_ROOT, relPath);
  if (!abs.startsWith(PROJECT_ROOT)) throw new Error(`Catalog path escapes project root: ${relPath}`);
  if (!fs.existsSync(abs)) throw new Error(`Catalog file does not exist on disk: ${relPath}`);
  return relPath;
}

// CI fixture SKU — one sample product registered so the security/e2e test
// suite (checkout-idempotency.test.ts and friends) can exercise the full
// /api/store/checkout flow against a real catalog entry. The mirror's
// stage-2 sed scrub rewrites the proprietary test SKU literal in the test
// files to this neutral one; this entry must match the post-scrub value.
// The primary file is a tiny on-disk stub written by
// tests/fixtures/seed-catalog-files.ts before the test step runs.
const CATALOG: Record<string, CatalogProduct> = {
  'sample-test-sku-050': {
    sku: 'sample-test-sku-050',
    productName: 'Sample Public Mirror Product',
    priceCents: 100,
    tagline: 'CI fixture — not a real product.',
    description: 'Sample SKU registered in the public mirror so the bundled security/e2e checkout-idempotency tests can exercise the full /api/store/checkout flow. Replace this entry (or empty the CATALOG) before deploying your own fork.',
    kind: 'static',
    primary: { fileName: 'sample.html', filePath: 'project-assets/sample.html', mimeType: 'text/html' },
  },
  'sample-test-service-sku-001': {
    sku: 'sample-test-service-sku-001',
    productName: 'Sample Public Mirror Service',
    priceCents: 100,
    tagline: 'CI fixture — service-kind SKU. Not a real product.',
    description: 'Service-kind sample SKU registered in the public mirror so the bundled storefront-checkout-intake test can exercise the intake-field validation path. Replace this entry before deploying your own fork.',
    kind: 'service',
    serviceType: 'research-report',
    intakeFields: [
      { key: 'topic', label: 'Topic', type: 'textarea', required: true, maxLength: 400, placeholder: 'Sample topic field — required.' },
      { key: 'audience', label: 'Audience', type: 'text', required: false, maxLength: 200 },
      { key: 'focus', label: 'Focus', type: 'text', required: false, maxLength: 300 },
      { key: 'depth', label: 'Depth', type: 'select', required: false, options: [
        { value: 'standard', label: 'Standard' },
        { value: 'deep', label: 'Deep' },
      ]},
    ],
  },
};

export function listPublicCatalog(): PublicCatalogEntry[] {
  return Object.values(CATALOG).map(p => ({
    sku: p.sku,
    productName: p.productName,
    priceCents: p.priceCents,
    priceFormatted: `$${(p.priceCents / 100).toFixed(2)}`,
    tagline: p.tagline,
    description: p.description,
    kind: p.kind ?? 'static',
    intakeFields: p.intakeFields,
    fileCount: p.primary ? 1 + (p.additionalFiles?.length ?? 0) : 0,
    primaryFileName: p.primary?.fileName ?? '',
    primaryFileType: p.primary?.mimeType ?? '',
  }));
}

export function getCatalogProduct(sku: string): CatalogProduct | undefined {
  return CATALOG[sku];
}

export function isValidSku(sku: string): boolean {
  return sku in CATALOG;
}

// R98.26.5 — exports referenced by routes/, coinbase-commerce, webhookHandlers.
// Mirrored from server/product-catalog.ts so the stubbed mirror still
// type-checks under `tsc --noEmit` and esbuild bundles cleanly.
export function lookupProduct(sku: string): CatalogProduct | null {
  if (!Object.hasOwn(CATALOG, sku)) return null;
  return CATALOG[sku] ?? null;
}

export function listSkus(): string[] {
  return Object.keys(CATALOG);
}

export function getPublicCatalog(): PublicCatalogEntry[] {
  return listPublicCatalog();
}
