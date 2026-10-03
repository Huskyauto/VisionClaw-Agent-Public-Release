import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

import { isValidWebhookKey } from "../../server/webhook-triggers";

const root = path.resolve(import.meta.dirname, "../..");
const source = fs.readFileSync(path.join(root, "server/webhook-triggers.ts"), "utf8");

test("webhook capability validation accepts only the generated opaque key format", () => {
  assert.equal(isValidWebhookKey("0123456789abcdef0123456789abcdef"), true);
  assert.equal(isValidWebhookKey("abcdefabcdefabcdefabcdefabcdefab"), true);

  for (const malformed of [
    "",
    "0123456789abcdef0123456789abcde",
    "0123456789abcdef0123456789abcdef0",
    "0123456789ABCDEF0123456789abcdef",
    "0123456789abcdef0123456789abcdeg",
    " 0123456789abcdef0123456789abcdef",
    "0123456789abcdef0123456789abcdef ",
    new String("0123456789abcdef0123456789abcdef"),
    null,
    undefined,
    123,
    ["0123456789abcdef0123456789abcdef"],
  ]) {
    assert.equal(isValidWebhookKey(malformed), false, JSON.stringify(malformed));
  }
});

test("trigger resolution rejects malformed and ambiguous capabilities before acting", () => {
  assert.match(
    source,
    /if \(!isValidWebhookKey\(webhookKey\)\) \{\s+return \{ success: false, error: "Webhook trigger not found or disabled" \};\s+\}/,
  );
  assert.match(source, /const trigger = rows\?\.length === 1 \? rows\[0\] : undefined/);
  assert.match(source, /if \(!trigger \|\| trigger\.enabled !== true \|\| !isValidWebhookKey\(trigger\.webhook_key\)\)/);
  assert.doesNotMatch(source, /const trigger = rows\?\.\[0\]/);
});

test("a valid stored trigger remains the sole source of webhook tenant scope", () => {
  assert.match(source, /const triggerTenantId = Number\(trigger\.tenant_id\);\s+assertValidTenantId\(triggerTenantId\)/);
  assert.match(source, /processMessage\(conversationId, eventSummary, \{ tenantId: triggerTenantId, source: "webhook" \}\)/);
  assert.doesNotMatch(source, /processTriggerEvent[\s\S]{0,2500}ADMIN_TENANT_ID/);
});
