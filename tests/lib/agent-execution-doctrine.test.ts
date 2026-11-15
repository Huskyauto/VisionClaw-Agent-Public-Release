import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import { transformSync } from "esbuild";

// Exercise the real document composer without database, provider or tool imports.
function compose(personaId: number): string {
  const mod = { exports: {} as any };
  vm.runInNewContext(transformSync(readFileSync("server/persona-sync.ts", "utf8"), {
    loader: "ts", format: "cjs",
  }).code, {
    module: mod, exports: mod.exports, process: { env: {} },
    require: (name: string) => {
      if (name === "./db") return { db: {} };
      if (name === "drizzle-orm") return { sql: {} };
      if (name === "./tools") return { getAllToolDefinitions: () => [] };
      if (name === "./seed-persona-prompts") return { PERSONA_DOCS: {} };
      if (name === "./lib/persona-sync-completion") return {};
      if (name === "./lib/persona-tools-doc-order") return {
        canonicalizePersonaToolsDocInputs: (customTools: unknown[], enabledSkills: unknown[]) => ({ customTools, enabledSkills }),
      };
      if (name === "./safety/destructive-tool-policy") return {
        TOOL_POLICIES: {}, TRUSTED_PERSONA_NAMES: new Set(["Felix", "Forge"]),
      };
      throw new Error(`Unexpected doctrine dependency: ${name}`);
    },
  });
  return mod.exports.composeSyncToolsDoc(personaId, personaId === 2 ? "Felix" : "Specialist", [], [], []);
}

test("composed persona guidance carries bounded delegation, advisory authority and evidence reporting", () => {
  for (const personaId of [2, 3, 16]) {
    const doc = compose(personaId);
    for (const required of [
      "SMALLEST NECESSARY TEAM",
      "DELEGATION CONTRACT",
      "BACKUP ADVISERS, NOT APPROVERS",
      "EVIDENCE-BASED COMPLETION",
      "No change to connector permissions",
      "locally verified",
      "production-verified",
      "disjoint write ownership",
      "stop conditions",
      "accept, adapt or reject",
      "allowed tools and authority",
      "time, cost and context/output budget",
      "Owner instructions, tenant isolation, approval gates, safety controls and budgets remain binding",
    ]) assert.ok(doc.includes(required), `persona ${personaId} missing ${required}`);
  }
});
