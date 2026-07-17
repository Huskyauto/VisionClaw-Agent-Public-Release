import { test } from "node:test";
import assert from "node:assert/strict";
import {
  classifyRetirementCandidates,
  isExempt,
  parseExemptions,
  type ClassifyRetirementInput,
  type RetirementUsage,
} from "../../server/lib/tool-retirement";

const NOW = new Date("2026-07-15T00:00:00Z");
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 24 * 3600 * 1000);

function baseInput(over: Partial<ClassifyRetirementInput> = {}): ClassifyRetirementInput {
  return {
    tools: [],
    usage: new Map<string, RetirementUsage>(),
    exemptions: { tools: new Set(), categories: new Set() },
    windowDays: 45,
    minSample: 10,
    failRateThreshold: 0.5,
    maxCandidates: 10,
    now: NOW,
    ...over,
  };
}

test("never-invoked tool is flagged zero_invocations", () => {
  const out = classifyRetirementCandidates(
    baseInput({ tools: [{ name: "dusty_tool", categories: ["misc"] }] }),
  );
  assert.equal(out.length, 1);
  assert.equal(out[0].tool, "dusty_tool");
  assert.equal(out[0].reason, "zero_invocations");
  assert.equal(out[0].evidence.lastActivityAt, null);
});

test("recently used tool is NOT flagged", () => {
  const usage = new Map([["fresh_tool", { successCount: 5, failCount: 0, lastActivityAt: daysAgo(2) }]]);
  const out = classifyRetirementCandidates(
    baseInput({ tools: [{ name: "fresh_tool", categories: [] }], usage }),
  );
  assert.equal(out.length, 0);
});

test("stale-beyond-window tool IS flagged", () => {
  const usage = new Map([["stale_tool", { successCount: 5, failCount: 0, lastActivityAt: daysAgo(90) }]]);
  const out = classifyRetirementCandidates(
    baseInput({ tools: [{ name: "stale_tool", categories: [] }], usage }),
  );
  assert.equal(out.length, 1);
  assert.equal(out[0].reason, "zero_invocations");
});

test("exemption by tool name and by category both hold", () => {
  const exemptions = { tools: new Set(["kill_switch"]), categories: new Set(["safety"]) };
  assert.equal(isExempt({ name: "kill_switch", categories: [] }, exemptions), true);
  assert.equal(isExempt({ name: "crisis_guard", categories: ["safety"] }, exemptions), true);
  assert.equal(isExempt({ name: "misc_tool", categories: ["misc"] }, exemptions), false);
  const out = classifyRetirementCandidates(
    baseInput({
      tools: [
        { name: "kill_switch", categories: [] },
        { name: "crisis_guard", categories: ["safety"] },
      ],
      exemptions,
    }),
  );
  assert.equal(out.length, 0);
});

test("high-failure flag requires min sample", () => {
  const usage = new Map([
    ["small_sample", { successCount: 1, failCount: 4, lastActivityAt: daysAgo(1) }],
    ["big_sample", { successCount: 3, failCount: 9, lastActivityAt: daysAgo(1) }],
  ]);
  const out = classifyRetirementCandidates(
    baseInput({
      tools: [
        { name: "small_sample", categories: [] },
        { name: "big_sample", categories: [] },
      ],
      usage,
    }),
  );
  assert.equal(out.length, 1);
  assert.equal(out[0].tool, "big_sample");
  assert.equal(out[0].reason, "high_failure");
  assert.ok((out[0].evidence.failRate ?? 0) >= 0.5);
});

test("cap respected, high-failure prioritized over zero-invocation, deterministic order", () => {
  const usage = new Map([["broken_tool", { successCount: 0, failCount: 20, lastActivityAt: daysAgo(1) }]]);
  const tools = [
    { name: "zzz_dust", categories: [] },
    { name: "aaa_dust", categories: [] },
    { name: "broken_tool", categories: [] },
  ];
  const out = classifyRetirementCandidates(baseInput({ tools, usage, maxCandidates: 2 }));
  assert.equal(out.length, 2);
  assert.equal(out[0].tool, "broken_tool");
  assert.equal(out[1].tool, "aaa_dust"); // ties by name, never-invoked first
});

test("maxCandidates 0 returns empty", () => {
  const out = classifyRetirementCandidates(
    baseInput({ tools: [{ name: "dusty", categories: [] }], maxCandidates: 0 }),
  );
  assert.equal(out.length, 0);
});

// --- parseExemptions: strict, fail-closed loader ---

test("parseExemptions: valid shape parses into Sets", () => {
  const ex = parseExemptions({ tools: ["exec"], categories: ["safety"] });
  assert.ok(ex.tools.has("exec"));
  assert.ok(ex.categories.has("safety"));
});

test("parseExemptions: throws on non-object roots", () => {
  for (const bad of [null, undefined, "x", 42, ["tools"]]) {
    assert.throws(() => parseExemptions(bad), /must be a JSON object/);
  }
});

test("parseExemptions: throws when a key is missing or not an array", () => {
  assert.throws(() => parseExemptions({ tools: ["a"] }), /categories must be an array/);
  assert.throws(() => parseExemptions({ categories: ["a"] }), /tools must be an array/);
  assert.throws(() => parseExemptions({ tools: "a", categories: [] }), /tools must be an array/);
  assert.throws(() => parseExemptions({ tools: [], categories: {} }), /categories must be an array/);
});

test("parseExemptions: throws on non-string or empty entries", () => {
  assert.throws(() => parseExemptions({ tools: [1], categories: [] }), /non-string or empty/);
  assert.throws(() => parseExemptions({ tools: [], categories: ["  "] }), /non-string or empty/);
  assert.throws(() => parseExemptions({ tools: [null], categories: [] }), /non-string or empty/);
});
