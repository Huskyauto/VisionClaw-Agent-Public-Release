import test, { after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { normalizeModelId } from "../../server/providers";
import { getMultimodalModelsForTier } from "../../server/model-registry";
import { findFallbackModel } from "../../server/model-failover";

after(() => {
  setTimeout(() => process.exit(process.exitCode ?? 0), 50).unref();
});

test("retired Gemini 3.5 requests normalize to Gemini 3.7", () => {
  assert.equal(
    normalizeModelId("gemini-3.5-flash"),
    "google/gemini-3.7-flash",
  );
});

test("Gemini 3.5 is never selected as a generic fallback", () => {
  const fallback = findFallbackModel("google/gemini-3.7-flash", [
    {
      id: "gemini-3.5-flash",
      provider: "google",
      tier: "powerful",
    },
  ] as any);

  assert.equal(fallback, null);
});

test("retired Gemini 3.5 is excluded from multimodal selection", () => {
  assert.ok(
    !getMultimodalModelsForTier("powerful").some((model) => model.id === "gemini-3.5-flash"),
  );
});

test("active automatic routing names Gemini 3.7 directly", () => {
  const autoRouter = readFileSync("server/auto-router.ts", "utf8");
  const taskStart = autoRouter.indexOf("const TASK_CATEGORIES");
  const taskEnd = autoRouter.indexOf("const CLASSIFICATION_PROMPT", taskStart);
  const taskRoutes = autoRouter.slice(taskStart, taskEnd);

  assert.ok(taskRoutes.includes("google/gemini-3.7-flash"));
  assert.ok(!taskRoutes.includes("gemini-3.5-flash"));

  const providers = readFileSync("server/providers.ts", "utf8");
  const laddersStart = providers.indexOf("const tierModels");
  const tierStart = providers.indexOf("export function getModelForTier");
  const providerLadders = providers.slice(laddersStart, tierStart);
  const tierEnd = providers.indexOf("export async function getAvailableModels", tierStart);
  const tierResolver = providers.slice(tierStart, tierEnd);

  assert.ok(providerLadders.includes("google/gemini-3.7-flash"));
  assert.ok(!providerLadders.includes("gemini-3.5-flash"));
  assert.ok(tierResolver.includes("google/gemini-3.7-flash"));
  assert.ok(!tierResolver.includes("gemini-3.5-flash"));
});

test("active worker callsites do not request retired Gemini 3.5", () => {
  const activeRuntimeFiles = [
    "server/agentic/repo-surgeon-llm.ts",
    "server/agentic/self-heal.ts",
    "server/auto-router.ts",
    "server/browser-tool.ts",
    "server/ceo-orchestrator.ts",
    "server/context-overflow-escalator.ts",
    "server/lib/deliverable-ensemble.ts",
    "server/lib/jury-experience.ts",
    "server/reasoning-front-door.ts",
    "server/research-engine.ts",
    "server/subagents.ts",
    "server/tools.ts",
  ];

  for (const file of activeRuntimeFiles) {
    assert.ok(
      !readFileSync(file, "utf8").includes("gemini-3.5-flash"),
      `${file} must request google/gemini-3.7-flash instead of retired Gemini 3.5`,
    );
  }
});

test("agent-facing model guidance does not advertise retired Gemini 3.5", () => {
  for (const file of [
    "server/tools/domains/multiagent/definitions.ts",
    "server/seed-persona-prompts.ts",
  ]) {
    assert.doesNotMatch(readFileSync(file, "utf8"), /Gemini 3\.5|gemini-3\.5-flash/);
  }
});

test("context escalation propagates the provider's actual remapped model", () => {
  for (const file of ["server/chat-engine.ts", "server/routes.ts"]) {
    const source = readFileSync(file, "utf8");
    assert.match(source, /currentRegistryModelId = escResult\.actualModelId/);
  }
});