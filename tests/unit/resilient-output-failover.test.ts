/**
 * tests/unit/resilient-output-failover.test.ts
 *
 * Output-LEVEL failover: when a model's ROUTE succeeds but the OUTPUT is
 * unusable (invalid JSON / schema mismatch / empty), the next attempt must move
 * to a DIFFERENT capable model — not re-ask the same model forever. This is the
 * gap a prior review flagged: prompt-repair alone exhausted on one model even
 * when other models were available.
 *
 * planOutputFailoverStart() is the pure decision at the core of that behavior.
 * Also re-asserts the HARD INVARIANT primitive (detectRefusal short-circuits all
 * repair on a STRUCTURED safety refusal — repair must never re-ask past it).
 *
 * Run: node --import tsx --test tests/unit/resilient-output-failover.test.ts
 */
import test, { after } from "node:test";
import assert from "node:assert/strict";
import { planOutputFailoverStart, detectRefusal } from "../../server/lib/resilient-llm";

// Importing the resilient stack pulls the providers chain, which holds open
// handles (timers) that would keep the test process alive. Force a clean exit
// once tests finish (same pattern as dispatch/blackboard suites).
after(() => { setTimeout(() => process.exit(process.exitCode ?? 0), 50).unref(); });

// Real registry ids (different providers, same "powerful" tier) so
// findFallbackModel resolves deterministically.
const AVAILABLE = [
  { id: "gpt-4.1", provider: "openai", tier: "powerful" },
  { id: "claude-opus-4-8", provider: "anthropic", tier: "powerful" },
];

// --- planOutputFailoverStart -------------------------------------------
test("no exclusions → start on the requested model, no seed (normal path)", () => {
  const r = planOutputFailoverStart("gpt-4.1", [], AVAILABLE, new Set());
  assert.equal(r.startModel, "gpt-4.1");
  assert.deepEqual(r.triedSeed, []);
});

test("requested model produced unusable output → fail over to a DIFFERENT model", () => {
  const r = planOutputFailoverStart("gpt-4.1", ["gpt-4.1"], AVAILABLE, new Set());
  assert.notEqual(r.startModel, "gpt-4.1", "must not re-pick the unusable model when an alt exists");
  assert.equal(r.startModel, "claude-opus-4-8");
  assert.ok(r.triedSeed.includes("gpt-4.1"), "unusable model is seeded as already-tried");
});

test("ALL available models excluded → gracefully fall back to the requested model", () => {
  // Re-asking the only available model beats hard-failing.
  const r = planOutputFailoverStart(
    "gpt-4.1",
    ["gpt-4.1", "claude-opus-4-8"],
    AVAILABLE,
    new Set(),
  );
  assert.equal(r.startModel, "gpt-4.1");
  // The fallback model we're about to try is NOT in the tried-seed; the other is.
  assert.ok(!r.triedSeed.includes("gpt-4.1"));
  assert.ok(r.triedSeed.includes("claude-opus-4-8"));
});

test("a non-requested model is excluded → still start on the requested model, seed the other", () => {
  const r = planOutputFailoverStart("gpt-4.1", ["claude-opus-4-8"], AVAILABLE, new Set());
  assert.equal(r.startModel, "gpt-4.1");
  assert.deepEqual(r.triedSeed, ["claude-opus-4-8"]);
});

// --- detectRefusal (HARD INVARIANT: refusal stays refused) --------------
test("structured message.refusal is detected → caller must stop, never repair", () => {
  const resp = { choices: [{ message: { refusal: "I can't help with that." } }] };
  assert.equal(detectRefusal(resp), "I can't help with that.");
});

test("content_filter finish_reason is detected as a refusal", () => {
  const resp = { choices: [{ message: {}, finish_reason: "content_filter" }] };
  assert.equal(detectRefusal(resp), "Response stopped by provider content filter");
});

test("a normal successful response is NOT a refusal (repair allowed for FORMAT)", () => {
  const resp = { choices: [{ message: { content: "{}" }, finish_reason: "stop" }] };
  assert.equal(detectRefusal(resp), null);
});

test("empty/garbage content alone is NOT a refusal (it is a FORMAT problem, repairable)", () => {
  // Critical: an empty body must route to format-repair, NOT be mistaken for a
  // safety refusal — and a refusal must never be mistaken for a format problem.
  const resp = { choices: [{ message: { content: "" }, finish_reason: "stop" }] };
  assert.equal(detectRefusal(resp), null);
});
