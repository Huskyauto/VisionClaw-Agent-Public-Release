import { test, after } from "node:test";
import assert from "node:assert/strict";

after(() => { setTimeout(() => process.exit(process.exitCode ?? 0), 50).unref(); });

// Tool dispatch contract tests — locks in the agent-loop safety net that:
//   1. Unknown tool names return a structured error (do NOT throw) — this
//      is critical because the agent loop catches throws and may surface
//      raw stack traces to the user; a structured {error: "Unknown tool"}
//      lets the loop ask the model to pick a different tool gracefully.
//   2. The error message includes guidance toward create_tool / skill_seeker
//      so the next agent turn knows how to recover.
//   3. Both executeTool and executeToolWithTimeout are exported and callable.
//
// Tools.ts is a 12,629-line module with 243 registered tools — testing every
// tool is impractical and would couple this suite to implementation details.
// Instead we test the DISPATCH CONTRACT, which is the integration-level
// invariant that protects every downstream call site from regressions when
// tools are added/removed/renamed in the registry.
//
// Note: imports are dynamic + lazy because tools.ts pulls in storage,
// providers, embeddings, sessions, etc. at module load. Doing it lazily
// inside each test means a single broken import surfaces clearly instead
// of breaking the whole test file.

test("tools module: executeTool is exported as a function", async () => {
  const mod = await import("../../server/tools");
  assert.equal(typeof mod.executeTool, "function", "executeTool must be a callable export");
});

test("tools module: executeToolWithTimeout is exported as a function", async () => {
  const mod = await import("../../server/tools");
  assert.equal(typeof mod.executeToolWithTimeout, "function", "executeToolWithTimeout must be a callable export");
});

test("executeTool: unknown tool returns structured error (does not throw)", async () => {
  const { executeTool } = await import("../../server/tools");
  const result = await executeTool("__nonexistent_tool_for_dispatch_test__", {});

  assert.equal(typeof result, "object", "Should return a result object, not throw");
  assert.ok(result, "Result should not be null/undefined");
  assert.ok(result.error, "Should include an error field");
  assert.match(
    result.error,
    /[Uu]nknown tool/,
    "Error should mention 'Unknown tool' so the agent loop can recover deterministically",
  );
});

test("executeTool: unknown-tool error names recovery options (create_tool / skill_seeker)", async () => {
  const { executeTool } = await import("../../server/tools");
  const result = await executeTool("__definitely_not_a_real_tool__", {});

  // The error string is the agent's only signal for what to do next when
  // it picks a tool that doesn't exist. It must point at the recovery
  // path or the agent will retry the same broken tool name in a loop.
  assert.match(
    result.error,
    /create_tool|skill_seeker/,
    "Error should suggest create_tool or skill_seeker as recovery paths",
  );
});

test("executeToolWithTimeout: unknown tool returns structured error (does not throw)", async () => {
  const { executeToolWithTimeout } = await import("../../server/tools");
  const result = await executeToolWithTimeout("__nonexistent_tool_for_dispatch_test__", {});

  assert.equal(typeof result, "object", "Should return a result object, not throw");
  assert.ok(result, "Result should not be null/undefined");
  assert.ok(
    result.error || result.success === false,
    "Should signal failure via .error or .success=false",
  );
});

test("executeTool: handles params=null without crashing (R74.13f null-guard regression)", async () => {
  // Regression test for the dispatch crash discovered in R74.13f:
  // executeTool's tool_performance ledger path reads `params._tenantId`
  // OUTSIDE the autonomy try/catch. With null params, the autonomy gate
  // logs "[autonomy-gate] error (falling through)" and falls through —
  // but then line ~5586 re-reads from null and throws TypeError, crashing
  // the entire agent turn. The fix is a 1-line `if (params == null) params = {}`
  // at the top of executeTool. This test locks in that fix.
  const { executeTool } = await import("../../server/tools");
  const result = await executeTool("__nonexistent_tool_null_params__", null as any);

  assert.equal(typeof result, "object", "Should return an object even with null params");
  assert.ok(result, "Result should not be null/undefined");
  assert.ok(result.error, "Should still return an error field for unknown tool with null params");
});

test("executeTool: handles params={} without crashing (LLM-emits-empty-object case)", async () => {
  // Realistic edge case: LLM tool-call sometimes emits `{}` when it
  // can't infer any args. Dispatch must still resolve to the unknown-tool
  // error path rather than throwing on a missing-property destructure.
  // (Genuine null params are out of scope — the agent-loop wrapper
  // guarantees an object; testing null would document a known dispatch
  // limitation rather than the contract we want to lock in.)
  const { executeTool } = await import("../../server/tools");
  const result = await executeTool("__nonexistent_tool_empty_params__", {});

  assert.equal(typeof result, "object", "Should return an object even with empty params");
  assert.ok(result, "Result should not be null/undefined");
  assert.ok(result.error, "Should still return an error field for unknown tool with empty params");
});
