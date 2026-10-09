import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const source = fs.readFileSync("server/routes/public-chat.ts", "utf8");

test("public chat distinguishes a daily cap from a short per-IP rate limit", () => {
  const client = fs.readFileSync("client/src/pages/public-chat.tsx", "utf8");
  assert.match(source, /code: "PUBLIC_CHAT_DAILY_LIMIT"/);
  assert.match(client, /body\.code === "PUBLIC_CHAT_DAILY_LIMIT"/);
  assert.match(client, /try again in a minute/);
  assert.match(client, /try again tomorrow \(UTC\)/);
});

test("anonymous public chat prompt is independent of tenant memories, knowledge, skills, and prompt builder", () => {
  assert.match(source, /const PUBLIC_CHAT_SYSTEM_PROMPT = `You are a helpful, concise AI assistant/);
  assert.doesNotMatch(source, /buildSystemPrompt|getMemoryEntries|getEnabledSkillsWithPrompts|getKnowledge/);
  assert.doesNotMatch(source, /memResult|enabledSkills|knResult/);
});

test("anonymous public chat exposes no callable tools or knowledge search route", () => {
  assert.doesNotMatch(source, /getAllToolDefinitions|createParams\.tools|tool_choice/);
  assert.doesNotMatch(source, /knowledge_search|search_web/);
  assert.match(source, /stream:\s*true/);
  assert.match(source, /res\.write\(`data: \$\{JSON\.stringify\(\{ content: contentDelta \}\)\}\\n\\n`\)/);
});

test("public completion cap is 1000 tokens on primary and provider fallback", () => {
  assert.match(source, /const PUBLIC_CHAT_MAX_COMPLETION_TOKENS = 1000;/);
  assert.match(source, /max_completion_tokens:\s*PUBLIC_CHAT_MAX_COMPLETION_TOKENS/);
  assert.match(source, /createParams\.max_completion_tokens = PUBLIC_CHAT_MAX_COMPLETION_TOKENS/);
  assert.equal((source.match(/chat\.completions\.create\(createParams\)/g) || []).length, 2,
    "only one completion attempt and its fallback are allowed, with no multi-round aggregate budget");
});

test("public chat claims daily admission before writes or provider calls and rejects before SSE", () => {
  const claim = source.indexOf("claimPublicChatAdmission(convTenantId)");
  assert.notEqual(claim, -1);
  assert.ok(claim < source.indexOf("storage.createMessage({ conversationId: convId, role: \"user\""),
    "admission is checked before persisting visitor content");
  assert.ok(claim < source.indexOf("activeClient.chat.completions.create(createParams)"),
    "the primary and fallback share a request claim before either completion attempt");
  assert.match(source, /if \(!admission\.admitted\)[\s\S]*?res\.status\(429\)/);
  assert.match(source, /catch \(_budgetErr\)[\s\S]*?res\.status\(503\)/);
  assert.doesNotMatch(source, /conv\.tenantId\s*\?\?\s*ADMIN_TENANT_ID/);
  assert.match(source, /conv\.tenantId == null \|\| conv\.tenantId !== tenant\.id/);
});

test("public chat title is deterministic local text with no additional model call", () => {
  assert.doesNotMatch(source, /Generate a concise 3-7 word title|replitOpenai/);
  assert.match(source, /const localTitle = userContent[\s\S]*?storage\.updateConversation\(convId, \{ title: localTitle \}/);
});