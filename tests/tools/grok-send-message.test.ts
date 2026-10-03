import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { ownerTenantId } from "../../server/agentic/autonomous-budget";
import { getMigratedHandler } from "../../server/tools/registry";
import { TOOL_POLICIES } from "../../server/safety/destructive-tool-policy";
import { routeTools } from "../../server/tool-router";
import type { ToolDefinition } from "../../server/tools/types";
import "../../server/tools/domains/grok-line";

const handler = getMigratedHandler("grok_send_message");
assert.ok(handler, "grok_send_message handler should be registered");

const ownerContext = { tenantId: ownerTenantId(), personaId: 2 };
const tool = (name: string): ToolDefinition => ({
  type: "function",
  function: { name, description: name, parameters: { type: "object", properties: {} } },
});

test("grok_send_message rejects missing or non-owner identity before sending", async () => {
  assert.deepEqual(await handler!({ message: "status update" }, { personaId: 2 }), {
    error: "A positive tenant context is required",
  });
  assert.deepEqual(await handler!({ message: "status update" }, { tenantId: 0, personaId: 2 }), {
    error: "A positive tenant context is required",
  });
  assert.deepEqual(await handler!({ message: "status update" }, { ...ownerContext, personaId: 3 }), {
    error: "grok_send_message is Felix-only",
  });
  assert.deepEqual(await handler!({ message: "status update" }, { tenantId: ownerContext.tenantId + 1, personaId: 2 }), {
    error: "grok_send_message is restricted to the owner tenant",
  });
});

test("grok_send_message validates bounded non-empty message text before service invocation", async () => {
  for (const message of ["", " \n\t ", 42, "x".repeat(4001), undefined]) {
    assert.deepEqual(await handler!({ message }, ownerContext), {
      error: "message must contain 1–4000 non-whitespace characters",
    });
  }
});

test("Grok Line remains private to owner Felix and keeps both Spark and cash-flow menu slots", async () => {
  const owner = ownerTenantId();
  const tools = [tool("grok_send_message"), tool("spark_send_message"), tool("cash_flow_summary")];
  const felix = await routeTools(tools, [{ role: "user", content: "Send a safe update to Grok" }], {
    maxTools: 2, personaId: 2, tenantId: owner,
  });
  const otherPersona = await routeTools(tools, [{ role: "user", content: "Send a safe update to Grok" }], {
    maxTools: 2, personaId: 3, tenantId: owner,
  });
  const otherTenant = await routeTools(tools, [{ role: "user", content: "Send a safe update to Grok" }], {
    maxTools: 2, personaId: 2, tenantId: owner + 1,
  });

  assert.ok(felix.tools.some(item => item.function.name === "grok_send_message"));
  assert.ok(felix.tools.some(item => item.function.name === "spark_send_message"));
  assert.ok(felix.tools.some(item => item.function.name === "cash_flow_summary"));
  assert.ok(!otherPersona.tools.some(item => item.function.name === "grok_send_message"));
  assert.ok(!otherTenant.tools.some(item => item.function.name === "grok_send_message"));
});

test("grok_send_message is classified sensitive, omitted from voice, and returns the durable receipt", () => {
  assert.equal(TOOL_POLICIES.grok_send_message?.risk, "sensitive");
  assert.equal(TOOL_POLICIES.grok_send_message?.trustedPersonasOnly, true);

  const voiceGateway = readFileSync(new URL("../../server/glasses-gateway.ts", import.meta.url), "utf8");
  assert.doesNotMatch(voiceGateway, /grok_send_message/);

  const handlers = readFileSync(new URL("../../server/tools/domains/grok-line/handlers.ts", import.meta.url), "utf8");
  assert.match(handlers, /sendGrokMessage\(tenantId,\s*personaId,\s*message,\s*ctx\.conversationId\)/);
  assert.match(handlers, /success:\s*true,\s*outboxId/);
});

test("Grok Line conversation stamping is present in the streaming route", () => {
  const stream = readFileSync(new URL("../../server/routes.ts", import.meta.url), "utf8");
  assert.match(stream, /tc\.name === "grok_send_message"\)\s*\{\s*parsedArgs\._conversationId = conversationId;/);
});

test("Grok Line API dispatch stamps the thread and does not log outbound message text", () => {
  const api = readFileSync(new URL("../../server/chat-engine.ts", import.meta.url), "utf8");
  assert.match(api, /toolName === "spark_send_message" \|\| toolName === "grok_send_message"/);
  assert.match(api, /parsedArgs\._conversationId = conversationId/);
  assert.match(api, /const loggedArgs = \["spark_send_message", "grok_send_message"\]\.includes\(toolName\)\s*\? "\[redacted coordination payload\]"/);
  assert.match(api, /console\.log\(`\[processMessage\] Tool:.*loggedArgs/);
});
