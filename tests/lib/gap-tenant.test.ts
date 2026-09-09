import { test } from "node:test";
import assert from "node:assert/strict";
import { coerceGapTenantId, GAP_TENANT_UNATTRIBUTED } from "../../server/lib/gap-tenant";

test("valid positive integer tenant ids pass through", () => {
  assert.equal(coerceGapTenantId(1), 1);
  assert.equal(coerceGapTenantId(42), 42);
  assert.equal(coerceGapTenantId("7"), 7);
});

test("missing/invalid tenant context routes to sentinel 0, NOT admin tenant 1", () => {
  for (const bad of [undefined, null, NaN, 0, -3, 1.5, "abc", "", {}, [], Infinity, -Infinity]) {
    assert.equal(coerceGapTenantId(bad), GAP_TENANT_UNATTRIBUTED, `expected sentinel for ${String(bad)}`);
  }
});

test("sentinel is never a real tenant id", () => {
  assert.equal(GAP_TENANT_UNATTRIBUTED, 0);
});
