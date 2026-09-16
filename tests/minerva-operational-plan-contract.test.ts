import test from "node:test";
import assert from "node:assert/strict";
import { composeHeuristicPlan } from "../server/minerva-planner";

test("auto-routed operational plans delegate real specialist work instead of simulating execution", () => {
  const plan = composeHeuristicPlan({
    objective: "Reduce heartbeat frequency for low-yield reflective tasks",
    source: "agentic-engine.auto-apply",
    tenantId: 1,
  });

  assert.ok(plan.steps.length >= 2);
  assert.equal(plan.steps.some((step) => step.agent === "Forge"), true);
  for (const step of plan.steps) {
    assert.equal(step.tool, "delegate_task");
    assert.equal(step.args?.targetAgent, step.agent);
    assert.equal(step.args?.schedule, "once");
    const substitutedPrompt = String(step.args?.prompt).replace("{{prev}}", "x".repeat(800));
    assert.ok(substitutedPrompt.length <= 2_000);
    assert.equal("_tenantId" in (step.args ?? {}), false);
    assert.equal("_personaId" in (step.args ?? {}), false);
  }
});