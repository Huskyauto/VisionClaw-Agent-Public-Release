import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import { transformSync } from "esbuild";
import * as cap from "../../server/lib/tool-cap";
import * as routing from "../../server/lib/tool-routing-context";
import { requestWithModelToolRoster, isToolAllowedInModelRound } from "../../server/lib/model-tool-authorization";

function loadRouter(deprecateInspection: boolean) {
  const mod = { exports: {} as any };
  vm.runInNewContext(transformSync(readFileSync("server/tool-router.ts", "utf8"), {
    loader: "ts", format: "cjs",
  }).code, {
    module: mod, exports: mod.exports, process: { env: {} }, console: { log() {}, warn() {} },
    require: (name: string) => {
      if (name === "./tool-registry") return { buildCategoryMap: () => ({
        business: ["opportunity_bank_file", "owner_business_overview", "a", "b", "c", "d", "e"],
      }) };
      if (name === "./scaffolding") return { classifyRequest: () => ({ confidence: 0 }) };
      if (name === "./tool-curator") return {
        matchHintsToMessage: () => [], buildContrastiveNote: () => "",
        filterDeprecated: (tools: any[]) => tools.filter(t => !deprecateInspection || t.function.name !== "introspect_tools"),
        rankByPerformance: async (_tenant: number, names: string[]) => names,
        semanticRank: async () => [],
      };
      if (name === "./lib/tool-cap") return cap;
      if (name === "./agentic/autonomous-budget") return { ownerTenantId: () => 1 };
      if (name === "./lib/instinct-read-draft") return { isInstinctReadDraft: () => false };
      if (name === "./lib/business-pilot-routing") return { isInteractivePilotRequest: () => false };
      if (name === "./lib/tool-routing-context") return routing;
      throw new Error(`Unexpected router dependency: ${name}`);
    },
  });
  return mod.exports.routeTools;
}

test("Felix can inspect schemas in the actual capped filing roster even if curator deprecates inspection", async () => {
  const tools = ["introspect_tools", "opportunity_bank_file", "owner_business_overview",
    "spark_send_message", "a", "b", "c", "d", "e"].map(name => ({
    type: "function", function: { name, description: name, parameters: { type: "object", properties: {} } },
  }));
  for (const deprecate of [false, true]) {
    const routeTools = loadRouter(deprecate);
    const result = await routeTools(tools, [{ role: "user", content: "File six opportunities as unvalidated Ideas" }], {
      tenantId: 1, personaId: 2, maxTools: 1, forceCategories: ["business"],
    });
    let roster: string[] = [];
    requestWithModelToolRoster({ tools: result.tools }, names => { roster = names; }, () => undefined);
    assert.equal(isToolAllowedInModelRound("opportunity_bank_file", roster), true);
    assert.equal(isToolAllowedInModelRound("introspect_tools", roster), true, `curator deprecated=${deprecate}`);
    assert.equal(isToolAllowedInModelRound("exec", roster), false);
  }
});

test("filtered chat menus keep schema inspection before the normal blocked-tool filter", () => {
  const source = readFileSync("server/chat-engine.ts", "utf8");
  const array = source.match(/const LEAN_ALWAYS_INCLUDE = (\[[\s\S]*?\]);/);
  assert.ok(array);
  const names = vm.runInNewContext(array[1]) as string[];
  assert.ok(names.includes("introspect_tools"));
});

test("owner Felix's actual capped API roster retains the Legion diagnostic without dropping handoff slots", async () => {
  const routeTools = loadRouter(false);
  const tools = ["test_api_keys", "cash_flow_summary", "spark_send_message",
    "grok_send_message", "instinct_send_message", "a", "b", "c", "d", "e"].map(name => ({
    type: "function", function: { name, description: name, parameters: { type: "object", properties: {} } },
  }));
  const result = await routeTools(tools, [{ role: "user", content:
    "Check legion-local / Mellum 2.1 using the fixed 17 + 25 acceptance test." }], {
    tenantId: 1, personaId: 2, maxTools: 1, forceCategories: ["business"],
  });
  let roster: string[] = [];
  requestWithModelToolRoster({ tools: result.tools }, names => { roster = names; }, () => undefined);
  for (const name of ["test_api_keys", "spark_send_message", "grok_send_message", "instinct_send_message"])
    assert.equal(isToolAllowedInModelRound(name, roster), true, name);
  assert.match(result.contrastiveNote ?? "", /local_check/);
});
