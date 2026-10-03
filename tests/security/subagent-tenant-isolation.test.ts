import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  createSubagentRunAccess,
  PLATFORM_ADMIN_SUBAGENT_ACCESS,
} from "../../server/lib/subagent-ownership";

type TestRun = {
  id: string;
  tenantId: number;
  parentConversationId: number;
  task: string;
  status: "running" | "completed" | "cancelled";
};

function fixtureRuns() {
  const runs = new Map<string, TestRun>([
    ["alpha", { id: "alpha", tenantId: 11, parentConversationId: 101, task: "tenant 11 task", status: "running" }],
    ["beta", { id: "beta", tenantId: 22, parentConversationId: 202, task: "tenant 22 task", status: "running" }],
    ["same-tenant-other-conversation", { id: "same-tenant-other-conversation", tenantId: 11, parentConversationId: 102, task: "other conversation task", status: "running" }],
  ]);
  return { runs, access: createSubagentRunAccess(runs) };
}

test("subagent run access reveals only runs owned by the exact tenant and conversation", () => {
  const { access } = fixtureRuns();
  const owner = { tenantId: 11, conversationId: 101 };

  assert.deepEqual(access.list(owner).map(run => run.id), ["alpha"]);
  assert.equal(access.info("alpha", owner)?.task, "tenant 11 task");
  assert.equal(access.info("beta", owner), undefined);
  assert.equal(access.info("same-tenant-other-conversation", owner), undefined);
});

test("foreign subagent kill is rejected without changing its status or revealing its task", () => {
  const { runs, access } = fixtureRuns();

  assert.deepEqual(access.kill("beta", { tenantId: 11, conversationId: 101 }), {
    success: false,
    error: "Run not found",
  });
  assert.equal(runs.get("beta")?.status, "running");
  assert.equal(access.info("beta", { tenantId: 11, conversationId: 101 }), undefined);
});

test("subagent access fails closed for missing or invalid trusted tenant/conversation context", () => {
  const { access } = fixtureRuns();

  for (const invalid of [
    undefined,
    { tenantId: 0, conversationId: 101 },
    { tenantId: 11, conversationId: 0 },
    { tenantId: "11", conversationId: 101 },
    { tenantId: 11, conversationId: Number.NaN },
    { platformAdmin: true },
  ] as any[]) {
    assert.deepEqual(access.list(invalid), []);
    assert.equal(access.info("alpha", invalid), undefined);
    assert.deepEqual(access.kill("alpha", invalid), {
      success: false,
      error: "Tenant and conversation context required",
    });
    assert.deepEqual(access.killAll(invalid), { killed: 0 });
  }
});

test("owner can kill own run and killAll cannot cancel another conversation", () => {
  const { runs, access } = fixtureRuns();
  const owner = { tenantId: 11, conversationId: 101 };

  assert.deepEqual(access.kill("alpha", owner), { success: true });
  assert.equal(runs.get("alpha")?.status, "cancelled");
  assert.deepEqual(access.killAll(owner), { killed: 0 });
  assert.equal(runs.get("same-tenant-other-conversation")?.status, "running");
  assert.equal(runs.get("beta")?.status, "running");
});

test("killAll cancels only running tasks in the exact owner conversation", () => {
  const { runs, access } = fixtureRuns();
  const owner = { tenantId: 11, conversationId: 101 };

  assert.deepEqual(access.killAll(owner), { killed: 1 });
  assert.equal(runs.get("alpha")?.status, "cancelled");
  assert.equal(runs.get("same-tenant-other-conversation")?.status, "running");
  assert.equal(runs.get("beta")?.status, "running");
});

test("tenant-scoped unified status never includes another tenant's subagent runs", () => {
  const { access } = fixtureRuns();

  assert.deepEqual(access.listForTenant(11).map(run => run.id), ["alpha", "same-tenant-other-conversation"]);
  assert.deepEqual(access.listForTenant(22).map(run => run.id), ["beta"]);
  assert.deepEqual(access.listForTenant(undefined).map(run => run.id), []);
});

