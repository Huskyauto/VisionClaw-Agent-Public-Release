import assert from "node:assert/strict";
import test from "node:test";
import { db } from "../../server/db";
import { replitOpenai } from "../../server/providers";
import { scoreLeads } from "../../server/agentic-features";

function sqlText(query: any): string {
  return (query?.queryChunks || []).map((chunk: any) => {
    if (Array.isArray(chunk?.value)) return chunk.value.join("");
    if (typeof chunk?.value === "string") return chunk.value;
    if (chunk?.queryChunks) return sqlText(chunk);
    return "";
  }).join("");
}

test("lead scoring persists a score only through the requesting tenant scope", async () => {
  const originalExecute = db.execute;
  const originalCreate = replitOpenai.chat.completions.create;
  const queries: string[] = [];
  let call = 0;

  (db as any).execute = async (query: unknown) => {
    queries.push(sqlText(query));
    call++;
    if (call === 1) return { rows: [{ name: "Tenant A ICP", icp_description: "widgets", criteria: "fit" }] };
    if (call === 2) return { rows: [{ id: 42, lead_name: "A lead", lead_email: "a@example.test" }] };
    return { rowCount: 1 };
  };
  (replitOpenai.chat.completions as any).create = async () => ({
    choices: [{ message: { content: '{"score":85,"grade":"A","reasoning":"fit"}' } }],
  });

  try {
    const result = await scoreLeads({ tenantId: 7 });
    assert.equal(result.scored, 1);
    assert.match(queries[2], /WHERE id = /);
    assert.match(queries[2], /tenant_id = /);
  } finally {
    (db as any).execute = originalExecute;
    (replitOpenai.chat.completions as any).create = originalCreate;
  }
});