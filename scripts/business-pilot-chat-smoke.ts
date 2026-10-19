/**
 * Development-only authenticated conversational pilot check. No saved analyses,
 * outreach, settings edits or publication. Deletes only its own conversations.
 * Credential values and session cookies never leave this process.
 */
import assert from "node:assert/strict";

if (process.env.REPLIT_DEPLOYMENT === "1" || process.env.NODE_ENV === "production")
  throw new Error("Development smoke only");
const origin = `https://${process.env.REPLIT_DEV_DOMAIN}`;
let token = "";
let csrfToken = "";
const created: number[] = [];
async function request(path: string, method = "GET", body?: unknown, timeout = 20_000) {
  const response = await fetch(origin + path, {
    method, headers: { "Content-Type": "application/json", Origin: origin,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(csrfToken ? { "x-csrf-token": csrfToken } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(timeout),
  });
  assert.ok(response.ok, `${method} ${path}: HTTP${response.status}`);
  return response;
}
try {
  const login = await request("/api/auth/login", "POST", { pin: process.env.ADMIN_PIN });
  token = (await login.json()).token;
  assert.ok(token, "Canonical login must create a session");
  csrfToken = (await (await request("/api/auth/csrf-token")).json()).csrfToken;
  assert.ok(csrfToken, "Authenticated mutations require the session CSRF token");
  for (const personaId of [2, 3]) {
    const conversation = await (await request("/api/conversations", "POST", {
      title: "Temporary conversational business pilot diagnostic",
      personaId, model: "auto",
    })).json();
    assert.ok(Number.isSafeInteger(conversation.id), "Conversation was not created");
    created.push(conversation.id);
    // Creation uses the active persona; change only this disposable conversation.
    const scoped = await (await request(`/api/conversations/${conversation.id}`, "PATCH", { personaId })).json();
    assert.equal(scoped.personaId, personaId);
    const response = await request(`/api/conversations/${conversation.id}/messages`, "POST", {
      content: "Use business_pilot now with action describe and kind health. Do not run or save any analysis. Summarize its input contract and the rule for unknown values. This is an owner-requested diagnostic.",
      suggestQuestions: false, preferDirectExecution: true,
    }, 210_000);
    const text = await response.text();
    const events = text.split("\n").filter(line => line.startsWith("data: ")).flatMap(line => {
      try { return [JSON.parse(line.slice(6))]; } catch { return []; }
    });
    const result = events.find(event => event.tool_result?.name === "business_pilot")?.tool_result?.output;
    console.log(JSON.stringify({
      personaId, tools: events.filter(e => e.tool_result).map(e => ({
        name: e.tool_result.name, ok: e.tool_result.output?.ok, error: e.tool_result.output?.error,
      })), errors: events.filter(e => e.error).map(e => e.error), resultOk: result?.ok,
    }));
    assert.equal(result?.ok, true, `Persona ${personaId} did not complete the actual guarded pilot invocation`);
    assert.ok(result.inputSchema, "Actual description missing");
  }
} finally {
  let cleanupFailed = false;
  for (const id of created) {
    try { await request(`/api/conversations/${id}`, "DELETE"); }
    catch { cleanupFailed = true; console.error("Diagnostic conversation cleanup failed"); }
  }
  try {
    if (token) await (await import("../server/auth")).revokeSession(token);
  } finally {
    if (token) await (await import("../server/db")).pool.end();
  }
  assert.ok(!cleanupFailed, "Diagnostic cleanup incomplete; session revocation was still attempted");
  console.log("Only diagnostic conversations removed; session revoked");
}
process.exit(0);
