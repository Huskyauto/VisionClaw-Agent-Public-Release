import test from "node:test";
import assert from "node:assert/strict";
import { resolveImportedTenant, resolveImportedPersona } from "../../server/lib/import-tenant-authority";

test("platform restore preserves existing tenants but rejects forged or absent destinations", () => {
  const tenants = new Set([1, 7]);
  assert.equal(resolveImportedTenant(7, 1, tenants), 7);
  assert.equal(resolveImportedTenant(undefined, 1, tenants), 1);
  for (const value of [null, 0, -1, "7", 2.5, NaN, 999])
    assert.throws(() => resolveImportedTenant(value, 1, tenants));
  assert.throws(() => resolveImportedTenant(undefined, 99, tenants));
});

test("a failed imported persona never falls back to an unrelated existing persona with the old ID", () => {
  const source = new Set([2, 3]), restored = new Map([[2, 42]]), existing = new Set([2, 3, 7]);
  assert.equal(resolveImportedPersona(2, source, restored, existing), 42);
  assert.equal(resolveImportedPersona(7, source, restored, existing), 7);
  assert.equal(resolveImportedPersona(null, source, restored, existing), null);
  for (const id of [3, 99, "2", -1, 1.5]) assert.throws(() => resolveImportedPersona(id, source, restored, existing));
});
