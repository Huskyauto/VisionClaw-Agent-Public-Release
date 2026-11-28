import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFileSync } from "node:fs";
import { transformSync } from "esbuild";
import { createLegionDiagnostics } from "../../server/legion/felix-diagnostics";
import { createLegionWorker } from "../../server/legion/background";
import { LEGION_MODEL, LOCAL_GUARDRAIL_PROMPT } from "../../server/legion/model-policy";
import { setImmediate } from "node:timers/promises";
import { prepareToolInvocation } from "../../server/tools/invocation-authority";
import { trustedConversationScope } from "../../server/lib/model-tool-authorization";
import { legionBackgroundConfiguration } from "../../server/legion/runtime";

test("local-offload configuration reports the exact blocker without revealing environment values", () => {
  assert.deepEqual(legionBackgroundConfiguration({}), { enabled: false, reason: "background_flag_disabled" });
  assert.deepEqual(legionBackgroundConfiguration({ LEGION_BACKGROUND_ENABLED: "1", REPL_ID: "other" }),
    { enabled: false, reason: "not_primary_project" });
  assert.deepEqual(legionBackgroundConfiguration({
    LEGION_BACKGROUND_ENABLED: "1", REPL_ID: "45b6d1c0-f690-443b-a4f3-d57f5cba126d",
  }), { enabled: true, reason: "enabled" });
});

test("published original uses its platform-managed domain instead of a workspace-only project id", () => {
  for (const REPL_ID of [undefined, "deployment-runtime-id"]) {
    assert.deepEqual(legionBackgroundConfiguration({
      LEGION_BACKGROUND_ENABLED: "1",
      REPLIT_DEPLOYMENT: "1",
      REPLIT_DOMAINS: "agenticcorporation.net,vison-claw-agent.replit.app",
      REPL_ID,
    }), { enabled: true, reason: "enabled" });
  }
});

test("published backups cannot borrow the original workspace id or custom-domain configuration", () => {
  for (const REPLIT_DOMAINS of [
    undefined, "", "agenticcorporation.net", "backup.replit.app",
    "vison-claw-agent.replit.app.backup.invalid",
    "backup-vison-claw-agent.replit.app",
    "https://vison-claw-agent.replit.app",
    "vison-claw-agent.replit.app:443",
  ]) {
    assert.deepEqual(legionBackgroundConfiguration({
      LEGION_BACKGROUND_ENABLED: "1", REPLIT_DEPLOYMENT: "1",
      REPL_ID: "45b6d1c0-f690-443b-a4f3-d57f5cba126d", REPLIT_DOMAINS,
    }), { enabled: false, reason: "not_primary_project" });
  }
});

test("published identity never enables a development backup or bypasses exact background opt-in", () => {
  const originalDeployment = {
    REPLIT_DEPLOYMENT: "1",
    REPLIT_DOMAINS: "vison-claw-agent.replit.app,agenticcorporation.net",
  };
  for (const LEGION_BACKGROUND_ENABLED of [undefined, "", "0", "true", "yes", " 1"]) {
    assert.deepEqual(legionBackgroundConfiguration({ ...originalDeployment, LEGION_BACKGROUND_ENABLED }),
      { enabled: false, reason: "background_flag_disabled" });
  }
  assert.deepEqual(legionBackgroundConfiguration({
    LEGION_BACKGROUND_ENABLED: "1", REPL_ID: "backup",
    REPLIT_DOMAINS: originalDeployment.REPLIT_DOMAINS,
  }), { enabled: false, reason: "not_primary_project" });
  assert.deepEqual(legionBackgroundConfiguration({
    ...originalDeployment, LEGION_BACKGROUND_ENABLED: "1",
    REPLIT_DOMAINS: "agenticcorporation.net, vison-claw-agent.replit.app ",
  }), { enabled: true, reason: "enabled" });
});

