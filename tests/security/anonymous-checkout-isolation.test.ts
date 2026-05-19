import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { Readable } from "node:stream";
import https from "node:https";

// Regression suite for the "anonymous shopper idempotency collision" bug.
//
// Pre-fix: the /api/stripe/checkout handler partitioned its Stripe
// idempotency key by `getTenantFromRequest(req) || 0`. Two logged-out
// visitors hitting the storefront within Stripe's 24h dedup window with
// the same line items therefore shared partition `0` and collided on a
// single Stripe Checkout Session — the second shopper was silently sent
// to the first shopper's session URL.
//
// Post-fix: anonymous callers are routed through anonymousVisitorPartition
// (per-visitor session id / client token), so cross-visitor collisions
// are impossible while same-visitor double-clicks still dedup.
//
// This suite locks the fix in place by exercising POST /api/stripe/checkout
// against a real Express + express-session app, with the Stripe SDK
// intercepted at the node:https boundary so we can read the exact
// Idempotency-Key header the route sends.

after(() => { setTimeout(() => process.exit(process.exitCode ?? 0), 50).unref(); });

// ---------------------------------------------------------------------------
// Step 1: install an https.request interceptor BEFORE the route module
// loads. Stripe's NodeHttpClient calls https.request directly, so patching
// the module's request export captures every Stripe API call without any
// real network traffic.
// ---------------------------------------------------------------------------

type CapturedCall = {
  idempotencyKey: string;
  path: string;
  body: string;
};
const captured: CapturedCall[] = [];
const origRequest = https.request.bind(https);

