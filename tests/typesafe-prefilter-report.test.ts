import test from "node:test";
import assert from "node:assert/strict";
import { factPrefilterReportQuery, parseFactPrefilterReportArgs } from "../server/lib/typesafe-prefilter-report";
import { PgDialect } from "drizzle-orm/pg-core";

test("report requires an explicit tenant and a bounded observation window", () => {
  assert.throws(() => parseFactPrefilterReportArgs([]), /tenant/);
  assert.throws(() => parseFactPrefilterReportArgs(["--tenant", "0"]), /tenant/);
  assert.throws(() => parseFactPrefilterReportArgs(["--tenant", "1", "--days", "31"]), /days/);
  assert.throws(() => parseFactPrefilterReportArgs(["--tenant", "1", "--days", "oops"]), /days/);
  assert.deepEqual(parseFactPrefilterReportArgs(["--tenant", "42", "--days", "7"]), { tenantId: 42, days: 7 });
});

test("report binds tenant and version and does not classify failures as savings", () => {
  const query = new PgDialect().sqlToQuery(factPrefilterReportQuery(42, 7));
  assert.ok(query.params.includes(42));
  assert.ok(query.params.includes("jev-session-fact-prefilter-v2"));
  assert.match(query.sql, /tenant_id = \$/);
  assert.match(query.sql, /error_class IS NULL/);
  assert.match(query.sql, /extractor_ran = false/);
  assert.match(query.sql, /mode = 'shadow'/);
  assert.match(query.sql, /facts_written > 0/);
  assert.throws(() => factPrefilterReportQuery(NaN, 7), /tenant/);
});
