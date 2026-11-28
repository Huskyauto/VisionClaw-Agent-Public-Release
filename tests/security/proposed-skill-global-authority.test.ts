import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { transformSync } from "esbuild";

const source = readFileSync("server/lib/proposed-skill-tool.ts", "utf8");
const branch = source.slice(source.indexOf("export async function proposeSkillTool(")).replace(/^export /, "");
assert.match(readFileSync("server/tools.ts", "utf8"), /return proposeSkillTool\(params, \{ storage, errorMessage \}\)/);

async function propose(tenantId: number) {
  const writes: any[] = [], built: any[] = [];
  let juries = 0;
  const db = {
    insert: () => ({ values: (row: any) => ({
      returning: async () => { writes.push(row); return [{ ...row, id: 17 }]; },
    }) }),
    update: () => ({ set: () => ({ where: async () => [] }) }),
  };
  const box = vm.createContext({
    TOOL_ADMIN_TENANT_ID: 1,
    storage: { createSkill: async (row: any) => { built.push(row); return { id: 31 }; } },
    errorMessage: (error: Error) => error.message,
    __fixtureImport: async (name: string) => {
      if (name.startsWith("../")) name = "./" + name.slice(3);
      if (name === "./db") return { db };
      if (name === "@shared/schema") return { proposedSkills: { id: "id" } };
      if (name === "./sanitize-untrusted") return { sanitizeUntrusted: (s: string) => s };
      if (name === "drizzle-orm") return { eq: () => true };
      if (name === "./jury-skill-build") return {
        jurySkillBuild: async () => { juries++; return {
          decision: "build", majority: 3, votes: [{ model: "fixture", verdict: "BUILD" }],
        }; },
        skillBuildApproved: (decision: string) => decision === "build",
      };
      throw new Error(`Unexpected fixture dependency: ${name}`);
    },
  });
  vm.runInContext(transformSync(
    `${branch}\nglobalThis.invoke = params => proposeSkillTool(params, {storage, errorMessage});`,
    { loader: "ts", format: "cjs" },
  ).code.replace(/\bimport\(/g, "__fixtureImport("), box);
  const result = await (box as any).invoke({
    _tenantId: tenantId, name: "test skill", description: "test description", body: "safe fixture",
  });
  return { result, writes, built, juries };
}

test("customers cannot enter the owner-only global skill build or its pending queue", async () => {
  const run = await propose(8);
  assert.equal(run.writes.length, 0);
  assert.equal(run.built.length, 0);
  assert.equal(run.juries, 0, "authority is checked before model spending");
  assert.match(run.result.error, /platform.owner/i);
});

test("authorized owner proposals retain the jury-approved autonomous build path", async () => {
  const run = await propose(1);
  assert.equal(run.result.error, undefined, run.result.error);
  assert.equal(run.writes.length, 1);
  assert.equal(run.built.length, 1);
  assert.equal(run.built[0].enabled, true);
  assert.equal(run.juries, 1);
  assert.equal(run.result.decision, "build");
});
