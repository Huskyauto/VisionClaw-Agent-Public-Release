import assert from "node:assert/strict";
import test from "node:test";
import express from "express";
import type { AddressInfo } from "node:net";
import { getTenantFromRequest, isAdminRequest, primeReplitTenantCacheForTest } from "../../server/auth";
import { registerVerifierMemoryDiagnosticRoute } from "../../server/routes/verifier-memory-diagnostic";

test("real admin helpers allow trusted owner identity but reject nonadmin sessions, API keys and forged headers", async () => {
  // Ingress fixtures stand in for successful session/OIDC validation only;
  // authorization below uses the real production helpers, not role stubs.
  primeReplitTenantCacheForTest("verifier-trusted-owner", 1, false);
  primeReplitTenantCacheForTest("verifier-other-admin", 42, true);
  const app = express();
  let probes = 0;
  registerVerifierMemoryDiagnosticRoute(app, {
    authMiddleware: (req, _res, next) => {
      const mode = req.headers["x-test-ingress"];
      if (mode === "owner" || mode === "other-admin") {
        Object.assign(req, {
          isAuthenticated: () => true,
          user: { claims: { sub: mode === "owner" ? "verifier-trusted-owner" : "verifier-other-admin" } },
        });
      } else if (mode === "session-member" || mode === "session-admin" || mode === "api-key") {
        Object.assign(req, { tenantId: 1, _validatedSession: { tenantId: 1, isAdmin: mode !== "session-member" } });
      }
      next();
    },
    getTenantFromRequest,
    isAdminRequest,
    adminTenantId: 1,
    readDiagnostic: () => {
      probes++;
      return {
        available: false, source: null, snapshot: null, reason: "no-authoritative-limit",
        v2: { mounts: 0, resolved: false, state: "missing" },
        v1: { mounts: 0, resolved: false, state: "missing" },
      };
    },
  });
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>(resolve => server.once("listening", resolve));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/admin/diagnostics/verifier-memory`;
  try {
    for (const mode of ["session-member", "other-admin", "forged", "api-key"]) {
      const result = await fetch(url, { headers: {
        "x-test-ingress": mode, "x-tenant": "1", "x-role": "admin",
        ...(mode === "api-key" ? { authorization: "Bearer vc_fixture_only" } : {}),
      } });
      assert.equal(result.status, 403, mode);
    }
    assert.equal(probes, 0);
    for (const mode of ["owner", "session-admin"]) {
      const result = await fetch(url, { headers: { "x-test-ingress": mode } });
      assert.equal(result.status, 200, mode);
    }
    assert.equal(probes, 1);
  } finally {
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});