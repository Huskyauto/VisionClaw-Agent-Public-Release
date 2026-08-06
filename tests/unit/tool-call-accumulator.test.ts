/**
 * tests/unit/tool-call-accumulator.test.ts
 *
 * Covers resolveToolCallIndex in server/lib/tool-call-accumulator.ts — the
 * streaming buffer-slot resolver that keeps parallel tool calls from collapsing
 * into one slot (and concatenating their names into a bogus unknown tool) when a
 * provider streams them without a per-call `index`.
 *
 * Run: node --import tsx --test tests/unit/tool-call-accumulator.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  resolveToolCallIndex,
  SYNTHETIC_TOOL_CALL_ID_PREFIX,
  type ToolCallBuffer,
  type ToolCallDelta,
} from "../../server/lib/tool-call-accumulator";

// Replays a sequence of deltas through the same accumulation logic routes.ts uses
// and returns the final buffer map, so each test asserts on real merged output.
function accumulate(deltas: ToolCallDelta[], round = 1): Record<number, ToolCallBuffer> {
  const buffers: Record<number, ToolCallBuffer> = {};
  for (const tc of deltas) {
    const idx = resolveToolCallIndex(buffers, tc);
    if (!buffers[idx]) {
      buffers[idx] = { id: tc.id || `${SYNTHETIC_TOOL_CALL_ID_PREFIX}${idx}_${round}`, name: "", args: "" };
    }
    if (tc.function?.name) {
      const cur = buffers[idx].name;
      const incoming = tc.function.name;
      if (!cur) buffers[idx].name = incoming;
      else if (cur === incoming) { /* replay — ignore */ }
      else if (incoming.startsWith(cur)) buffers[idx].name = incoming;
      else if (!cur.endsWith(incoming)) buffers[idx].name = cur + incoming;
    }
    if (tc.function?.arguments) buffers[idx].args += tc.function.arguments;
  }
  return buffers;
}

// --- authoritative indexed path (OpenAI/Anthropic) ----------------------
test("indexed parallel calls keep their provider index unchanged", () => {
  const b = accumulate([
    { index: 0, id: "a", function: { name: "alpha" } },
    { index: 1, id: "b", function: { name: "beta" } },
    { index: 0, function: { arguments: "{\"x\":1}" } },
    { index: 1, function: { arguments: "{\"y\":2}" } },
  ]);
  assert.equal(b[0].name, "alpha");
  assert.equal(b[1].name, "beta");
  assert.equal(b[0].args, "{\"x\":1}");
  assert.equal(b[1].args, "{\"y\":2}");
});

test("indexed out-of-order deltas still route by index, not arrival order", () => {
  const b = accumulate([
    { index: 1, id: "b", function: { name: "beta" } },
    { index: 0, id: "a", function: { name: "alpha" } },
  ]);
  assert.equal(b[0].name, "alpha");
  assert.equal(b[1].name, "beta");
});

// --- the reported bug: no-index parallel calls --------------------------
test("no-index parallel calls with ids split into separate slots", () => {
  const b = accumulate([
    { id: "1", function: { name: "check_system_status", arguments: "{}" } },
    { id: "2", function: { name: "test_api_keys", arguments: "{}" } },
    { id: "3", function: { name: "list_models", arguments: "{}" } },
    { id: "4", function: { name: "agent_status", arguments: "{}" } },
  ]);
  assert.equal(Object.keys(b).length, 4);
  assert.deepEqual(
    Object.values(b).map((x) => x.name),
    ["check_system_status", "test_api_keys", "list_models", "agent_status"],
  );
  // The original bug produced exactly this mash in a single slot:
  assert.notEqual(b[0].name, "check_system_statustest_api_keyslist_modelsagent_status");
});

test("no-index parallel calls without ids split on name-after-args", () => {
  const b = accumulate([
    { function: { name: "check_system_status" } },
    { function: { arguments: "{}" } },
    { function: { name: "test_api_keys" } },
    { function: { arguments: "{}" } },
  ]);
  assert.equal(Object.keys(b).length, 2);
  assert.equal(b[0].name, "check_system_status");
  assert.equal(b[1].name, "test_api_keys");
});

// --- regressions the architect flagged: do NOT split one call -----------
test("legacy suffix-chunked single-call name still merges (no id, no index)", () => {
  const b = accumulate([
    { function: { name: "check_" } },
    { function: { name: "system_status" } },
    { function: { arguments: "{}" } },
  ]);
  assert.equal(Object.keys(b).length, 1);
  assert.equal(b[0].name, "check_system_status");
});

test("replayed name after args (same id) stays on the same call", () => {
  const b = accumulate([
    { id: "1", function: { name: "create_memory" } },
    { id: "1", function: { arguments: "{\"a\":1}" } },
    { id: "1", function: { name: "create_memory" } },
  ]);
  assert.equal(Object.keys(b).length, 1);
  assert.equal(b[0].name, "create_memory");
  assert.equal(b[0].args, "{\"a\":1}");
});

test("same name re-sent after args without ids does not spawn an empty slot", () => {
  const b = accumulate([
    { function: { name: "list_models" } },
    { function: { arguments: "{}" } },
    { function: { name: "list_models" } },
  ]);
  assert.equal(Object.keys(b).length, 1);
  assert.equal(b[0].name, "list_models");
});

test("cumulative-prefix name delta replaces rather than duplicates", () => {
  const b = accumulate([
    { index: 0, id: "a", function: { name: "get" } },
    { index: 0, function: { name: "get_weather" } },
  ]);
  assert.equal(b[0].name, "get_weather");
});

// --- regression: a real id after a synthetic-id call must NOT merge args -----
// A provider that streams the FIRST call without an id (synthetic slot) and then
// a SECOND call WITH a real id whose arguments arrive before its name used to be
// merged into the first call (the else-branch name heuristic saw no name yet).
test("real id after a synthetic-id call splits even when args precede the name", () => {
  const b = accumulate([
    { function: { name: "alpha", arguments: "{\"a\":1}" } }, // no id → synthetic slot 0
    { id: "realB", function: { arguments: "{\"b\":2}" } },   // real id, args before name
    { id: "realB", function: { name: "beta" } },             // name arrives later
  ]);
  assert.equal(Object.keys(b).length, 2);
  assert.equal(b[0].name, "alpha");
  assert.equal(b[0].args, "{\"a\":1}");
  assert.equal(b[1].name, "beta");
  assert.equal(b[1].args, "{\"b\":2}");
});
