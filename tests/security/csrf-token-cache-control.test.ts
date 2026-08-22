import assert from "node:assert/strict";
import test from "node:test";
import express from "express";
import type { AddressInfo } from "node:net";

import { registerAuthPublicRoutes } from "../../server/routes/auth-extra";

test("authenticated CSRF bootstrap is never cacheable", async () => {
  const app = express();
  registerAuthPublicRoutes(app, {
    loginLimiter: (_req: unknown, _res: unknown, next: () => void) => next(),
    getTenantFromRequestAsync: () => 1,
  });

  const server = await new Promise<ReturnType<typeof app.listen>>((resolve) => {
    const listener = app.listen(0, () => resolve(listener));
  });

  try {
    const { port } = server.address() as AddressInfo;
    const response = await fetch(`http://127.0.0.1:${port}/api/auth/csrf-token`);

    assert.equal(response.status, 200);
    assert.match(response.headers.get("cache-control") ?? "", /\bno-store\b/i);
    assert.match((await response.json()).csrfToken, /^[a-f0-9]{64}$/);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  }
});

test("CSRF bootstrap awaits tenant resolution before issuing a token", async () => {
  const app = express();
  registerAuthPublicRoutes(app, {
    loginLimiter: (_req: unknown, _res: unknown, next: () => void) => next(),
    getTenantFromRequestAsync: () => Promise.resolve(null),
  });

  const server = await new Promise<ReturnType<typeof app.listen>>((resolve) => {
    const listener = app.listen(0, () => resolve(listener));
  });

  try {
    const { port } = server.address() as AddressInfo;
    const response = await fetch(`http://127.0.0.1:${port}/api/auth/csrf-token`);

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { csrfToken: null });
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  }
});