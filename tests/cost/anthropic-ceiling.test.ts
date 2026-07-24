import { test, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  noteModelSpend,
  meteredAnthropicCeiling,
  isCostExemptLane,
  __resetAnthropicDailySpendForTest,
} from "../../server/agentic/cost-ledger";

after(() => { setTimeout(() => process.exit(process.exitCode ?? 0), 50).unref(); });

// Metered-Anthropic daily circuit breaker regression net (Bob 2026-06-12).
// Backstop for the $440 / 752-call runaway: Opus/Claude is JURY-ONLY, and any
// NON-jury metered Claude spend accumulates against a daily ceiling (default
// $25). Once crossed, providers.ts fails CLOSED on further metered Anthropic
// calls. These are pure unit tests — no DB, no network. They lock in:
//   1. only metered (cost>0) claude spend counts (flat-rate runner records ~$0)
//   2. non-claude models never count
//   3. the JURY lane (":jury" toolName marker) is ALWAYS exempt — it can never
//      trip its own breaker, even at huge spend
//   4. the ceiling trips on cumulative NON-jury metered spend only
// The default ceiling is $25; tests use amounts well clear of that boundary so
// they don't depend on the exact env-tunable value.

beforeEach(() => { __resetAnthropicDailySpendForTest(); });

test("fresh day: ceiling not exceeded, spent is 0", () => {
  const g = meteredAnthropicCeiling();
  assert.equal(g.exceeded, false);
  assert.equal(g.spent, 0);
  assert.ok(g.ceiling > 0);
});

test("non-claude models never count toward the Anthropic ceiling", () => {
  noteModelSpend("gpt-5.4", 100);
  noteModelSpend("gemini-3.5-flash", 100);
  assert.equal(meteredAnthropicCeiling().spent, 0);
});

test("$0-cost claude (flat-rate Claude Runner) does not inflate the counter", () => {
  noteModelSpend("claude-opus-4-8", 0);
  noteModelSpend("claude-opus-4-8", -5); // defensive: negatives ignored too
  assert.equal(meteredAnthropicCeiling().spent, 0);
});

test("metered NON-jury claude accumulates and trips the ceiling", () => {
  noteModelSpend("claude-opus-4-8", 10, "llm.anthropic");
  assert.equal(meteredAnthropicCeiling().exceeded, false);
  noteModelSpend("claude-opus-4-8", 30, "llm.anthropic"); // cumulative 40 > 25
  const g = meteredAnthropicCeiling();
  assert.equal(g.exceeded, true);
  assert.equal(g.spent, 40);
});

test("JURY lane is exempt — huge jury spend never trips the breaker", () => {
  noteModelSpend("claude-opus-4-8", 1000, "llm.anthropic:jury");
  const g = meteredAnthropicCeiling();
  assert.equal(g.exceeded, false);
  assert.equal(g.spent, 0);
});

test("mixed traffic: only NON-jury metered claude counts toward the ceiling", () => {
  noteModelSpend("claude-opus-4-8", 500, "llm.anthropic:jury"); // jury — exempt
  noteModelSpend("gpt-5.4", 500);                                 // non-claude — ignored
  noteModelSpend("claude-opus-4-8", 0, "llm.anthropic");          // $0 runner — ignored
  noteModelSpend("claude-opus-4-8", 30, "llm.anthropic");         // metered non-jury — counts
  const g = meteredAnthropicCeiling();
  assert.equal(g.spent, 30);
  assert.equal(g.exceeded, true);
});

// ── FLAGSHIP lane (Bob 2026-06-12): the once-weekly Built With Bob recap ──────
// is the one OTHER owner-blessed Opus use besides the jury. It is tagged
// ":flagship" and gets the SAME breaker exemption — a bounded weekly recap must
// never be killed mid-render by an unrelated runaway elsewhere.

test("isCostExemptLane recognizes both jury and flagship lanes (and nothing else)", () => {
  assert.equal(isCostExemptLane("llm.anthropic:jury"), true);
  assert.equal(isCostExemptLane("llm.anthropic:flagship"), true);
  assert.equal(isCostExemptLane("llm.anthropic"), false);
  assert.equal(isCostExemptLane(undefined), false);
  assert.equal(isCostExemptLane(""), false);
});

test("FLAGSHIP lane is exempt — huge recap spend never trips the breaker", () => {
  noteModelSpend("claude-opus-4-8", 1000, "llm.anthropic:flagship");
  const g = meteredAnthropicCeiling();
  assert.equal(g.exceeded, false);
  assert.equal(g.spent, 0);
});

test("flagship + jury both exempt; only the plain metered lane counts", () => {
  noteModelSpend("claude-opus-4-8", 400, "llm.anthropic:flagship"); // recap — exempt
  noteModelSpend("claude-opus-4-8", 400, "llm.anthropic:jury");     // jury — exempt
  noteModelSpend("claude-opus-4-8", 30, "llm.anthropic");           // everyday metered — counts
  const g = meteredAnthropicCeiling();
  assert.equal(g.spent, 30);
  assert.equal(g.exceeded, true);
});
