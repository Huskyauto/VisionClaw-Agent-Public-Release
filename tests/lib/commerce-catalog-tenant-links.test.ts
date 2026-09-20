import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const source = fs.readFileSync(path.resolve("server/lib/commerce-catalog.ts"), "utf8");
const commerceHandlerSource = fs.readFileSync(
  path.resolve("server/tools/domains/commerce/handlers.ts"),
  "utf8",
);

test("commerce catalog verifies mission ownership before persisting a mission link", () => {
  const ownershipCheck = source.indexOf(
    "FROM revenue_missions WHERE id = ${input.missionId} AND tenant_id = ${input.tenantId}",
  );
  const insert = source.indexOf("INSERT INTO commerce_products");

  assert.ok(ownershipCheck >= 0, "mission links require an exact tenant-scoped ownership query");
  assert.ok(insert >= 0 && ownershipCheck < insert, "mission ownership is checked before product persistence");
});

test("commerce catalog verifies outreach-sequence ownership before persisting a sequence link", () => {
  const ownershipCheck = source.indexOf(
    "FROM outreach_sequences WHERE id = ${input.postPurchaseSequenceId} AND tenant_id = ${input.tenantId}",
  );
  const insert = source.indexOf("INSERT INTO commerce_products");

  assert.ok(ownershipCheck >= 0, "sequence links require an exact tenant-scoped ownership query");
  assert.ok(insert >= 0 && ownershipCheck < insert, "sequence ownership is checked before product persistence");
});

test("payment-link creation rejects legacy catalog rows with a foreign mission link", () => {
  const ownershipCheck = commerceHandlerSource.indexOf("getMission(gate.tenantId, row.mission_id)");
  const existingLinkReuse = commerceHandlerSource.indexOf("if (row.stripe_payment_link_url)");
  const stripePaymentLink = commerceHandlerSource.indexOf("stripe.paymentLinks.create");

  assert.ok(ownershipCheck >= 0, "payment-link creation must recheck mission ownership");
  assert.ok(
    existingLinkReuse >= 0 && ownershipCheck < existingLinkReuse,
    "mission ownership must be checked before returning a cached payment link",
  );
  assert.ok(
    stripePaymentLink >= 0 && ownershipCheck < stripePaymentLink,
    "foreign mission IDs must be rejected before they can enter Stripe metadata",
  );
});