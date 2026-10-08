import assert from "node:assert/strict";
import test from "node:test";
import express from "express";
import type { AddressInfo } from "node:net";
import { registerGoalLedgerRoutes } from "../../server/routes/goal-ledger";

test("Goal Ledger answers authorized requests and rejects unauthorized requests", async () => {
  const app = express();
  registerGoalLedgerRoutes(app, {
    authMiddleware: (_req: any, _res: any, next: () => void) => next(),
    requirePlatformAdmin: (req: any, res: any) => {
      if (req.headers["x-test-admin"] === "yes") return true;
      res.status(403).json({ error: "Platform admin access required" });
      return false;
    },
    readActiveJobs: async () => [],
  });
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const port = (server.address() as AddressInfo).port;
  try {
    const unauthorized = await fetch(`http://127.0.0.1:${port}/api/admin/goal-ledger`, {
      signal: AbortSignal.timeout(1500),
    });
    assert.equal(unauthorized.status, 403);
    const authorized = await fetch(`http://127.0.0.1:${port}/api/admin/goal-ledger`, {
      headers: { "x-test-admin": "yes" },
      signal: AbortSignal.timeout(1500),
    });
    assert.equal(authorized.status, 200);
    const body = await authorized.json();
    assert.equal(body.futureImprovements.status, "available");
    assert.equal(body.futureImprovements.items.length, 4);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});