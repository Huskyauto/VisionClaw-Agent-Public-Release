import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "../..");
const read = (file: string) => fs.readFileSync(path.join(root, file), "utf8");

test("chat processing scopes its initial conversation lookup to the caller tenant", () => {
  const source = read("server/chat-engine.ts");
  assert.match(source, /const tenantId = opts\.tenantId;\s+if \(!Number\.isInteger\(tenantId\) \|\| tenantId <= 0\)/);
  assert.match(source, /storage\.getConversation\(conversationId, tenantId\)/);
  assert.doesNotMatch(source, /processMessage[\s\S]{0,900}storage\.getConversationUnscoped\(conversationId\)/);
});

test("heartbeat delegation preserves the mandatory chat tenant contract", () => {
  const source = read("server/heartbeat.ts");
  assert.match(source, /interface ProcessMessageOptions \{\s+\/\*[\s\S]*?\*\/\s+tenantId: number;/);
  assert.match(source, /opts: ProcessMessageOptions,/);
  assert.match(source, /const processMessage = _processMessageFn;\s+if \(!processMessage\)/);
  assert.match(source, /processMessage\(\s+childConv\.id,\s+taskPrompt,\s+\{ tenantId, enableTools: true, depth \}/);
});

test("presenter sessions insert only the validated tenant ID", () => {
  const source = read("server/routes.ts");
  assert.match(source, /VALUES \(\$\{tenantIdNum\}, \$\{presentationId\}/);
});

test("tenant-bound message and fact writes retain their tenant predicate", () => {
  const storageSource = read("server/storage.ts");
  const routesSource = read("server/routes.ts");
  const factsSource = read("server/lib/session-fact-extractor.ts");
  const protectionSource = read("server/data-protection.ts");

  assert.match(storageSource, /\.where\(and\(eq\(messages\.id, data\.messageId\), eq\(messages\.tenantId, data\.tenantId\)\)\)/);
  assert.match(routesSource, /\.where\(and\(eq\(messages\.id, messageId\), eq\(messages\.tenantId, tenantId\)\)\)/);
  assert.match(factsSource, /await storage\.getConversation\(input\.conversationId, input\.tenantId\)/);
  assert.match(factsSource, /skipped: "conversation not found for tenant"/);
  assert.match(protectionSource, /FROM messages WHERE conversation_id = conversations\.id AND tenant_id = \$\{tenantId\}/);
});

test("ID-only conversation and heartbeat reads are not exposed", () => {
  const storageSource = read("server/storage.ts");
  const heartbeatRoutes = read("server/routes/heartbeat.ts");
  const adminConversationSource = read("server/platform-admin-conversations.ts");
  assert.doesNotMatch(storageSource, /getConversationUnscoped/);
  assert.doesNotMatch(storageSource, /PLATFORM_ADMIN_CONVERSATION_AUTHORITY/);
  assert.doesNotMatch(storageSource, /getConversationForPlatformAdmin/);
  assert.match(adminConversationSource, /if \(!isPlatformAdmin\(req\)\)/);
  assert.match(adminConversationSource, /eq\(conversations\.id, conversationId\)/);
  assert.match(storageSource, /getHeartbeatTask\(id: number, tenantId: number\)/);
  assert.match(storageSource, /eq\(heartbeatTasks\.tenantId, tenantId\)/);
  assert.match(heartbeatRoutes, /getHeartbeatTask\(taskId, tenantId\)/);
});

test("cross-tenant heartbeat operations are absent from general storage", () => {
  const storageSource = read("server/storage.ts");
  const schedulerSource = read("server/heartbeat.ts");
  const schedulerStorage = read("server/heartbeat-task-scheduler-storage.ts");
  assert.doesNotMatch(storageSource, /HEARTBEAT_SCHEDULER_AUTHORITY/);
  assert.doesNotMatch(storageSource, /getDueHeartbeatTasksAcrossTenants|claimDueHeartbeatTasksAcrossTenants/);
  assert.match(schedulerSource, /from "\.\/heartbeat-task-scheduler-storage"/);
  assert.match(schedulerStorage, /export async function getDueHeartbeatTasksAcrossTenants/);
  assert.match(schedulerStorage, /export async function claimDueHeartbeatTasksAcrossTenants/);
});

test("webhook secrets resolve a persisted, validated tenant binding", () => {
  const source = read("server/webhook-triggers.ts");
  assert.match(source, /webhook_triggers \(\s+id SERIAL PRIMARY KEY,\s+tenant_id INTEGER NOT NULL/);
  assert.match(source, /INSERT INTO webhook_triggers \(tenant_id,/);
  assert.match(source, /WHERE w\.webhook_key = \$\{webhookKey\} AND w\.enabled = true/);
  assert.match(source, /const triggerTenantId = Number\(trigger\.tenant_id\);\s+assertValidTenantId\(triggerTenantId\)/);
  assert.match(source, /processMessage\(conversationId, eventSummary, \{ tenantId: triggerTenantId/);
  assert.match(source, /tenantId: triggerTenantId,\s+title: `Webhook:/);
  assert.doesNotMatch(source, /trigger\.tenant_id \?\? trigger\.tenantId \?\? ADMIN_TENANT_ID/);
});

test("webhook management and event queries retain tenant predicates", () => {
  const source = read("server/webhook-triggers.ts");
  assert.match(source, /listTriggers\(tenantId: number\)/);
  assert.match(source, /WHERE w\.tenant_id = \$\{tenantId\}/);
  assert.match(source, /DELETE FROM webhook_triggers WHERE id = \$\{id\} AND tenant_id = \$\{tenantId\}/);
  assert.match(source, /UPDATE webhook_triggers SET enabled = \$\{enabled\} WHERE id = \$\{id\} AND tenant_id = \$\{tenantId\}/);
  assert.match(source, /WHERE trigger_id = \$\{triggerId\} AND tenant_id = \$\{tenantId\}/);
});

test("webhook runtime migration atomically cleans telemetry before ownership constraints", () => {
  const source = read("server/webhook-triggers.ts");
  assert.match(source, /db\.transaction\(async \(tx\) =>/);
  assert.match(source, /pg_advisory_xact_lock/);
  assert.match(source, /DELETE FROM webhook_trigger_events e[\s\S]*?NOT EXISTS/);
  assert.match(source, /DELETE FROM webhook_trigger_events e[\s\S]*?e\.tenant_id <> w\.tenant_id/);
  assert.match(source, /CONSTRAINT uq_webhook_triggers_tenant_id_id UNIQUE \(tenant_id, id\)/);
  assert.match(source, /ADD CONSTRAINT uq_webhook_triggers_tenant_id_id[\s\S]*?UNIQUE USING INDEX uq_webhook_triggers_tenant_id_id/);
  assert.match(source, /CONSTRAINT uq_webhook_triggers_tenant_id_id UNIQUE \(tenant_id, id\)[\s\S]*?FOREIGN KEY \(tenant_id, trigger_id\)/);
  assert.match(source, /FOREIGN KEY \(tenant_id, trigger_id\)[\s\S]*?REFERENCES webhook_triggers \(tenant_id, id\)/);
  assert.match(source, /CREATE INDEX IF NOT EXISTS idx_webhook_triggers_tenant_created/);
  assert.match(source, /CREATE INDEX IF NOT EXISTS idx_webhook_trigger_events_tenant_trigger_created/);
});