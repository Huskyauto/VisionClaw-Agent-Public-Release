import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("activity completion binds its write to an explicit tenant", () => {
  const source = readFileSync("server/agent-activity.ts", "utf8");
  const body = source.slice(source.indexOf("export async function completeActivity"), source.indexOf("export function getLiveAgentStatuses"));
  assert.match(body, /tenantId: number/);
  assert.match(body, /eq\(agentActivity\.tenantId, tenantId\)/);
});

test("global operator job access is explicit rather than an omitted tenant", () => {
  const source = readFileSync("server/job-queue.ts", "utf8");
  assert.match(source, /cancelJob\(id: number, scope: TenantScope\)/);
  assert.match(source, /listJobs\(filter: ListJobsFilter, scope: TenantScope\)/);
  const routes = readFileSync("server/routes/agent-jobs.ts", "utf8");
  assert.match(routes, /cancelJob\(id, ALL_TENANTS\)/);
  assert.match(routes, /listJobs\(\{[^}]+\}, ALL_TENANTS\)/);
  assert.match(routes, /requirePlatformAdmin\(req, res\)/);
});
