import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import crypto from "node:crypto";
import vm from "node:vm";
import { transformSync } from "esbuild";
import { isCommandAllowed } from "../../server/exec-tool";

const source = readFileSync("server/tools.ts", "utf8");
const begin = source.indexOf('      const gateCmdRaw = typeof params.gate_command');
const end = source.indexOf("      return delegateTask(", begin);
assert.ok(begin >= 0 && end > begin);
const gate = source.slice(begin, end).replace(/\bimport\(/g, "__fixtureImport(");

async function run(command: string, status = 0) {
  let processes = 0;
  const box = vm.createContext({
    crypto, process: { env: {} },
    __fixtureImport: async (name: string) => {
      if (name === "./exec-tool") return {
        isCommandAllowed,
        loadExecConfig: () => ({
          enabled: true, securityMode: "allowlist", allowlist: [], denyPatterns: [], workdir: process.cwd(),
        }),
      };
      if (name === "child_process") return { execSync: () => {
        processes++;
        if (status) throw Object.assign(new Error("fixture exit"), { status });
        return "fixture stdout";
      } };
      throw new Error(`Unexpected gate fixture dependency: ${name}`);
    },
  });
  vm.runInContext(transformSync(
    `async function invoke(params) { let prompt = "fixture"; ${gate} return { ok: true }; }\nglobalThis.invoke = invoke;`,
    { loader: "ts", format: "cjs" },
  ).code, box);
  const result = await (box as any).invoke({ _tenantId: 1, _personaId: 2, gate_command: command });
  return { result, processes };
}

test("delegation preconditions cannot bypass the canonical destructive-command floor", async () => {
  for (const command of ["rm -rf /", "npm run db:push", "git reset --hard"]) {
    const attempt = await run(command);
    assert.equal(attempt.processes, 0, command);
    assert.ok(attempt.result.error, command);
  }
});

test("safe owner preconditions and exit-77 skip semantics remain available", async () => {
  const allowed = await run("git diff --quiet HEAD~1 -- server/");
  assert.equal(allowed.processes, 1);
  assert.equal(allowed.result.ok, true);
  const skipped = await run("printf 'no work'; exit 77", 77);
  assert.equal(skipped.processes, 1);
  assert.equal(skipped.result.skipped, true);
});
