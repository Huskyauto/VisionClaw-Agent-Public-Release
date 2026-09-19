import { test, after } from "node:test";
import assert from "node:assert/strict";
import { estimateCostUsd } from "../../server/agentic/cost-ledger";

after(() => { setTimeout(() => process.exit(process.exitCode ?? 0), 50).unref(); });

// Cost-ledger pricing tests — pure unit tests (no DB required, CI-safe even
// without a postgres). Locks in the contract that estimateCostUsd:
//   1. Looks up canonical model prices correctly per the rate card
//   2. Falls back deterministically on unknown gpt-* / claude-* models
//   3. Returns 0 for $0/token "tools" (whisper duration-billed elsewhere)
//   4. Returns 0 for totally unknown models (explicit "we don't know" signal,
//      better than logging a fictional cost that misleads the burn dashboard)
//   5. Doesn't throw on edge cases (empty model, zero tokens, default args)
//
// This is the regression net for the cost-tracking infrastructure that
// covers ~30 LLM call sites (Round 30 monkey-patch on replitOpenai +
// wrapClientWithCostTracking on getClientForModel). Wrong rate card =
// silently-incorrect burn-rate verdicts on the admin Cost-vs-Revenue card.
//
// Note: floating-point comparison helper used because JS float arithmetic
// produces e.g. 10_000 * 0.0003 = 2.9999999999999996, not exactly 3. The
// tolerance is 1e-9, which is tighter than 1/1000th of a cent — well past
// the precision the dashboard ever displays (it formats to 6 decimals).
function closeTo(actual: number, expected: number, tol = 1e-9): void {
  assert.ok(
    Math.abs(actual - expected) < tol,
    `Expected ${actual} to be within ${tol} of ${expected} (delta=${Math.abs(actual - expected)})`,
  );
}

// === Known canonical models (rate card from server/agentic/cost-ledger.ts) ===

test("gpt-5.4: $0.0025/1K in + $0.015/1K out (reconciled to live OpenAI rate, R125+136)", () => {
  closeTo(estimateCostUsd("gpt-5.4", 1000, 1000), 0.0175);
});

test("gpt-5.1: $0.00125/1K in + $0.010/1K out (live OpenRouter rate, verified 2026-07-21)", () => {
  closeTo(estimateCostUsd("gpt-5.1", 2000, 1000), 0.0125);
});

test("claude-opus-4-5: $0.005/1K in + $0.025/1K out (default Anthropic fallback alias; live OpenRouter $5/$25 per M, verified 2026-07-21)", () => {
  closeTo(estimateCostUsd("claude-opus-4-5", 1000, 1000), 0.03);
});

test("claude-opus-4-7: $0.005/1K in + $0.025/1K out", () => {
  closeTo(estimateCostUsd("claude-opus-4-7", 2000, 500), 0.0225);
});

test("claude-opus-4-6: legacy higher pricing ($0.015 + $0.075)", () => {
  // Locks in that the older pricing is preserved for back-dated
  // ledger reconciliation if we ever need to recompute historical rows.
  closeTo(estimateCostUsd("claude-opus-4-6", 1000, 1000), 0.09);
});

test("gemini-3-flash-preview: priced cheaply for high-volume use", () => {
  // 10 * 0.0005 + 5 * 0.003 = 0.005 + 0.015 = 0.02
  closeTo(estimateCostUsd("gemini-3-flash-preview", 10_000, 5_000), 0.02);
});

test("gemini-3.1-pro-preview: $0.002/1K in + $0.012/1K out (live OpenRouter rate, verified 2026-07-21)", () => {
  // 4 * 0.002 + 1 * 0.012 = 0.008 + 0.012 = 0.02
  closeTo(estimateCostUsd("gemini-3.1-pro-preview", 4000, 1000), 0.02);
});

test("gemini-3.5-flash: $0.0015/1K in + $0.009/1K out (live OpenRouter rate, verified 2026-07-21)", () => {
  // 4 * 0.0015 + 1 * 0.009 = 0.006 + 0.009 = 0.015
  closeTo(estimateCostUsd("gemini-3.5-flash", 4000, 1000), 0.015);
});

test("text-embedding-3-small: in-priced only (out is 0)", () => {
  // 5 * 0.00002 + 999 * 0 = 0.0001
  closeTo(estimateCostUsd("text-embedding-3-small", 5_000, 999), 0.0001);
});

test("text-embedding-3-large: 6.5x more expensive than -small", () => {
  closeTo(estimateCostUsd("text-embedding-3-large", 1000, 0), 0.00013);
});

test("whisper-1: zero-cost marker (duration billed elsewhere)", () => {
  // Whisper is duration-billed at the API level, not token-billed.
  // We log the call as a $0 marker so the operation count is tracked
  // without inflating the cost dashboard. The actual whisper $/min
  // is reconciled separately against the OpenAI billing export.
  assert.equal(estimateCostUsd("whisper-1", 100, 100), 0);
});

test("firecrawl-search: in=0, out=$0.003/1K", () => {
  closeTo(estimateCostUsd("firecrawl-search", 0, 1000), 0.003);
});

