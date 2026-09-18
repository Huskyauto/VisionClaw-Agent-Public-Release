import { test } from "node:test";
import assert from "node:assert";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..", "..");
const read = (path: string) => readFileSync(resolve(ROOT, path), "utf8");

test("Hy4-preview has evaluation-only registry and context metadata", () => {
  const registry = read("server/model-registry.ts");
  const context = read("server/context-window-guard.ts");

  assert.match(
    registry,
    /\{ id: "tencent\/hy4-preview".*label: "Hy4 Preview \(Evaluation\)".*capabilities: \["code", "tools"\]/,
  );
  assert.match(registry, /"tencent\/hy4-preview": 64000/);
  assert.match(context, /"tencent\/hy4-preview": 1_048_576/);
});

test("Hy4-preview requires explicit owner selection to use its metered OpenRouter route", () => {
  const registry = read("server/model-registry.ts");
  const providers = read("server/providers.ts");
  const routes = read("server/routes.ts");
  const conversations = read("server/routes/conversations.ts");
  assert.match(registry, /isOwnerOnlyFinalDecisionModel[\s\S]*modelId === "tencent\/hy4-preview"/);
  assert.match(providers, /const explicitOwnerOnlyModel = isOwnerOnlyFinalDecisionModel\(modelId\)/);
  assert.match(providers, /options\?\.explicitOwnerSelection === true[\s\S]*options\?\.platformAdminVerified === true[\s\S]*tenantId === \(await import\("\.\/auth"\)\)\.ADMIN_TENANT_ID/);
  assert.match(routes, /isPlatformAdmin\(req\) && isOwnerOnlyFinalDecisionModel\(model\)/);
  assert.match(routes, /platformAdminVerified: ownerExplicitPaidOverride/);
  assert.match(
    conversations,
    /!isOwnerOnlyFinalDecisionModel\(requestedModel\) \|\| explicitModelSelected/,
    "owner-only models must never come from a persona or global default",
  );
});

test("Hy4-preview is absent from every automatic routing roster", () => {
  for (const path of [
    "server/auto-router.ts",
    "server/moa.ts",
    "data/model-tiers.json",
  ]) {
    assert.doesNotMatch(read(path), /tencent\/hy4-preview/, `${path} must not auto-route to the evaluation model`);
  }
  const providers = read("server/providers.ts");
  assert.match(
    providers,
    /getAvailableModels\(\)[\s\S]*!isOwnerOnlyFinalDecisionModel\(m\.id\)/,
    "generic automatic routing inventory must exclude owner-only models",
  );
});