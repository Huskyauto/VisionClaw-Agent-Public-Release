import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

const api = readFileSync(path.join(process.cwd(), "server/routes/api-v1.ts"), "utf8");
const auth = readFileSync(path.join(process.cwd(), "server/auth.ts"), "utf8");
const engine = readFileSync(path.join(process.cwd(), "server/chat-engine.ts"), "utf8");
const runs = readFileSync(path.join(process.cwd(), "server/spark-line.ts"), "utf8");

test("Spark outbox is tenant-derived, cursor-validated, and chat-scoped", () => {
  assert.match(api, /app\.get\(\s*"\/api\/v1\/spark\/outbox"/);
  assert.match(api, /listSparkMessages\(tenantId,\s*since\)/);
  assert.match(api, /!\/\^\(0\|\[1-9\]\\d\*\)\$\/\.test\(rawSince\)/);
  assert.ok(auth.includes(String.raw`{ method: "GET", pattern: /^\/api\/v1\/spark\/outbox$/, scopes: ["chat"] },`));
  assert.ok(auth.includes(String.raw`{ method: "POST", pattern: /^\/api\/v1\/conversations\/\d+\/messages$/, scopes: ["chat"] },`));
});

test("follow-up messages require an API marker and fail closed on active turns", () => {
  const routeStart = api.indexOf('"/api/v1/conversations/:id/messages"');
  const routeEnd = api.indexOf("\n  );", routeStart);
  assert.ok(routeStart >= 0 && routeEnd > routeStart, "follow-up route is mounted");
  const route = api.slice(routeStart, routeEnd);
  assert.match(route, /storage\.getConversation\(conversationId,\s*tenantId\)/);
  assert.match(route, /isApiV1Conversation\(tenantId,\s*conversationId\)/);
  assert.match(route, /claimApiV1Turn\(tenantId,\s*conversationId\)/);
  assert.match(route, /publicError\(res,\s*409,/);
  assert.match(route, /source:\s*"api-v1"/);
  assert.match(route, /message:\s*z\.string\(\)\.min\(1\)\.max\(MAX_TASK_LEN\)/);
  assert.match(route, /async:\s*z\.boolean\(\)\.default\(true\)/);
  assert.match(route, /finishApiV1Turn\(tenantId,\s*conversationId,\s*"complete"\)/);
  assert.match(route, /finishApiV1Turn\(tenantId,\s*conversationId,\s*"failed",/);
});

test("dispatch registers and claims durable ownership before starting the turn", () => {
  const routeStart = api.indexOf('"/api/v1/agents/dispatch"');
  const routeEnd = api.indexOf('"/api/v1/spark/outbox"', routeStart);
  const route = api.slice(routeStart, routeEnd);
  const registration = route.indexOf("registerApiV1Conversation");
  const claim = route.indexOf("claimApiV1Turn");
  const process = route.indexOf("processMessage(conv.id, task");
  assert.ok(registration >= 0 && registration < claim && claim < process);
  assert.match(route, /status: "running"/);
});

test("polling uses durable marked-run state and preserves the legacy fallback", () => {
  const pollStart = api.indexOf('"/api/v1/conversations/:id"');
  const pollEnd = api.indexOf("\n  );", pollStart);
  const route = api.slice(pollStart, pollEnd);
  assert.match(route, /isApiV1Conversation\(tenantId,\s*conversationId\)/);
  assert.match(route, /getApiV1TurnStatus\(tenantId,\s*conversationId\)/);
  assert.match(route, /else if \(lastAssistant\)/);
  assert.match(route, /formatSparkLinePollOutcome\(status,/);
  assert.match(route, /completedReply, reason: failureReason, failedAt/);
});

test("follow-up retries check the idempotency key before starting work", () => {
  const start = api.indexOf('"/api/v1/conversations/:id/messages"');
  const end = api.indexOf("\n  );", start);
  const route = api.slice(start, end);
  assert.match(route, /req\.headers\["idempotency-key"\]/);
  assert.match(route, /claimApiV1FollowUp\(/);
  assert.ok(route.indexOf('claim.outcome === "duplicate"') < route.indexOf("processMessage(conversationId"),
    "duplicate returns original receipt without starting another turn");
  assert.match(route, /requestId: claim\.requestId/);
});

test("Felix expert routing is decided before optional model preflights and auto-ensemble", () => {
  const gate = engine.indexOf("const expertLanes = getFelixExpertLanes(");
  const refinement = engine.indexOf("refinePromptViaJury({");
  const ensemble = engine.indexOf("shouldAutoInvokeEnsemble(content.trim()");
  assert.ok(gate > 0 && gate < refinement && refinement < ensemble);
  assert.match(engine, /if \(!expertLanes && \(opts\?\.depth \?\? 0\) === 0 && !opts\?\.source\?\.startsWith\("subagent:"\) && !promptRefined\)/);
  assert.match(engine, /if \(!expertLanes && conv\.model === "auto" && round > 0\)/);
  assert.match(engine, /const needsTitle = !expertLanes/);
  assert.match(engine, /const outcomeEnabled = !expertLanes &&/);
  assert.match(engine, /if \(!expertLanes && !retainedJuryPackage && cleanedResponse\.length > 100/);
});

test("A2A failures terminate durably without granting Spark follow-up authority", () => {
  const a2a = api.slice(api.indexOf('"/api/v1/a2a"'));
  assert.ok(a2a.indexOf("registerA2ATask(tenantId, conv.id)") < a2a.indexOf('processMessage(conv.id, text, { tenantId, source: "a2a" })'));
  assert.match(a2a, /finishA2ATask\(tenantId,\s*conv\.id,\s*"a2a_failed"/);
  assert.match(a2a, /getA2ATaskStatus\(tenantId,\s*conversationId\)/);
  assert.match(a2a, /if \(!a2aRun\) return a2aError\(res,\s*rpcId,\s*-32001,\s*"Task not found"\)/);
  assert.match(a2a, /a2aRun\.status === "a2a_failed"/);
  assert.match(runs, /status\} IN \('idle', 'running', 'complete', 'failed'\)/);
  assert.match(runs, /WHERE status IN \('running', 'a2a_running'\)/);
});