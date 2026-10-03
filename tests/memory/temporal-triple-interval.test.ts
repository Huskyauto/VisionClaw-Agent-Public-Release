import assert from "node:assert/strict";
import { test } from "node:test";
import { planTripleValidity } from "../../server/memory/temporal-triple-interval";

const now = new Date("2026-09-25T12:00:00Z");

test("a backdated fact ends at the newer active fact without expiring it", () => {
  const plan = planTripleValidity(
    new Date("2025-01-01T00:00:00Z"), null,
    [new Date("2026-01-01T00:00:00Z")], now,
  );
  assert.deepEqual(plan, { validUntil: new Date("2026-01-01T00:00:00Z"), supersedeCurrent: false });
});

test("a new current fact supersedes older active facts, but an already expired one does not", () => {
  const older = [new Date("2025-01-01T00:00:00Z")];
  assert.deepEqual(planTripleValidity(new Date("2026-01-01T00:00:00Z"), null, older, now), {
    validUntil: null, supersedeCurrent: true,
  });
  assert.deepEqual(planTripleValidity(
    new Date("2025-06-01T00:00:00Z"), new Date("2025-07-01T00:00:00Z"), older, now,
  ), { validUntil: new Date("2025-07-01T00:00:00Z"), supersedeCurrent: false });
});

test("an end before a fact starts is rejected", () => {
  assert.throws(() => planTripleValidity(
    new Date("2026-01-01T00:00:00Z"), new Date("2025-12-31T00:00:00Z"), [], now,
  ), /valid_until must be after valid_from/);
});