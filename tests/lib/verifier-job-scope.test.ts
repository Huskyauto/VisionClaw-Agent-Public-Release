import assert from "node:assert/strict";
import test from "node:test";
import { PgDialect } from "drizzle-orm/pg-core";
import { verifierJobScopeSql, webVerifierQueueScope } from "../../server/lib/verifier-job-scope";

test("only an exact opt-in diverts compiler jobs from the web worker", () => {
  for (const value of [undefined, "", "true", "01", " 1", "0"]) {
    assert.equal(webVerifierQueueScope(value), "all");
  }
  assert.equal(webVerifierQueueScope("1"), "exclude-verifier");
});

test("queue scope is closed to the two compiler kinds and rejects unknown modes", () => {
  const dialect = new PgDialect();
  assert.match(dialect.sqlToQuery(verifierJobScopeSql("only-verifier")).sql, /AND kind IN/);
  assert.match(dialect.sqlToQuery(verifierJobScopeSql("exclude-verifier")).sql, /AND kind NOT IN/);
  assert.equal(dialect.sqlToQuery(verifierJobScopeSql("all")).sql, "");
  assert.throws(() => verifierJobScopeSql("oops" as any));
});