function loadRuntime(ledger: "confirmed" | "false" | "throws" | "timeout" = "confirmed") {
  const requests: any[] = [], slots: string[] = [], costs: any[] = [], rows: any[] = [];
  const mod = { exports: {} as any };
  const source = readFileSync("server/legion/felix-diagnostics-runtime.ts", "utf8")
    .replace('await import("../agentic/cost-ledger")', 'await mockImport("cost-ledger")');
  vm.runInNewContext(transformSync(source, { loader: "ts", format: "cjs" }).code, {
    module: mod, exports: mod.exports, AbortSignal,
    mockImport: async (name: string) => {
      assert.equal(name, "cost-ledger");
      return { recordCost: async (receipt: any) => {
        costs.push(receipt);
        if (ledger === "false") return false;
        if (ledger === "throws") throw Error("Synthetic ledger failure");
        if (ledger === "timeout") return new Promise(() => {});
        return true;
      } };
    },
    require: (name: string) => {
      if (name === "./felix-diagnostics") return { createLegionDiagnostics };
      if (name === "./background") return { createLegionWorker };
      if (name === "./runtime") return {
        legionBackgroundEnabled: () => true, legionProxyPort: () => 10551,
        legionShutdownSignal: () => new AbortController().signal, legionRuntimeReady: () => true,
      };
      if (name === "../lib/tenant-context") return { currentTenantId: () => 1 };
      if (name === "./model-policy") return { LEGION_MODEL };
      if (name === "./local-slots") return {
        withLocalInferenceSlot: async (provider: string, signal: AbortSignal, generate: any) => {
          slots.push(provider); return generate(signal);
        },
      };
      if (name === "./proxy-client") return {
        legionRequest: async (port: number, path: string, body: any, timeout: number, signal: AbortSignal) => {
          requests.push({ port, path, body, timeout }); assert.equal(signal.aborted, false);
          if (path === "/api/tags") return { models: [{ name: LEGION_MODEL }] };
          assert.equal(path, "/v1/chat/completions");
          return { model: LEGION_MODEL, system_fingerprint: "fp_ollama",
            usage: { prompt_tokens: 10, completion_tokens: 1 },
            choices: [{ finish_reason: "stop", message: { role: "assistant", content: "42\n" } }] };
        },
      };
      if (name === "@shared/schema") return { activityLog: { id: "id" } };
      if (name === "../db") return { db: {
        insert: () => ({ values: (row: any) => {
          rows.push(row); return { returning: async () => [{ id: 71 }] };
        } }),
      } };
      throw Error(`Unexpected runtime dependency: ${name}`);
    },
  });
  return { run: mod.exports.runLegionDiagnostics, requests, slots, costs, rows };
}

test("Felix's real local adapter sends only the fixed payload through one Legion slot and persists its verified receipt", async () => {
  const { run, requests, slots, costs, rows } = loadRuntime();
  const result = await run(
    { provider: "legion-local", local_check: "arithmetic" }, { tenantId: 1, personaId: 2, conversationId: 620 });
  assert.equal(result.status, "complete");
  assert.deepEqual(slots, ["legion-local"]);
  assert.equal(requests.length, 2);
  assert.equal(requests[1].body.model, LEGION_MODEL);
  assert.equal(requests[1].body.messages[0].content, LOCAL_GUARDRAIL_PROMPT);
  assert.equal(requests[1].body.messages.at(-1).content, "What is 17 + 25? Reply with only the number.");
  assert.equal(requests[1].body.tools, undefined);
  assert.equal(requests[1].timeout, 30_000);
  assert.equal(costs.length, 1);
  assert.equal(costs[0].toolName, "llm.legion-local");
  assert.equal(costs[0].tokensIn, 10);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].tenantId, 1);
  assert.equal(rows[0].metadata.conversationId, 620);
  assert.equal(rows[0].metadata.servedModel, LEGION_MODEL);
  assert.equal(rows[0].metadata.rawOutput, "42\n");
  assert.equal(rows[0].metadata.probeId, result.receipt.probeId);
  assert.equal(result.receipt.id, 71);
  assert.equal(result.usageLedgerConfirmed, true);
});

for (const mode of ["false", "throws", "timeout"] as const) {
  test(`the real adapter exposes ${mode} usage accounting without retrying a successful generation`, async t => {
    const { run, requests, rows } = loadRuntime(mode);
    if (mode === "timeout") t.mock.timers.enable({ apis: ["setTimeout"] });
    const pending = run({ provider: "legion-local", local_check: "arithmetic" },
      { tenantId: 1, personaId: 2, conversationId: 620 });
    if (mode === "timeout") {
      await setImmediate();
      t.mock.timers.tick(10_001);
    }
    const result = await pending;
    assert.equal(result.status, "complete", "provider-proof receipt is distinct from accounting confirmation");
    assert.equal(result.usageLedgerConfirmed, false);
    assert.equal(rows[0].metadata.usageLedgerConfirmed, false);
    assert.equal(result.providerReportedCostUsd, null);
    assert.equal(requests.filter(r => r.path === "/v1/chat/completions").length, 1);
  });
}

