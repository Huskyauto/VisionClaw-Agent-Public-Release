import { test, after } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { Readable } from "node:stream";
import https from "node:https";

// Regression suite for the "storefront double-click safety" wiring done
// in Task #23 and locked in by Task #25.
//
// What this guards:
//   1. POST /api/store/checkout sends a deterministic Stripe
//      Idempotency-Key that survives an honest double-click — same
//      shopper clicking the Buy button twice within Stripe's 24h
//      dedup window must hit the SAME Checkout Session, not create
//      a duplicate one (and a duplicate charge).
//   2. Two different shoppers (different emails, different per-mount
//      `clientIdempotencyToken` values, or none) MUST get DISTINCT
//      Stripe Idempotency-Keys so they can never collide on a single
//      Checkout Session.
//
// What would silently break without this test:
//   - If a future edit drops `clientIdempotencyToken` from
//     client/src/pages/store.tsx (the per-mount token the Buy button
//     plumbs into the request body) the route's anonymousVisitorPartition
//     fallback would degrade to a fresh UUID per request, and a real
//     customer's second click could create a second Stripe session.
//   - If a future edit removes the email branch from the partition in
//     server/routes.ts (~line 1786) the same regression would surface
//     for the normal email-bearing path.
//
// Mirrors the node:https interceptor pattern used by
// tests/security/anonymous-checkout-isolation.test.ts so we read the
// exact Idempotency-Key the route sends to Stripe without any real
// network traffic.

after(() => { setTimeout(() => process.exit(process.exitCode ?? 0), 50).unref(); });

// ---------------------------------------------------------------------------
// Step 1: install an https.request interceptor BEFORE the route module
// loads. Stripe's NodeHttpClient calls https.request directly, so patching
// it here captures every Stripe API call without any real network traffic.
// ---------------------------------------------------------------------------

type CapturedCall = { idempotencyKey: string; path: string; body: string };
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
        id: `cs_test_store_${captured.length}`,
        object: "checkout.session",
        url: `https://stripe.example/c/store/${captured.length}`,
      });
      const res: any = new Readable({
        read() {
          this.push(fakeBody);
          this.push(null);
        },
      });
      res.statusCode = 200;
      res.headers = { "content-type": "application/json", "request-id": "req_fake_store" };
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
process.env.STRIPE_LIVE_SECRET_KEY = process.env.STRIPE_LIVE_SECRET_KEY || "sk_test_fake_for_storefront_test";
process.env.STRIPE_LIVE_PUBLISHABLE_KEY = process.env.STRIPE_LIVE_PUBLISHABLE_KEY || "pk_test_fake_for_storefront_test";

// ---------------------------------------------------------------------------
// Step 3: build a minimal Express app that mounts the REAL
// /api/store/checkout handler via registerStoreCheckoutRoutes from
// server/routes/store-checkout.ts. The handler used to live inline in
// the giant registerRoutes() in server/routes.ts and this test had to
// duplicate the body to avoid booting the entire app (DB, every
// integration). Task #27 extracted the handler into its own module so
// the test can mount the production code path directly — eliminating
// the silent-drift risk where the inline copy could diverge from
// production and the regression would stop protecting the bug.
// ---------------------------------------------------------------------------

const express = (await import("express")).default;
const sessionMod = (await import("express-session")).default;
const { registerStoreCheckoutRoutes } = await import("../../server/routes/store-checkout");

