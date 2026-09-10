import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path: string) => readFileSync(path, "utf8");

test("tenant-audit blocker batch pins every affected mutation and join", () => {
  const heartbeat = read("server/heartbeat-schedules.ts");
  for (const update of heartbeat.match(/UPDATE research_schedules[\s\S]*?;/g) || []) {
    assert.match(update, /WHERE id = \$\{sched\.id\}\s+AND tenant_id = \$\{sched\.tenant_id\}/);
  }

  const queue = read("server/job-queue.ts");
  assert.match(queue, /export async function retryJob\(id: number, tenantId: number\)/);
  assert.match(queue, /WHERE id = \$\{id\}\s+AND tenant_id = \$\{tenantId\}\s+AND status IN/);
  assert.match(queue, /export async function getJobTenantForAdmin\(id: number\)/);
  const jobRoute = read("server/routes/agent-jobs.ts");
  const retryRoute = jobRoute.match(/app\.post\("\/api\/admin\/agent-jobs\/:id\/retry"[\s\S]*?\n  }\);/);
  assert.ok(retryRoute, "admin retry route present");
  assert.match(retryRoute![0], /getJobTenantForAdmin\(id\)/);
  assert.match(retryRoute![0], /const jobTenantId = job\?\.tenantId/);
  assert.match(retryRoute![0], /retryJob\(id, jobTenantId as number\)/);
  assert.doesNotMatch(retryRoute![0], /req\.body\??\.tenantId/);

  const keys = read("server/lib/mcp-api-keys.ts");
  assert.match(keys, /UPDATE mcp_api_keys SET last_used_at = NOW\(\)\s+WHERE id = \$\{row\.id\}\s+AND tenant_id = \$\{row\.tenant_id\}/);

  const minds = read("server/minds-engine.ts");
  assert.match(minds, /function normalizeIntegerArray/);
  assert.doesNotMatch(minds, /join\(","\).*::int\[\]/);
  assert.match(minds, /ANY\(\$\{dependencyIds\}::int\[\]\)/);
  assert.match(minds, /ANY\(\$\{normalizedEventIds\}::int\[\]\)/);

  const governor = read("server/process-governor.ts");
  assert.match(governor, /LEFT JOIN watchlist_items wi ON wi\.id = wa\.watchlist_item_id\s+AND wi\.tenant_id = \$\{tenantId\}/);

  const improvement = read("server/self-improvement.ts");
  assert.match(
    improvement,
    /\.where\(and\(eq\(experiments\.id, experiment\.id\), eq\(experiments\.tenantId, config\.tenantId!\)\)\)/,
  );

  const dataProtection = read("server/data-protection.ts");
  assert.match(dataProtection, /DELETE FROM conversations WHERE id = \$\{conv\.id\} AND tenant_id = \$\{conv\.tenant_id\}/);
});