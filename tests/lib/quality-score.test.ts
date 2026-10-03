// R116 — agentmemory N7 invariants on heuristic quality_score.
import { test } from "node:test";
import assert from "node:assert/strict";
import { computeQualityScore, QUALITY_REVIEW_THRESHOLD } from "../../server/lib/quality-score";

test("empty fact → score 0", () => {
  const r = computeQualityScore({ fact: "", source: "manual", confidence: 1 });
  assert.equal(r.score, 0);
  assert.ok(r.reasons.includes("empty_fact"));
});

test("well-formed user fact → high score", () => {
  const r = computeQualityScore({
    fact: "Bob prefers Tailwind utilities over inline styles in client/src/components/.",
    source: "manual",
    confidence: 1.0,
    confidenceSource: "user_explicit",
  });
  assert.ok(r.score >= 0.75, `expected ≥0.75 got ${r.score}`);
  assert.ok(r.score <= 1);
});

test("auto-capture mid-confidence well-sized fact → mid score (≥ threshold)", () => {
  const r = computeQualityScore({
    fact: "[auto-learned:browser-automation] Multi-step browser automation: navigate → click → extract",
    source: "auto_capture",
    confidence: 0.85,
    confidenceSource: "heuristic_pattern_match",
  });
  assert.ok(r.score >= QUALITY_REVIEW_THRESHOLD, `auto-capture should clear review threshold; got ${r.score}`);
});

test("repetitive spam → low score", () => {
  const r = computeQualityScore({
    fact: "test test test test test test test test",
    source: "conversation",
    confidence: 0.5,
  });
  assert.ok(r.score < QUALITY_REVIEW_THRESHOLD, `repetitive spam should land below threshold; got ${r.score}`);
  assert.ok(r.reasons.some((x) => x === "repetitive"));
});

test("very short single-token fact → low score", () => {
  const r = computeQualityScore({ fact: "x", source: "conversation", confidence: 0.9 });
  assert.ok(r.score < QUALITY_REVIEW_THRESHOLD, `single-token fact should land below threshold; got ${r.score}`);
});

test("low-confidence cap: even pretty fact stays ≤ 0.6 when conf<0.5", () => {
  const r = computeQualityScore({
    fact: "Stripe webhooks should validate signatures with the raw body, not the parsed JSON.",
    source: "manual",
    confidence: 0.2,
    confidenceSource: "user_explicit",
  });
  assert.ok(r.score <= 0.6 + 1e-9, `expected score ≤0.6 (low-conf cap), got ${r.score}`);
  assert.ok(r.reasons.some((x) => x.startsWith("capped_low_conf")));
});

test("score always within [0,1]", () => {
  for (const sample of [
    { fact: "a", source: "unknown", confidence: 1 },
    { fact: "x".repeat(5000), source: "manual", confidence: 1 },
    { fact: "Hello world.", source: "user", confidence: 1, confidenceSource: "explicit" },
    { fact: "\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000", source: "tool", confidence: 1 },
  ]) {
    const r = computeQualityScore(sample as any);
    assert.ok(r.score >= 0 && r.score <= 1, `out of range for ${JSON.stringify(sample).slice(0, 80)}: ${r.score}`);
  }
});

test("QUALITY_REVIEW_THRESHOLD is in [0,1]", () => {
  assert.ok(QUALITY_REVIEW_THRESHOLD >= 0 && QUALITY_REVIEW_THRESHOLD <= 1);
});
