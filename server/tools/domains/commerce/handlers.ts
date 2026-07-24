/**
 * Commerce domain handlers — Sell & Fulfill slice.
 *
 * All three tools gate on ctx.tenantId (dispatcher-derived, never params)
 * with the fail-closed owner-only check via ownerTenantId() (env-configurable
 * OWNER_TENANT_ID single source of truth) — mirrors the revenue-missions
 * domain pattern.
 *
 * Backing lib (`server/lib/commerce-catalog`) and the Stripe client are
 * pulled via call-time dynamic import — NOT top-level static imports — so the
 * domain module statically imports only within server/tools/ (acyclicity
 * invariant, tools-layer-split plan.md S2).
 *
 * SAFETY CONTRACT: create_payment_link puts ONLY the SKU in Stripe metadata —
 * never file paths — so a misconfigured/forged Stripe object cannot point
 * delivery at an arbitrary file. File-path validation happens at registration
 * AND at webhook lookup time (lib enforces both).
 */

import { defineTool } from "../../define-tool";
import type { RegisteredTool, ToolContext, ToolResult } from "../../types";
import {
  productListingCreateDefinition,
  productListingListDefinition,
  createPaymentLinkDefinition,
} from "./definitions";

async function ownerGate(ctx: ToolContext, toolName: string): Promise<{ tenantId: number } | { error: string }> {
  if (!ctx.tenantId) return { error: "Tenant context required" };
  const tenantId = ctx.tenantId as number;
  const { ownerTenantId } = await import("../../../agentic/autonomous-budget");
  if (tenantId !== ownerTenantId()) return { error: `${toolName} is owner-only (the storefront and Stripe account belong to the platform owner)` };
  return { tenantId };
}

async function productListingCreateHandler(
  params: Record<string, any>,
  ctx: ToolContext,
): Promise<ToolResult> {
  const gate = await ownerGate(ctx, "product_listing_create");
  if ("error" in gate) return gate;
  try {
    const { registerProduct } = await import("../../../lib/commerce-catalog");
    const row = await registerProduct({
      tenantId: gate.tenantId,
      sku: String(params.sku || ""),
      productName: String(params.productName || ""),
      priceCents: Number(params.priceCents),
      tagline: typeof params.tagline === "string" ? params.tagline : undefined,
      description: typeof params.description === "string" ? params.description : undefined,
      kind: params.kind === "service" ? "service" : "static",
      serviceType: typeof params.serviceType === "string" ? params.serviceType : undefined,
      primaryFileName: typeof params.primaryFileName === "string" ? params.primaryFileName : undefined,
      primaryFilePath: typeof params.primaryFilePath === "string" ? params.primaryFilePath : undefined,
      primaryMimeType: typeof params.primaryMimeType === "string" ? params.primaryMimeType : undefined,
      missionId: Number.isSafeInteger(Number(params.missionId)) && Number(params.missionId) > 0 ? Number(params.missionId) : undefined,
      postPurchaseSequenceId: Number.isSafeInteger(Number(params.postPurchaseSequenceId)) && Number(params.postPurchaseSequenceId) > 0 ? Number(params.postPurchaseSequenceId) : undefined,
    });
    return {
      product: { id: row.id, sku: row.sku, productName: row.product_name, priceCents: row.price_cents, kind: row.kind, serviceType: row.service_type },
      note: "Listing registered. It is NOT buyable yet — run create_payment_link with this SKU to mint the Stripe payment link.",
    };
  } catch (err: any) {
    return { error: `product_listing_create failed: ${err.message}` };
  }
}

async function productListingListHandler(
  _params: Record<string, any>,
  ctx: ToolContext,
): Promise<ToolResult> {
  const gate = await ownerGate(ctx, "product_listing_list");
  if ("error" in gate) return gate;
  try {
    const { listProducts } = await import("../../../lib/commerce-catalog");
    const products = await listProducts(gate.tenantId);
    return { count: products.length, products };
  } catch (err: any) {
    return { error: `product_listing_list failed: ${err.message}` };
  }
}

async function createPaymentLinkHandler(
  params: Record<string, any>,
  ctx: ToolContext,
): Promise<ToolResult> {
  const gate = await ownerGate(ctx, "create_payment_link");
  if ("error" in gate) return gate;
  const sku = String(params.sku || "").trim().toLowerCase();
  if (!sku) return { error: "create_payment_link requires a sku" };
  try {
    const { getProductBySku, saveStripeRefs } = await import("../../../lib/commerce-catalog");
    const row = await getProductBySku(gate.tenantId, sku);
    if (!row) return { error: `SKU '${sku}' is not registered — run product_listing_create first (static-catalog SKUs already have their own checkout paths)` };
    if (row.active === false) return { error: `SKU '${sku}' is inactive` };
    if (row.stripe_payment_link_url) {
      return { sku, paymentLinkUrl: row.stripe_payment_link_url, reused: true, note: "Existing payment link reused (idempotent)." };
    }

    const { getUncachableStripeClient, withLedgerIdempotency } = await import("../../../stripeClient");
    const stripe = await getUncachableStripeClient();

    let stripeProductId: string = row.stripe_product_id;
    if (!stripeProductId) {
      const product = await stripe.products.create({
        name: row.product_name,
        description: row.tagline || row.description || undefined,
        metadata: { bundle_sku: sku, source: "visionclaw-commerce" },
      }, withLedgerIdempotency({ idempotencyKey: `vc-commerce-product-${sku}` }));
      stripeProductId = product.id;
      await saveStripeRefs(gate.tenantId, sku, { productId: stripeProductId });
    }

    let stripePriceId: string = row.stripe_price_id;
    if (!stripePriceId) {
      const price = await stripe.prices.create({
        product: stripeProductId,
        unit_amount: row.price_cents,
        currency: "usd",
      }, withLedgerIdempotency({ idempotencyKey: `vc-commerce-price-${sku}-${row.price_cents}` }));
      stripePriceId = price.id;
      await saveStripeRefs(gate.tenantId, sku, { priceId: stripePriceId });
    }

    const link = await stripe.paymentLinks.create({
      line_items: [{ price: stripePriceId, quantity: 1 }],
      metadata: {
        bundle_sku: sku,
        ...(row.mission_id ? { mission_id: String(row.mission_id) } : {}),
      },
    }, withLedgerIdempotency({ idempotencyKey: `vc-commerce-paylink-${sku}` }));
    await saveStripeRefs(gate.tenantId, sku, { paymentLinkId: link.id, paymentLinkUrl: link.url });

    return {
      sku,
      paymentLinkUrl: link.url,
      stripeProductId,
      stripePriceId,
      note: "Live payment link created. Payments auto-fulfill via the Stripe webhook (static products deliver immediately; service products generate and land in the owner review queue).",
    };
  } catch (err: any) {
    return { error: `create_payment_link failed: ${err.message}` };
  }
}

/** Registered by ./index.ts at import time. */
export const commerceDomainTools: RegisteredTool[] = [
  defineTool(productListingCreateDefinition, productListingCreateHandler),
  defineTool(productListingListDefinition, productListingListHandler),
  defineTool(createPaymentLinkDefinition, createPaymentLinkHandler),
];
