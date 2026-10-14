import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { transformSync } from "esbuild";
import { sql } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import ts from "typescript";
import { isPlatformGoogleConnectorTenant } from "../../server/lib/google-connector-ownership";

function seedFixture(customerConnected = false) {
  const source = fs.readFileSync("server/oauth-subscriptions.ts", "utf8");
  const parsed = ts.createSourceFile("oauth.ts", source, ts.ScriptTarget.Latest, true);
  const functions = parsed.statements.filter(node =>
    ts.isFunctionDeclaration(node) &&
    ["seedYouTubeIfMissing", "getYouTubeAccessToken"].includes(node.name?.text || ""));
  assert.equal(functions.length, 2);
  const { code } = transformSync(functions.map(node => node.getFullText(parsed)).join("\n"),
    { loader: "ts", format: "cjs" });
  const evidence = { queries: 0, requests: 0, secretReads: 0 };
  const module = { exports: {} as any };
  vm.runInNewContext(code, {
    module, exports: module.exports, sql, ADMIN_TENANT_ID: 1,
    isPlatformGoogleConnectorTenant: (tenantId: unknown) => isPlatformGoogleConnectorTenant(tenantId, "1"),
    console: { log() {}, warn() {}, error() {} },
    db: { async execute(query: any) {
      evidence.queries++;
      const compiled = new PgDialect().sqlToQuery(query);
      if (customerConnected && compiled.sql.includes("SELECT access_token")) {
        assert.ok(compiled.params.includes(3), "customer reads must retain customer scope");
        return { rows: [{ access_token: "opaque-customer", expires_at: Date.now() + 3600000 }] };
      }
      return { rows: [] };
    } },
    process: { env: new Proxy({
      YOUTUBE_REFRESH_TOKEN: "synthetic-refresh",
      YOUTUBE_CLIENT_ID: "synthetic-client",
      YOUTUBE_CLIENT_SECRET: "synthetic-secret",
    }, { get(target, key: keyof typeof target) { evidence.secretReads++; return target[key]; } }) },
    URLSearchParams,
    encryptApiKey: () => "synthetic-encrypted",
    decryptApiKey: () => "synthetic-customer-token",
    async fetch() {
      evidence.requests++;
      return { ok: true, async json() { return { access_token: "synthetic-access", expires_in: 3600 }; } };
    },
  });
  return {
    seed: module.exports.seedYouTubeIfMissing,
    getToken: module.exports.getYouTubeAccessToken,
    evidence,
  };
}

test("customer YouTube seed refuses shared owner credentials before DB, secrets or network access", async () => {
  const { seed, evidence } = seedFixture();
  await seed(3);
  assert.deepEqual(evidence, { queries: 0, requests: 0, secretReads: 0 });
});

test("owner YouTube bootstrap remains available without using live credentials", async () => {
  const { seed, evidence } = seedFixture();
  await seed(1);
  assert.deepEqual(evidence, { queries: 2, requests: 1, secretReads: 3 });
});

test("malformed owner IDs cannot activate credential bootstrap", async () => {
  for (const tenant of [0, -1, "1", NaN, {}, null]) {
    const { seed, evidence } = seedFixture();
    await seed(tenant);
    assert.deepEqual(evidence, { queries: 0, requests: 0, secretReads: 0 });
  }
});

test("a missing customer YouTube connection stays disconnected through the public token getter", async () => {
  const { getToken, evidence } = seedFixture();
  assert.equal(await getToken(3), null);
  assert.deepEqual(evidence, { queries: 2, requests: 0, secretReads: 0 });
});

test("a customer's existing private YouTube connection remains usable", async () => {
  const { getToken, evidence } = seedFixture(true);
  assert.equal(await getToken(3), "synthetic-customer-token");
  assert.deepEqual(evidence, { queries: 1, requests: 0, secretReads: 0 });
});
