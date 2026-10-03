import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { ownerTenantId } from "../../server/agentic/autonomous-budget";
import { getMigratedHandler } from "../../server/tools/registry";
import { TOOL_POLICIES } from "../../server/safety/destructive-tool-policy";
import { routeTools } from "../../server/tool-router";
import type { ToolDefinition } from "../../server/tools/types";
import "../../server/tools/domains/instinct-line";

const handler = getMigratedHandler("instinct_send_message");
assert.ok(handler, "instinct_send_message handler should be registered");

const ownerContext = { tenantId: ownerTenantId(), personaId: 2, conversationId: 100 };
const tool = (name: string): ToolDefinition => ({
  type: "function",
  function: { name, description: name, parameters: { type: "object", properties: {} } },
});

test("Instinct send rejects untrusted identity and invalid content, but accepts absent conversation context", async () => {
  assert.deepEqual(await handler!({ message: "status update" }, { personaId: 2 }), {
    error: "A positive tenant context is required",
  });
  assert.deepEqual(await handler!({ message: "status update" }, { ...ownerContext, personaId: 3 }), {
    error: "instinct_send_message is Felix-only",
  });
  assert.deepEqual(await handler!({ message: "status update" }, { tenantId: ownerContext.tenantId + 1, personaId: 2, conversationId: 100 }), {
    error: "instinct_send_message is restricted to the owner tenant",
  });
  const withoutConversation = await handler!({ message: "Customer record: alice@example.com" }, {
    tenantId: ownerContext.tenantId, personaId: 2,
  });
  assert.deepEqual(withoutConversation, {
    error: "Message rejected by Instinct Line content policy",
  });
  for (const message of ["", "  ", 7, "x".repeat(4001)]) {
    assert.deepEqual(await handler!({ message }, ownerContext), {
      error: "message must contain 1–4000 non-whitespace characters",
    });
  }
  assert.deepEqual(await handler!({ message: "Customer record: alice@example.com" }, ownerContext), {
    error: "Message rejected by Instinct Line content policy",
  });
});

test("Instinct is only routed to owner Felix and cannot displace existing private handoff slots", async () => {
  const tools = ["instinct_send_message", "grok_send_message", "spark_send_message", "cash_flow_summary"].map(tool);
  const felix = await routeTools(tools, [{ role: "user", content: "Send Instinct a safe update" }], {
    maxTools: 1, personaId: 2, tenantId: ownerTenantId(),
  });
  const other = await routeTools(tools, [{ role: "user", content: "Send Instinct a safe update" }], {
    maxTools: 4, personaId: 3, tenantId: ownerTenantId(),
  });
  assert.deepEqual(new Set(felix.tools.map(item => item.function.name)), new Set(tools.map(item => item.function.name)));
  assert.ok(!other.tools.some(item => item.function.name === "instinct_send_message"));
});

test("Instinct is trusted-only, unavailable to voice, and its call args are redacted", () => {
  assert.equal(TOOL_POLICIES.instinct_send_message?.risk, "sensitive");
  assert.equal(TOOL_POLICIES.instinct_send_message?.trustedPersonasOnly, true);
  const voice = readFileSync(new URL("../../server/glasses-gateway.ts", import.meta.url), "utf8");
  assert.doesNotMatch(voice, /instinct_send_message/);
  const chat = readFileSync(new URL("../../server/chat-engine.ts", import.meta.url), "utf8");
  assert.match(chat, /toolName === "spark_send_message" \|\| toolName === "grok_send_message" \|\| toolName === "instinct_send_message"/);
  assert.match(chat, /"spark_send_message", "grok_send_message", "instinct_send_message"\]\.includes\(toolName\)/);
});