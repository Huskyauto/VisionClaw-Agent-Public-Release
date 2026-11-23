import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import type { Express, Request, RequestHandler, Response } from "express";
import { db } from "../../server/db";
import { registerMemoryRoutes } from "../../server/routes/memory";
import { DatabaseStorage, ALL_TENANTS, storage as routeStorage } from "../../server/storage";

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

test("memory edits reject ownership changes without querying the database", async (t) => {
  const update = t.mock.method(db, "update", () => {
    throw new Error("Memory edit attempted a database write");
  });
  await assert.rejects(
    storage.updateMemoryEntry(1, { tenantId: 2 }, 1),
    /Memory tenant ownership cannot be changed/,
  );
  assert.equal(update.mock.callCount(), 0);
});

test("memory PATCH denies ownership changes and foreign rows but permits scoped edits", async (t) => {
  const actorTenant = 12;
  const ownedMemory = { id: 41, tenantId: actorTenant, fact: "Existing", category: "preference" };
  const foreignMemory = { id: 42, tenantId: 13, fact: "Unavailable", category: "preference" };
  const lookup = t.mock.method(routeStorage, "getMemoryEntry", async (id: number, tenantId: number) =>
    [ownedMemory, foreignMemory].find(row => row.id === id && row.tenantId === tenantId));
  const update = t.mock.method(routeStorage, "updateMemoryEntry", async () => ({
    ...ownedMemory, fact: "Updated",
  }));
  let handler: RequestHandler | undefined;
  const noop = () => {};
  const app = {
    get: noop, post: noop, delete: noop,
    patch: (path: string, candidate: RequestHandler) => { if (path === "/api/memory/:id") handler = candidate; },
  };
  registerMemoryRoutes(app as unknown as Express, {
    getTenantFromRequest: () => actorTenant, isAdminRequest: () => false,
    isPlatformAdmin: () => false, ADMIN_TENANT_ID: 1, requirePlatformAdmin: () => false,
  });
  assert.ok(handler);
  const patch = handler;
  const invoke = async (id: number, body: object) => {
    let status = 200;
    let payload: unknown;
    const res = {
      status(code: number) { status = code; return this; },
      json(value: unknown) { payload = value; return this; },
    };
    await patch({ params: { id: String(id) }, body } as Request, res as Response, noop);
    return { status, payload };
  };

  for (const tenantId of [foreignMemory.tenantId, actorTenant, undefined]) {
    assert.deepEqual(await invoke(ownedMemory.id, { tenantId }), {
      status: 400, payload: { error: "Memory tenant ownership cannot be changed" },
    });
  }
  assert.equal(lookup.mock.callCount(), 0);
  assert.equal(update.mock.callCount(), 0);

  assert.equal((await invoke(foreignMemory.id, { fact: "No change" })).status, 404);
  assert.equal(update.mock.callCount(), 0);
  assert.deepEqual(lookup.mock.calls[0].arguments, [foreignMemory.id, actorTenant]);

  assert.equal((await invoke(ownedMemory.id, { fact: "Updated" })).status, 200);
  assert.equal(update.mock.callCount(), 1);
  assert.deepEqual(update.mock.calls[0].arguments, [ownedMemory.id, { fact: "Updated" }, actorTenant]);
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