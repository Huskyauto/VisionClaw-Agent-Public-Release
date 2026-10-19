import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { registerBusinessPilotRoutes } from "../../server/routes/business-pilots";
import type { withPilotStore } from "../../server/lib/business-pilot-store";
import type { PilotRun } from "../../server/lib/business-pilot-state";

test("pilot routes enforce owner access, tenant-scoped CRUD, replay, validation and baseline identity", async () => {
  const app = express(); app.use(express.json());
  const state = new Map<string, PilotRun[]>();
  let stores = 0, mutations = 0;
  const store: typeof withPilotStore = async (tenant, kind, operation) => {
    stores++;
    const key = `${tenant}:${kind}`;
    const result = operation(state.get(key) ?? []);
    if (result.runs) state.set(key, result.runs);
    return result.value;
  };
  registerBusinessPilotRoutes(app, {
    authMiddleware: (req, res, next) => req.headers["x-role"] ? next() : res.status(401).end(),
    requirePlatformAdmin: (req, res) => {
      if (req.headers["x-role"] === "owner" && req.headers["x-tenant"] === "1") return true;
      res.status(403).end(); return false;
    },
    getTenantFromRequest: req => Number(req.headers["x-tenant"]) || null,
    mutateLimiter: (_req, _res, next) => { mutations++; next(); },
  }, store);
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>(resolve => server.once("listening", resolve));
  const address = server.address() as { port: number };
  const base = `http://127.0.0.1:${address.port}/api/admin/business-pilots`;
  const headers = { "x-role": "owner", "x-tenant": "1", "Content-Type": "application/json" };
  const body = { requestId: "11111111-1111-4111-8111-111111111111",
    input: { business: "Synthetic", reference: "synthetic", currency: "USD", start: "2026-09-01", end: "2026-09-30" } };
  try {
    assert.equal((await fetch(`${base}/health`)).status, 401);
    assert.equal((await fetch(`${base}/health`, { headers: { ...headers, "x-tenant": "2" } })).status, 403);
    assert.equal(stores, 0);
    assert.equal((await fetch(`${base}/invalid`, { headers })).status, 422);
    assert.equal((await fetch(`${base}/health`, { headers, method: "POST", body: JSON.stringify(body) })).status, 201);
    const replay = await fetch(`${base}/health`, { headers, method: "POST", body: JSON.stringify(body) });
    assert.equal(replay.status, 201);
    const saved = await replay.json();
    assert.equal(saved.id, body.requestId);
    const history = await (await fetch(`${base}/health`, { headers })).json();
    assert.equal(history.runs.length, 1);
    assert.equal(state.has("2:health"), false);
    assert.equal((await fetch(`${base}/health`, { headers, method: "POST",
      body: JSON.stringify({ ...body, input: { ...body.input, calls: "100" } }) })).status, 422);
    assert.equal((await fetch(`${base}/health`, { headers, method: "POST",
      body: JSON.stringify({ ...body, input: { ...body.input, business: "Changed" } }) })).status, 409);
    assert.equal((await fetch(`${base}/health/${saved.id}`, { headers, method: "DELETE" })).status, 200);
    assert.equal((await (await fetch(`${base}/health`, { headers })).json()).runs.length, 0);
    assert.equal((await fetch(`${base}/health/${saved.id}`, { headers, method: "DELETE" })).status, 404);
    assert.ok(mutations >= 5);
  } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
});
