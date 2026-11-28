import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { transformSync } from "esbuild";

const source = readFileSync("server/tools/domains/research-intel/handlers.ts", "utf8");
const operations = [
  ["addCompetitorHandler", "addCompetitor"],
  ["listCompetitorsHandler", "listCompetitors"],
  ["takeCompetitorSnapshotHandler", "takeCompetitorSnapshot"],
  ["detectCompetitorChangesHandler", "detectCompetitorChanges"],
  ["competitorBriefingHandler", "competitorBriefing"],
  ["defineIcpHandler", "defineICP"],
] as const;

for (const [handler, operation] of operations) {
  test(`${operation} cannot replace authenticated tenant with request fields`, async () => {
    const begin = source.indexOf(`async function ${handler}(`);
    assert.notEqual(begin, -1);
    const end = source.indexOf("\n}", begin) + 2;
    assert.ok(end > begin);
    const calls: any[] = [];
    const fixture = {
      [operation]: async (params: unknown) => { calls.push(params); return params; },
    };
    const body = source.slice(begin, end)
      .replace('import("../../../agentic-features")', "Promise.resolve(fixture)");
    const context = vm.createContext({ fixture });
    vm.runInContext(transformSync(`${body}\nglobalThis.handler = ${handler};`, {
      loader: "ts", format: "cjs",
    }).code, context);
    const invoke = (context as any).handler;
    await invoke({ tenantId: 999, competitorId: 7, name: "owned control" }, { tenantId: 42 });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].tenantId, 42);
    assert.equal(calls[0].competitorId, 7);
    assert.equal(calls[0].name, "owned control");
    const denied = await invoke({ tenantId: 999 }, {});
    assert.equal(denied.error, "Tenant context required");
    assert.equal(calls.length, 1, "denial precedes the backing operation");
  });
}
