import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Regression suite for the cross-tenant delivery IDOR.
//
// Pre-fix: `delivery_logs` had NO tenant_id column and the pipeline read
// helpers (listDeliveries / getDeliveryStatus / getDeliveryStats /
// retryDelivery) ignored their tenant argument (named `_tenantId`). The
// authenticated HTTP routes /api/deliveries[/*] therefore returned, exposed,
// and could re-trigger EVERY tenant's delivery rows — customer name, email,
// download links, stripe payment ids — to any logged-in tenant.
//
// Post-fix: delivery_logs carries tenant_id (NOT NULL, indexed); every read
// helper filters by tenantId when provided, and retryDelivery refuses a row
// that does not belong to the caller's tenant (so it cannot re-email another
// tenant's customer). This suite locks that isolation in place.

after(() => { setTimeout(() => process.exit(process.exitCode ?? 0), 50).unref(); });

const { db } = await import("../../server/db");
const { deliveryLogs } = await import("@shared/schema");
const { eq } = await import("drizzle-orm");
const dp = await import("../../server/delivery-pipeline");

// Use two high, unlikely-to-collide tenant ids and a unique product marker so
// the fixtures are trivially identifiable for cleanup and never clash with
// real rows.
const tenantSeed = 1_000_000_000 + (Date.now() % 500_000_000);
const TENANT_A = tenantSeed;
const TENANT_B = tenantSeed + 1;
const MARK = `__deliv_iso_test_${Date.now()}__`;
const STRIPE_PAYMENT_ID = `pi_${MARK}`;

let rowAId = 0;
let rowBId = 0;
let invalidSourceRowId = 0;

before(async () => {
  const [a] = await db.insert(deliveryLogs).values({
    tenantId: TENANT_A,
    customerName: `A ${MARK}`,
    customerEmail: "a@example.test",
    productName: `${MARK} product A`,
    fileName: "a.txt",
    status: "completed",
    stripePaymentId: STRIPE_PAYMENT_ID,
    downloadLink: "https://example.test/a-secret-link",
  }).returning({ id: deliveryLogs.id });
  rowAId = a.id;

  const [b] = await db.insert(deliveryLogs).values({
    tenantId: TENANT_B,
    customerName: `B ${MARK}`,
    customerEmail: "b@example.test",
    productName: `${MARK} product B`,
    fileName: "b.txt",
    status: "pending",
  }).returning({ id: deliveryLogs.id });
  rowBId = b.id;

  const [invalidSource] = await db.insert(deliveryLogs).values({
    tenantId: TENANT_A,
    customerName: `Invalid source ${MARK}`,
    customerEmail: "invalid-source@example.test",
    productName: `${MARK} unavailable source`,
    fileName: `missing-${MARK}.mp4`,
    status: "failed",
    metadata: { _deliverySourcePath: `tmp/missing-${MARK}.mp4` },
  }).returning({ id: deliveryLogs.id });
  invalidSourceRowId = invalidSource.id;
});

after(async () => {
  await db.delete(deliveryLogs).where(eq(deliveryLogs.id, rowAId));
  await db.delete(deliveryLogs).where(eq(deliveryLogs.id, rowBId));
  await db.delete(deliveryLogs).where(eq(deliveryLogs.id, invalidSourceRowId));
});

test("listDeliveries scopes to the caller's tenant — no cross-tenant rows", async () => {
  const forB = await dp.listDeliveries(200, 0, TENANT_B);
  assert.ok(forB.some((r) => r.id === rowBId), "tenant B must see its own delivery");
  assert.ok(
    !forB.some((r) => r.id === rowAId),
    "cross-tenant IDOR regression: tenant B's list returned tenant A's delivery row (customer PII + download link leak)",
  );
});

test("getDeliveryStatus refuses a row owned by another tenant", async () => {
  const denied = await dp.getDeliveryStatus(rowAId, TENANT_B);
  assert.equal(denied, null, "tenant B must NOT be able to read tenant A's delivery by id");

  const allowed = await dp.getDeliveryStatus(rowAId, TENANT_A);
  assert.ok(allowed && allowed.id === rowAId, "owning tenant must still read its own delivery");
});

