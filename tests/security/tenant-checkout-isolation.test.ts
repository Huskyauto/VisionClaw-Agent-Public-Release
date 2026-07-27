import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { Readable } from "node:stream";
import https from "node:https";

// Regression suite for the "logged-in shopper idempotency collision" bug —
// the tenant-aware mirror of tests/security/anonymous-checkout-isolation.test.ts.
//
// The /api/stripe/checkout handler partitions its Stripe idempotency key by
// `getTenantFromRequest(req) ?? anonymousVisitorPartition(req)`. The
// anonymous branch is covered separately; this file locks down the
// LOGGED-IN branch:
//
//   * Two paying tenants buying the same SKU within Stripe's 24h dedup
//     window MUST produce DIFFERENT Idempotency-Key headers — otherwise
//     tenant B silently lands on tenant A's checkout session (and worse,
//     receives tenant A's confirmation page / fulfilment).
//   * The same tenant double-clicking the same SKU MUST produce the SAME
//     Idempotency-Key header — that's the whole point of the dedup window
//     (Stripe collapses the second create into the first session).
//
// The test boots a real Express app, mounts the real route, and intercepts
// the Stripe SDK at the node:https boundary so we can read the exact
// Idempotency-Key the route sends. No real network traffic.

after(() => { setTimeout(() => process.exit(process.exitCode ?? 0), 50).unref(); });

// ---------------------------------------------------------------------------
// Step 1: install an https.request interceptor BEFORE the route module
// loads. Stripe's NodeHttpClient calls https.request directly.
// ---------------------------------------------------------------------------

type CapturedCall = {
  idempotencyKey: string;
  path: string;
  body: string;
};
const captured: CapturedCall[] = [];
const origRequest = https.request.bind(https);

(https as any).request = function patchedRequest(...args: any[]): any {
  let opts: any = args[0];
  let cbArg: any = undefined;
  if (typeof args[args.length - 1] === "function") cbArg = args[args.length - 1];

  if (typeof opts === "string" || opts instanceof URL) {
    const u = new URL(typeof opts === "string" ? opts : opts.toString());
    const merged: any = {
      host: u.hostname,
      port: u.port,
      path: u.pathname + u.search,
      headers: {},
    };
    if (typeof args[1] === "object" && args[1] !== null && !(args[1] instanceof Function)) {
      Object.assign(merged, args[1]);
      merged.headers = { ...(args[1].headers || {}) };
    }
    opts = merged;
  }
  const host: string = String((opts && (opts.host || opts.hostname)) || "");
  if (!host.includes("stripe.com")) {
    return origRequest(...(args as [any]));
  }

  const headers: Record<string, string> = {};
  for (const [k, v] of Object.entries(opts.headers || {})) {
    headers[String(k).toLowerCase()] = String(v);
  }
  const idempotencyKey = headers["idempotency-key"] || "";
  const path = String(opts.path || "");

  const writes: Buffer[] = [];

  const req: any = new EventEmitter();
  req.setTimeout = () => req;
  req.setNoDelay = () => req;
  req.setSocketKeepAlive = () => req;
  req.destroy = () => req;
  req.write = (chunk: any) => {
    if (chunk != null) writes.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
    return true;
  };
  req.end = function (chunk?: any) {
    if (chunk != null) writes.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
    captured.push({
      idempotencyKey,
      path,
      body: Buffer.concat(writes).toString("utf-8"),
    });
    setImmediate(() => {
      const fakeBody = JSON.stringify({
        id: `cs_test_fake_${captured.length}`,
        object: "checkout.session",
        url: `https://stripe.example/c/${captured.length}`,
      });
      const res: any = new Readable({
        read() {
          this.push(fakeBody);
          this.push(null);
        },
      });
      res.statusCode = 200;
      res.headers = { "content-type": "application/json", "request-id": "req_fake" };
      if (typeof cbArg === "function") cbArg(res);
      req.emit("response", res);
    });
    return req;
  };
  setImmediate(() => {
    const fakeSocket: any = new EventEmitter();
    fakeSocket.connecting = false;
    req.emit("socket", fakeSocket);
  });
  return req;
};

