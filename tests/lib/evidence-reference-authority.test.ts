import test from "node:test";
import assert from "node:assert/strict";
import { PgDialect } from "drizzle-orm/pg-core";
import { evidenceReferenceAuthority } from "../../server/lib/evidence-reference-authority";

test("structured evidence only resolves an exact positive source ID under the current tenant", () => {
  for (const [kind, table] of [["memory_entry", "memory_entries"], ["finding", "parallel_job_findings"]]) {
    const compiled = new PgDialect().sqlToQuery(evidenceReferenceAuthority(kind, "42", 7));
    assert.ok(compiled.sql.includes(table));
    assert.match(compiled.sql, /tenant_id = \$/);
    assert.deepEqual(compiled.params, [42, 7]);
    for (const bad of ["", "0", "-1", "1.5", " 42", "42 OR 1=1", "system:42", "9999999999999999999999"])
      assert.throws(() => evidenceReferenceAuthority(kind, bad, 7));
  }
  assert.throws(() => evidenceReferenceAuthority("memory_entry", "42", undefined as any));
  assert.throws(() => evidenceReferenceAuthority("other_kind", "42", 7));
});

test("opaque evidence snippets do not acquire source-record authority", () => {
  for (const kind of ["free_text", "tool_result"])
    assert.equal(new PgDialect().sqlToQuery(evidenceReferenceAuthority(kind, "snippet", 7)).sql, "TRUE");
});
