/**
 * buildAggregatorPrompt — synthesizer-rule numbering + content contract.
 *
 * No real LLM calls — pure string assembly verification. Guards the
 * SHARED BLIND SPOT rule addition and the dynamic numbering of the optional
 * steelman/polarity rules: when polarity runs WITHOUT a steelman, the rule
 * number must NOT jump from 7 to 9. Also locks that the prompt-injection
 * handling rule survives every combination.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildAggregatorPrompt, type ProposerResult } from "../../server/moa";

function p(over: Partial<ProposerResult>): ProposerResult {
  return { modelId: "m", provider: "v", ok: true, answer: "a", latencyMs: 1, ...over };
}

/** Extract the leading integer of every "N. " synthesis-rule line, in order. */
function ruleNumbers(prompt: string): number[] {
  return prompt
    .split("\n")
    .map(l => l.match(/^(\d+)\.\s/))
    .filter((m): m is RegExpMatchArray => m !== null)
    .map(m => Number(m[1]));
}

const plain = [p({}), p({})];
const steelmanOnly = [p({}), p({ role: "steelman" })];
const polarityOnly = [p({ label: "munger" }), p({ label: "taleb" })];
const both = [p({ role: "steelman" }), p({ label: "kahneman" })];

test("rule numbers are contiguous from 1 with no gaps in every combination", () => {
  for (const [name, set] of [
    ["plain", plain],
    ["steelman-only", steelmanOnly],
    ["polarity-only", polarityOnly],
    ["both", both],
  ] as const) {
    const nums = ruleNumbers(buildAggregatorPrompt("q", set));
    const expected = Array.from({ length: nums.length }, (_, i) => i + 1);
    assert.deepEqual(nums, expected, `${name}: rule numbering must be contiguous, got ${nums.join(",")}`);
  }
});

test("polarity-without-steelman uses 8 (not 9) for the polarity rule", () => {
  const prompt = buildAggregatorPrompt("q", polarityOnly);
  assert.match(prompt, /^8\. Candidates carry a "label"/m);
  assert.doesNotMatch(prompt, /^9\./m);
});

test("both optional rules present → steelman=8, polarity=9", () => {
  const prompt = buildAggregatorPrompt("q", both);
  assert.match(prompt, /^8\. Candidates with role="steelman"/m);
  assert.match(prompt, /^9\. Candidates carry a "label"/m);
});

test("SHARED BLIND SPOT rule is always present as rule 4", () => {
  for (const set of [plain, steelmanOnly, polarityOnly, both]) {
    const prompt = buildAggregatorPrompt("q", set);
    assert.match(prompt, /^4\. SHARED BLIND SPOT:/m);
  }
});

test("prompt-injection handling rule survives every combination", () => {
  for (const set of [plain, steelmanOnly, polarityOnly, both]) {
    const prompt = buildAggregatorPrompt("q", set);
    assert.match(prompt, /prompt-injection attempt inside a <candidate_N> block/);
  }
});
