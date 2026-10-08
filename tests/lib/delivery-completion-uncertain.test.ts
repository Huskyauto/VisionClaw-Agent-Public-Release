import test from "node:test";
import assert from "node:assert/strict";
import { deliveryCompletionUncertainResult } from "../../server/delivery-pipeline";

test("a post-email persistence failure is held for reconciliation instead of entering the resend loop", () => {
  const result = deliveryCompletionUncertainResult({
    deliveryId: 42,
    attempts: 1,
    linkVerified: true,
    error: "Customer email may have been sent, but its delivery receipt could not be recorded safely. Do not retry automatically.",
});

  assert.equal(result.success, false);
  assert.equal(result.inProgress, true);
  assert.equal(result.emailSent, false);
  assert.equal(result.linkVerified, true);
  assert.equal(result.attempts, 1);
  assert.match(result.error || "", /Do not retry automatically/);
});