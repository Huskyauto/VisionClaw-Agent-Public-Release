import assert from "node:assert/strict";
import test from "node:test";
import { summarizeSecurityReview } from "../../server/lib/staged-security-review-policy";

const day = 86_400_000;
const start = Date.parse("2026-11-12T12:00:00Z");
const evidence = Array.from({ length: 7 }, (_, i) => ({
  observedAt: new Date(start + i * day).toISOString(),
  sourceHash: "a".repeat(64),
  rls: { configured: false, available: "available" as const },
  scopedTransactions: 5,
}));

test("seven distinct observed days still require seven elapsed days and owner review", () => {
  assert.equal(summarizeSecurityReview(evidence, new Date(start + 6 * day)).stage, "observing");
  const report = summarizeSecurityReview(evidence, new Date(start + 7 * day));
  assert.equal(report.stage, "owner_review_required");
  assert.equal(report.observedDays, 7);
  assert.equal(report.enforcementAuthorized, false);
  assert.equal(report.securityCleared, false);
  assert.ok(report.gaps.includes("unwrapped_queries_not_measured"));
  assert.ok(report.gaps.includes("blocked_query_rate_not_measured"));
});

test("missing days, repeated snapshots and source changes never authorize enforcement", () => {
  const report = summarizeSecurityReview([evidence[0], evidence[0], { ...evidence[6], sourceHash: "b".repeat(64) }], new Date(start + 20 * day));
  assert.equal(report.stage, "observing");
  assert.equal(report.observedDays, 2);
  assert.ok(report.gaps.includes("source_changed_during_review"));
  assert.ok(report.gaps.includes("missed_observation_days"));
});

test("future, malformed and invalid-counter observations cannot fill coverage gaps", () => {
  const report = summarizeSecurityReview([
    ...evidence.slice(0, 5),
    { ...evidence[5], observedAt: "not-a-date" },
    { ...evidence[6], scopedTransactions: NaN },
    { ...evidence[6], observedAt: new Date(start + 90 * day).toISOString() },
  ], new Date(start + 8 * day));
  assert.equal(report.observedDays, 5);
  assert.equal(report.stage, "observing");
  assert.ok(report.gaps.includes("invalid_observation_excluded"));
});

test("same-day source changes and transient unknown availability remain visible after recovery", () => {
  const report = summarizeSecurityReview([{ ...evidence[0], sourceChanged: true, availabilityUnproven: true }], new Date(start + day));
  assert.ok(report.gaps.includes("source_changed_during_review"));
  assert.ok(report.gaps.includes("policy_or_role_availability_unproven"));
});
