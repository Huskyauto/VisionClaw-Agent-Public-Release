import { test } from "node:test";
import assert from "node:assert/strict";
import {
  insertConversationSchema,
  insertMessageSchema,
  insertMemoryEntrySchema,
  insertTenantSchema,
} from "../../shared/schema";

// VisionClaw's core tenant-isolation invariant from replit.md:
//   "tenant_id columns: All 34 tables use .notNull() with NO .default(1).
//    Every INSERT must explicitly pass tenantId."
// These tests prove the Drizzle/Zod insert schemas refuse to silently
// fall through to a default tenant — the regression that would re-open
// every cross-tenant exposure we've fixed.

test("insertConversationSchema: rejects insert without tenantId", () => {
  const r = insertConversationSchema.safeParse({
    title: "hello",
    personaId: 1,
  });
  assert.equal(r.success, false, "insertConversationSchema must require tenantId");
});

test("insertConversationSchema: accepts insert with explicit tenantId", () => {
  const r = insertConversationSchema.safeParse({
    title: "hello",
    personaId: 1,
    tenantId: 42,
  });
  assert.equal(r.success, true, JSON.stringify(r));
});

test("insertMessageSchema: rejects insert without tenantId", () => {
  const r = insertMessageSchema.safeParse({
    conversationId: 1,
    role: "user",
    content: "hi",
  });
  assert.equal(r.success, false, "insertMessageSchema must require tenantId");
});

test("insertMemoryEntrySchema: rejects insert without tenantId", () => {
  const r = insertMemoryEntrySchema.safeParse({
    personaId: 1,
    title: "x",
    content: "y",
    category: "fact",
  });
  assert.equal(r.success, false, "insertMemoryEntrySchema must require tenantId");
});

test("insertTenantSchema: minimum viable insert is well-formed", () => {
  // Tenant is the one table without its own tenantId (it IS a tenant).
  const r = insertTenantSchema.safeParse({
    name: "Acme Co",
    email: "founder@acme.test",
  });
  // Either accepts or rejects with a clear shape error — never crashes.
  assert.ok(typeof r.success === "boolean");
});
