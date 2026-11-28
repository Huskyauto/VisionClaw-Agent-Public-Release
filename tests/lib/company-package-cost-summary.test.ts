import test from "node:test";
import assert from "node:assert/strict";
import { companyPackageCostSummary } from "../../server/lib/company-package-cost-summary";

test("package cost visibility never calls reservations actual spend", () => {
  const result = companyPackageCostSummary({
    packageSpend: { "matrix:author:a": 1_000_000, "matrix:author:a:recovery:one": 500_000,
      "review:12:compiler:fixture": 250_000 },
  });
  assert.equal(result.reservedModelUsd, 1.75);
  assert.equal(result.reservationCount, 3);
  assert.equal(result.actualTotalUsd, null);
  assert.equal(result.status, "unreconciled");
  assert.ok(result.excludedCosts.includes("narration"));
});

test("missing, malformed, oversized and overflowing reservations never become zero-cost evidence", () => {
  assert.equal(companyPackageCostSummary({}).status, "unavailable");
  for (const claims of [[], "1", { a: "100" }, { a: -1 }, { a: 1.5 }, { a: NaN },
    { a: Number.MAX_SAFE_INTEGER, b: 1 }, Object.fromEntries(Array.from({ length: 2001 }, (_, i) => [i, 1]))]) {
    const result = companyPackageCostSummary({ packageSpend: claims });
    assert.equal(result.reservedModelUsd, null);
    assert.equal(result.actualTotalUsd, null);
  }
  const empty = companyPackageCostSummary({ packageSpend: {} });
  assert.equal(empty.reservedModelUsd, 0);
  assert.equal(empty.actualTotalUsd, null, "no model reservation does not prove no external charges");
});
