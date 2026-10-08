import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import type { AddressInfo } from "node:net";
import { registerProjectsRoutes } from "../../server/routes/projects";

test("income transition stops at the existing platform-admin guard", async () => {
  const app = express();
  let guardCalls = 0;
  registerProjectsRoutes(app, {
    authMiddleware: (_req, _res, next) => next(),
    getTenantFromRequest: () => 1,
    requirePlatformAdmin: (_req, res) => {
      guardCalls++;
      res.status(403).json({ error: "Platform admin access required" });
      return false;
    },
    upload: { array: () => (_req: express.Request, _res: express.Response, next: express.NextFunction) => next() } as any,
    SAFE_EXTENSIONS: {},
    UPLOADS_DIR: "/tmp/ideabrowser-transition-test-uploads",
  });

  const server = await new Promise<ReturnType<typeof app.listen>>((resolve, reject) => {
    const instance = app.listen(0, "127.0.0.1", () => resolve(instance));
    instance.once("error", reject);
  });
  try {
    const address = server.address() as AddressInfo;
    const response = await fetch(`http://127.0.0.1:${address.port}/api/projects/42/transition-income-product`, {
      method: "POST",
    });
    assert.equal(response.status, 403);
    assert.deepEqual(await response.json(), { error: "Platform admin access required" });
    assert.equal(guardCalls, 1);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});