// ---------------------------------------------------------------------------
// Step 2: feed Stripe a fake credential so getUncachableStripeClient skips
// the connector lookup. The interceptor above ensures no real call happens.
// ---------------------------------------------------------------------------
process.env.STRIPE_LIVE_SECRET_KEY = process.env.STRIPE_LIVE_SECRET_KEY || "sk_test_fake_for_isolation_test";
process.env.STRIPE_LIVE_PUBLISHABLE_KEY = process.env.STRIPE_LIVE_PUBLISHABLE_KEY || "pk_test_fake_for_isolation_test";

// ---------------------------------------------------------------------------
// Step 3: build an Express app that registers the REAL route with a
// configurable tenant-id resolver, so each test can simulate "logged in as
// tenant N" for a given request.
// ---------------------------------------------------------------------------

const express = (await import("express")).default;
const sessionMod = (await import("express-session")).default;
const { registerStripeCheckoutRoutes } = await import("../../server/routes/stripe-checkout");

// The resolver reads the X-Test-Tenant-Id header so each individual request
// can act as a different logged-in tenant inside the same server.
function tenantFromHeader(req: any): number | null {
  const raw = req.headers["x-test-tenant-id"];
  if (!raw) return null;
  const n = Number(Array.isArray(raw) ? raw[0] : raw);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function startServer(): Promise<{ url: string; close: () => Promise<void> }> {
  const app = express();
  app.set("trust proxy", true);
  app.use(express.json());
  app.use(sessionMod({
    secret: "test-secret-tenant-checkout",
    resave: false,
    saveUninitialized: false,
    cookie: { secure: false, httpOnly: true, sameSite: "lax" },
  }));
  registerStripeCheckoutRoutes(app, {
    getTenantFromRequest: tenantFromHeader,
    requirePlatformAdmin: () => true,
    authMiddleware: (_req: any, _res: any, next: any) => next(),
  });
  return new Promise((resolve) => {
    const srv = app.listen(0, "127.0.0.1", () => {
      const port = (srv.address() as any).port;
      resolve({
        url: `http://127.0.0.1:${port}`,
        close: () => new Promise<void>((r) => srv.close(() => r())),
      });
    });
  });
}

const SAMPLE_PRICE_ID = "price_test_tenant_iso";
const SAMPLE_PRODUCT_ID = "prod_test_tenant_iso";
const checkoutBody = JSON.stringify({ priceId: SAMPLE_PRICE_ID, mode: "payment" });

// R74.13u-sec: the route now validates priceId against stripe.prices/products.
// Seed the test row before the suite runs and remove it after.
before(async () => {
  const { db } = await import("../../server/db");
  const { sql } = await import("drizzle-orm");
  // stripe.products._account_id is FK → stripe.accounts.id; use whichever
  // account is already in this tenant DB rather than synthesising one.
  const acctRows: any = await db.execute(sql`SELECT id FROM stripe.accounts ORDER BY id LIMIT 1`);
  const acctId = ((acctRows as any).rows || acctRows)[0]?.id;
  if (!acctId) throw new Error("test setup: no rows in stripe.accounts to attach test fixture to");
  await db.execute(sql`
    INSERT INTO stripe.products (_account_id, _raw_data)
    VALUES (${acctId}, ${JSON.stringify({ id: SAMPLE_PRODUCT_ID, object: "product", active: true, name: "Tenant-iso test product" })}::jsonb)
    ON CONFLICT DO NOTHING
  `);
  await db.execute(sql`
    INSERT INTO stripe.prices (_account_id, _raw_data)
    VALUES (${acctId}, ${JSON.stringify({ id: SAMPLE_PRICE_ID, object: "price", active: true, product: SAMPLE_PRODUCT_ID, unit_amount: 100, currency: "usd" })}::jsonb)
    ON CONFLICT DO NOTHING
  `);
});

after(async () => {
  const { db } = await import("../../server/db");
  const { sql } = await import("drizzle-orm");
  await db.execute(sql`DELETE FROM stripe.prices WHERE id = ${SAMPLE_PRICE_ID}`);
  await db.execute(sql`DELETE FROM stripe.products WHERE id = ${SAMPLE_PRODUCT_ID}`);
});

async function postCheckout(url: string, init: { headers?: Record<string, string>; body?: string } = {}): Promise<{ status: number; setCookie: string | null; json: any }> {
  const r = await fetch(`${url}/api/stripe/checkout`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(init.headers || {}) },
    body: init.body ?? checkoutBody,
  });
  const setCookie = r.headers.get("set-cookie");
  let json: any = null;
  try { json = await r.json(); } catch { /* non-json bodies aren't expected here */ }
  return { status: r.status, setCookie, json };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test("two logged-in tenants buying the same SKU get DISTINCT idempotency keys", async () => {
  captured.length = 0;
  const { url, close } = await startServer();
  try {
    // Tenant 17 — a real, paying customer.
    const a = await postCheckout(url, {
      headers: {
        "x-test-tenant-id": "17",
        "user-agent": "vc-test-ua-tenant-a/1.0",
      },
    });
    // Tenant 42 — a different paying customer, same SKU, within Stripe's
    // 24h dedup window.
    const b = await postCheckout(url, {
      headers: {
        "x-test-tenant-id": "42",
        "user-agent": "vc-test-ua-tenant-b/1.0",
      },
    });

    assert.equal(a.status, 200, `tenant 17 failed: ${JSON.stringify(a.json)}`);
    assert.equal(b.status, 200, `tenant 42 failed: ${JSON.stringify(b.json)}`);
    assert.equal(captured.length, 2, "expected exactly two captured Stripe calls");

    const [keyA, keyB] = captured.map((c) => c.idempotencyKey);
    assert.ok(keyA && keyB, "both Stripe calls must have an Idempotency-Key");
    assert.notEqual(
      keyA,
      keyB,
      `cross-tenant idempotency collision regression: tenants 17 and 42 were both given key ${keyA}. ` +
      `If anyone flattened the tenant id (e.g. defaulting to 0, swapping in a process-global, or ` +
      `memoizing the wrong way) two paying tenants buying the same SKU within Stripe's 24h dedup ` +
      `window would silently collide on a single Stripe Checkout Session — and tenant B would be ` +
      `routed to tenant A's session URL.`,
    );

    // Sanity: the keys should embed each tenant id verbatim, so a future
    // refactor that accidentally swaps in `0` (or a single shared id) is
    // caught by this assertion in addition to the inequality above.
    assert.ok(
      keyA.includes("_17_"),
      `tenant 17's idempotency key "${keyA}" must include its tenant id partition`,
    );
    assert.ok(
      keyB.includes("_42_"),
      `tenant 42's idempotency key "${keyB}" must include its tenant id partition`,
    );
    for (const k of [keyA, keyB]) {
      assert.ok(
        !/^vc_checkout_[a-z]+_0_/.test(k),
        `idempotency key "${k}" looks like the legacy tenant-0 partition; ` +
        `that's the regression we are guarding against`,
      );
    }
  } finally { await close(); }
});

