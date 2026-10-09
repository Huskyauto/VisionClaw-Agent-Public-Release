import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (file: string) => readFileSync(path.join(root, file), "utf8");

test("Instinct has a separate tenant-scoped outbox and cannot query Grok or Spark rows", () => {
  const schema = read("shared/schema.ts");
  const line = read("server/instinct-line.ts");
  assert.match(schema, /export const instinctOutbox = pgTable\("instinct_outbox"/);
  assert.match(line, /from\(instinctOutbox\)/);
  assert.match(line, /eq\(instinctOutbox\.tenantId,\s*tenantId\)/);
  assert.match(line, /gt\(instinctOutbox\.id,\s*since\)/);
  assert.match(line, /\.limit\(50\)/);
  assert.doesNotMatch(line, /grokOutbox|sparkOutbox/);
});

test("Instinct send enforces Felix and owner tenant, trusted thread ownership and outbound guardrails", () => {
  const line = read("server/instinct-line.ts");
  assert.match(line, /personaId !== 2/);
  assert.match(line, /ownerTenantId\(\)/);
  assert.match(line, /validateSparkMessage\(message\)/);
  assert.match(line, /conversationId\?: number/);
  assert.match(line, /conversation_id IS NOT DISTINCT FROM/);
  assert.match(line, /INTERVAL '10 minutes'/);
  assert.match(line, /INTERVAL '1 hour'/);
  assert.match(line, />= 20/);
  assert.match(line, /INSTINCT_LINE_ENABLED/);
});

test("Instinct API poll uses API-key chat auth, owner tenant and a tenant-wide cursor", () => {
  const api = read("server/routes/api-v1.ts");
  const auth = read("server/auth.ts");
  const start = api.indexOf('"/api/v1/instinct/outbox"');
  assert.ok(start >= 0, "Instinct outbox poll is mounted");
  const route = api.slice(start, api.indexOf("\n  );", start));
  assert.match(route, /authMiddleware/);
  assert.match(route, /requireApiKeyOnly/);
  assert.match(route, /getTenantFromRequest\(req\)/);
  assert.match(route, /listInstinctMessages\(tenantId,\s*since/);
  assert.doesNotMatch(route, /conversationId/);
  assert.match(route, /Number\.isSafeInteger\(since\)/);
  assert.match(route, /ownerTenantId\(\)/);
  assert.match(route, /INSTINCT_LINE_ENABLED/);
  assert.doesNotMatch(route, /req\.query\.tenantId|req\.body\.tenantId/);
  assert.ok(auth.includes(String.raw`{ method: "GET", pattern: /^\/api\/v1\/instinct\/outbox$/, scopes: ["chat"] },`));
});

test("Tenant-wide Instinct poll includes rows from any owner conversation, including later threads", () => {
  const line = read("server/instinct-line.ts");
  const list = line.slice(line.indexOf("export async function listInstinctMessages"));
  assert.match(list, /eq\(instinctOutbox\.tenantId,\s*tenantId\)/);
  assert.match(list, /gt\(instinctOutbox\.id,\s*since\)/);
  assert.doesNotMatch(list, /eq\(instinctOutbox\.conversationId/);
});

test("Instinct retains for 30 days and uses existing dispatch and conversation follow-up APIs", () => {
  const spark = read("server/spark-line.ts");
  const api = read("server/routes/api-v1.ts");
  const line = read("server/instinct-line.ts");
  assert.match(spark, /DELETE FROM instinct_outbox WHERE created_at < NOW\(\) - INTERVAL '30 days'/);
  assert.match(api, /\/api\/v1\/agents\/dispatch/);
  assert.match(api, /\/api\/v1\/conversations\/:id\/messages/);
  assert.match(line, /conversationId\?: number/);
});

test("Instinct is routed only to owner-tenant Felix and uses trusted-only sensitive policy", () => {
  const router = read("server/tool-router.ts");
  const prompts = read("server/seed-persona-prompts.ts");
  const dispatcher = read("server/tools/dispatcher.ts");
  const policy = read("server/safety/destructive-tool-policy.ts");
  assert.match(router, /instinct_send_message/);
  assert.match(prompts, /Instinct Line/);
  assert.match(prompts, /never create a send\/response loop/i);
  assert.match(dispatcher, /domains\/instinct-line/);
  assert.match(policy, /instinct_send_message:[\s\S]*risk: "sensitive"[\s\S]*trustedPersonasOnly: true/);
});