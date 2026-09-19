import test from "node:test";
import assert from "node:assert/strict";
import { isAuthoritativePaidCheckout } from "../../server/routes/billing";

test("subscription activation rejects a completed but unpaid checkout session", () => {
  assert.equal(
    isAuthoritativePaidCheckout({ status: "complete", payment_status: "unpaid", mode: "subscription" }),
    false,
  );
});

test("subscription activation accepts a paid subscription checkout session", () => {
  assert.equal(
    isAuthoritativePaidCheckout({ status: "complete", payment_status: "paid", mode: "subscription" }),
    true,
  );
});