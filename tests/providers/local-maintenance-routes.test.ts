import test from "node:test";
import assert from "node:assert/strict";
import { registerLocalMaintenanceRoutes } from "../../server/routes/local-maintenance";
import { createCsrfMiddleware } from "../../server/validation";

const response = () => ({
  statusCode: 200, body: undefined as unknown,
  status(code: number) { this.statusCode = code; return this; },
  json(body: unknown) { this.body = body; return this; },
});

test("owner maintenance routes deny another tenant before any metadata read or enqueue", async () => {
  const handlers: Record<string, Function> = {};
  const app = Object.fromEntries(["get", "post"].map(method => [method, (path: string, ...chain: Function[]) => {
    handlers[method + path] = chain.at(-1)!;
  }]));
  registerLocalMaintenanceRoutes(app as any, {
    authMiddleware: () => {},
    requirePlatformAdmin: (_req, res) => { res.status(403).json({ error: "Forbidden" }); return false; },
  });
  for (const method of ["get", "post"]) {
    const res = response();
    await handlers[method + "/api/admin/local-maintenance"]({ body: { sourceId: "zoom-out", task: "both" } }, res);
    assert.equal(res.statusCode, 403);
  }
});

test("global CSRF gate rejects a session-authenticated maintenance POST without a CSRF token", async () => {
  const req = { method: "POST", path: "/api/admin/local-maintenance",
    headers: { authorization: "Bearer local-maintenance-test-session" }, session: {} };
  const res = response();
  let passed = false;
  await createCsrfMiddleware(async () => 1)(req as any, res as any, () => { passed = true; });
  assert.equal(passed, false);
  assert.equal(res.statusCode, 403);
});
