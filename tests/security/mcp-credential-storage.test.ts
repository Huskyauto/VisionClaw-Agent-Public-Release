import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { sql } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";

function fixture(stored = "enc:v1:synthetic-token", encryptionAvailable = true) {
  const queries: { sql: string; params: unknown[] }[] = [];
  const sent: any[] = [];
  const dialect = new PgDialect();
  const row: any = { id: 7, name: "fixture", server_url: "https://example.com",
    auth_type: "bearer", auth_token: stored, enabled: true };
  const module = { exports: {} as any };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync("server/mcp-client.ts", "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, {
    module, exports: module.exports, AbortSignal, console,
    require: (name: string) => {
      if (name === "drizzle-orm") return { sql };
      if (name === "./db") return { db: { execute: async (query: any) => {
        const parsed = dialect.sqlToQuery(query); queries.push(parsed);
        if (/INSERT INTO mcp_servers/.test(parsed.sql)) row.auth_token = parsed.params[4];
        return { rows: [row] };
      } } };
      if (name === "./lib/silent-catch") return { logSilentCatch() {} };
      if (name === "./crypto") return {
        isEncrypted: (s: string) => s.startsWith("enc:v1:"),
        encryptApiKey: (s: string) => encryptionAvailable ? `enc:v1:${s}` : s,
        decryptApiKey: (s: string) => s.replace(/^enc:v1:/, ""),
      };
      if (name === "./lib/mcp-network-boundary") return {
        validateMcpServerUrl: async (url: string) => ({ url }),
        fetchMcpEndpoint: async (_url: string, _endpoint: string, init: any) => {
          sent.push(init); return { ok: true, json: async () => ({ result: { ok: true } }) };
        },
      };
      throw new Error(`Unexpected MCP fixture dependency ${name}`);
    },
  });
  return { client: module.exports, queries, sent };
}

test("MCP configuration encrypts tokens at INSERT and never returns them to the API", async () => {
  const { client, queries } = fixture();
  const config = await client.addMcpServer({ name: "fixture", serverUrl: "https://example.com",
    authType: "bearer", authToken: "synthetic-token" });
  const insert = queries.find(q => /INSERT INTO mcp_servers/.test(q.sql))!;
  assert.equal(insert.params[4], "enc:v1:synthetic-token");
  assert.equal(config.authToken, "***configured***");
});

test("authenticated MCP fails closed with an explicit setup error if encryption is unavailable", async () => {
  const { client, queries, sent } = fixture("synthetic-token", false);
  await assert.rejects(client.addMcpServer({ name: "fixture", serverUrl: "https://example.com",
    authType: "bearer", authToken: "synthetic-token" }), /SESSION_SECRET/);
  assert.equal(queries.some(q => /INSERT INTO/.test(q.sql)), false);
  await assert.rejects(client.callMcpTool(7, "fixture", {}), /SESSION_SECRET/);
  assert.equal(sent.length, 0);
});

test("MCP decrypts only for outbound auth, and upgrades legacy storage with a compare-and-set", async () => {
  for (const token of ["enc:v1:synthetic-token", "synthetic-token"]) {
    const { client, queries, sent } = fixture(token);
    await client.callMcpTool(7, "fixture", {});
    assert.equal(sent[0].headers.Authorization, "Bearer synthetic-token");
    const writes = queries.filter(q => /SET auth_token/.test(q.sql));
    assert.equal(writes.length, token.startsWith("enc:") ? 0 : 1);
    if (writes.length) {
      assert.match(writes[0].sql, /WHERE id = .* AND auth_token =/s);
      assert.equal(writes[0].params[0], "enc:v1:synthetic-token");
    }
  }
});
