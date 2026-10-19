import test from "node:test";
import assert from "node:assert/strict";
import { routeTools, MAX_ROUTED_TOOLS_PER_TURN } from "../../server/tool-router";
import { getAllToolDefinitions } from "../../server/tools";
import { ownerTenantId } from "../../server/agentic/autonomous-budget";

test("combined owner pilots stay interactive and require a real first tool call for both agents", async () => {
  const all = await getAllToolDefinitions();
  for (const personaId of [2, 3]) {
    const route = await routeTools(all, [{ role: "user", content:
      "Run all five business_pilot analyses directly: health, release, governance, cost and readiness." }],
    { maxTools: MAX_ROUTED_TOOLS_PER_TURN, personaId, tenantId: ownerTenantId() });
    assert.equal(route.requiredToolName, "business_pilot");
    for (const name of ["orchestrate", "delegate_task", "spawn_agent"])
      assert.ok(!route.tools.some(tool => tool.function.name === name), `${name} cannot hand off an owner-only pilot`);
    assert.match(route.contrastiveNote || "", /interactive/i);
  }
});

test("a pilot mention or explicit opt-out does not force a tool invocation", async () => {
  const all = await getAllToolDefinitions();
  for (const content of [
    "Do not call business_pilot. Explain the feature without tools.",
    "I am considering the business pilot feature.",
  ]) {
    const route = await routeTools(all, [{ role: "user", content }],
      { personaId: 2, tenantId: ownerTenantId(), maxTools: MAX_ROUTED_TOOLS_PER_TURN });
    assert.equal(route.requiredToolName, undefined);
  }
});

test("owner pilot menu preserves existing finance and coordination tools; other callers cannot discover it", async () => {
  const all = await getAllToolDefinitions();
  const messages = [{ role: "user", content: "Review business health and place a status update in the Spark outbox." }];
  const routed = await routeTools(all, messages, { maxTools: MAX_ROUTED_TOOLS_PER_TURN,
    personaId: 2, tenantId: ownerTenantId(), personaRole: "CEO Persona" });
  const names = routed.tools.map(tool => tool.function.name);
  for (const name of ["business_pilot", "cash_flow_summary", "spark_send_message", "grok_send_message", "instinct_send_message"])
    assert.ok(names.includes(name), `${name} must survive the capped menu`);
  for (const scope of [{ personaId: 1, tenantId: ownerTenantId() }, { personaId: 2, tenantId: ownerTenantId() + 1 }]) {
    const denied = await routeTools(all, [{ role: "user", content: "Describe our business pilot." }], {
      ...scope, maxTools: MAX_ROUTED_TOOLS_PER_TURN, personaRole: "CEO Persona",
    });
    assert.ok(!denied.tools.some(tool => tool.function.name === "business_pilot"));
  }
});