test("the actual legacy dispatch selects Legion explicitly, rejects other tenants, and preserves default cloud checks", async () => {
  const source = readFileSync("server/tools.ts", "utf8");
  const arm = source.slice(source.indexOf('case "test_api_keys":'), source.indexOf('case "check_system_status":'))
    .replace(/await import\(([^)]+)\)/g, "await load($1)");
  const factory = vm.runInNewContext(`(async (params, load, testApiKeys) => { switch ("test_api_keys") { ${arm} } })`);
  let local = 0, cloud = 0;
  const load = async (name: string) => {
    if (name === "./auth") return { ADMIN_TENANT_ID: 1 };
    assert.equal(name, "./legion/felix-diagnostics-runtime");
    return { runLegionDiagnostics: async (input: any, context: any) => {
      local++; assert.equal(input._tenantId, undefined);
      assert.equal(context.personaId, 2); assert.equal(context.conversationId, 620);
      return { status: "local" };
    } };
  };
  const defaults = async () => { cloud++; return { status: "cloud" }; };
  const owner = { _tenantId: 1, _personaId: 2, _conversationId: 620 };
  assert.equal((await factory({ ...owner, provider: "legion-local", local_check: "arithmetic" }, load, defaults)).status, "local");
  assert.equal(local, 1); assert.equal(cloud, 0);
  assert.ok((await factory({ ...owner, _tenantId: 2, provider: "legion-local" }, load, defaults)).error);
  assert.ok((await factory({ ...owner, provider: "typo", local_check: "arithmetic" }, load, defaults)).error);
  assert.ok((await factory({ ...owner, local_check: "arithmetic" }, load, defaults)).error);
  assert.equal(local, 1); assert.equal(cloud, 0);
  assert.equal((await factory(owner, load, defaults)).status, "cloud");
  assert.equal(cloud, 1);
});

test("the guarded conversation envelope reaches the strict local diagnostic without admitting arbitrary inputs", async () => {
  const source = readFileSync("server/tools.ts", "utf8");
  const arm = source.slice(source.indexOf('case "test_api_keys":'), source.indexOf('case "check_system_status":'))
    .replace(/await import\(([^)]+)\)/g, "await load($1)");
  const dispatch = vm.runInNewContext(`(async (params, load) => { switch ("test_api_keys") { ${arm} } })`);
  const { run, requests } = loadRuntime();
  const load = async (name: string) => name === "./auth"
    ? { ADMIN_TENANT_ID: 1 } : { runLegionDiagnostics: run };
  const envelope = (extra = {}, tenantId = 1, personaId = 2) => prepareToolInvocation({
    provider: "legion-local", local_check: "arithmetic", ...extra,
    ...trustedConversationScope(620, true),
  }, { tenantId, personaId, conversationId: 620, actor: "persona", invokedVia: "chat_engine" });
  assert.equal((await dispatch(envelope(), load)).status, "complete");
  assert.equal(requests.filter(r => r.path === "/v1/chat/completions").length, 1);
  for (const extra of [{ prompt: "arbitrary" }, { url: "https://example.com" }, { model: "other" }])
    assert.equal((await dispatch(envelope(extra), load)).status, "invalid_request");
  const mismatched = prepareToolInvocation({
    provider: "legion-local", local_check: "arithmetic", conversationId: 621,
  }, { tenantId: 1, personaId: 2, conversationId: 620, actor: "persona", invokedVia: "chat_engine" });
  assert.equal((await dispatch(mismatched, load)).status, "invalid_request");
  assert.ok((await dispatch(envelope({}, 2), load)).error);
  assert.equal((await dispatch(envelope({}, 1, 3), load)).status, "forbidden");
  assert.equal(requests.filter(r => r.path === "/v1/chat/completions").length, 1);
});
