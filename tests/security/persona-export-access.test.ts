import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import { transformSync } from "esbuild";

function loadExport(failTable?: string, failDependency?: "router" | "lanes") {
  const queries: Array<{ text: string; values: unknown[] }> = [];
  const source = readFileSync("server/persona-export.ts", "utf8")
    .replace('await import("./tool-router")', "__router")
    .replace('await import("./express-lanes")', "__lanes");
  const sql = (parts: TemplateStringsArray, ...values: unknown[]) => ({
    text: parts.join("?"), values,
  });
  const database = { execute: async (query: { text: string; values: unknown[] }) => {
    queries.push(query);
    if (failTable && query.text.includes(`FROM ${failTable}`)) throw new Error("private database failure");
    return { rows: query.text.includes("FROM personas") ? [{
      id: 2, name: "Felix", soul: "private agent instructions",
    }] : [] };
  } };
  const module = { exports: {} as any };
  vm.runInNewContext(transformSync(source, { loader: "ts", format: "cjs" }).code, {
    module, exports: module.exports, console,
    __router: { getPersonaBlockedTools: () => {
      if (failDependency === "router") throw new Error("routing unavailable");
      return new Set();
    } },
    __lanes: { findLanesForAgent: () => {
      if (failDependency === "lanes") throw new Error("lanes unavailable");
      return { outbound: [] };
    } },
    require: (name: string) => {
      if (name === "./db") return { db: database };
      if (name === "drizzle-orm") return { sql };
      if (name === "./lib/silent-catch") return { logSilentCatch: () => {} };
      if (name === "./storage-helpers/tenant-context") return { ADMIN_TENANT_ID: 1 };
      throw new Error(`Unexpected dependency: ${name}`);
    },
  });
  return { exportPersona: module.exports.exportPersona, queries };
}

test("persona export denies foreign or malformed tenant identity before any database read", async () => {
  for (const tenant of [2, 55, undefined, null, "1", 0, -1, NaN, Infinity, {}, [1]]) {
    const { exportPersona, queries } = loadExport();
    await assert.rejects(exportPersona(2, tenant), /owner/i);
    assert.equal(queries.length, 0);
  }
});

test("owner can export the persona and tenant-scoped data uses bound identity", async () => {
  const { exportPersona, queries } = loadExport();
  const result = await exportPersona(2, 1);
  assert.equal(result.agent.identity.soul, "private agent instructions");
  for (const table of ["trust_scores", "governance_rules", "agent_knowledge"]) {
    const query = queries.find(q => q.text.includes(`FROM ${table}`));
    assert.ok(query);
    assert.match(query.text, /tenant_id = \?/);
    assert.ok(query.values.includes(1));
  }
});

for (const table of ["skills", "agent_knowledge"]) {
  test(`failed ${table} lookup rejects the export instead of returning an empty success`, async () => {
    const { exportPersona } = loadExport(table);
    await assert.rejects(exportPersona(2, 1), /private database failure/);
  });
}

test("invalid persona IDs are rejected before querying", async () => {
  for (const id of [undefined, "2", 0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    const { exportPersona, queries } = loadExport();
    await assert.rejects(exportPersona(id, 1), /positive integer/);
    assert.equal(queries.length, 0);
  }
});

for (const dependency of ["router", "lanes"] as const) {
  test(`failed ${dependency} resolution does not fabricate a complete export`, async () => {
    const { exportPersona } = loadExport(undefined, dependency);
    await assert.rejects(exportPersona(2, 1), /unavailable/);
  });
}

function loadHandler(fail = false) {
  const source = readFileSync("server/tools.ts", "utf8");
  const start = source.indexOf('    case "export_persona": {');
  const end = source.indexOf('    case "skillify": {', start);
  assert.ok(start > 0 && end > start);
  const body = source.slice(start, end).replace('case "export_persona":', "")
    .replace('await import("./persona-export")', "__export");
  let calls = 0;
  const messages: string[] = [];
  const context = vm.createContext({
    console: { error: (message: string) => messages.push(message) },
    __export: {
      exportPersona: async () => {
        calls++;
        if (fail) throw new Error("secret SQL and private-customer@example.invalid");
        return { format: "visionclaw-agent-v1", agent: { name: "Felix" } };
      },
      exportToMarkdown: () => "# Felix",
    },
  });
  const handler = vm.runInContext(`(async function(params) ${body})`, context);
  return { handler, calls: () => calls, messages };
}

test("registered tool rejects foreign tenants without calling the export service", async () => {
  for (const tenant of [undefined, 2, "1", {}, [1]]) {
    const h = loadHandler();
    const result = await h.handler({ _tenantId: tenant, persona_id: 2 });
    assert.match(result.error, /owner/i);
    assert.equal(h.calls(), 0);
  }
});

test("registered owner tool returns JSON and markdown exports", async () => {
  const h = loadHandler();
  assert.equal((await h.handler({ _tenantId: 1, persona_id: 2, format: "json" })).agent.name, "Felix");
  assert.equal((await h.handler({ _tenantId: 1, persona_id: 2, format: "markdown" })).markdown, "# Felix");
});

test("registered tool reports failure without exposing database details in output or logs", async () => {
  const h = loadHandler(true);
  const result = await h.handler({ _tenantId: 1, persona_id: 2, format: "json" });
  assert.match(result.error, /No complete export/);
  assert.doesNotMatch(JSON.stringify([result, h.messages]), /secret SQL|private-customer/);
  assert.equal(h.calls(), 1);
});
