import { test } from "node:test";
import assert from "node:assert/strict";
import { tenantScope, requireTenantScope, assertValidTenantId } from "../../server/storage-helpers/tenant-scope";
import { conversations } from "../../shared/schema";

// R74.13g — Centralized tenant-scope helper.
// Replaces 11 truthy `if (tenantId) conditions.push(eq(...))` sites in storage.ts
// that silently fail-open on 0/NaN/non-integer (Furrow BLOCKING pattern, agentic-engines.ts:177,257).

test("tenantScope: returns undefined for explicit undefined (admin/global call)", () => {
  assert.equal(tenantScope(conversations.tenantId, undefined), undefined);
});

test("tenantScope: returns undefined for null (admin/global call)", () => {
  assert.equal(tenantScope(conversations.tenantId, null), undefined);
});

test("tenantScope: returns SQL predicate for tenantId=1", () => {
  const result = tenantScope(conversations.tenantId, 1);
  assert.ok(result, "expected truthy SQL object for valid tenantId");
  assert.equal(typeof result, "object");
});

test("tenantScope: returns SQL predicate for large positive int", () => {
  const result = tenantScope(conversations.tenantId, 999999);
  assert.ok(result);
});

test("tenantScope: throws for tenantId=0 (truthy-check fail-open shape)", () => {
  assert.throws(() => tenantScope(conversations.tenantId, 0), /Invalid tenantId/);
});

test("tenantScope: throws for negative tenantId", () => {
  assert.throws(() => tenantScope(conversations.tenantId, -1), /Invalid tenantId/);
});

test("tenantScope: throws for NaN", () => {
  assert.throws(() => tenantScope(conversations.tenantId, NaN), /Invalid tenantId/);
});

test("tenantScope: throws for non-integer (1.5)", () => {
  assert.throws(() => tenantScope(conversations.tenantId, 1.5), /Invalid tenantId/);
});

test("tenantScope: throws for Infinity", () => {
  assert.throws(() => tenantScope(conversations.tenantId, Infinity), /Invalid tenantId/);
});

test("tenantScope: throws for non-number (string '1')", () => {
  assert.throws(() => tenantScope(conversations.tenantId, "1" as any), /Invalid tenantId/);
});

test("assertValidTenantId: returns undefined for undefined", () => {
  assert.equal(assertValidTenantId(undefined), undefined);
});

test("assertValidTenantId: returns undefined for null", () => {
  assert.equal(assertValidTenantId(null), undefined);
});

test("assertValidTenantId: returns the number for valid input", () => {
  assert.equal(assertValidTenantId(1), 1);
  assert.equal(assertValidTenantId(42), 42);
});

test("assertValidTenantId: throws on fail-open shapes", () => {
  assert.throws(() => assertValidTenantId(0), /Invalid tenantId/);
  assert.throws(() => assertValidTenantId(-1), /Invalid tenantId/);
  assert.throws(() => assertValidTenantId(NaN), /Invalid tenantId/);
  assert.throws(() => assertValidTenantId(1.5), /Invalid tenantId/);
  assert.throws(() => assertValidTenantId(Infinity), /Invalid tenantId/);
  assert.throws(() => assertValidTenantId("1" as any), /Invalid tenantId/);
});

test("requireTenantScope: throws when tenantId is undefined", () => {
  assert.throws(() => requireTenantScope(conversations.tenantId, undefined), /required/);
});

test("requireTenantScope: throws when tenantId is null", () => {
  assert.throws(() => requireTenantScope(conversations.tenantId, null), /required/);
});

test("requireTenantScope: throws for invalid values (0, NaN, negative)", () => {
  assert.throws(() => requireTenantScope(conversations.tenantId, 0), /Invalid tenantId/);
  assert.throws(() => requireTenantScope(conversations.tenantId, NaN), /Invalid tenantId/);
  assert.throws(() => requireTenantScope(conversations.tenantId, -5), /Invalid tenantId/);
});

test("requireTenantScope: returns SQL predicate for valid tenantId", () => {
  const result = requireTenantScope(conversations.tenantId, 42);
  assert.ok(result);
  assert.equal(typeof result, "object");
});
