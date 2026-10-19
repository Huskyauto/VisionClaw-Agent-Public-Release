import test from "node:test";
import assert from "node:assert/strict";
import { authorizePilotInvocation, requirePilotInvocation } from "../../server/lib/business-pilot-invocation";
import { executeBusinessPilot } from "../../server/lib/business-pilot-agent";
import type { PilotRun } from "../../server/lib/business-pilot-state";
import type { withPilotStore } from "../../server/lib/business-pilot-store";
import { randomUUID } from "node:crypto";

test("pilot receipt accepts only guarded owner interactive conversations and binds scope", () => {
  const args = { action: "describe", kind: "health", conversationId: 7 };
  const ctx = { tenantId: 1, personaId: 2, conversationId: 7, invokedVia: "main_chat" };
  assert.throws(() => requirePilotInvocation(args, ctx), /interactive owner/);
  authorizePilotInvocation(args, ctx);
  assert.doesNotThrow(() => requirePilotInvocation(args, ctx));
  assert.throws(() => requirePilotInvocation(args, { ...ctx, tenantId: 2 }), /interactive owner/);
  assert.throws(() => requirePilotInvocation(args, { ...ctx, invokedVia: "system" }), /interactive owner/);
  for (const change of [
    { tenantId: 2 }, { tenantId: undefined }, { personaId: 1 }, { conversationId: undefined },
    { invokedVia: "system" }, { invokedVia: "self_heal" }, { invokedVia: "public_chat" },
  ]) assert.throws(() => authorizePilotInvocation({}, { ...ctx, ...change }), /interactive owner/);
});

test("agent runs save privately, replay exactly, list and retrieve without permitting delete", async () => {
  let runs: PilotRun[] = [];
  const store: typeof withPilotStore = async (tenant, kind, operation) => {
    assert.equal(tenant, 1); assert.equal(kind, "health");
    const result = operation(runs); if (result.runs) runs = result.runs;
    return result.value;
  };
  const ctx = { tenantId: 1, personaId: 2, conversationId: 7, invokedVia: "main_chat" };
  const invoke = async (args: Record<string, unknown>) => {
    authorizePilotInvocation(args, ctx);
    return executeBusinessPilot(args, ctx, { store });
  };
  const request = { action: "run", kind: "health", requestId: randomUUID(),
    input: { business: "Self pilot fixture", reference: "self-pilot", currency: "USD",
      start: "2026-09-01", end: "2026-09-30", calls: 100, missedCalls: 20 } };
  const first = await invoke({ ...request });
  assert.equal(first.ok, true);
  assert.equal(first.run.result.metrics[0].value, 20);
  assert.deepEqual((await invoke({ ...request })).run, first.run);
  assert.equal(runs.length, 1);
  assert.equal((await invoke({ action: "list", kind: "health" })).runs[0].id, first.run.id);
  assert.deepEqual((await invoke({ action: "get", kind: "health", runId: first.run.id })).run, first.run);
  assert.ok((await invoke({ action: "delete", kind: "health", runId: first.run.id })).error);
  assert.ok((await invoke({ ...request, input: { ...request.input, calls: 200 } })).error);
});

test("agent describe returns the actual bounded input contract without reading storage", async () => {
  const args = { action: "describe", kind: "health" };
  const ctx = { tenantId: 1, personaId: 3, conversationId: 8, invokedVia: "chat_engine" };
  authorizePilotInvocation(args, ctx);
  const result = await executeBusinessPilot(args, ctx, {
    store: async () => { throw new Error("describe must not read storage"); },
  });
  assert.equal(result.ok, true);
  assert.ok(result.inputSchema);
  assert.match(JSON.stringify(result.inputSchema), /missedCalls/);
  assert.match(result.instructions, /unknown|null/i);
});

test("readiness runs bounded read-only retrieval and reports five evidenced checks", async () => {
  const ctx = { tenantId: 1, personaId: 3, conversationId: 8, invokedVia: "chat_engine" };
  const args = { action: "run", kind: "readiness", input: { url: "https://example.com/" } };
  authorizePilotInvocation(args, ctx);
  const calls: string[] = [];
  const result = await executeBusinessPilot(args, ctx, { fetchText: async (url, options) => {
    calls.push(url);
    assert.equal(options.maxRedirects, 0); assert.equal(options.maxBytes, 100_000);
    return { ok: true, status: 200, contentType: "text/html", finalUrl: url,
      text: "<main><h2>Our services</h2><p>Equipment maintenance</p><a href='/contact'>Contact us</a><a href='/book'>Book</a></main>" };
  } });
  assert.equal(result.ok, true);
  assert.equal(result.result.checks.length, 5);
  assert.deepEqual(calls, ["https://example.com/", "https://example.com/contact"]);
  assert.equal(result.saved, false);
  for (const url of ["file:///etc/passwd", "https://user:pass@example.com/", "https://example.com/?send=yes",
    "https://example.com/book", "javascript:alert(1)"]) {
    const bad = { action: "run", kind: "readiness", input: { url } };
    authorizePilotInvocation(bad, ctx);
    assert.ok((await executeBusinessPilot(bad, ctx, { fetchText: async () => {
      assert.fail("unsafe/action URL reached fetch");
    } })).error);
  }
});

test("forged, changed, disabled and wrong-scope invocations never access collaborators", async () => {
  const ctx = { tenantId: 1, personaId: 2, conversationId: 7, invokedVia: "main_chat" };
  const deps = {
    store: (async () => { assert.fail("unauthorized storage access"); }) as typeof withPilotStore,
    fetchText: async () => { assert.fail("unauthorized network access"); },
  };
  for (const raw of [
    { action: "list", kind: "health", _tenantId: 1, _personaId: 2, _invokedVia: "main_chat", approved: true },
    { action: "run", kind: "readiness", input: { url: "https://example.com/" } },
  ]) assert.ok((await executeBusinessPilot(raw, ctx, deps)).error);
  const args = { action: "list", kind: "health" };
  authorizePilotInvocation(args, ctx);
  args.kind = "cost";
  assert.ok((await executeBusinessPilot(args, ctx, deps)).error);
  const fresh = { action: "list", kind: "health" };
  authorizePilotInvocation(fresh, ctx);
  assert.ok((await executeBusinessPilot(fresh, { ...ctx, conversationId: 99 }, deps)).error);
  const previous = process.env.BUSINESS_PILOT_AGENT_ACCESS;
  try {
    process.env.BUSINESS_PILOT_AGENT_ACCESS = "off";
    assert.ok((await executeBusinessPilot(fresh, ctx, deps)).error);
  } finally {
    if (previous === undefined) delete process.env.BUSINESS_PILOT_AGENT_ACCESS;
    else process.env.BUSINESS_PILOT_AGENT_ACCESS = previous;
  }
});

test("partial page retrieval exposes a coverage gap rather than definite absence", async () => {
  const args = { action: "run", kind: "readiness", input: { url: "https://example.com/" } };
  const ctx = { tenantId: 1, personaId: 2, conversationId: 7, invokedVia: "main_chat" };
  authorizePilotInvocation(args, ctx);
  const result = await executeBusinessPilot(args, ctx, { fetchText: async url => ({
    ok: true, status: 200, finalUrl: url, text: "<main>Partial content</main>", contentType: "text/html", truncated: true,
  }) });
  assert.ok(result.result.checks.every((c: any) => c.status === "uncertain"));
  assert.match(result.result.limitations.join(" "), /byte cap/);
});
