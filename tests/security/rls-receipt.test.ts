import assert from "node:assert/strict";
import { test } from "node:test";
import {
  getRlsEnforcementReceipt,
  isRlsEnforcementConfigured,
  rlsAvailabilityFromProbe,
} from "../../server/db";

test("RLS receipt configuration is opt-in only for RLS_ENFORCE=1", () => {
  assert.equal(isRlsEnforcementConfigured({}), false);
  assert.equal(isRlsEnforcementConfigured({ RLS_ENFORCE: "true" }), false);
  assert.equal(isRlsEnforcementConfigured({ RLS_ENFORCE: "1" }), true);
});

test("RLS receipt maps catalog-only availability results without values", () => {
  assert.equal(rlsAvailabilityFromProbe({
    rows: [{ available: true, expected_count: 16, covered_count: 16, can_set_role: true }],
  }), "available");
  assert.equal(rlsAvailabilityFromProbe({
    rows: [{ available: true, expected_count: 16, covered_count: 1, can_set_role: true }],
  }), "unavailable");
  assert.equal(rlsAvailabilityFromProbe({
    rows: [{ available: true, expected_count: 16, covered_count: 16, can_set_role: false }],
  }), "unavailable");
  assert.equal(rlsAvailabilityFromProbe({
    rows: [{ available: false, expected_count: 16, covered_count: 15, can_set_role: true }],
  }), "unavailable");
  assert.equal(rlsAvailabilityFromProbe({ rows: [] }), "unavailable");
});

test("RLS receipt fails safe when its bounded probe cannot run", async () => {
  const receipt = await getRlsEnforcementReceipt(
    async () => {
      throw new Error("database unavailable");
    },
    { RLS_ENFORCE: "1" },
  );

  assert.deepEqual(receipt, { configured: true, available: "unknown" });
});