import test from "node:test";
import assert from "node:assert/strict";
import { analyzeHealth, healthSchema } from "../../shared/business-pilots/health";

const sample = () => ({ business: "Example", reference: "example", currency: "USD",
  start: "2026-09-01", end: "2026-09-30", calls: 100, missedCalls: 20,
  quotes: 20, wonQuotes: 5, timelyFollowups: 10, customers: 40, repeatCustomers: 10,
  receivables: 10000, overdueReceivables: 2000 });
test("health computes rates and explicit baseline deltas", () => {
  const before = sample(), after = { ...before, start: "2026-10-01", end: "2026-10-30", missedCalls: 10 };
  const result = analyzeHealth(healthSchema.parse(after), healthSchema.parse(before));
  assert.equal(result.metrics[0].value, 10);
  assert.equal(result.metrics[0].delta, -10);
  assert.equal(result.metrics[0].direction, "improved");
});
test("health distinguishes missing and zero denominators from healthy zero", () => {
  const result = analyzeHealth(healthSchema.parse({ business: "Example", reference: "example", currency: "USD",
    start: "2026-09-01", end: "2026-09-30", calls: 0, missedCalls: 0 }));
  assert.equal(result.metrics[0].value, null);
  assert.ok(result.metrics.every(metric => metric.value === null));
});
test("health rejects inconsistent counters, invalid periods and incompatible baselines", () => {
  assert.equal(healthSchema.safeParse({ ...sample(), missedCalls: 101 }).success, false);
  assert.equal(healthSchema.safeParse({ ...sample(), end: "2026-02-30" }).success, false);
  assert.equal(healthSchema.safeParse({ ...sample(), end: "2026-08-31" }).success, false);
  assert.throws(() => analyzeHealth(healthSchema.parse(sample()),
    healthSchema.parse({ ...sample(), reference: "other" })), /same business/i);
  assert.throws(() => analyzeHealth(healthSchema.parse(sample()),
    healthSchema.parse({ ...sample(), business: "Another business" })), /same business/i);
  assert.throws(() => analyzeHealth(healthSchema.parse(sample()), healthSchema.parse(sample())), /earlier/i);
});
