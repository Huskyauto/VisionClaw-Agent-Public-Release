import assert from "node:assert/strict";
import { test } from "node:test";
import { SparkLineContentError, validateSparkMessage } from "../../server/spark-line";

test("Felix's non-sensitive free text and project paths pass verbatim", () => {
  const text = "The draft is ready at /docs/q3-review.md — please check section 3 and tell me if the numbers match.";
  assert.equal(validateSparkMessage(text), text);
});

test("detectable private data is refused before it can enter the outbox", () => {
  for (const message of [
    "Contact jane@example.com about the task",
    "Call 312-555-1234",
    "Here is a bearer credential",
    "Customer record #32",
    "My key is vc_abcdef0123456789",
    "A".repeat(4001),
    "",
  ]) {
    assert.throws(() => validateSparkMessage(message), SparkLineContentError, message.slice(0, 40));
  }
});