test("elevenlabs-tts: high $0.30/1K out reflects per-char pricing", () => {
  closeTo(estimateCostUsd("elevenlabs-tts", 0, 1000), 0.3);
});

test("perplexity-sonar-pro: $0.003/1K in + $0.015/1K out", () => {
  closeTo(estimateCostUsd("perplexity-sonar-pro", 1000, 1000), 0.018);
});

// === Unknown-model fallbacks ===

test("unknown gpt-* model: $0.005 averaged on combined tokens", () => {
  // Heuristic: keep us roughly in the right order of magnitude until
  // explicit pricing lands for the new model in the rate card above.
  closeTo(estimateCostUsd("gpt-7.0-experimental", 1000, 0), 0.005);
});

test("unknown claude-* model: same $0.005 averaged fallback", () => {
  closeTo(estimateCostUsd("claude-opus-9", 1000, 0), 0.005);
});

test("totally unknown model: returns 0 (better than guessing wrong)", () => {
  // The 0 is an explicit "we don't know" signal — better than logging
  // a fictional cost that misleads the admin burn-rate dashboard.
  // The dashboard's "shouldThrottlePremium" gate would falsely fire
  // if we hallucinated $/token for an unrecognized provider.
  assert.equal(estimateCostUsd("totally-fake-model", 9999, 9999), 0);
});

// === Edge cases — must not throw, must return finite numbers ===

test("empty model string: returns 0 fallback (not crash)", () => {
  assert.equal(estimateCostUsd("", 1000, 1000), 0);
});

test("zero tokens on a known model: returns 0", () => {
  assert.equal(estimateCostUsd("gpt-5.4", 0, 0), 0);
});

test("default args: no tokens passed → returns 0 (no NaN)", () => {
  const c = estimateCostUsd("gpt-5.4");
  assert.equal(c, 0);
  assert.ok(!Number.isNaN(c), "Must not return NaN even with no token args");
});

test("only tokensIn provided: out defaults to 0, computes correctly", () => {
  // 1 * 0.0025 + 0 * 0.015 = 0.0025
  closeTo(estimateCostUsd("gpt-5.4", 1000), 0.0025);
});

// === Prompt-cache discounting (cachedTokensIn / cacheWriteTokens subsets of tokensIn) ===

test("gpt-5.1: cached input billed at 25% of input rate", () => {
  // tokensIn=10k (4k cached), out=1k. in=0.00125/1K out=0.010/1K.
  // full=6k*0.00125 + cached=4k*0.00125*0.25 + out=1k*0.010 = 7.5 + 1.25 + 10 = 18.75 (units/1000)
  // = 0.01875
  closeTo(estimateCostUsd("gpt-5.1", 10_000, 1000, 4000, 0), 0.01875);
});

test("cached call costs strictly less than the same call uncached (OpenAI)", () => {
  const cached = estimateCostUsd("gpt-5.1", 10_000, 1000, 4000, 0);
  const uncached = estimateCostUsd("gpt-5.1", 10_000, 1000, 0, 0);
  assert.ok(cached < uncached, `cached (${cached}) must be < uncached (${uncached})`);
  // 4k cached tokens save 4k * 0.00125 * (1 - 0.25) / 1000 = 0.00375
  closeTo(uncached - cached, 0.00375);
});

test("claude: cache-read at 10%, cache-write at 125% surcharge", () => {
  // tokensIn=10k = full 3k + read 6k + write 1k. out=1k. in=0.005/1K out=0.025/1K.
  // in units = 3000 + 6000*0.1 + 1000*1.25 = 3000 + 600 + 1250 = 4850
  // cost = (4850*0.005 + 1000*0.025) / 1000 = (24.25 + 25)/1000 = 0.04925
  closeTo(estimateCostUsd("claude-opus-4-8", 10_000, 1000, 6000, 1000), 0.04925);
});

test("gemini: cached input at 25% of input rate", () => {
  // tokensIn=10k (8k cached), out=2k. in=0.0015/1K out=0.009/1K.
  // full=2k*0.0015=3 + cached=8k*0.0015*0.25=3 + out=2k*0.009=18 → 24/1000 = 0.024
  closeTo(estimateCostUsd("gemini-3.5-flash", 10_000, 2000, 8000, 0), 0.024);
});

test("cache subsets are clamped: cachedTokensIn > tokensIn never goes negative", () => {
  // Defensive: a bogus cached count larger than total input must not produce a
  // negative or NaN cost. cachedRead clamps to tokensIn, full goes to 0.
  const c = estimateCostUsd("gpt-5.1", 1000, 0, 99_999, 0);
  assert.ok(Number.isFinite(c) && c >= 0, `must be finite & non-negative, got ${c}`);
  // all 1000 treated as cached: 1000 * 0.00125 * 0.25 / 1000 = 0.0003125
  closeTo(c, 0.0003125);
});

test("no cache args → identical to legacy 3-arg result (back-compat)", () => {
  closeTo(estimateCostUsd("gpt-5.1", 2000, 1000, 0, 0), estimateCostUsd("gpt-5.1", 2000, 1000));
});
