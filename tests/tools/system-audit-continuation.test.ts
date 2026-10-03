import assert from "node:assert/strict";
import { test } from "node:test";
import { getActiveUserRoutingMessage, isSystemAuditRequest } from "../../server/lib/tool-routing-context";
import { isUnfulfilledSystemAuditPromise } from "../../server/chat-response-validation";
import { getRoutedMaxOutputTokens } from "../../server/model-registry";
import { routeTools } from "../../server/tool-router";

const messages = [
  { role: "user", content: "Can you run a thorough system check across the whole app including APIs and services?" },
  { role: "assistant", content: "Would you like me to ask questions first or jump right in?" },
  { role: "user", content: "Jump Right In take care of everything take a look at everything and give me a full report" },
];

test("an explicit go-ahead carries the original system-review intent into tool routing", async () => {
  assert.match(getActiveUserRoutingMessage(messages), /system check/i);
  assert.equal(isSystemAuditRequest(messages), true);
  const names = ["check_system_status", "codebase_graph_query", "read_file", "create_pdf", "search_memory"];
  const tools = names.map(name => ({
    type: "function" as const,
    function: { name, description: name, parameters: { type: "object", properties: {} } },
  }));
  const routed = await routeTools(tools, messages, { maxTools: 3 });
  for (const required of ["check_system_status", "codebase_graph_query", "read_file"]) {
    assert.ok(routed.tools.some(tool => tool.function.name === required), required);
  }
});

test("a new subject must not inherit the earlier audit", () => {
  assert.equal(isSystemAuditRequest([...messages, { role: "user", content: "Write a birthday note for my friend" }]), false);
});

test("app, API and service review phrasings require investigation too", () => {
  for (const phrasing of ["Do a comprehensive app, API and service review", "Review all APIs and services", "Audit the project's codebase", "Please conduct a comprehensive review of our app, APIs and services", "Do an end-to-end review of the app"]) {
    assert.equal(isSystemAuditRequest([{ role: "user", content: phrasing }]), true, phrasing);
  }
});

test("ordinary writing reviews do not trigger the system audit gate", () => {
  for (const phrasing of ["Review my job application", "Review our project proposal", "What is a system check?"]) {
    assert.equal(isSystemAuditRequest([{ role: "user", content: phrasing }]), false, phrasing);
  }
});

test("a zero-tool promise is not a completed system review", () => {
  const candidate = "I'll run a comprehensive system check now. Let me investigate the app's structure, APIs, services, and current state to give you a full report.";
  assert.equal(isUnfulfilledSystemAuditPromise(messages, candidate, 0), true);
  assert.equal(isUnfulfilledSystemAuditPromise(messages, candidate, 1), false);
  assert.equal(isUnfulfilledSystemAuditPromise(messages, "No checks ran because access to the service was denied.", 0), false);
  assert.equal(isUnfulfilledSystemAuditPromise([...messages, { role: "user", content: "What is a system check?" }], candidate, 0), false);
});

test("a metered-policy remap uses the actual model output limit", () => {
  assert.equal(getRoutedMaxOutputTokens("deepseek/deepseek-v4.1-flash", "gpt-5.4"), 32768);
  assert.equal(getRoutedMaxOutputTokens("deepseek/deepseek-v4.1-flash", "deepseek/deepseek-v4.1-flash"), 384000);
  assert.equal(getRoutedMaxOutputTokens("openference/deepseek-v4-pro", "DeepSeek-V4-Pro"), 384000);
  assert.equal(getRoutedMaxOutputTokens("deepseek/deepseek-v4.1-flash", "Unknown-Remap"), 16384);
});