// Task #119 — requiredTenantScope fail-closed contract.
// Query-free (tests/lib stays query-free): only builds predicates, never executes.
import { test } from "node:test";
import assert from "node:assert/strict";
import { pgTable, serial, integer } from "drizzle-orm/pg-core";
import {
  ALL_TENANTS,
  requiredTenantScope,
} from "../../server/storage-helpers/tenant-scope";

const t = pgTable("tenant_scope_probe", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull(),
});

test("ALL_TENANTS sentinel yields no filter (undefined)", () => {
  assert.equal(requiredTenantScope(t.tenantId, ALL_TENANTS), undefined);
});

test("positive integer yields an eq predicate", () => {
  const pred = requiredTenantScope(t.tenantId, 7);
  assert.ok(pred, "expected a SQL predicate for a positive tenantId");
});

test("undefined/null/zero/negative/NaN/non-integer/strings all throw (fail closed)", () => {
  const bad: any[] = [undefined, null, 0, -1, NaN, 1.5, "1", "", "__ALL__", {}, true];
  for (const v of bad) {
    assert.throws(
      () => requiredTenantScope(t.tenantId, v),
      /tenantId is required/,
      `expected throw for ${JSON.stringify(v)}`,
    );
  }
});
