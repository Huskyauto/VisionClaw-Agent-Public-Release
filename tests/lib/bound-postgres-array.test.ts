import test from "node:test";
import assert from "node:assert/strict";
import { PgDialect } from "drizzle-orm/pg-core";
import { boundPostgresArray } from "../../server/lib/bound-postgres-array";

test("crew arrays preserve quoted text as data and require exact integer IDs", () => {
  const tools = ['quoted"tool', "slash\\tool", "x'}; SELECT secret"];
  const query = new PgDialect().sqlToQuery(boundPostgresArray(tools, "text"));
  assert.deepEqual(query.params, [JSON.stringify(tools)]);
  assert.ok(!query.sql.includes("SELECT secret"));
  assert.match(query.sql, /jsonb_array_elements_text/);
  assert.deepEqual(new PgDialect().sqlToQuery(boundPostgresArray([1, 2], "integer")).params, ["[1,2]"]);
  for (const values of [[1.5], ["1"], [null], [-1], [2 ** 40]])
    assert.throws(() => boundPostgresArray(values as any, "integer"));
  assert.throws(() => boundPostgresArray("not-array" as any, "text"));
  assert.equal(new PgDialect().sqlToQuery(boundPostgresArray([], "text")).sql, "NULL");
});
