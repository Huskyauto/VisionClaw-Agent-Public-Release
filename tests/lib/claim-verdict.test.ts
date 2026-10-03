import { test } from "node:test";
import assert from "node:assert/strict";

import {
  computeVerdictGate,
  planSampleSize,
  strideSampleIndices,
  normalizeVerdict,
  emptyVerdictCounts,
} from "../../server/lib/claim-verdict.ts";

// PURE logic only — claim-verdict.ts deliberately imports NO providers/DB so it
// can be unit-tested without the cove-verifier → providers setInterval handle
// that would otherwise hang the test runner at exit.

test("computeVerdictGate: clean counts PASS", () => {
  const c = emptyVerdictCounts();
  c.VERIFIED = 7;
  assert.equal(computeVerdictGate(c), "PASS");
});

test("computeVerdictGate: MAJOR_DISTORTION or UNVERIFIABLE forces FAIL", () => {
  const a = emptyVerdictCounts();
  a.VERIFIED = 5; a.MAJOR_DISTORTION = 1;
  assert.equal(computeVerdictGate(a), "FAIL");

  const b = emptyVerdictCounts();
  b.VERIFIED = 5; b.UNVERIFIABLE = 1;
  assert.equal(computeVerdictGate(b), "FAIL");

  // FAIL dominates even when soft buckets are also present.
  const c = emptyVerdictCounts();
  c.MINOR_DISTORTION = 3; c.UNVERIFIABLE_ACCESS = 2; c.MAJOR_DISTORTION = 1;
  assert.equal(computeVerdictGate(c), "FAIL");
});

test("computeVerdictGate: soft-only buckets downgrade to PASS_WITH_NOTES", () => {
  const a = emptyVerdictCounts();
  a.VERIFIED = 4; a.MINOR_DISTORTION = 2;
  assert.equal(computeVerdictGate(a), "PASS_WITH_NOTES");

  const b = emptyVerdictCounts();
  b.VERIFIED = 4; b.UNVERIFIABLE_ACCESS = 1;
  assert.equal(computeVerdictGate(b), "PASS_WITH_NOTES");
});

test("planSampleSize: final mode always samples everything", () => {
  assert.equal(planSampleSize(20, "final"), 20);
  assert.equal(planSampleSize(1, "final"), 1);
  assert.equal(planSampleSize(0, "final"), 0);
});

test("planSampleSize: draft mode honors floor, ratio, and cap", () => {
  // default ratio 0.3, floor 5
  assert.equal(planSampleSize(3, "draft"), 3);      // floor 5 capped at total 3
  assert.equal(planSampleSize(10, "draft"), 5);     // ceil(0.3*10)=3 < floor 5 → 5
  assert.equal(planSampleSize(30, "draft"), 9);     // ceil(0.3*30)=9 > floor 5
  assert.equal(planSampleSize(100, "draft"), 30);   // ceil(0.3*100)=30
  assert.equal(planSampleSize(0, "draft"), 0);
});

test("planSampleSize: ratio/minSample are sanitized against junk input", () => {
  assert.equal(planSampleSize(100, "draft", 2 as any), 100);     // ratio clamped to 1
  assert.equal(planSampleSize(100, "draft", -1 as any, 0), 0);   // ratio→0, floor 0 → 0 samples
  assert.equal(planSampleSize(100, "draft", NaN as any), 30);    // NaN ratio → default 0.3
  assert.equal(planSampleSize(100, "draft", 0.3, NaN as any), 30); // NaN floor → default 5, ceil 30 wins
});

test("strideSampleIndices: returns all when k>=n, none when k<=0", () => {
  assert.deepEqual(strideSampleIndices(4, 4), [0, 1, 2, 3]);
  assert.deepEqual(strideSampleIndices(4, 10), [0, 1, 2, 3]);
  assert.deepEqual(strideSampleIndices(4, 0), []);
});

test("strideSampleIndices: distinct, sorted, spans full range", () => {
  const idx = strideSampleIndices(100, 10);
  assert.equal(idx.length, 10);
  assert.equal(new Set(idx).size, idx.length, "indices must be distinct");
  const sorted = [...idx].sort((a, b) => a - b);
  assert.deepEqual(idx, sorted, "indices must be returned sorted");
  assert.ok(idx[0] === 0, "sample should start near the beginning");
  assert.ok(idx[idx.length - 1] <= 99 && idx[idx.length - 1] >= 80, "sample should reach the tail");
});

test("normalizeVerdict: canonicalizes case/spacing/hyphens, rejects junk", () => {
  assert.equal(normalizeVerdict("verified"), "VERIFIED");
  assert.equal(normalizeVerdict("Major Distortion"), "MAJOR_DISTORTION");
  assert.equal(normalizeVerdict("minor-distortion"), "MINOR_DISTORTION");
  assert.equal(normalizeVerdict("UNVERIFIABLE_ACCESS"), "UNVERIFIABLE_ACCESS");
  assert.equal(normalizeVerdict("totally made up"), null);
  assert.equal(normalizeVerdict(""), null);
  assert.equal(normalizeVerdict(undefined as any), null);
});
