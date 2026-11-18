import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import type { AddressInfo } from "node:net";
import AdmZip from "adm-zip";
import { createCsrfMiddleware, generateCsrfToken, getCsrfSessionKey } from "../../server/validation";
import { registerAgentReadyRoutes } from "../../server/routes/agent-ready-package";

test("owner export enforces CSRF and returns only generated package files, never caller paths", async () => {
  const app = express();
  let enabled = true;
  let liveInvocations = 0;
  const tenant = (req: express.Request) => req.headers.authorization === "Bearer owner-fixture" ? 1
    : req.headers.authorization === "Bearer customer-fixture" ? 2 : null;
  app.use(express.json(), createCsrfMiddleware(tenant));
  registerAgentReadyRoutes(app, {
    authMiddleware: (req, res, next) => { if (tenant(req)) next(); else res.sendStatus(401); },
    requireAdmin: async (req, res) => {
      if (tenant(req) === 1) return 1;
      res.sendStatus(403); return null;
    },
  }, {
    enabled: () => enabled,
    verify: async packet => {
      liveInvocations++;
      return { packageId: packet.packageId, checkedAt: "2026-11-16T00:00:00Z", checks: [], limitations: ["Fixture; no network requests."] };
    },
  });
  const server = app.listen(0);
  await new Promise<void>(resolve => server.once("listening", resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/admin/audit/agent-ready`;
  const headers = (token: string) => ({
    Authorization: `Bearer ${token}`, "Content-Type": "application/json",
    "X-CSRF-Token": generateCsrfToken(getCsrfSessionKey({
      headers: { authorization: `Bearer ${token}` },
    } as express.Request, token === "owner-fixture" ? 1 : 2)!),
  });
  const body = { company: "Example", website: "https://example.com", description: "Home services.",
    businessType: "Organization", services: ["Repair"], pageUrls: [], confirmed: true };
  try {
    for (const action of ["preview", "download", "verify"]) {
      const url = `${base}/${action}`;
      assert.equal((await fetch(url, { method: "POST" })).status, 401);
      assert.equal((await fetch(url, { method: "POST", headers: { Authorization: "Bearer owner-fixture" } })).status, 403);
      assert.equal((await fetch(url, { method: "POST", headers: headers("customer-fixture"), body: JSON.stringify(body) })).status, 403);
    }
    assert.equal((await fetch(`${base}/preview`, { method: "POST", headers: headers("owner-fixture"),
      body: JSON.stringify({ ...body, path: "../../secret", tenantId: 2 }) })).status, 400);
    const preview = await fetch(`${base}/preview`, { method: "POST", headers: headers("owner-fixture"), body: JSON.stringify(body) });
    assert.equal(preview.status, 200);
    const packet = await preview.json();
    const download = await fetch(`${base}/download`, { method: "POST", headers: headers("owner-fixture"), body: JSON.stringify(body) });
    assert.equal(download.status, 200);
    assert.equal(download.headers.get("content-type"), "application/zip");
    const zip = new AdmZip(Buffer.from(await download.arrayBuffer()));
    assert.deepEqual(zip.getEntries().map(entry => entry.entryName).sort(), packet.files.map((file: { path: string }) => file.path).sort());
    for (const file of packet.files) assert.equal(zip.readAsText(file.path), file.content);
    assert.equal(download.headers.get("x-agent-ready-package"), packet.packageId);
    for (let index = 0; index < 7; index++) {
      const response = await fetch(`${base}/verify`, { method: "POST", headers: headers("owner-fixture"), body: JSON.stringify(body) });
      assert.equal(response.status, index < 6 ? 200 : 429);
    }
    assert.equal(liveInvocations, 6);
    enabled = false;
    assert.equal((await fetch(`${base}/preview`, { method: "POST", headers: headers("owner-fixture"), body: JSON.stringify(body) })).status, 503);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close(e => e ? reject(e) : resolve()));
  }
});