test("same logged-in tenant double-clicking the same SKU reuses the SAME idempotency key", async () => {
  captured.length = 0;
  const { url, close } = await startServer();
  try {
    // Two near-simultaneous clicks from tenant 17 with identical line items.
    // The route is stateless w.r.t. dedup (it relies on Stripe's 24h window),
    // so we expect two outbound Stripe calls — but with an identical key,
    // so Stripe collapses them into the same session.
    const headers = { "x-test-tenant-id": "17", "user-agent": "vc-test-ua-double-click/1.0" };
    const [first, second] = await Promise.all([
      postCheckout(url, { headers }),
      postCheckout(url, { headers }),
    ]);

    assert.equal(first.status, 200, `first click failed: ${JSON.stringify(first.json)}`);
    assert.equal(second.status, 200, `second click failed: ${JSON.stringify(second.json)}`);
    assert.equal(captured.length, 2, "expected two Stripe calls (the route does not cache; it relies on Stripe-side dedup)");
    assert.equal(
      captured[0].idempotencyKey,
      captured[1].idempotencyKey,
      "double-click from the same logged-in tenant + same SKU must produce the same Stripe " +
      "idempotency key so Stripe dedups into a single Checkout Session",
    );
    // And the shared key must be the tenant-partitioned one, not the
    // anonymous-visitor partition.
    assert.ok(
      captured[0].idempotencyKey.includes("_17_"),
      `double-click idempotency key "${captured[0].idempotencyKey}" must be partitioned by ` +
      `the tenant id (saw a non-tenant partition; check that getTenantFromRequest is being honored)`,
    );
  } finally { await close(); }
});
