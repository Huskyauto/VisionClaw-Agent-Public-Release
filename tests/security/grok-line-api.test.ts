import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const api = readFileSync(path.join(root, "server/routes/api-v1.ts"), "utf8");
const auth = readFileSync(path.join(root, "server/auth.ts"), "utf8");
const grok = readFileSync(path.join(root, "server/grok-line.ts"), "utf8");
const schema = readFileSync(path.join(root, "shared/schema.ts"), "utf8");
const spark = readFileSync(path.join(root, "server/spark-line.ts"), "utf8");

test("Grok outbox route uses the authenticated tenant and a validated cursor", () => {
  const start = api.indexOf('"/api/v1/grok/outbox"');
  assert.ok(start >= 0, "Grok outbox route is mounted");
  const route = api.slice(start, api.indexOf("\n  );", start));
  assert.match(route, /authMiddleware/);
  assert.match(route, /requireApiKeyOnly/);
  assert.match(route, /getTenantFromRequest\(req\)/);
  assert.match(route, /listGrokMessages\(tenantId,\s*since\)/);
  assert.match(route, /GROK_LINE_ENABLED/);
  assert.doesNotMatch(route, /req\.query\.tenantId|req\.body\.tenantId/);
  assert.ok(auth.includes(String.raw`{ method: "GET", pattern: /^\/api\/v1\/grok\/outbox$/, scopes: ["chat"] },`));
});

test("Grok API outbox is isolated from Spark and bounded to 50 rows", () => {
  assert.match(grok, /from\(grokOutbox\)/);
  assert.match(grok, /eq\(grokOutbox\.tenantId,\s*tenantId\)/);
  assert.match(grok, /gt\(grokOutbox\.id,\s*since\)/);
  assert.match(grok, /\.limit\(50\)/);
  assert.doesNotMatch(grok, /sparkOutbox|listSparkMessages/);
  assert.match(schema, /export const grokOutbox = pgTable\("grok_outbox"/);
  assert.match(schema, /grok_outbox_message_length/);
});

test("Grok send follows Felix owner, egress, dedup and hourly-limit policy", () => {
  assert.match(grok, /sendGrokMessage/);
  assert.match(grok, /ownerTenantId\(\)/);
  assert.match(grok, /personaId !== 2/);
  assert.match(grok, /validateSparkMessage\(message\)/);
  assert.match(grok, /INTERVAL '10 minutes'/);
  assert.match(grok, /INTERVAL '1 hour'/);
  assert.match(grok, />= 20/);
  assert.match(grok, /GROK_LINE_ENABLED/);
});

test("Grok outbox retention is isolated and inbound processing reuses existing APIs", () => {
  assert.match(spark, /DELETE FROM grok_outbox WHERE created_at < NOW\(\) - INTERVAL '30 days'/);
  assert.doesNotMatch(grok, /app\.(get|post|put|delete)\(/);
  assert.doesNotMatch(api, /\/api\/v1\/grok\/inbound/);
});