(https as any).request = function patchedRequest(...args: any[]): any {
  // node accepts: request(url|opts, [opts], [cb])
  let opts: any = args[0];
  let cbArg: any = undefined;
  // Find the trailing callback if present.
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

  // Normalize header keys for case-insensitive lookup.
  const headers: Record<string, string> = {};
  for (const [k, v] of Object.entries(opts.headers || {})) {
    headers[String(k).toLowerCase()] = String(v);
  }
  const idempotencyKey = headers["idempotency-key"] || "";
  const path = String(opts.path || "");

  // Buffer the request body so the test can introspect it if needed.
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
  // Stripe's NodeHttpClient writes only after the socket connects. Emit a
  // fake socket immediately so the request body flows in this fake path.
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
// Step 3: build an Express app that registers the REAL route and mounts
// express-session the same way the production server does (so sessionID
// is populated and the Set-Cookie roundtrip works).
// ---------------------------------------------------------------------------

const express = (await import("express")).default;
const sessionMod = (await import("express-session")).default;
const { registerStripeCheckoutRoutes } = await import("../../server/routes/stripe-checkout");

function startServer(): Promise<{ url: string; close: () => Promise<void> }> {
  const app = express();
  app.set("trust proxy", true);
  app.use(express.json());
  app.use(sessionMod({
    secret: "test-secret-anon-checkout",
    resave: false,
    saveUninitialized: false,
    cookie: { secure: false, httpOnly: true, sameSite: "lax" },
  }));
  // Anonymous shopper path — return null so the route falls through to
  // anonymousVisitorPartition, exactly like an unauthenticated production
  // visitor would.
  registerStripeCheckoutRoutes(app, {
    getTenantFromRequest: () => null,
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

const SAMPLE_PRICE_ID = "price_test_anon_iso";
const SAMPLE_PRODUCT_ID = "prod_test_anon_iso";
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
    VALUES (${acctId}, ${JSON.stringify({ id: SAMPLE_PRODUCT_ID, object: "product", active: true, name: "Anon-iso test product" })}::jsonb)
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

// Strip everything after the first `;` to keep just `name=value` for replay.
function cookiePair(setCookie: string | null): string | null {
  if (!setCookie) return null;
  const first = setCookie.split(",")[0];
  return first.split(";")[0];
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test("two anonymous shoppers (different sessions, IPs, UAs) get DISTINCT idempotency keys", async () => {
  captured.length = 0;
  const { url, close } = await startServer();
  try {
    // Shopper A — fresh session, ua-1, x-forwarded-for set to one IP.
    const a = await postCheckout(url, {
      headers: {
        "user-agent": "test-ua-shopper-a/1.0",
        "x-forwarded-for": "203.0.113.10",
      },
    });
    // Shopper B — fresh session (no cookie shared), different ua + ip.
    const b = await postCheckout(url, {
      headers: {
        "user-agent": "test-ua-shopper-b/9.9",
        "x-forwarded-for": "198.51.100.42",
      },
    });

    assert.equal(a.status, 200, `shopper A failed: ${JSON.stringify(a.json)}`);
    assert.equal(b.status, 200, `shopper B failed: ${JSON.stringify(b.json)}`);
    assert.equal(captured.length, 2, "expected exactly two captured Stripe calls");

    const [keyA, keyB] = captured.map((c) => c.idempotencyKey);
    assert.ok(keyA && keyB, "both Stripe calls must have an Idempotency-Key");
    assert.notEqual(
      keyA,
      keyB,
      `cross-shopper idempotency collision regression: both anonymous visitors were given key ${keyA}. ` +
      `If you re-introduced \`getTenantFromRequest(req) || 0\` (or any other shared partition for anonymous callers) ` +
      `the second visitor would silently land on the first visitor's checkout session.`,
    );

    // Sanity: the post-fix keys are visitor-scoped and not the literal
    // `vc_checkout_<mode>_0_*` shape that broke production.
    for (const k of [keyA, keyB]) {
      assert.ok(
        !/^vc_checkout_[a-z]+_0_/.test(k),
        `idempotency key "${k}" looks like the legacy tenant-0 partition; that's the regression we are guarding against`,
      );
    }
  } finally { await close(); }
});

test("same anonymous shopper (cookie-bound session, double-click) reuses the SAME idempotency key", async () => {
  captured.length = 0;
  const { url, close } = await startServer();
  try {
    // First click — establishes the express-session cookie.
    const first = await postCheckout(url, {
      headers: { "user-agent": "test-ua-double-click/1.0" },
    });
    assert.equal(first.status, 200, `first click failed: ${JSON.stringify(first.json)}`);
    const cookie = cookiePair(first.setCookie);
    assert.ok(cookie, "express-session must Set-Cookie on the first anonymous checkout (lastAnonCheckoutAt touch)");

    // Second click — replay the same cookie + UA, same priceId.
    const second = await postCheckout(url, {
      headers: { "user-agent": "test-ua-double-click/1.0", cookie: cookie! },
    });
    assert.equal(second.status, 200, `second click failed: ${JSON.stringify(second.json)}`);

    assert.equal(captured.length, 2, "expected two Stripe calls (the route does not cache; it relies on Stripe-side dedup)");
    assert.equal(
      captured[0].idempotencyKey,
      captured[1].idempotencyKey,
      "double-click from the same session/UA/IP must produce the same Stripe idempotency key so Stripe dedups",
    );
  } finally { await close(); }
});

test("client-supplied Idempotency-Key header dedups even before any cookie roundtrip", async () => {
  // Cookie-less first-clicks (two near-simultaneous POSTs from the same
  // mounted button) get partitioned by the client-supplied token, so the
  // requests still dedup on Stripe's side.
  captured.length = 0;
  const { url, close } = await startServer();
  try {
    const sharedToken = "client_tok_abc123_double_click_safe";
    const headers = { "idempotency-key": sharedToken, "user-agent": "test-ua-cookieless/1.0" };
    const [a, b] = await Promise.all([postCheckout(url, { headers }), postCheckout(url, { headers })]);
    assert.equal(a.status, 200);
    assert.equal(b.status, 200);
    assert.equal(captured.length, 2);
    assert.equal(
      captured[0].idempotencyKey,
      captured[1].idempotencyKey,
      "two cookieless first-clicks with the same client Idempotency-Key header must produce the same Stripe key",
    );
  } finally { await close(); }
});

test("two shoppers with DIFFERENT client Idempotency-Key headers stay isolated", async () => {
  captured.length = 0;
  const { url, close } = await startServer();
  try {
    const [a, b] = await Promise.all([
      postCheckout(url, { headers: { "idempotency-key": "client_tok_shopper_one_unique_value" } }),
      postCheckout(url, { headers: { "idempotency-key": "client_tok_shopper_two_unique_value" } }),
    ]);
    assert.equal(a.status, 200);
    assert.equal(b.status, 200);
    assert.equal(captured.length, 2);
    assert.notEqual(
      captured[0].idempotencyKey,
      captured[1].idempotencyKey,
      "distinct client tokens must yield distinct Stripe idempotency keys",
    );
  } finally { await close(); }
});
