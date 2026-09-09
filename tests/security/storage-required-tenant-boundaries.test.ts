import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { DatabaseStorage, ALL_TENANTS } from "../../server/storage";

const storage = new DatabaseStorage();

test("conversation list and search reject omitted tenant scope before querying", async () => {
  await assert.rejects(
    storage.getConversations(undefined, undefined, undefined as any),
    /tenantId is required/,
  );
  await assert.rejects(
    storage.searchConversations("needle", undefined as any),
    /tenantId is required/,
  );
});

test("memory updates and heartbeat reads reject omitted tenant scope", async () => {
  await assert.rejects(
    storage.updateMemoryEntry(1, { status: "superseded" }, undefined as any),
    /tenantId is required/,
  );
  await assert.rejects(
    storage.getHeartbeatLogs(5, undefined, undefined as any),
    /tenantId is required/,
  );
});

test("global persona deletion requires the explicit global sentinel", async () => {
  await assert.rejects(
    storage.deletePersona(1, 42 as any),
    /explicit ALL_TENANTS scope is required/,
  );
  assert.equal(ALL_TENANTS, "__ALL_TENANTS__");
});

test("experiment history API requires TenantScope and validates it before query", () => {
  const source = fs.readFileSync(
    new URL("../../server/self-improvement.ts", import.meta.url),
    "utf8",
  );
  assert.match(source, /getExperimentHistory\([^)]*tenantId: TenantScope/);
  assert.match(source, /tenantId !== ALL_TENANTS/);
  assert.match(source, /positive tenantId or explicit ALL_TENANTS scope is required/);
});