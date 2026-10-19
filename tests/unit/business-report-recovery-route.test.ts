import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import type { AddressInfo } from "node:net";
import { createCsrfMiddleware, generateCsrfToken, getCsrfSessionKey } from "../../server/validation";
import { registerReportRecoveryRoute } from "../../server/routes/report-recovery";

test("report recovery POST requires authenticated owner and session CSRF before invoking recovery", async () => {
  const app = express();
  const tenant = (req: express.Request) => req.headers.authorization === "Bearer owner-fixture" ? 1 :
    req.headers.authorization === "Bearer customer-fixture" ? 2 : null;
  app.use(express.json(), createCsrfMiddleware(tenant));
  let recoveries = 0, cacheUpdates = 0;
  registerReportRecoveryRoute(app, {
    authMiddleware: (req, res, next) => { if (tenant(req)) next(); else res.sendStatus(401); },
    requireAdmin: async (req, res) => {
      if (tenant(req) === 1) return 1;
      res.sendStatus(403); return null;
    },
    recovered: () => { cacheUpdates++; },
  }, async (_tenant, operatorId) => {
    recoveries++;
    return { jobId: operatorId, evidenceReviewJobId: 12, status: "running", reviewPhase: "initial_jury" };
  });
  const server = app.listen(0);
  await new Promise<void>(resolve => server.once("listening", resolve));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/admin/business-report/294a157b-f21d-4d3d-926e-cb7adf7eff17/resume-unspent`;
  const headers = (token: string) => ({
    Authorization: `Bearer ${token}`, "Content-Type": "application/json",
    "X-CSRF-Token": generateCsrfToken(getCsrfSessionKey({
      headers: { authorization: `Bearer ${token}` },
    } as any, token === "owner-fixture" ? 1 : 2)!),
  });
  try {
    assert.equal((await fetch(url, { method: "POST" })).status, 401);
    assert.equal((await fetch(url, { method: "POST", headers: { Authorization: "Bearer owner-fixture" } })).status, 403);
    assert.equal((await fetch(url, { method: "POST", headers: headers("customer-fixture") })).status, 403);
    assert.equal(recoveries, 0);
    const result = await fetch(url, { method: "POST", headers: headers("owner-fixture"), body: "{}" });
    assert.equal(result.status, 200);
    assert.equal((await result.json()).evidenceReviewJobId, 12);
    assert.equal(recoveries, 1); assert.equal(cacheUpdates, 1);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close(e => e ? reject(e) : resolve()));
  }
});
