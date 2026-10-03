import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  DEFAULT_CHAT_MODEL_ID,
  DEFAULT_CHAT_MODEL_LABEL,
  HIGH_END_WORK_MODEL_ID,
} from "../../server/chat-model-default";
import { MODEL_REGISTRY } from "../../server/model-registry";
import { normalizeModelId, providerLaneCanServeModel } from "../../server/providers";

test("VisionClaw chat defaults to GPT-5.6 Luna on the Profundo flat-rate lane", () => {
  assert.equal(DEFAULT_CHAT_MODEL_ID, "gpt-5.6-luna");
  assert.equal(DEFAULT_CHAT_MODEL_LABEL, "GPT-5.6 Luna");
  assert.equal(providerLaneCanServeModel("profundo", DEFAULT_CHAT_MODEL_ID), true);

  const model = MODEL_REGISTRY.find((entry) => entry.id === DEFAULT_CHAT_MODEL_ID);
  assert.ok(model);
  assert.equal(model.provider, "replit");
  assert.equal(model.costClass, "free");
  assert.ok(model.capabilities?.includes("tools"));
  assert.equal(HIGH_END_WORK_MODEL_ID, "gpt-5.6-sol");
  assert.equal(providerLaneCanServeModel("profundo", HIGH_END_WORK_MODEL_ID), true);
});

