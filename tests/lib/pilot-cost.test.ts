import test from "node:test";
import assert from "node:assert/strict";
import { costSchema, analyzeCost } from "../../shared/business-pilots/cost";
const input = () => ({ business: "Example", start: "2026-10-01", end: "2026-10-19", currency: "USD",
  rows: [{ workload: "Support", model: "Model A", inputTokens: 1_000_000, outputTokens: 500_000,
    inputRate: 2, outputRate: 8, rateDate: "2026-10-19", rateSource: "Provider price sheet",
    alternative: { model: "Model B", inputRate: 1, outputRate: 4, qualityValidated: false,
      evidence: "", testedAt: "2026-10-19" } }] });
test("cost computes aggregate token arithmetic without treating untested alternatives as savings", () => {
  const result = analyzeCost(costSchema.parse(input()), "2026-10-19");
  assert.equal(result.metrics[0].value, 6);
  assert.equal(result.metrics[1].value, 0);
  assert.match(result.findings[0].detail, /scenario only/i);
});
test("cost includes only evidenced recent quality tests in candidate savings", () => {
  const data = input(); Object.assign(data.rows[0].alternative, { qualityValidated: true, evidence: "Task-set test 123" });
  const result = analyzeCost(costSchema.parse(data), "2026-10-19");
  assert.equal(result.metrics[1].value, 3);
  data.rows[0].alternative.testedAt = "2026-01-01";
  assert.equal(analyzeCost(costSchema.parse(data), "2026-10-19").metrics[1].value, 0);
});
test("cost rejects strings, negative/infinite rates, empty usage lists and reversed periods", () => {
  const data = input();
  for (const inputRate of ["", "2", -1, Infinity, NaN]) {
    assert.equal(costSchema.safeParse({ ...data, rows: [{ ...data.rows[0], inputRate }] }).success, false);
  }
  assert.equal(costSchema.safeParse({ ...data, rows: [] }).success, false);
  assert.equal(costSchema.safeParse({ ...data, end: "2026-09-01" }).success, false);
});
