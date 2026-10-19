import test from "node:test";
import assert from "node:assert/strict";
import { manualReportDelivery } from "../../server/lib/manual-report-delivery";

test("manual reports default to report-only and ignore supplied customer contact", () => {
  for (const reportOnly of [undefined, true]) {
    const result = manualReportDelivery({ reportOnly, customerEmail: "customer@example.com" }, "owner@example.com");
    assert.deepEqual(result, { reportOnly: true, customerEmail: "owner@example.com", deliveryEmail: undefined });
  }
});

test("only explicit unchecked mode prepares customer delivery; no email still means no delivery", () => {
  assert.deepEqual(manualReportDelivery({ reportOnly: false, customerEmail: " customer@example.com " }, "owner@example.com"),
    { reportOnly: false, customerEmail: "customer@example.com", deliveryEmail: "customer@example.com" });
  assert.equal(manualReportDelivery({ reportOnly: false }, "owner@example.com").deliveryEmail, undefined);
  for (const reportOnly of ["false", null, 0, {}]) {
    assert.throws(() => manualReportDelivery({ reportOnly: reportOnly as boolean }, "owner@example.com"));
  }
});
