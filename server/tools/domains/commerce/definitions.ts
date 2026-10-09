/**
 * Commerce domain — Sell & Fulfill slice. Three OWNER-ONLY tools that close
 * the loop from "agent built a digital product" to "customer can pay and get
 * it auto-fulfilled": register a product in the DB catalog, list catalog
 * entries, and mint a Stripe Payment Link for a registered SKU. Deliberately
 * EXCLUDED: any tool that delivers files directly or mutates prices on
 * existing Stripe objects — delivery only ever happens via the webhook →
 * deliverDigitalProduct() pipeline keyed on a paid Stripe session.
 */

import type { ToolDefinition } from "../../types";

export const productListingCreateDefinition: ToolDefinition = {
  type: "function",
  function: {
    name: "product_listing_create",
    description: "Register a sellable digital product in the commerce catalog (DB-backed extension of the built-in static catalog). Owner-only. kind='static' ships a pre-built file (must live under project-assets/, uploads/, or data/products/ and exist on disk); kind='service' generates the artifact post-payment via a fulfillment pipeline (serviceType 'research-report' or 'readiness-audit'). Creates NO Stripe objects and takes NO payment — follow up with create_payment_link to make it buyable. Price is in cents, $0.50–$5,000.",
    parameters: {
      type: "object",
      properties: {
        sku: { type: "string", description: "Unique SKU: 3-64 chars, lowercase letters/digits/hyphens, e.g. 'vc-focus-planner-001'. Must not collide with the static catalog." },
        productName: { type: "string", description: "Customer-facing product name." },
        priceCents: { type: "number", description: "Price in cents (50–500000)." },
        tagline: { type: "string", description: "One-line hook (optional)." },
        description: { type: "string", description: "Longer sales description (optional)." },
        kind: { type: "string", enum: ["static", "service"], description: "'static' = ship a pre-built file; 'service' = generate post-payment." },
        serviceType: { type: "string", enum: ["research-report", "readiness-audit"], description: "Required for kind='service': which fulfillment pipeline runs after payment." },
        primaryFileName: { type: "string", description: "For static products: the delivered file name, e.g. 'focus-planner.html'." },
        primaryFilePath: { type: "string", description: "For static products: project-relative path under project-assets/, uploads/, or data/products/." },
        primaryMimeType: { type: "string", description: "For static products: MIME type, e.g. 'text/html' or 'application/pdf'." },
        missionId: { type: "number", description: "Optional Verified Revenue Mission id this product belongs to (evidence attribution)." },
        postPurchaseSequenceId: { type: "number", description: "Optional outreach sequence id to enroll the buyer in after successful delivery (customer-success follow-up)." },
      },
      required: ["sku", "productName", "priceCents", "kind"],
    },
  },
};

export const productListingListDefinition: ToolDefinition = {
  type: "function",
  function: {
    name: "product_listing_list",
    description: "List commerce catalog products registered via product_listing_create (DB catalog): SKU, name, price, kind, Stripe payment-link URL if minted, active flag. Owner-only, read-only. Use before creating a new listing (avoid duplicate SKUs) or to find the payment link for an existing product.",
    parameters: { type: "object", properties: {}, required: [] },
  },
};

export const createPaymentLinkDefinition: ToolDefinition = {
  type: "function",
  function: {
    name: "create_payment_link",
    description: "Mint a shareable Stripe Payment Link for a SKU already registered via product_listing_create. Owner-only, trusted personas only. Creates the Stripe product + price (idempotent: reuses previously saved Stripe refs) and a payment link whose metadata carries ONLY the bundle_sku — the webhook resolves the SKU server-side and auto-fulfills (static file delivery, or service generation into the owner review queue). Returns the live payment URL to share with customers.",
    parameters: {
      type: "object",
      properties: {
        sku: { type: "string", description: "The registered commerce-catalog SKU to make buyable." },
      },
      required: ["sku"],
    },
  },
};

export const commerceDomainDefinitions: ToolDefinition[] = [
  productListingCreateDefinition,
  productListingListDefinition,
  createPaymentLinkDefinition,
];
