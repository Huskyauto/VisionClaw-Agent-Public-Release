import { test } from "node:test";
import assert from "node:assert/strict";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";

const dialect = new PgDialect();

test("project briefs list only bounded, tenant-scoped fields", async () => {
  const { listProjectBriefs } = await import("../../server/lib/mcp-project-briefs");
  const statements: { sql: string; params: unknown[] }[] = [];
  const execute = async (statement: SQL) => {
    const query = dialect.sqlToQuery(statement);
    statements.push(query);
    return { rows: [{
      id: 3, name: "Tenant project", description: "Visible", status: "active",
      updated_at: new Date("2026-01-01"), customer_email: "private@example.test",
      drive_folder_url: "private-url",
    }] };
  };
  const projects = await listProjectBriefs(42, execute);
  assert.deepEqual(projects, [{
    id: 3, name: "Tenant project", description: "Visible", status: "active",
    updatedAt: new Date("2026-01-01"),
  }]);
  assert.match(statements[0].sql, /WHERE p\.tenant_id = \$1/);
  assert.match(statements[0].sql, /LIMIT 20\b/);
  assert.deepEqual(statements[0].params, [42]);
  await assert.rejects(() => listProjectBriefs(0, execute), /tenant/i);
  assert.equal(statements.length, 1, "invalid tenants must not reach the DB");
});

test("project brief detail requires both tenant and project and returns only approved fields", async () => {
  const { getProjectBrief } = await import("../../server/lib/mcp-project-briefs");
  const statements: { sql: string; params: unknown[] }[] = [];
  const execute = async (statement: SQL) => {
    const query = dialect.sqlToQuery(statement);
    statements.push(query);
    if (query.params[0] !== 3 || query.params[1] !== 42) return { rows: [] };
    return { rows: [{
      id: 3, name: "Project", description: "Summary", status: "active",
      current_state: "Current work", updated_at: new Date("2026-01-01"),
      customer_email: "private@example.test", metadata: { secret: "private" },
    }] };
  };
  assert.deepEqual(await getProjectBrief(3, 42, execute), {
    id: 3, name: "Project", description: "Summary", status: "active",
    currentState: "Current work", updatedAt: new Date("2026-01-01"),
  });
  assert.equal(await getProjectBrief(3, 9, execute), null, "wrong tenant cannot read the brief");
  assert.match(statements[0].sql, /WHERE p\.id = \$1 AND p\.tenant_id = \$2/);
  assert.deepEqual(statements[0].params, [3, 42]);
  await assert.rejects(() => getProjectBrief(0, 42, execute), /project/i);
  await assert.rejects(() => getProjectBrief(3, 0, execute), /tenant/i);
  assert.equal(statements.length, 2, "invalid identifiers must not query the DB");
});

test("project briefs cap every text field and the returned row count", async () => {
  const { getProjectBrief, listProjectBriefs } = await import("../../server/lib/mcp-project-briefs");
  const queries: string[] = [];
  const huge = "X".repeat(10_000);
  const rows = Array.from({ length: 25 }, (_, index) => ({
    id: index + 1, name: huge, description: huge, status: huge,
    current_state: huge, updated_at: new Date("2026-01-01"),
  }));
  const execute = async (statement: SQL) => {
    queries.push(dialect.sqlToQuery(statement).sql);
    return { rows };
  };
  const list = await listProjectBriefs(42, execute);
  assert.equal(list.length, 20);
  assert.equal(list[0].name.length, 160);
  assert.equal(list[0].description.length, 1000);
  assert.equal(list[0].status.length, 40);
  assert.ok(JSON.stringify(list).length < 30_000);
  const detail = await getProjectBrief(1, 42, execute);
  assert.equal(detail?.status.length, 40);
  assert.equal(detail?.currentState.length, 2000);
  assert.ok(JSON.stringify(detail).length < 5_000);
  for (const query of queries) {
    assert.match(query, /LEFT\(p\.status,\s*40\)/, "database must also bound status before transfer");
  }
});