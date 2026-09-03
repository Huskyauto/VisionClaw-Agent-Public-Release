import { test, after } from "node:test";
import assert from "node:assert/strict";

// Simulation-sandbox firewall (S1) contract tests.
// Contract: data/feature-contracts/simulation-sandbox/spec.md — acceptance #1:
//   - a destructive tool invoked during a simulation run is STUBBED (zero
//     real execution) and the call is recorded;
//   - an unknown/unclassifiable tool in sim mode is stubbed (fail-closed);
//   - simulation mode CANNOT be entered or exited via params (ALS-only);
//   - outside simulation, dispatch behavior is byte-identical (no stubs).
//
// tools.ts imports are dynamic + lazy (same pattern as tests/tools/
// dispatch.test.ts) because the module pulls in storage/providers at load.

after(() => { setTimeout(() => process.exit(process.exitCode ?? 0), 50).unref(); });

test("firewall: inactive outside runInSimulation — maybeStubTool passes everything", async () => {
  const { maybeStubTool, isSimulationActive } = await import("../../server/lib/sandbox/firewall");
  assert.equal(isSimulationActive(), false);
  assert.equal(maybeStubTool("send_email", { to: "x@y.z" }), null, "no stubbing outside a sim run");
  assert.equal(maybeStubTool("__unknown__", {}), null);
});

test("firewall: destructive tool is stubbed inside a sim run and recorded", async () => {
  const { runInSimulation, maybeStubTool, isSimStubResult } = await import("../../server/lib/sandbox/firewall");
  const { sim } = await runInSimulation("test-run-1", async () => {
    const stub = maybeStubTool("send_email", { to: "victim@example.com", body: "hello" });
    assert.ok(stub, "send_email must be stubbed in simulation");
    assert.ok(isSimStubResult(stub), "stub must carry the sim marker");
    assert.equal(stub!.stubbed, true);
    assert.equal(stub!.tool, "send_email");
    return null;
  });
  assert.equal(sim.stubbedCalls.length, 1, "stubbed call must be recorded on the run context");
  assert.equal(sim.stubbedCalls[0].tool, "send_email");
  assert.match(sim.stubbedCalls[0].argsPreview, /to=/, "args preview should name the keys");
  assert.ok(!sim.stubbedCalls[0].argsPreview.includes("victim@example.com"), "string VALUES never appear in the preview (true redaction, not truncation)");
  assert.ok(!sim.stubbedCalls[0].argsPreview.includes("hello"), "message bodies never appear in the preview");
});

test("firewall: secret-bearing keys are fully redacted in the preview", async () => {
  const { runInSimulation, maybeStubTool } = await import("../../server/lib/sandbox/firewall");
  const { sim } = await runInSimulation("test-run-redact", async () => {
    maybeStubTool("send_email", { apiKey: "sk-live-abc123", password: "hunter2", amount: 500 });
    return null;
  });
  const preview = sim.stubbedCalls[0].argsPreview;
  assert.ok(!preview.includes("sk-live-abc123"), "secret value must not leak");
  assert.ok(!preview.includes("hunter2"), "password value must not leak");
  assert.match(preview, /apiKey=\[REDACTED\]/);
  assert.match(preview, /password=\[REDACTED\]/);
  assert.match(preview, /amount=500/, "non-secret numbers still shown");
});

test("firewall: unknown tool is stubbed (fail-closed), NOT treated as read-only", async () => {
  const { runInSimulation, maybeStubTool } = await import("../../server/lib/sandbox/firewall");
  const { sim } = await runInSimulation("test-run-2", async () => {
    assert.ok(maybeStubTool("__totally_unknown_tool__", {}), "unknown tool must be stubbed");
    assert.ok(maybeStubTool("", {}), "empty name must be stubbed");
    return null;
  });
  assert.equal(sim.stubbedCalls.length, 2);
});

test("firewall: explicitly read-only tool passes through and is recorded as allowed", async () => {
  const { runInSimulation, maybeStubTool } = await import("../../server/lib/sandbox/firewall");
  const { sim } = await runInSimulation("test-run-3", async () => {
    assert.equal(maybeStubTool("search_memory", { query: "q" }), null, "read-only tool executes for real");
    assert.equal(maybeStubTool("web_search", { query: "q" }), null);
    return null;
  });
  assert.deepEqual(sim.allowedCalls, ["search_memory", "web_search"]);
  assert.equal(sim.stubbedCalls.length, 0);
});

test("firewall: params cannot forge simulation on or off (ALS-only)", async () => {
  const { runInSimulation, maybeStubTool } = await import("../../server/lib/sandbox/firewall");
  // Outside a run: params claiming simulation do nothing.
  assert.equal(maybeStubTool("send_email", { _simulation: true, simulation: true }), null);
  // Inside a run: params claiming NOT-simulation still get stubbed.
  await runInSimulation("test-run-4", async () => {
    assert.ok(maybeStubTool("send_email", { _simulation: false, simulation: false }), "cannot exit sim via params");
    return null;
  });
});

test("dispatch integration: executeTool stubs a destructive tool during simulation (zero real execution)", async () => {
  const { executeTool } = await import("../../server/tools");
  const { runInSimulation, isSimStubResult } = await import("../../server/lib/sandbox/firewall");

  const { result, sim } = await runInSimulation("test-run-5", async () => {
    // stripe_create_payout is destructive; inside sim it must return the stub
    // envelope BEFORE the rate-limit gate, TNR capture, ledger, or dispatch —
    // proving zero real execution and zero side-effect machinery engaged.
    return executeTool("stripe_create_payout", { amount: 100, _tenantId: 1 });
  });

  assert.ok(isSimStubResult(result), `expected sim stub, got: ${JSON.stringify(result).slice(0, 200)}`);
  assert.equal((result as any).tool, "stripe_create_payout");
  assert.equal(sim.stubbedCalls.length, 1);
});

test("dispatch integration: unknown tool during simulation is stubbed (fail-closed at dispatch)", async () => {
  const { executeTool } = await import("../../server/tools");
  const { runInSimulation, isSimStubResult } = await import("../../server/lib/sandbox/firewall");

  const { result } = await runInSimulation("test-run-6", async () => {
    return executeTool("__sim_unknown_tool_probe__", {});
  });
  assert.ok(isSimStubResult(result), "unknown tool must be stubbed in sim, not dispatched to the unknown-tool path");
});

test("dispatch integration: executeToolWithTimeout (guarded/plan-executor entrypoint) also hits the firewall", async () => {
  const { executeToolWithTimeout } = await import("../../server/tools");
  const { runInSimulation, isSimStubResult } = await import("../../server/lib/sandbox/firewall");

  const { result, sim } = await runInSimulation("test-run-7", async () => {
    // This is the exact path executeGuardedTool and the plan-executor step
    // runners use — proving the chokepoint holds for every real entrypoint.
    return executeToolWithTimeout("stripe_create_payout", { amount: 100, _tenantId: 1 });
  });
  assert.ok(isSimStubResult(result), "guarded/plan path must be stubbed in sim");
  assert.equal(sim.stubbedCalls.length, 1);
});

test("dispatch integration: outside simulation, unknown tool still returns the normal structured error", async () => {
  const { executeTool } = await import("../../server/tools");
  const result = await executeTool("__sim_firewall_baseline_probe__", {});
  assert.ok(result?.error, "baseline behavior unchanged outside sim");
  assert.match(result.error, /[Uu]nknown tool/);
});
