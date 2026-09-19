// R116 — agentmemory N6 invariants on the contradiction resolver.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  resolveContradiction,
  shouldEscalateAfterResolver,
  RESOLVER_CONFIDENCE_FLOOR,
} from "../../server/lib/contradiction-resolver";

test("fewer than 2 candidates → escalate, no winner separation", () => {
  const r = resolveContradiction([{ text: "lone" }]);
  assert.equal(r.resolverConfidence, 0);
  assert.equal(r.loser, null);
  assert.ok(shouldEscalateAfterResolver(r));
});

test("authoritative user fact beats fresh auto-capture", () => {
  const days = 14;
  const r = resolveContradiction([
    {
      id: "user_old",
      text: "Felix uses voice 'onyx'.",
      sourceAuthority: "user",
      lastReinforcedAt: new Date(Date.now() - days * 86400000),
      supportingObservations: 1,
      confidence: 1.0,
    },
    {
      id: "auto_fresh",
      text: "Felix uses voice 'echo'.",
      sourceAuthority: "auto_capture",
      lastReinforcedAt: new Date(),
      supportingObservations: 1,
      confidence: 0.85,
    },
  ]);
  assert.equal(r.winner?.id, "user_old");
});

test("recency tiebreaker when authority + support equal", () => {
  const r = resolveContradiction([
    { id: "old", text: "A", sourceAuthority: "tool", lastReinforcedAt: new Date(Date.now() - 60 * 86400000), supportingObservations: 1, confidence: 1 },
    { id: "new", text: "B", sourceAuthority: "tool", lastReinforcedAt: new Date(), supportingObservations: 1, confidence: 1 },
  ]);
  assert.equal(r.winner?.id, "new");
});

test("support-count breaks identical authority+recency ties", () => {
  const r = resolveContradiction([
    { id: "many", text: "A", sourceAuthority: "tool", lastReinforcedAt: new Date(), supportingObservations: 10, confidence: 0.9 },
    { id: "one", text: "B", sourceAuthority: "tool", lastReinforcedAt: new Date(), supportingObservations: 1, confidence: 0.9 },
  ]);
  assert.equal(r.winner?.id, "many");
});

test("zero-margin pair → confidence 0 → escalate", () => {
  const r = resolveContradiction([
    { id: "a", text: "A", sourceAuthority: "tool", lastReinforcedAt: new Date(), supportingObservations: 1, confidence: 1 },
    { id: "b", text: "B", sourceAuthority: "tool", lastReinforcedAt: new Date(), supportingObservations: 1, confidence: 1 },
  ]);
  assert.equal(r.resolverConfidence, 0);
  assert.ok(shouldEscalateAfterResolver(r));
});

test("low confidence multiplicatively penalises an otherwise-strong candidate", () => {
  const r = resolveContradiction([
    { id: "strong_but_unsure", text: "A", sourceAuthority: "user", lastReinforcedAt: new Date(), supportingObservations: 5, confidence: 0.1 },
    { id: "decent_and_sure", text: "B", sourceAuthority: "tool", lastReinforcedAt: new Date(), supportingObservations: 3, confidence: 0.95 },
  ]);
  assert.equal(r.winner?.id, "decent_and_sure");
});

test("RESOLVER_CONFIDENCE_FLOOR is in [0,1]", () => {
  assert.ok(RESOLVER_CONFIDENCE_FLOOR >= 0 && RESOLVER_CONFIDENCE_FLOOR <= 1);
});

test("scores array sorted descending and includes all parts", () => {
  const r = resolveContradiction([
    { id: 1, text: "A", sourceAuthority: "tool", lastReinforcedAt: new Date(), supportingObservations: 2, confidence: 0.7 },
    { id: 2, text: "B", sourceAuthority: "user", lastReinforcedAt: new Date(), supportingObservations: 4, confidence: 0.9 },
    { id: 3, text: "C", sourceAuthority: "auto_capture", lastReinforcedAt: new Date(), supportingObservations: 1, confidence: 0.5 },
  ]);
  assert.equal(r.scores.length, 3);
  for (let i = 1; i < r.scores.length; i++) {
    assert.ok(r.scores[i - 1].score >= r.scores[i].score, "scores must be sorted desc");
  }
  for (const s of r.scores) {
    assert.ok("auth" in s.parts && "recency" in s.parts && "support" in s.parts && "conf" in s.parts);
  }
});
