/**
 * Regression pin for the 2026-08-01 architect HIGH: replyToEmail must apply
 * the R95 outbound redaction gate (enforceOutbound) to BOTH text and html
 * before submitting the reply to the provider.
 *
 * Static source-scan (no import of server/email.ts — it pulls the AgentMail
 * client and other heavy deps; memory lesson: DB-touching imports hang the
 * node:test pool). The pin: inside the replyToEmail function body, both
 * "email:reply:text" and "email:reply:html" enforceOutbound surfaces exist,
 * and the provider reply call uses the gated payloads.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

const src = readFileSync(path.join(process.cwd(), "server", "email.ts"), "utf8");

function replyFnBody(): string {
  const start = src.indexOf("export async function replyToEmail");
  assert.ok(start >= 0, "replyToEmail not found in server/email.ts");
  const next = src.indexOf("\nexport ", start + 10);
  return src.slice(start, next === -1 ? src.length : next);
}

test("replyToEmail gates text through enforceOutbound", () => {
  const body = replyFnBody();
  assert.match(body, /enforceOutbound\([^)]*surface:\s*"email:reply:text"/s);
  assert.match(body, /if \(!textGate\.ok\) throw/);
  assert.match(body, /text:\s*textGate\.payload/);
});

test("replyToEmail gates html through enforceOutbound", () => {
  const body = replyFnBody();
  assert.match(body, /enforceOutbound\([^)]*surface:\s*"email:reply:html"/s);
  assert.match(body, /if \(!htmlGate\.ok\) throw/);
  assert.match(body, /replyParams\.html = htmlGate\.payload/);
});

test("provider reply call happens AFTER the gates (fail closed)", () => {
  const body = replyFnBody();
  const gateIdx = body.indexOf('surface: "email:reply:text"');
  const sendIdx = body.indexOf("c.inboxes.messages.reply(");
  assert.ok(gateIdx >= 0 && sendIdx > gateIdx, "reply submit must follow the redaction gate");
});

// 72h-review HIGH — all tenants share one provider inbox, so the /api/email/reply
// route MUST verify the submitted provider message id belongs to an inbox_messages
// row owned by the authenticated tenant BEFORE calling replyToEmail. Without this,
// tenant B can reply into tenant A's correspondence with a known/guessed message id.
test("/api/email/reply route enforces tenant OWNERSHIP of messageId before replying", () => {
  const routesSrc = readFileSync(path.join(process.cwd(), "server", "routes.ts"), "utf8");
  const routeIdx = routesSrc.indexOf('app.post("/api/email/reply"');
  assert.ok(routeIdx >= 0, "/api/email/reply route not found in server/routes.ts");
  const body = routesSrc.slice(routeIdx, routesSrc.indexOf("app.", routeIdx + 20));
  const ownIdx = body.search(/FROM inbox_messages WHERE message_id = \$\{[^}]+\} AND tenant_id = \$\{tenantId\}/);
  const replyIdx = body.indexOf("replyToEmail(");
  assert.ok(ownIdx >= 0, "ownership query (inbox_messages by message_id + tenant_id) missing from /api/email/reply");
  assert.ok(replyIdx > ownIdx, "replyToEmail must be called AFTER the ownership check");
  assert.match(body, /status\(404\)/, "unowned messageId must 404, not proceed");
});
