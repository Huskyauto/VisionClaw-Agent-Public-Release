/**
 * tests/unit/archive-rescue-pin-gate.test.ts — R125+139
 *
 * Regression coverage for the two PUBLIC archive-rescue admin endpoints
 * (72h-review follow-up: "prove PIN-gated behavior remains fail-closed if
 * middleware/path logic evolves"). These paths are exempted from the global
 * auth middleware, so the in-handler PIN gate is the ONLY lock — it must
 * fail closed on every branch BEFORE any DB work.
 *
 * DB rule: every request here is rejected at the PIN gate, so no query ever
 * executes (node-test pg-pool hang rule). The express server is closed in
 * after() so the process exits cleanly.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import type { Server } from "http";
import { registerArchiveRescueRoutes } from "../../server/routes/archive-rescue";

let server: Server;
let base: string;
const PRIOR_PIN = process.env.ADMIN_PIN;

before(async () => {
  const app = express();
  app.set("trust proxy", 1);
  app.use(express.json());
  // Stub helpers: the PIN gate rejects before any upload/tenant logic runs.
  const helpers = {
    upload: { array: () => (_req: unknown, _res: unknown, next: () => void) => next() },
    getTenantFromRequest: () => 1,
  } as any;
  registerArchiveRescueRoutes(app, helpers);
  await new Promise<void>((resolve) => {
    server = app.listen(0, "127.0.0.1", () => resolve());
  });
  const addr = server.address() as { port: number };
  base = `http://127.0.0.1:${addr.port}`;
});

after(() => {
  server?.close();
  if (PRIOR_PIN === undefined) delete process.env.ADMIN_PIN; else process.env.ADMIN_PIN = PRIOR_PIN;
});

test("orders list: 403 when ADMIN_PIN is not configured (fail-closed, even with a pin header)", async () => {
  delete process.env.ADMIN_PIN;
  const res = await fetch(`${base}/api/admin/archive-rescue/orders`, {
    headers: { "x-admin-pin": "" }, // empty pin vs empty expected must NOT pass
  });
  assert.equal(res.status, 403);
});

test("orders list: 403 on wrong PIN (same length — timingSafeEqual branch)", async () => {
  process.env.ADMIN_PIN = "123456";
  const res = await fetch(`${base}/api/admin/archive-rescue/orders`, {
    headers: { "x-admin-pin": "654321" },
  });
  assert.equal(res.status, 403);
});

test("orders list: 403 on missing PIN header", async () => {
  process.env.ADMIN_PIN = "123456";
  const res = await fetch(`${base}/api/admin/archive-rescue/orders`);
  assert.equal(res.status, 403);
});

test("status update: 403 on wrong PIN — no status change side effect path reached", async () => {
  process.env.ADMIN_PIN = "123456";
  const res = await fetch(`${base}/api/admin/archive-rescue/orders/1/status`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-admin-pin": "wrongpin!!" },
    body: JSON.stringify({ status: "delivered" }),
  });
  assert.equal(res.status, 403);
});

test("status update: 403 when ADMIN_PIN unset regardless of body validity", async () => {
  delete process.env.ADMIN_PIN;
  const res = await fetch(`${base}/api/admin/archive-rescue/orders/1/status`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-admin-pin": "anything" },
    body: JSON.stringify({ status: "paid" }),
  });
  assert.equal(res.status, 403);
});

test("repeated failed PIN attempts trip the lockout throttle (429 with Retry-After)", async () => {
  process.env.ADMIN_PIN = "123456";
  let last = 0;
  // PIN_ATTEMPT_LIMIT is 8 per window; hammer past it from the same IP.
  for (let i = 0; i < 12; i++) {
    const res = await fetch(`${base}/api/admin/archive-rescue/orders`, {
      headers: { "x-admin-pin": "nope-wrong" },
    });
    last = res.status;
    if (last === 429) {
      assert.ok(res.headers.get("retry-after"), "429 must carry Retry-After");
      break;
    }
  }
  assert.equal(last, 429, "lockout should engage within 12 bad attempts");
});
