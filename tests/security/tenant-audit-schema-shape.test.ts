import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildTenantAuditSchemaIndex } from "../../scripts/lib/tenant-audit-schema-index";
import { readFileSync } from "node:fs";

test("audit schema shape uses actual columns, not comments, nearby tables or a 4KB prefix", () => {
  const dir = mkdtempSync(join(tmpdir(), "audit-schema-"));
  try {
    const path = join(dir, "schema.ts");
    writeFileSync(path, `
      export const global = pgTable("global", { id: serial("id"),
        // tenantId: integer("tenant_id") is intentionally NOT a column
      });
      export const wide = pgTable("wide", {
        note: text("note").default("${"x".repeat(5000)}"),
        tenantId: integer("tenant_id").notNull(),
      });
      export const renamed = pgTable("renamed", { owner: integer("tenant_id") });
    `);
    const result = buildTenantAuditSchemaIndex(path);
    assert.equal(result.ok, true);
    assert.equal(result.index.get("global")?.hasTenantId, false);
    assert.equal(result.index.get("wide")?.hasTenantId, true);
    assert.equal(result.index.get("renamed")?.hasTenantId, true);
    writeFileSync(path, "export const broken = pgTable(");
    assert.equal(buildTenantAuditSchemaIndex(path).ok, false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("current schema disproves missing tenant columns without certifying child ownership", () => {
  const result = buildTenantAuditSchemaIndex("shared/schema.ts");
  assert.equal(result.ok, true);
  for (const table of ["personas", "skills", "heartbeat_logs", "mcp_servers", "tenants",
    "project_notes", "project_files", "project_conversations", "outreach_sequence_steps"]) {
    assert.equal(result.index.get(table)?.hasTenantId, false, table);
  }
  for (const table of ["messages", "projects", "conversations", "memory_entries"]) {
    assert.equal(result.index.get(table)?.hasTenantId, true, table);
  }
  const source = readFileSync("scripts/tenant-isolation-audit.ts", "utf8");
  assert.match(source, /Never suppress merely because the schema note says/);
  assert.doesNotMatch(source, /Every INSERT must pass tenantId explicitly \(columns are NOT NULL with no default\)/);
});
