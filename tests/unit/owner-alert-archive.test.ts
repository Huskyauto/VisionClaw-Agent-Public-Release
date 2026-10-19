import test from "node:test";
import assert from "node:assert/strict";
import { archiveOwnerAlert, prepareOwnerAlert, pendingAlertBatch, type AlertArchivePorts } from "../../server/lib/owner-alert-archive-core";
import express from "express";
import { registerOwnerAlertRoutes } from "../../server/routes/owner-alert-logs";

test("full details survive digest-size truncation and durable reads need no local mirror", async () => {
  const saved = new Map<string, any>();
  const ports: AlertArchivePorts = {
    persist: async row => { saved.set(row.id, row); },
    mirror: async () => {},
  };
  const body = "Observed finding and reproduction steps.\n".repeat(200);
  const result = await archiveOwnerAlert({
    subject: "Audit findings", text: body, source: "tenant-isolation-audit",
    reports: [{ name: "full-audit.md", content: "All findings including low and medium.\n".repeat(300) }],
  }, ports);
  assert.equal(result.durability, "durable");
  assert.ok(result.id);
  assert.equal(saved.get(result.id!).text, body);
  assert.equal(saved.get(result.id!).reports[0].content, "All findings including low and medium.\n".repeat(300));
});

test("persistent failures cannot monopolize the next recovery batch", () => {
  const names = Array.from({ length: 30 }, (_, i) => `${String(i).padStart(8, "0")}-0000-4000-8000-000000000000.json`);
  const first = pendingAlertBatch(names, "");
  const next = pendingAlertBatch(names, first.at(-1)!);
  assert.equal(first.length, 10);
  assert.equal(next.length, 10);
  assert.ok(next.every(n => !first.includes(n)));
  const third = pendingAlertBatch(names, next.at(-1)!);
  assert.deepEqual(pendingAlertBatch(names, third.at(-1)!), first);
});

test("database and disk failures are explicit; successful database write remains durable without a mirror", async () => {
  const fail = async () => { throw new Error("storage down"); };
  const okay = async () => {};
  assert.equal((await archiveOwnerAlert({ text: "full detail" }, { persist: fail, mirror: okay })).durability, "local_only");
  assert.equal((await archiveOwnerAlert({ text: "full detail" }, { persist: fail, mirror: fail })).durability, "failed");
  const durable = await archiveOwnerAlert({ text: "full detail" }, { persist: okay, mirror: fail });
  assert.equal(durable.durability, "durable");
  assert.ok(durable.warnings.length);
});

test("redaction cannot be disabled for archive storage; oversized and unsafe snapshots fail explicitly", async () => {
  let row: any;
  const ports = { persist: async (r: any) => { row = r; }, mirror: async () => {} };
  const prior = process.env.VISIONCLAW_REDACT_SECRETS;
  process.env.VISIONCLAW_REDACT_SECRETS = "off";
  try {
    await archiveOwnerAlert({ text: 'API_KEY=pretend-value-1234567890\nCookie: session=pretend-cookie\nhttps://example.com?a=1&token=pretend-query-token\n{"client_secret":"pretend-oauth-client-secret","refreshToken":"pretend-refresh-token"}\nAuthorization: Basic dXNlcjpwcmV0ZW5kLWJhc2ljLXBhc3M=' }, ports);
    assert.doesNotMatch(row.text, /pretend-value-1234567890|pretend-cookie|pretend-query-token/);
    assert.doesNotMatch(row.text, /pretend-oauth-client-secret|pretend-refresh-token|dXNlcjpwcmV0ZW5kLWJhc2ljLXBhc3M=/);
  } finally {
    if (prior === undefined) delete process.env.VISIONCLAW_REDACT_SECRETS;
    else process.env.VISIONCLAW_REDACT_SECRETS = prior;
  }
  assert.equal((await archiveOwnerAlert({ text: "x".repeat(8 * 1024 * 1024) }, ports)).durability, "failed");
  assert.equal((await archiveOwnerAlert({ text: "x".repeat(8 * 1024 * 1024 - 100) }, ports)).durability, "failed");
  assert.equal((await archiveOwnerAlert({ reports: [{ name: "../secret", content: "x" }] }, ports)).durability, "failed");
});

test("every archive read/download requires owner authorization; storage failure is never an empty healthy list", async () => {
  const app = express();
  let reads = 0;
  const id = "12345678-1234-4234-8234-123456789012";
  const fixture = { ...prepareOwnerAlert({ text: "Complete detail\n".repeat(100), reports: [{ name: "full.md", content: "Final finding." }] }), id, sizeBytes: 3000 };
  registerOwnerAlertRoutes(app, {
    authMiddleware(req, res, next) {
      if (!req.headers["x-role"]) { res.status(401).end(); return; }
      next();
    },
    requirePlatformAdmin(req, res) {
      if (req.headers["x-role"] === "owner") return true;
      res.status(403).end(); return false;
    },
    list: async page => { reads++; if (page === 2) throw new Error("down"); return { items: [], page, hasMore: false }; },
    read: async target => { reads++; return target === id ? fixture : null; },
  });
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>(resolve => server.once("listening", resolve));
  const address = server.address() as { port: number };
  const base = `http://127.0.0.1:${address.port}/api/admin/alert-logs`;
  try {
    for (const suffix of ["", `/${id}`, `/${id}/download`]) {
      assert.equal((await fetch(base + suffix)).status, 401);
      for (const role of ["customer", "non-admin-owner-tenant", "other-tenant-admin"])
        assert.equal((await fetch(base + suffix, { headers: { "x-role": role } })).status, 403);
    }
    assert.equal(reads, 0);
    assert.equal((await fetch(base, { headers: { "x-role": "owner" } })).status, 200);
    assert.equal((await fetch(`${base}?page=2`, { headers: { "x-role": "owner" } })).status, 503);
    assert.equal((await fetch(`${base}?page=-1`, { headers: { "x-role": "owner" } })).status, 400);
    const detail = await fetch(`${base}/${id}`, { headers: { "x-role": "owner" } });
    assert.equal((await detail.json()).text, fixture.text);
    const download = await fetch(`${base}/${id}/download`, { headers: { "x-role": "owner" } });
    assert.match(download.headers.get("content-disposition") || "", /attachment/);
    assert.equal((await download.json()).reports[0].content, "Final finding.");
    assert.equal((await fetch(`${base}/12345678-1234-4234-8234-123456789013/download`, { headers: { "x-role": "owner" } })).status, 404);
  } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
});
