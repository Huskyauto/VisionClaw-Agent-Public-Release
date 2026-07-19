/**
 * tests/unit/skill-activation-test.test.ts
 *
 * Covers evaluateActivationPrecision in server/lib/skill-activation-test.ts — the
 * margin-based "5 related / 3 unrelated" trigger-precision check that proves a
 * skill fires on related queries and stays quiet on unrelated ones before it
 * goes live. Uses a deterministic bag-of-words fake embedder (no network).
 *
 * Run: node --import tsx --test tests/unit/skill-activation-test.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import { evaluateActivationPrecision } from "../../server/lib/skill-activation-test";

// Deterministic fake embedder: a vector over a tiny fixed vocab so cosine
// similarity reflects keyword overlap. Lets us assert precision logic offline.
const VOCAB = [
  "stripe", "webhook", "signature", "verify", "payment", "refund",
  "cake", "bake", "oven", "flour", "video", "render",
];
function fakeEmbed(text: string): Promise<number[] | null> {
  const t = text.toLowerCase();
  return Promise.resolve(VOCAB.map(w => (t.includes(w) ? 1 : 0)));
}

test("well-scoped skill passes: related fire, unrelated stay quiet", async () => {
  const r = await evaluateActivationPrecision({
    skillText: "Verify Stripe webhook signature for payment and refund events",
    relatedProbes: [
      "how do I verify a stripe webhook signature",
      "stripe payment webhook verify failing",
      "refund webhook signature check",
    ],
    unrelatedProbes: ["how do I bake a cake in the oven", "render a video"],
    embed: fakeEmbed,
  });
  assert.equal(r.ran, true);
  assert.equal(r.pass, true, r.summary);
  assert.equal(r.falseTriggers.length, 0);
  assert.equal(r.misses.length, 0);
  assert.ok(r.margin > 0, "related band should sit above unrelated band");
});

test("over-broad skill fails: an unrelated probe false-triggers", async () => {
  // skillText overlaps BOTH domains -> a 'cake' query climbs into the fire band.
  const r = await evaluateActivationPrecision({
    skillText: "stripe payment cake bake oven webhook everything",
    relatedProbes: ["stripe payment webhook", "stripe refund signature verify"],
    unrelatedProbes: ["bake a cake in the oven", "flour for the cake"],
    embed: fakeEmbed,
  });
  assert.equal(r.ran, true);
  assert.equal(r.pass, false, r.summary);
  assert.ok(r.falseTriggers.length >= 1, "a cake query should false-trigger");
});

test("fail-open: insufficient related probes -> not evaluated", async () => {
  const r = await evaluateActivationPrecision({
    skillText: "Verify Stripe webhook signature",
    relatedProbes: ["stripe webhook verify"],
    unrelatedProbes: ["bake a cake"],
    embed: fakeEmbed,
  });
  assert.equal(r.ran, false);
  assert.equal(r.pass, false);
  assert.match(r.summary, /not evaluated/);
});

test("fail-open: embedder unavailable -> not evaluated, never throws", async () => {
  const r = await evaluateActivationPrecision({
    skillText: "Verify Stripe webhook signature",
    relatedProbes: ["stripe webhook verify", "stripe refund signature"],
    unrelatedProbes: ["bake a cake", "render a video"],
    embed: () => Promise.resolve(null),
  });
  assert.equal(r.ran, false);
  assert.equal(r.pass, false);
});

test("fail-open: a throwing embedder yields ran=false and never propagates", async () => {
  const r = await evaluateActivationPrecision({
    skillText: "Verify Stripe webhook signature",
    relatedProbes: ["stripe webhook verify", "stripe refund signature"],
    unrelatedProbes: ["bake a cake", "render a video"],
    embed: () => {
      throw new Error("embedding backend down");
    },
  });
  assert.equal(r.ran, false);
  assert.equal(r.pass, false);
});

test("empty whitespace probes are filtered before the count check", async () => {
  const r = await evaluateActivationPrecision({
    skillText: "Verify Stripe webhook signature for payment events",
    relatedProbes: ["stripe webhook verify", "   ", "stripe payment signature"],
    unrelatedProbes: ["bake a cake", ""],
    embed: fakeEmbed,
  });
  assert.equal(r.ran, true);
  assert.equal(r.probes.filter(p => p.expected === "fire").length, 2);
  assert.equal(r.probes.filter(p => p.expected === "quiet").length, 1);
});