test("production LLM work does not use gpt-5-mini", () => {
  const workSources = [
    "server/chat-engine.ts",
    "server/routes.ts",
    "server/voice.ts",
    "server/user-modeling.ts",
    "server/task-planner.ts",
    "server/critique-agent.ts",
    "server/self-reflection.ts",
    "server/debate-engine.ts",
    "server/treasury.ts",
    "server/audit-fix-kit.ts",
    "server/tree-of-thought.ts",
    "server/self-improvement.ts",
  ];

  for (const path of workSources) {
    const source = readFileSync(path, "utf8");
    assert.doesNotMatch(source, /model:\s*"gpt-5-mini"/, path);
    assert.doesNotMatch(source, /getClientForModel\("gpt-5-mini"/, path);
  }

  for (const path of workSources.slice(4)) {
    assert.match(readFileSync(path, "utf8"), /HIGH_END_WORK_MODEL_ID/, path);
  }

  const tiers = JSON.parse(readFileSync("data/model-tiers.json", "utf8"));
  assert.deepEqual(tiers.mundane, ["gpt-5.6-luna"]);
});

test("persisted retired model ids remain compatible across chat entry points", () => {
  assert.equal(normalizeModelId("gpt-5-mini"), "gpt-5.4");
  assert.equal(normalizeModelId("o4-mini"), "gpt-5.4");
  assert.equal(normalizeModelId("o4-mini-openai"), "gpt-5.4");
  assert.equal(normalizeModelId("openai/gpt-5-mini"), "gpt-5.4");
  assert.ok(MODEL_REGISTRY.some((entry) => entry.id === "gpt-5.4"));
  assert.ok(!MODEL_REGISTRY.some((entry) => entry.id === "gpt-5-mini"));

  const engineSource = readFileSync("server/chat-engine.ts", "utf8");
  const publicChatSource = readFileSync("server/routes/public-chat.ts", "utf8");
  const schemaSource = readFileSync("shared/schema.ts", "utf8");
  const chatUiSource = readFileSync("client/src/pages/chat.tsx", "utf8");
  const settingsUiSource = readFileSync("client/src/pages/settings.tsx", "utf8");
  const predictorSource = readFileSync("server/resource-predictor.ts", "utf8");
  assert.match(engineSource, /normalizeModelId\(conv\.model \|\| DEFAULT_CHAT_MODEL_ID\)/);
  assert.match(publicChatSource, /normalizeModelId\(conv\.model\)/);
  assert.doesNotMatch(schemaSource, /\.default\("gpt-5-mini"\)/);
  assert.equal((schemaSource.match(/\.default\("gpt-5\.4"\)/g) || []).length >= 2, true);
  assert.doesNotMatch(chatUiSource, /\|\| "gpt-5-mini"/);
  assert.doesNotMatch(settingsUiSource, /defaultModel:\s*"gpt-5-mini"/);
  assert.doesNotMatch(predictorSource, /modelId:\s*string\s*=\s*"gpt-5-mini"/);
});

test("retired-model script guard rejects every JavaScript string delimiter", () => {
  const config = JSON.parse(readFileSync("data/preflight-stale-strings.json", "utf8"));
  const rule = config.rules.find((entry: { id: string }) => entry.id === "retired-gpt5-mini-script-execution");
  assert.ok(rule);
  const match = /^\/([\s\S]*)\/([a-z]*)$/.exec(rule.pattern);
  assert.ok(match);
  const pattern = new RegExp(match[1], match[2]);

  for (const literal of ['"gpt-5-mini"', "'openai/gpt-5-mini'", "`o4-mini-openai`"]) {
    assert.match(literal, pattern);
  }
  assert.doesNotMatch('"gpt-5.4"', pattern);
  assert.deepEqual(rule.allowed_files, []);
});

test("adaptive hard routing follows the shared high-end model policy", () => {
  const engineSource = readFileSync("server/chat-engine.ts", "utf8");
  assert.match(
    engineSource,
    /const HARD_ROUTE_MODEL = process\.env\.ADAPTIVE_HARD_ROUTE_MODEL \|\| HIGH_END_WORK_MODEL_ID/,
  );
  assert.doesNotMatch(engineSource, /ADAPTIVE_HARD_ROUTE_MODEL \|\| "moonshotai\/kimi-k2\.6"/);
});

test("every live chat entry point uses the shared Luna default", () => {
  const sources = Object.fromEntries(
    [
      "server/routes.ts",
      "server/chat-engine.ts",
      "server/routes/conversations.ts",
      "server/routes/platform-config.ts",
      "server/routes/api-v1.ts",
      "server/telegram.ts",
      "server/discord.ts",
      "server/webhook-triggers.ts",
      "server/routes/slack.ts",
      "server/whatsapp.ts",
      "server/webhooks.ts",
      "server/routes/tenants.ts",
      "server/voice.ts",
      "server/routes/public-chat.ts",
    ].map((path) => [path, readFileSync(path, "utf8")]),
  );
  const routeSource = sources["server/routes.ts"];
  const engineSource = sources["server/chat-engine.ts"];
  const conversationSource = sources["server/routes/conversations.ts"];
  const settingsSource = sources["server/routes/platform-config.ts"];

  assert.match(routeSource, /conv\.model \|\| DEFAULT_CHAT_MODEL_ID/);
  assert.match(routeSource, /modelId: DEFAULT_CHAT_MODEL_ID, label: DEFAULT_CHAT_MODEL_LABEL/g);
  assert.match(engineSource, /conv\.model \|\| DEFAULT_CHAT_MODEL_ID/);
  assert.equal((engineSource.match(/model = DEFAULT_CHAT_MODEL_ID;/g) || []).length, 2);
  assert.match(conversationSource, /settings\?\.defaultModel \|\|[\s\S]*DEFAULT_CHAT_MODEL_ID/);
  assert.match(settingsSource, /defaultModel: DEFAULT_CHAT_MODEL_ID/);

  for (const source of Object.values(sources)) {
    assert.match(source, /DEFAULT_CHAT_MODEL_ID/);
    assert.doesNotMatch(source, /failing open to gpt-5\.6-sol/);
    assert.doesNotMatch(source, /conv\.model \|\| "gpt-5\.6-sol"/);
  }

  assert.doesNotMatch(sources["server/routes/api-v1.ts"], /settings\?\.defaultModel \|\| "deepseek\/deepseek-v3\.2"/);
  for (const path of ["server/telegram.ts", "server/discord.ts", "server/webhook-triggers.ts"]) {
    assert.doesNotMatch(sources[path], /settings\?\.defaultModel \|\| "gemini-2\.5-flash"/);
  }
  assert.doesNotMatch(sources["server/whatsapp.ts"], /settings\?\.defaultModel \|\| "gpt-5"/);
  assert.doesNotMatch(sources["server/webhooks.ts"], /settings\?\.defaultModel \|\| "gemini-2\.5-flash"/);
  assert.doesNotMatch(sources["server/routes/tenants.ts"], /settings\?\.defaultModel \|\| "gemini-2\.5-flash"/);
  assert.doesNotMatch(sources["server/voice.ts"], /conv\.model \|\| "gemini-2\.5-flash"/);
  assert.doesNotMatch(sources["server/routes/public-chat.ts"], /const model = "deepseek\/deepseek-v3\.2"/);
  assert.doesNotMatch(sources["server/routes/public-chat.ts"], /model: "auto"/);
  assert.doesNotMatch(sources["server/routes/slack.ts"], /model:\s*['"]gpt-5\.6-sol['"]/);
});