import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import test from "node:test";
import { transformSync } from "esbuild";
import { defineTool } from "../../server/tools/define-tool";
import { dispatchTool } from "../../server/tools/dispatcher";
import { registerTools, __resetRegistryForTests } from "../../server/tools/registry";
import { fileIncomeOpportunitySchema } from "../../shared/models/income-opportunities";
import * as overview from "../../server/lib/owner-business-overview";
import * as definitions from "../../server/tools/domains/income-opportunities/definitions";

const idea = {
  name: "Level-Up Skills Sprint", category: "Education", buyer: "Local business owners",
  problem: "UNVALIDATED: owners need practical skills", entryOffer: "Proposed skills sprint",
  nextStep: "Interview five owners before building",
};
const metadata = {
  _tenantId: 1, _personaId: 2, _conversationId: 620,
  _invokedByModel: true, conversationId: 620, _skipTracking: true,
  _invokedVia: "chat_engine", _selfHeal: false,
};

function fixture() {
  const writes: Array<{ tenant: number; input: Record<string, unknown> }> = [];
  const source = readFileSync("server/tools/domains/income-opportunities/handlers.ts", "utf8")
    .replaceAll('import("../../../agentic/autonomous-budget")', "Promise.resolve(__budget)")
    .replaceAll('import("@shared/schema")', "Promise.resolve(__schema)")
    .replaceAll('import("../../../lib/income-opportunities")', "Promise.resolve(__store)");
  const mod = { exports: {} as any };
  vm.runInNewContext(transformSync(source, { loader: "ts", format: "cjs" }).code, {
    module: mod, exports: mod.exports, console, Error, process: { env: {} },
    __budget: { ownerTenantId: () => 1 },
    __schema: { fileIncomeOpportunitySchema },
    __store: { fileIncomeOpportunity: async (tenant: number, input: Record<string, unknown>) => {
      writes.push({ tenant, input });
      return { created: true, opportunity: { id: writes.length, slug: `idea-${writes.length}`, evidence: "Idea" } };
    } },
    require: (name: string) => {
      if (name === "../../define-tool") return { defineTool };
      if (name === "./definitions") return definitions;
      if (name === "../../../lib/owner-business-overview") return overview;
      throw new Error(`Unexpected dependency: ${name}`);
    },
  });
  __resetRegistryForTests();
  registerTools(mod.exports.incomeOpportunityDomainTools);
  return { writes };
}

test("six filings survive the real dispatcher envelope and return six identifiers", async () => {
  const { writes } = fixture();
  const names = ["Level-Up Skills Sprint", "Never-Let-An-Estimate-Die", "Tuesday Watcher",
    "Your Own Catalog Knows", "Second Brain in a Box", "Owner's Voice Brain"];
  const ids: unknown[] = [];
  for (const name of names) {
    const result = await dispatchTool("opportunity_bank_file", { ...idea, name, ...metadata });
    assert.equal(result.success, true, JSON.stringify(result));
    assert.equal(result.evidence, "Idea");
    ids.push(result.id);
  }
  assert.equal(new Set(ids).size, 6);
  assert.equal(writes.length, 6);
  for (const write of writes) {
    assert.equal(write.tenant, 1);
    assert.deepEqual(Object.keys(write.input).sort(), Object.keys(idea).sort());
  }
});

test("envelope separation preserves unknown-field rejection and owner-only filing", async () => {
  const { writes } = fixture();
  for (const extra of [{ evidence: "Paid" }, { entryOffre: "typo" }, { _unknownFlag: true }]) {
    const result = await dispatchTool("opportunity_bank_file", { ...idea, ...metadata, ...extra });
    assert.equal(result.error, "Invalid opportunity fields");
  }
  for (const identity of [{ _tenantId: 2 }, { _tenantId: undefined }, { _personaId: 3 }]) {
    const result = await dispatchTool("opportunity_bank_file", { ...idea, ...metadata, ...identity });
    assert.ok(result.error);
  }
  assert.equal(writes.length, 0);
});

test("owner overview accepts framework metadata but rejects unknown public arguments", async () => {
  fixture();
  const result = await dispatchTool("owner_business_overview", { ...metadata, section: "not-a-section" });
  assert.equal(result.error, "Invalid overview section", "metadata must not mask actual field validation");
  const unknown = await dispatchTool("owner_business_overview", { ...metadata, invented: true });
  assert.equal(unknown.error, "Unknown overview argument");
});

test("metadata projection is opt-in, non-mutating and preserves declared public fields", async () => {
  const definition = {
    type: "function" as const,
    function: { name: "envelope_probe", description: "test",
      parameters: { type: "object", properties: { conversationId: { type: "number" } } } },
  };
  const params = { conversationId: 7, _invokedByModel: true, unknown: "reject me" };
  const legacy = defineTool(definition, async input => input);
  assert.equal(await legacy.handler(params, {}), params);
  const separated = defineTool(definition, async (input, ctx) => ({ input, tenantId: ctx.tenantId }),
    { publicArgumentsOnly: true });
  const result = await separated.handler(params, { tenantId: 42 });
  assert.deepEqual(result.input, { conversationId: 7, unknown: "reject me" });
  assert.equal(result.tenantId, 42);
  assert.equal(params._invokedByModel, true);
});
