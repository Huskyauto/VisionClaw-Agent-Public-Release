import { test } from "node:test";
import assert from "node:assert";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..", "..");
const read = (path: string) => readFileSync(resolve(ROOT, path), "utf8");

test("GLM-5.3-Flash keeps its verified evaluation metadata", () => {
  const registry = read("server/model-registry.ts");
  const context = read("server/context-window-guard.ts");

  assert.match(
    registry,
    /\{ id: "z-ai\/glm-5\.3-flash".*label: "GLM 5\.3 Flash \(Evaluation\)".*capabilities: \["vision", "video", "code", "tools"\]/,
  );
  assert.match(registry, /"z-ai\/glm-5\.3-flash": 131072/);
  assert.match(context, /"z-ai\/glm-5\.3-flash": 1_310_720/);
});

test("only an explicit owner selection bypasses the global metered substitution", () => {
  const chat = read("server/chat-engine.ts");
  assert.match(chat, /OWNER_EVALUATION_MODEL_IDS = new Set\(\[[\s\S]*"z-ai\/glm-5\.3-flash"/);
  assert.match(chat, /OWNER_EVALUATION_MODEL_IDS\.has\(explicitRequestedModel\)/);
  assert.match(chat, /tenantId === \(await import\("\.\/auth"\)\)\.ADMIN_TENANT_ID/);
  assert.match(chat, /meteredOverride: ownerExplicitPaidOverride/);
  assert.match(chat, /explicitOwnerSelection: ownerExplicitPaidOverride/);
});

test("the Hermes pilot keeps precedence over a persona reasoning-tier fallback", () => {
  const conversations = read("server/routes/conversations.ts");
  assert.match(
    conversations,
    /if \(!parsed\.data\.model && !pilotModel && personaReasoningConfig\.reasoningTier && !personaReasoningConfig\.preferredModel\)/,
  );
});

test("GLM-5.3-Flash is absent from every automatic routing roster", () => {
  for (const path of [
    "server/auto-router.ts",
    "server/moa.ts",
    "data/model-tiers.json",
  ]) {
    assert.doesNotMatch(read(path), /z-ai\/glm-5\.3-flash/, `${path} must not auto-route to the evaluation model`);
  }
});