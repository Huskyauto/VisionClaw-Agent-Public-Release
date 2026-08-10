import { test, before, after } from "node:test";
import assert from "node:assert/strict";

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
const TENANT_A = 880011;
const TENANT_B = 880022;
const MARK = `__deliv_iso_test_${Date.now()}__`;

let rowAId = 0;
let rowBId = 0;

before(async () => {
  const [a] = await db.insert(deliveryLogs).values({
    tenantId: TENANT_A,
    customerName: `A ${MARK}`,
    customerEmail: "a@example.test",
    productName: `${MARK} product A`,
    fileName: "a.txt",
    status: "completed",
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
});

after(async () => {
  await db.delete(deliveryLogs).where(eq(deliveryLogs.id, rowAId));
  await db.delete(deliveryLogs).where(eq(deliveryLogs.id, rowBId));
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

test("retryDelivery refuses (and does not re-fire) another tenant's delivery", async () => {
  const res = await dp.retryDelivery(rowAId, TENANT_B);
  assert.equal(res.success, false, "cross-tenant retry must fail");
  assert.match(
    res.error || "",
    /not found/i,
    "cross-tenant retry must be indistinguishable from a missing row — it must never load or re-email tenant A's delivery",
  );
});