test("getDeliveryStats counts only the caller's tenant", async () => {
  const statsB = await dp.getDeliveryStats(TENANT_B);
  // TENANT_B has exactly one fixture row (pending) and TENANT_A's row must not
  // bleed in. Exact equality is safe because these test tenants are otherwise
  // empty.
  assert.equal(statsB.total, 1, "tenant B stats must count only tenant B rows");
  assert.equal(statsB.pending, 1, "tenant B's single row is pending");
});

test("Stripe payment lookup is tenant-scoped and never exposes another tenant's delivery", async () => {
  const denied = await dp.getDeliveryByStripePayment(STRIPE_PAYMENT_ID, TENANT_B);
  assert.equal(denied, null, "tenant B must not use tenant A's Stripe delivery record as an idempotency match");

  const allowed = await dp.getDeliveryByStripePayment(STRIPE_PAYMENT_ID, TENANT_A);
  assert.equal(allowed?.id, rowAId, "the owning tenant must retain its own Stripe idempotency match");
});

test("Stripe payment lookup fails closed for invalid tenant IDs", async () => {
  for (const tenantId of [0, -1, 1.5, Number.NaN]) {
    assert.equal(
      await dp.getDeliveryByStripePayment(STRIPE_PAYMENT_ID, tenantId),
      null,
      `tenant ID ${String(tenantId)} must not run an unscoped lookup`,
    );
  }
});

test("retryDelivery refuses (and does not re-fire) another tenant's delivery", async () => {
  const res = await dp.retryDelivery(rowAId, TENANT_B);
  assert.equal(res.success, false, "cross-tenant retry must fail");
  assert.match(
    res.error || "",
    /not found/i,
    "cross-tenant retry must be indistinguishable from a missing row — it must never load or re-email tenant A's delivery",
  );
});

test("retry preflight failure leaves the original delivery status unchanged", async () => {
  const result = await dp.retryDelivery(invalidSourceRowId, TENANT_A);
  assert.equal(result.success, false);
  assert.match(result.error || "", /source path is invalid/i);

  const after = await dp.getDeliveryStatus(invalidSourceRowId, TENANT_A);
  assert.equal(after?.status, "failed", "failed preflight must not mark the delivery retrying or create a new row");
});

test("delivery management helpers cannot silently omit their tenant scope", () => {
  const source = readFileSync("server/delivery-pipeline.ts", "utf8");
  for (const helper of ["retryDelivery", "getDeliveryStatus", "listDeliveries", "getDeliveryStats"]) {
    assert.doesNotMatch(
      source,
      new RegExp(`export async function ${helper}\\([^)]*tenantId\\?:`),
      `${helper} must require a tenant scope rather than falling back to an all-tenant query`,
    );
  }
});

test("public order recovery binds its consumed challenge and final order query to the trusted storefront tenant", () => {
  const source = readFileSync("server/routes.ts", "utf8");
  assert.match(
    source,
    /const storefrontTenantId = ownerTenantId\(\);/,
    "the public storefront must resolve its tenant from trusted server configuration",
  );
  const verificationRoute = source.slice(source.indexOf('app.post("/api/store/verify-orders"'));
  assert.ok(
    verificationRoute.includes("DELETE FROM order_lookup_codes") && verificationRoute.includes("tenant_id = ${storefrontTenantId}"),
    "successful code consumption must be bound to the storefront tenant captured on the challenge",
  );
  assert.match(
    source,
    /\.where\(and\(\s*sqlTag`lower\(\$\{deliveryLogs\.customerEmail\}\) = \$\{rawEmail\}`,\s*eq\(deliveryLogs\.tenantId, storefrontTenantId\),/,
    "verified recovery must not select an identically-addressed customer order from another tenant",
  );
});
