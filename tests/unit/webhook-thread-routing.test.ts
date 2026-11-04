import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { webhookThreadIdentity, resolveBoundWebhookConversation } from "../../server/webhook-thread-routing";

const event = (repo = "Acme/App", number = 42) => ({
  repository: { full_name: repo }, issue: { number },
});
const scope = { tenantId: 1, triggerId: 3, personaId: 4 };

test("comparison against the actual legacy key separates unrelated items instead of sharing one context", () => {
  const source = readFileSync(new URL("../../server/webhook-triggers.ts", import.meta.url), "utf8");
  const legacyTemplate = source.match(/const convKey = `([^`]+)`/)?.[1];
  assert.equal(legacyTemplate, "trigger-${trigger.id}");
  const cases = [event("Acme/App", 1), event("Acme/App", 2), event("Other/App", 1)];
  assert.equal(new Set(cases.map(() => legacyTemplate!.replace("${trigger.id}", "3"))).size, 1);
  assert.equal(new Set(cases.map((body) => webhookThreadIdentity(scope, body).key)).size, 3);
});

test("live wiring preserves capability/tenant gates and locks binding allocation before dispatch", () => {
  const ingress = readFileSync(new URL("../../server/webhook-triggers.ts", import.meta.url), "utf8");
  const adapter = readFileSync(new URL("../../server/webhook-thread-conversations.ts", import.meta.url), "utf8");
  assert.match(ingress, /const trigger = rows\?\.length === 1 \? rows\[0\] : undefined/);
  assert.match(ingress, /trigger\.enabled !== true/);
  assert.match(ingress, /WEBHOOK_THREAD_ROUTING !== "0"/);
  assert.ok(ingress.indexOf("assertValidTenantId(triggerTenantId)", ingress.indexOf("export async function processTriggerEvent"))
    < ingress.indexOf("? await getThreadedWebhookConversation"));
  assert.match(ingress, /processMessage\(conversationId, eventSummary, \{ tenantId: triggerTenantId, source: "webhook" \}\)/);
  assert.match(adapter, /WHERE id = \$\{scope\.triggerId\} AND tenant_id = \$\{scope\.tenantId\}\s+FOR UPDATE/);
  assert.match(adapter, /WHERE id = \$\{conversationId\} AND tenant_id = \$\{scope\.tenantId\}/);
  assert.match(adapter, /database\.transaction/);
});

test("the production binding boundary survives a cache restart and refuses deleted context", async () => {
  let persisted: unknown = {};
  let creates = 0;
  let deleted = false;
  const deps = {
    read: async () => ({ tenantId: 1, personaId: 4, deletedAt: deleted ? new Date() : null }),
    create: async () => { creates++; return 123; },
    save: async (bindings: Record<string, number>) => { persisted = bindings; },
  };
  const key = webhookThreadIdentity(scope, event()).key;
  assert.equal(await resolveBoundWebhookConversation(scope, key, persisted, deps), 123);
  // A fresh invocation has only persisted state, not an in-process conversation map.
  assert.equal(await resolveBoundWebhookConversation(scope, key, structuredClone(persisted), { ...deps }), 123);
  assert.equal(creates, 1);
  deleted = true;
  await assert.rejects(resolveBoundWebhookConversation(scope, key, persisted, deps), /unavailable/);
  assert.equal(creates, 1);
});

test("same PR follow-ups retain identity while different issues no longer share the trigger context", () => {
  const first = webhookThreadIdentity(scope, event());
  assert.deepEqual(first, webhookThreadIdentity(scope, {
    repository: { full_name: "acme/app" }, pull_request: { number: 42 },
  }));
  assert.notEqual(first.key, webhookThreadIdentity(scope, event("Acme/App", 43)).key);
});

test("repository, tenant, trigger, persona and server-owned scope separate contexts", () => {
  const original = webhookThreadIdentity(scope, event()).key;
  for (const changed of [
    { ...scope, tenantId: 2 }, { ...scope, triggerId: 9 },
    { ...scope, personaId: 5 }, { ...scope, configuration: "new scope" },
  ]) assert.notEqual(original, webhookThreadIdentity(changed, event()).key);
  assert.notEqual(original, webhookThreadIdentity(scope, event("Other/App")).key);
  assert.notEqual(original, webhookThreadIdentity(scope, "plain event").key);
  assert.equal(original, webhookThreadIdentity(scope, {
    ...event(), tenantId: 99, personaId: 99, conversationId: 999,
  }).key, "payload authority fields do not affect routing");
});

test("ambiguous/malformed issue identities reject instead of entering a shared conversation", () => {
  for (const payload of [
    { ...event(), pull_request: { number: 43 } },
    event("Acme/App", "42" as any), event("Acme/App", -1),
    event("Acme/App", NaN), event("Acme/App", 1.5),
    event("Acme/.."), event(" Acme/App"), event("Acme/App\n"),
    event("https://github.com/Acme/App"), event("Acme/App", Number.MAX_SAFE_INTEGER + 1),
  ]) assert.throws(() => webhookThreadIdentity(scope, payload), /identity/);
  assert.throws(() => webhookThreadIdentity({ ...scope, tenantId: 0 }, event()), /scope/);
  assert.equal(webhookThreadIdentity(scope, { customEvent: true }).mode, "trigger");
});

test("corrupted state, wrong tenant/persona and missing conversations never create replacements", async () => {
  const key = webhookThreadIdentity(scope, event()).key;
  let creates = 0;
  const deps = {
    read: async (): Promise<any> => undefined,
    create: async () => { creates++; return 100; },
    save: async () => {},
  };
  for (const bad of [null, [], "{}", { bad: 1 }, { [key]: "123" }, { [key]: -1 }]) {
    await assert.rejects(resolveBoundWebhookConversation(scope, key, bad, deps), /state/);
  }
  for (const conversation of [undefined, { tenantId: 2, personaId: 4 },
    { tenantId: 1, personaId: 5 }]) {
    await assert.rejects(resolveBoundWebhookConversation(scope, key, { [key]: 123 }, {
      ...deps, read: async () => conversation,
    }), /unavailable/);
  }
  assert.equal(creates, 0);
});

test("binding capacity rejects new tasks but keeps existing follow-ups usable", async () => {
  const key = webhookThreadIdentity(scope, event()).key;
  const stored = Object.fromEntries(Array.from({ length: 128 }, (_, i) =>
    [i.toString(16).padStart(64, "0"), i + 1]));
  let creates = 0;
  const deps = {
    read: async () => ({ tenantId: 1, personaId: 4 }),
    create: async () => { creates++; return 1000; },
    save: async () => {},
  };
  await assert.rejects(resolveBoundWebhookConversation(scope, key, stored, deps), /capacity/);
  assert.equal(await resolveBoundWebhookConversation(scope, "0".repeat(64), stored, deps), 1);
  assert.equal(creates, 0);
});

test("failed creation never publishes a binding; failed persistence is not reported as success", async () => {
  const key = webhookThreadIdentity(scope, event()).key;
  let saves = 0;
  await assert.rejects(resolveBoundWebhookConversation(scope, key, {}, {
    read: async () => undefined,
    create: async () => { throw new Error("create failed"); },
    save: async () => { saves++; },
  }), /create failed/);
  assert.equal(saves, 0);
  await assert.rejects(resolveBoundWebhookConversation(scope, key, {}, {
    read: async () => undefined, create: async () => 10,
    save: async () => { throw new Error("save failed"); },
  }), /save failed/);
});
