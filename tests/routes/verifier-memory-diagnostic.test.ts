import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import test from "node:test";
import express from "express";
import { registerVerifierMemoryDiagnosticRoute } from "../../server/routes/verifier-memory-diagnostic";

test("verifier memory diagnostic rejects unauthorized callers without probing", async () => {
  const app = express();
  let probeCalls = 0;
  registerVerifierMemoryDiagnosticRoute(app, {
    authMiddleware: (_req, _res, next) => next(),
    getTenantFromRequest: (req) => req.header("x-tenant") === "1" ? 1 : 2,
    isAdminRequest: (req) => req.header("x-role") === "admin",
    adminTenantId: 1,
    readDiagnostic: () => {
      probeCalls++;
      throw new Error("should not run");
    },
  });
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/admin/diagnostics/verifier-memory`;
  try {
    const denied = await fetch(base, { headers: { "x-tenant": "1", "x-role": "user" } });
    const wrongTenant = await fetch(base, { headers: { "x-tenant": "2", "x-role": "admin" } });
    assert.equal(denied.status, 403);
    assert.equal(wrongTenant.status, 403);
    assert.equal(probeCalls, 0);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test("authorized diagnostic returns sanitized no-store summary and caches the probe briefly", async () => {
  const app = express();
  let probeCalls = 0;
  registerVerifierMemoryDiagnosticRoute(app, {
    authMiddleware: (_req, _res, next) => next(),
    getTenantFromRequest: () => 1,
    isAdminRequest: () => true,
    adminTenantId: 1,
    readDiagnostic: () => {
      probeCalls++;
      return {
        available: true,
        source: "cgroup-v2",
        snapshot: { maxBytes: 8_000_000_000, currentBytes: 3_000_000_000 },
        reason: "available",
        v2: { mounts: 1, resolved: true, state: "finite" },
        v1: { mounts: 0, resolved: false, state: "secret kernel path" },
      };
    },
  });
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/admin/diagnostics/verifier-memory`;
  try {
    const response = await fetch(base);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "no-store");
    const body = await response.json();
    assert.deepEqual(body.v1, { mounts: 0, resolved: false, state: "unavailable" });
    assert.equal(body.snapshot.maxBytes, 8_000_000_000);
    assert.equal(body.snapshot.currentBytes, 3_000_000_000);
    await fetch(base);
    assert.equal(probeCalls, 1);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test("probe errors never disclose exception text", async () => {
  const app = express();
  registerVerifierMemoryDiagnosticRoute(app, {
    authMiddleware: (_req, _res, next) => next(),
    getTenantFromRequest: () => 1,
    isAdminRequest: () => true,
    adminTenantId: 1,
    readDiagnostic: () => { throw new Error("/sys/cgroup/private-token"); },
  });
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  try {
    const response = await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/api/admin/diagnostics/verifier-memory`);
    assert.equal(response.status, 500);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.deepEqual(await response.json(), { error: "Verifier memory diagnostic unavailable" });
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test("global authorized request cap rejects the eleventh request without probing again", async () => {
  const app = express();
  let probeCalls = 0;
  registerVerifierMemoryDiagnosticRoute(app, {
    authMiddleware: (_req, _res, next) => next(),
    getTenantFromRequest: () => 1,
    isAdminRequest: () => true,
    adminTenantId: 1,
    readDiagnostic: () => {
      probeCalls++;
      return {
        available: false, source: null, snapshot: null, reason: "no-authoritative-limit",
        v2: { mounts: 0, resolved: false, state: "missing" },
        v1: { mounts: 0, resolved: false, state: "missing" },
      };
    },
  });
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/admin/diagnostics/verifier-memory`;
  try {
    for (let i = 0; i < 10; i++) assert.equal((await fetch(base)).status, 200);
    const limited = await fetch(base);
    assert.equal(limited.status, 429);
    assert.equal(limited.headers.get("cache-control"), "no-store");
    assert.equal(probeCalls, 1);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});