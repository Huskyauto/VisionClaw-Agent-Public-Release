import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { ownerTenantId } from "../../server/agentic/autonomous-budget";
import "../../server/tools/domains/spark-line";
import { getMigratedHandler } from "../../server/tools/registry";

const handler = getMigratedHandler("spark_send_message");
assert.ok(handler, "spark_send_message handler should be registered");

const ownerContext = { tenantId: ownerTenantId(), personaId: 2 };

test("API and streaming tool dispatch both attach the current thread to Spark outbox calls", () => {
  const api = readFileSync(new URL("../../server/chat-engine.ts", import.meta.url), "utf8");
  const stream = readFileSync(new URL("../../server/routes.ts", import.meta.url), "utf8");
  assert.match(api, /toolName === "spark_send_message" \|\| toolName === "grok_send_message" \|\| toolName === "instinct_send_message"\)\s*\{\s*parsedArgs\._conversationId = conversationId;/);
  assert.match(stream, /tc\.name === "spark_send_message"\)\s*\{\s*parsedArgs\._conversationId = conversationId;/);
});

test("spark_send_message rejects invalid tenant/persona identity without calling the service", async () => {
  assert.deepEqual(await handler!({ message: "approved" }, { personaId: 2 }), {
    error: "A positive tenant context is required",
  });
  assert.deepEqual(await handler!({ message: "approved" }, { tenantId: 0, personaId: 2 }), {
    error: "A positive tenant context is required",
  });
  assert.deepEqual(await handler!({ message: "approved" }, { tenantId: ownerContext.tenantId, personaId: 3 }), {
    error: "spark_send_message is Felix-only",
  });
  assert.deepEqual(await handler!({ message: "approved" }, { tenantId: ownerContext.tenantId + 1, personaId: 2 }), {
    error: "spark_send_message is restricted to the owner tenant",
  });
});

test("spark_send_message rejects empty, non-string, and over-limit messages before service import", async () => {
  for (const message of ["", " \n\t ", 42, "x".repeat(4001), undefined]) {
    const result = await handler!({ message }, ownerContext);
    assert.deepEqual(result, {
      error: "message must contain 1–4000 non-whitespace characters",
    });
  }
});
