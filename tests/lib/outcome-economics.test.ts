import test from "node:test";
import assert from "node:assert/strict";
import { summarizeOutcomeEconomics } from "../../server/lib/outcome-economics";

test("period cost includes failures but only receipt-backed deliveries supply the denominator", () => {
  const result = summarizeOutcomeEconomics({
    total: 10, receiptBacked: 2, completedUnverified: 3, failed: 4, pending: 1,
  }, 12);
  assert.equal(result.windowCostPerReceiptBackedDeliveryUsd, 6);
  assert.equal(result.semanticallyVerifiedOutcomes, null);
  assert.equal(result.scope, "delivery_receipt_only");
  assert.equal(result.failed, 4);
});

test("no proven denominator or invalid cost is unavailable, never zero-success savings", () => {
  const empty = { total: 0, receiptBacked: 0, completedUnverified: 0, failed: 0, pending: 0 };
  assert.equal(summarizeOutcomeEconomics(empty, 0).windowCostPerReceiptBackedDeliveryUsd, null);
  assert.equal(summarizeOutcomeEconomics({ ...empty, total: 1, receiptBacked: 1 }, NaN).estimatedWindowCostUsd, null);
  assert.throws(() => summarizeOutcomeEconomics({ ...empty, total: 1 }, 2));
});
