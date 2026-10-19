import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const source = (path: string) => readFileSync(new URL("../../" + path, import.meta.url), "utf8");

test("job completion fences null-owned jobs exactly, never as a wildcard", () => {
  const body = source("server/job-queue.ts").split("export async function completeJob(")[1].split("export async function failJob(")[0];
  assert.match(body, /tenant_id IS NOT DISTINCT FROM \$\{tenantId\}/);
  assert.doesNotMatch(body, /IS NULL OR tenant_id/);
  for (const fence of ["status = 'running'", "attempts = ${attempts}", "lease_until > NOW()"])
    assert.ok(body.includes(fence));
});

test("embedding backfill requires explicit scope and heartbeat stays within the task tenant", () => {
  const storage = source("server/storage.ts");
  for (const [method, table] of [
    ["getMemoriesWithoutEmbeddings", "memoryEntries"], ["getKnowledgeWithoutEmbeddings", "agentKnowledge"],
  ]) {
    const body = storage.split(`async ${method}(`)[1].split("\n  }")[0];
    assert.match(body, /tenantId: TenantScope/);
    assert.ok(body.includes(`requiredTenantScope(${table}.tenantId, tenantId)`));
  }
  const heartbeat = source("server/heartbeat.ts");
  assert.match(heartbeat, /getMemoriesWithoutEmbeddings\(50, task\.tenantId\)/);
  assert.match(heartbeat, /getKnowledgeWithoutEmbeddings\(50, task\.tenantId\)/);
  const route = source("server/routes/memory.ts");
  assert.match(route, /getMemoriesWithoutEmbeddings\(100, ALL_TENANTS\)/);
  assert.match(route, /getKnowledgeWithoutEmbeddings\(100, ALL_TENANTS\)/);
});

test("workload message aggregates constrain both sides of the tenant join", () => {
  const sql = source("server/situation-room.ts").split("async function getPersonaWorkloads")[1].split("GROUP BY")[0];
  assert.match(sql, /m\.tenant_id = \$\{tenantId\}/);
  assert.match(sql, /c\.tenant_id = \$\{tenantId\}/);
});
