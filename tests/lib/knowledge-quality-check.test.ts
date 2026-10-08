import assert from "node:assert/strict";
import { test } from "node:test";
import { PgDialect } from "drizzle-orm/pg-core";
import { checkKnowledgeQuality } from "../../scripts/lib/knowledge-quality-check";

test("knowledge quality check refuses missing or invalid tenant before querying", async () => {
  let calls = 0;
  const execute = async () => { calls++; return { rows: [] }; };
  for (const id of [0, -1, 1.5, Number.NaN]) {
    await assert.rejects(checkKnowledgeQuality(id, execute), /tenant/i);
  }
  assert.equal(calls, 0);
});

test("quality check uses only scoped, recent aggregates and labels its limits", async () => {
  const dialect = new PgDialect();
  const queries: string[] = [];
  const execute = async (statement: Parameters<typeof checkKnowledgeQuality>[1] extends (q: infer Q) => unknown ? Q : never) => {
    const built = dialect.sqlToQuery(statement);
    queries.push(built.sql);
    assert.deepEqual(built.params, [7]);
    if (queries.length === 1) return { rows: [{ recent: 20, vector_cohort: 10, vector_missing: 2, accessed: 3 }] };
    if (queries.length === 2) return { rows: [{ recent: 5, vector_missing: 1, accessed: 2 }] };
    return { rows: [{ recent: 8, source_linked: 6, passage_anchored: 4 }] };
  };
  const report = await checkKnowledgeQuality(7, execute);
  assert.equal(queries.length, 3);
  for (const query of queries) {
    assert.match(query, /tenant_id\s*=\s*\$1/i);
    assert.match(query, /created_at\s*>=\s*NOW\(\)\s*-\s*INTERVAL '30 days'/i);
    assert.doesNotMatch(query, /\bSELECT\s+(?:\*|id|title|content|fact|claim|source_url)\b/i);
  }
  assert.equal(report.knowledge.vectorMissingInCohort, 2);
  assert.equal(report.knowledge.vectorCoverageInCohort, 0.8);
  assert.match(report.limitations.join(" "), /source tags.*does not verify/i);
  assert.equal(report.evidence.sourceLinked, 6);
  assert.equal(report.evidence.passageAnchored, 4);
  assert.match(report.limitations.join(" "), /not.*recall|recall.*not/i);
});