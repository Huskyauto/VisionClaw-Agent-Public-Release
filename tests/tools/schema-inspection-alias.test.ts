import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import test from "node:test";
import { transformSync } from "esbuild";
import { defineTool } from "../../server/tools/define-tool";
import * as definitions from "../../server/tools/domains/self-reflection/definitions";

function inspectFixture(tenantId = 1) {
  const inspected: string[] = [];
  let source = readFileSync("server/tools/domains/self-reflection/handlers.ts", "utf8");
  for (const [path, fixture] of [
    ["../../../self-reflection", "__reflection"],
    ["../../../safety/destructive-tool-policy", "__policy"],
    ["../../../tenant-constants", "__tenant"],
    ["../../../storage", "__storage"],
  ]) source = source.replaceAll(`import("${path}")`, `Promise.resolve(${fixture})`);
  const mod = { exports: {} as any };
  vm.runInNewContext(transformSync(source, { loader: "ts", format: "cjs" }).code, {
    module: mod, exports: mod.exports,
    __reflection: { introspectTool: (name: string) => { inspected.push(name); return { name }; } },
    __policy: { TOOL_POLICIES: { private_tool: { trustedPersonasOnly: true } }, TRUSTED_PERSONA_NAMES: new Set() },
    __tenant: { ADMIN_TENANT_ID: 1 },
    __storage: { storage: { getPersona: async () => ({ name: "Customer helper" }) } },
    require: (name: string) => {
      if (name === "../../define-tool") return { defineTool };
      if (name === "./definitions") return definitions;
      throw new Error(`Unexpected dependency: ${name}`);
    },
  });
  const handler = mod.exports.selfReflectionDomainTools[0].handler;
  return { inspect: (params: object) => handler(params, { tenantId, personaId: 2 }), inspected };
}

test("schema inspection accepts Felix's recorded name spelling and canonical tool_name", async () => {
  const fixture = inspectFixture();
  for (const args of [{ name: "opportunity_bank_file" }, { tool_name: "opportunity_bank_file" }]) {
    const result = await fixture.inspect({ action: "inspect", ...args });
    assert.equal(result.tool?.name, "opportunity_bank_file");
  }
  assert.ok(definitions.introspectToolsDefinition.function.parameters.properties.name);
});

test("inspection rejects conflicting names and still conceals restricted tools", async () => {
  const fixture = inspectFixture(2);
  const conflict = await fixture.inspect({ action: "inspect", name: "private_tool", tool_name: "public_tool" });
  assert.ok(conflict.error);
  assert.equal(fixture.inspected.length, 0);
  const hidden = await fixture.inspect({ action: "inspect", name: "private_tool" });
  assert.ok(hidden.error);
  assert.equal(fixture.inspected.length, 0);
});
