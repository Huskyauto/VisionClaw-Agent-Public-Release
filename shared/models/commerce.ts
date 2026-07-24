// ============================================================
// COMMERCE PRODUCTS — Sell & Fulfill slice (contract:
// data/feature-contracts/revenue-missions, S6). DB-backed extension of the
// static server/product-catalog.ts CATALOG so owner-approved agents can
// register new sellable digital products at runtime. The webhook fulfillment
// bridge treats these rows as trusted server-side product records — Stripe
// metadata only ever carries the SKU, never file paths.
// ============================================================
import { sql } from "drizzle-orm";
import { pgTable, serial, text, integer, boolean, timestamp, jsonb, index, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const commerceProducts = pgTable("commerce_products", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull(),
  sku: text("sku").notNull(),
  productName: text("product_name").notNull(),
  priceCents: integer("price_cents").notNull(),
  tagline: text("tagline").notNull().default(""),
  description: text("description").notNull().default(""),
  // 'static' = ship pre-built file(s); 'service' = generate artifact post-payment
  kind: text("kind").notNull().default("static"),
  // for service products: which fulfillment pipeline ('research-report' | 'readiness-audit')
  serviceType: text("service_type"),
  primaryFileName: text("primary_file_name"),
  primaryFilePath: text("primary_file_path"),
  primaryMimeType: text("primary_mime_type"),
  additionalFiles: jsonb("additional_files").default(sql`'[]'::jsonb`),
  intakeFields: jsonb("intake_fields").default(sql`'[]'::jsonb`),
  // optional Verified Revenue Mission this product belongs to (evidence attribution)
  missionId: integer("mission_id"),
  // optional post-purchase customer-success sequence (outreach_sequences.id)
  postPurchaseSequenceId: integer("post_purchase_sequence_id"),
  // Stripe objects created by create_payment_link (idempotent reuse)
  stripeProductId: text("stripe_product_id"),
  stripePriceId: text("stripe_price_id"),
  stripePaymentLinkId: text("stripe_payment_link_id"),
  stripePaymentLinkUrl: text("stripe_payment_link_url"),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  updatedAt: timestamp("updated_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
}, (t) => ({
  skuUnique: uniqueIndex("idx_commerce_products_sku").on(t.sku),
  tenantIdx: index("idx_commerce_products_tenant").on(t.tenantId),
}));

export const insertCommerceProductSchema = createInsertSchema(commerceProducts).omit({ id: true, createdAt: true, updatedAt: true });
export type CommerceProduct = typeof commerceProducts.$inferSelect;
export type InsertCommerceProduct = z.infer<typeof insertCommerceProductSchema>;
