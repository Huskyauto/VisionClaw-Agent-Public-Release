import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { sql } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";

function harness() {
  const source = ts.createSourceFile("store.ts", readFileSync("server/whatsapp-auth-store.ts", "utf8"),
    ts.ScriptTarget.Latest, true);
  const fn = source.statements.find(s => ts.isFunctionDeclaration(s) && s.name?.text === "clearDbAuthState");
  assert.ok(fn);
  const code = ts.transpileModule(fn.getText(source), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const keys = new Set(["creds", "keys_legacy", "t2_creds", "t2_keys_session_1",
    "t20_creds", "t21_keys_session", "t200_creds", "t3_creds"]);
  const calls: string[] = [];
  const exports: Record<string, (...args: any[]) => Promise<void>> = {};
  vm.runInNewContext(code, { exports, sql,
    ensureTable: async () => { calls.push("ensure"); },
    db: { execute: async (query: any) => {
      const compiled = new PgDialect().sqlToQuery(query);
      calls.push("delete");
      let matches: (key: string) => boolean;
      if (/starts_with\(key,\s*\$1\)/i.test(compiled.sql)) {
        matches = key => key.startsWith(compiled.params[0] as string);
      } else if (/key LIKE \$1/.test(compiled.sql)) {
        const pattern = String(compiled.params[0]).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
          .replace(/_/g, ".").replace(/%/g, ".*");
        matches = key => new RegExp(`^${pattern}$`).test(key);
      } else if (/key NOT LIKE 't%'/.test(compiled.sql)) {
        matches = key => !key.startsWith("t");
      } else { throw Error(`Unexpected deletion SQL: ${compiled.sql}`); }
      for (const key of keys) if (matches(key)) keys.delete(key);
    } },
  });
  return { clear: exports.clearDbAuthState, keys, calls };
}

test("tenant 2 disconnect deletes only its exact namespace, never tenants 20, 21 or 200", async () => {
  const h = harness();
  await h.clear(2);
  assert.deepEqual([...h.keys], ["creds", "keys_legacy", "t20_creds", "t21_keys_session", "t200_creds", "t3_creds"]);
});

test("the owner's legacy slot cleanup preserves every tenant-prefixed session", async () => {
  const h = harness();
  await h.clear();
  assert.deepEqual([...h.keys], ["t2_creds", "t2_keys_session_1",
    "t20_creds", "t21_keys_session", "t200_creds", "t3_creds"]);
});

test("a tenant with no matching session cannot remove another tenant's credentials", async () => {
  const h = harness();
  const before = [...h.keys];
  await h.clear(2000);
  assert.deepEqual([...h.keys], before);
});