function startStorefrontServer(): Promise<{ url: string; close: () => Promise<void> }> {
  const app = express();
  app.set("trust proxy", true);
  app.use(express.json());
  app.use(sessionMod({
    secret: "test-secret-storefront-double-click",
    resave: false,
    saveUninitialized: false,
    cookie: { secure: false, httpOnly: true, sameSite: "lax" },
  }));
  registerStoreCheckoutRoutes(app);
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

// `sample-test-sku-050` is the cheapest static SKU in the catalog and has no
// service intake fields, so the route accepts it with just sku +
// customerEmail. Using a static SKU also keeps the request body compact
// and avoids any service-specific branching.
const SAMPLE_SKU = "sample-test-sku-050";

async function postStoreCheckout(url: string, body: Record<string, unknown>): Promise<{ status: number; json: any }> {
  const r = await fetch(`${url}/api/store/checkout`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  let json: any = null;
  try { json = await r.json(); } catch { /* non-json bodies aren't expected here */ }
  return { status: r.status, json };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test("/api/store/checkout: same shopper double-click (same email + same clientIdempotencyToken) hits Stripe with the SAME Idempotency-Key", async () => {
  captured.length = 0;
  const { url, close } = await startStorefrontServer();
  try {
    const sharedToken = "client_tok_storefront_button_mount_aaaa1111";
    const body = {
      sku: SAMPLE_SKU,
      customerEmail: "shopper@example.com",
      clientIdempotencyToken: sharedToken,
    };
    // Two near-simultaneous POSTs from the same Buy button mount —
    // exactly what an impatient customer's double-click sends.
    const [a, b] = await Promise.all([
      postStoreCheckout(url, body),
      postStoreCheckout(url, body),
    ]);
    assert.equal(a.status, 200, `first click failed: ${JSON.stringify(a.json)}`);
    assert.equal(b.status, 200, `second click failed: ${JSON.stringify(b.json)}`);
    assert.equal(captured.length, 2, "expected exactly two Stripe calls (route does not cache; relies on Stripe-side dedup)");
    assert.ok(captured[0].idempotencyKey, "first Stripe call must carry an Idempotency-Key");
    assert.equal(
      captured[0].idempotencyKey,
      captured[1].idempotencyKey,
      "double-click from the same shopper must produce the same Stripe Idempotency-Key — " +
      "if this fails, the storefront has lost its double-click safety and a real customer could be charged twice. " +
      "Check that POST /api/store/checkout still partitions by `store_<sku>_email_<email>` (server/routes.ts ~line 1786) " +
      "and that the request body still carries `customerEmail` + `clientIdempotencyToken`.",
    );
  } finally { await close(); }
});

test("/api/store/checkout: two strangers (different emails, different clientIdempotencyToken values) get DISTINCT Stripe Idempotency-Keys", async () => {
  captured.length = 0;
  const { url, close } = await startStorefrontServer();
  try {
    // Two completely independent shoppers buying the same SKU at the
    // same moment. Different emails AND different per-mount tokens —
    // both partition inputs disagree, so Stripe MUST get distinct keys.
    const [a, b] = await Promise.all([
      postStoreCheckout(url, {
        sku: SAMPLE_SKU,
        customerEmail: "stranger-one@example.com",
        clientIdempotencyToken: "client_tok_stranger_one_unique_zzzz1111",
      }),
      postStoreCheckout(url, {
        sku: SAMPLE_SKU,
        customerEmail: "stranger-two@example.com",
        clientIdempotencyToken: "client_tok_stranger_two_unique_zzzz2222",
      }),
    ]);
    assert.equal(a.status, 200, `stranger one failed: ${JSON.stringify(a.json)}`);
    assert.equal(b.status, 200, `stranger two failed: ${JSON.stringify(b.json)}`);
    assert.equal(captured.length, 2);
    assert.notEqual(
      captured[0].idempotencyKey,
      captured[1].idempotencyKey,
      "two strangers buying the same SKU at the same moment must get distinct Stripe Idempotency-Keys — " +
      "if this fails, two unrelated customers could collide on a single Checkout Session.",
    );
  } finally { await close(); }
});

test("/api/store/checkout: two strangers with NO clientIdempotencyToken still get DISTINCT Stripe Idempotency-Keys", async () => {
  // The "(or none)" half of the regression: even if the storefront
  // button never sends the per-mount token (the bug we'd be guarding
  // against), two visitors with different emails must STILL be
  // partitioned apart by the email branch. This locks in the
  // defense-in-depth: removing the client token from store.tsx alone
  // does not collapse two strangers onto one Checkout Session.
  captured.length = 0;
  const { url, close } = await startStorefrontServer();
  try {
    const [a, b] = await Promise.all([
      postStoreCheckout(url, { sku: SAMPLE_SKU, customerEmail: "no-token-one@example.com" }),
      postStoreCheckout(url, { sku: SAMPLE_SKU, customerEmail: "no-token-two@example.com" }),
    ]);
    assert.equal(a.status, 200, `first failed: ${JSON.stringify(a.json)}`);
    assert.equal(b.status, 200, `second failed: ${JSON.stringify(b.json)}`);
    assert.equal(captured.length, 2);
    assert.notEqual(
      captured[0].idempotencyKey,
      captured[1].idempotencyKey,
      "two strangers with no client token must still be partitioned by email — " +
      "if this fails, the email-branch partition in server/routes.ts has been weakened.",
    );
    // Sanity: both keys must use the email partition (proves the
    // active branch is `store_<sku>_email_…`, not the anonymous
    // fallback path that depends on the client token).
    for (const c of captured) {
      assert.match(
        c.idempotencyKey,
        /^vc_checkout_payment_store_/,
        `expected storefront partition prefix, got ${c.idempotencyKey}`,
      );
    }
  } finally { await close(); }
});