test("explicit platform-admin capability retains global administrative inspection", () => {
  const { access } = fixtureRuns();
  assert.deepEqual(
    access.list({ platformAdmin: PLATFORM_ADMIN_SUBAGENT_ACCESS }).map(run => run.id),
    ["alpha", "beta", "same-tenant-other-conversation"],
  );
});

test("global platform-admin inspection does not grant unscoped cancellation", () => {
  const { runs, access } = fixtureRuns();
  const admin = { platformAdmin: PLATFORM_ADMIN_SUBAGENT_ACCESS };

  assert.equal(access.info("beta", admin)?.task, "tenant 22 task");
  assert.deepEqual(access.kill("beta", admin), {
    success: false,
    error: "Tenant and conversation context required",
  });
  assert.equal(runs.get("beta")?.status, "running");
  assert.deepEqual(access.killAll(admin), { killed: 0 });
  assert.deepEqual(access.kill("beta", { tenantId: 22, conversationId: 202 }), { success: true });
  assert.deepEqual(access.killAll({ tenantId: 11, conversationId: 101 }), { killed: 1 });
  assert.equal(runs.get("alpha")?.status, "cancelled");
  assert.equal(runs.get("beta")?.status, "cancelled");
  assert.equal(runs.get("same-tenant-other-conversation")?.status, "running");
});

test("tool and non-tool callers route through owner-scoped or explicitly privileged APIs", () => {
  const tools = readFileSync("server/tools.ts", "utf8");
  const toolsCase = tools.slice(tools.indexOf('case "subagents":'), tools.indexOf('case "autonomous_task":'));
  assert.match(toolsCase, /const tenantId = params\._tenantId/);
  assert.match(toolsCase, /const conversationId = params\._conversationId/);
  assert.match(toolsCase, /Number\.isSafeInteger\(tenantId\)/);
  assert.match(toolsCase, /Number\.isSafeInteger\(conversationId\)/);
  assert.match(toolsCase, /getSubagentRuns\(ownerScope\)/);
  assert.match(toolsCase, /killSubagent\(params\.runId, ownerScope\)/);
  assert.match(toolsCase, /killAllSubagents\(ownerScope\)/);
  assert.match(toolsCase, /getSubagentInfo\(params\.runId, ownerScope\)/);

  const routes = readFileSync("server/routes.ts", "utf8");
  const apiStart = routes.indexOf('app.get("/api/subagents"');
  const apiEnd = routes.indexOf('app.post("/api/subagents/spawn"');
  const adminApi = routes.slice(apiStart, apiEnd);
  assert.match(adminApi, /requirePlatformAdmin\(req, res\)/);
  assert.match(adminApi, /PLATFORM_ADMIN_SUBAGENT_ACCESS/);
  assert.match(adminApi, /getSubagentRunsForPlatformAdmin/);
  assert.match(adminApi, /getSubagentInfoForPlatformAdmin/);
  assert.match(adminApi, /killSubagentForPlatformAdmin/);
  assert.match(adminApi, /killAllSubagentsForPlatformAdmin/);
  assert.match(adminApi, /Valid conversationId required to cancel a subagent/);
  assert.match(adminApi, /Valid conversationId required for kill-all/);
  assert.match(adminApi, /killSubagentForPlatformAdmin\([\s\S]*parentConversationId/);
  assert.match(adminApi, /killAllSubagentsForPlatformAdmin\([\s\S]*parentConversationId/);
  const platformAdminGate = adminApi.indexOf("if (!requirePlatformAdmin(req, res)) return;");
  assert.ok(platformAdminGate >= 0);
  for (const apiCall of [
    "getSubagentRunsForPlatformAdmin(",
    "getSubagentInfoForPlatformAdmin(",
    "killSubagentForPlatformAdmin(",
    "killAllSubagentsForPlatformAdmin(",
  ]) {
    assert.ok(adminApi.indexOf(apiCall) > platformAdminGate, `${apiCall} must follow platform-admin authorization`);
  }

  const agentManager = readFileSync("server/agent-manager.ts", "utf8");
  assert.match(agentManager, /getSubagentRunsForTenant\(tenantId\)/);
  assert.doesNotMatch(agentManager, /getSubagentRuns\(\)/);
});