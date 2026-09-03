import assert from "node:assert/strict";
import test from "node:test";
import { assertPersonaSyncComplete } from "../../server/lib/persona-sync-completion";

test("persona sync refuses partial updates", () => {
  assert.throws(
    () => assertPersonaSyncComplete({
      expectedCount: 18,
      syncedCount: 17,
      errors: ["Radar: database unavailable"],
      verifiedCount: 17,
    }),
    /persona sync incomplete.*Radar: database unavailable/i,
  );
});

test("persona sync refuses missing post-sync CMMC guidance", () => {
  assert.throws(
    () => assertPersonaSyncComplete({
      expectedCount: 18,
      syncedCount: 18,
      errors: [],
      verifiedCount: 17,
    }),
    /CMMC guidance verified for 17\/18/i,
  );
});

test("persona sync accepts a fully updated and verified run", () => {
  assert.doesNotThrow(() => assertPersonaSyncComplete({
    expectedCount: 18,
    syncedCount: 18,
    errors: [],
    verifiedCount: 18,
  }));
});