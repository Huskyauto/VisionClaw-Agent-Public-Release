// R125+137.24 — Invariant test for the tool-router hard cap (ChatGPT 5.6
// external-review finding: routeTools() added whole categories with no
// slice-back to maxTools). Tests the pure helper directly — importing
// server/tool-router.ts would pull tool-curator's pg pool and hang node:test
// at exit (see memory: node-test DB-pool hang).
import { test } from "node:test";
import assert from "node:assert/strict";
import { enforceToolCap, estimateSchemaTokens } from "../../server/lib/tool-cap";

const tool = (name: string) => ({ function: { name } });

test("caps to maxTools, dropping lowest-priority tail first", () => {
  const always = new Set(["a1", "a2"]);
  const order = ["a1", "a2", "p1", "p2", "p3", "p4"];
  const tools = order.map(tool);
  const { tools: capped, trimmed } = enforceToolCap(tools, 4, always, order);
  assert.equal(capped.length, 4);
  assert.equal(trimmed, 2);
  assert.deepEqual(capped.map(t => t.function.name), ["a1", "a2", "p1", "p2"]);
});

test("never trims ALWAYS_INCLUDE even when the always set alone exceeds maxTools", () => {
  const always = new Set(["a1", "a2", "a3", "a4", "a5"]);
  const order = ["a1", "a2", "a3", "a4", "a5", "p1"];
  const { tools: capped, trimmed } = enforceToolCap(order.map(tool), 3, always, order);
  assert.equal(trimmed, 1);
  assert.deepEqual(capped.map(t => t.function.name), ["a1", "a2", "a3", "a4", "a5"]);
});

test("no-op when already within cap", () => {
  const tools = ["a", "b", "c"].map(tool);
  const { tools: capped, trimmed } = enforceToolCap(tools, 5, new Set(["a"]), ["a", "b", "c"]);
  assert.equal(trimmed, 0);
  assert.equal(capped, tools);
});

test("no-op (fail open) on invalid maxTools", () => {
  const tools = ["a", "b", "c"].map(tool);
  for (const bad of [0, -1, NaN, Infinity * -1]) {
    const { trimmed } = enforceToolCap(tools, bad as number, new Set(), ["a", "b", "c"]);
    assert.equal(trimmed, 0);
  }
});

test("tools missing from priority order are trimmed last-priority", () => {
  const always = new Set<string>();
  const tools = ["known1", "unknown", "known2"].map(tool);
  const { tools: capped } = enforceToolCap(tools, 2, always, ["known1", "known2"]);
  assert.deepEqual(capped.map(t => t.function.name).sort(), ["known1", "known2"]);
});

test("invariant: result length ≤ max(maxTools, always∩tools)", () => {
  const always = new Set(["a1"]);
  for (let n = 1; n <= 60; n++) {
    const order = ["a1", ...Array.from({ length: n }, (_, i) => `t${i}`)];
    const { tools: capped } = enforceToolCap(order.map(tool), 40, always, order);
    assert.ok(capped.length <= Math.max(40, 1));
  }
});

test("estimateSchemaTokens returns a positive rough count", () => {
  const est = estimateSchemaTokens([{ function: { name: "x", description: "y".repeat(400) } }]);
  assert.ok(est > 50);
});
