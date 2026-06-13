import { test, after } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { Readable } from "node:stream";
import https from "node:https";

// Regression suite for the "clientIdempotencyToken silently dropped on
// the public Stripe checkout endpoint" bug fixed alongside Task #23.
//
// Pre-fix:
//   1. server/validation.ts `stripeCheckoutSchema` did not whitelist
//      `clientIdempotencyToken`. The validate() middleware reassigns
//      `req.body = result.data`, and Zod's default strip-unknown
//      behavior dropped the field — so even when the frontend sent
//      a stable per-button-mount token in the POST body to
//      `/api/public/stripe/checkout`, the route's
//      readClientIdempotencyToken() never saw it and the partition
//      fell back to the weaker session-cookie / UUID path. A
//      cookieless first-click double-click could therefore create two
//      Stripe Checkout Sessions instead of one.
//   2. client/src/pages/store.tsx did not mint a stable per-mount
//      idempotency token at all — every storefront double-click was
//      partitioned only by sessionID (which itself isn't issued until
//      the first response cookie has round-tripped).
//
// Post-fix: the schema accepts the field, the storefront button mints
// a stable per-mount token, and the public checkout route honors a
// body-level token even before any cookie roundtrip — so honest
// double-clicks dedup to one Stripe Checkout Session.

after(() => { setTimeout(() => process.exit(process.exitCode ?? 0), 50).unref(); });

// ---------------------------------------------------------------------------
// Step 1: install an https.request interceptor BEFORE the route module
// loads. Stripe's NodeHttpClient calls https.request directly, so patching
// it here captures every Stripe API call without any real network traffic.
// ---------------------------------------------------------------------------

type CapturedCall = { idempotencyKey: string; path: string };
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

  const req: any = new EventEmitter();
  req.setTimeout = () => req;
  req.setNoDelay = () => req;
  req.setSocketKeepAlive = () => req;
  req.destroy = () => req;
  req.write = () => true;
  req.end = function () {
    captured.push({ idempotencyKey, path });
    setImmediate(() => {
      const fakeBody = JSON.stringify({
        id: `cs_test_pub_${captured.length}`,
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
      res.headers = { "content-type": "application/json", "request-id": "req_fake_pub" };
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
process.env.STRIPE_LIVE_SECRET_KEY = process.env.STRIPE_LIVE_SECRET_KEY || "sk_test_fake_for_token_test";
process.env.STRIPE_LIVE_PUBLISHABLE_KEY = process.env.STRIPE_LIVE_PUBLISHABLE_KEY || "pk_test_fake_for_token_test";

// ---------------------------------------------------------------------------
// Step 3: build a minimal Express app that mounts a copy of the REAL
// /api/public/stripe/checkout handler — re-using the production
// validate(), schema, anonymousVisitorPartition, and Stripe client. The
// real handler lives inside the giant registerRoutes() in
// server/routes.ts which boots the entire app (DB, every integration);
// we'd rather isolate the regression than run the world.
// ---------------------------------------------------------------------------

const express = (await import("express")).default;
const sessionMod = (await import("express-session")).default;
const { validate, stripeCheckoutSchema } = await import("../../server/validation");
const { anonymousVisitorPartition } = await import("../../server/anonymousVisitorPartition");
const { getUncachableStripeClient, buildCheckoutIdempotencyKey } = await import("../../server/stripeClient");

function startPublicCheckoutServer(): Promise<{ url: string; close: () => Promise<void> }> {
  const app = express();
  app.set("trust proxy", true);
  app.use(express.json());
  app.use(sessionMod({
    secret: "test-secret-public-checkout",
    resave: false,
    saveUninitialized: false,
    cookie: { secure: false, httpOnly: true, sameSite: "lax" },
  }));
  app.post("/api/public/stripe/checkout", validate(stripeCheckoutSchema), async (req: any, res: any) => {
    const { priceId, customerEmail } = req.body;
    const stripe = await getUncachableStripeClient();
    const sessionData: any = {
      payment_method_types: ['card'],
      line_items: [{ price: priceId, quantity: 1 }],
      mode: 'subscription',
      success_url: `https://example.com/?status=success`,
      cancel_url: `https://example.com/?status=cancelled`,
    };
    if (customerEmail) sessionData.customer_email = customerEmail;
    const partition = customerEmail
      ? `pub_email_${customerEmail}`
      : `pub_${anonymousVisitorPartition(req)}`;
    const session = await stripe.checkout.sessions.create(sessionData, {
      idempotencyKey: buildCheckoutIdempotencyKey(partition, "subscription", sessionData),
    });
    res.json({ url: session.url, sessionId: session.id });
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

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test("stripeCheckoutSchema preserves clientIdempotencyToken (regression for strip-unknown bug)", () => {
  const parsed = stripeCheckoutSchema.parse({
    priceId: "price_abc",
    customerEmail: "shopper@example.com",
    clientIdempotencyToken: "client_tok_double_click_safe_001",
  });
  assert.equal(
    parsed.clientIdempotencyToken,
    "client_tok_double_click_safe_001",
    "validate() middleware reassigns req.body = result.data; if Zod strips the field here it never reaches readClientIdempotencyToken and the dedup degrades to the cookie/UUID fallback",
  );
});

test("stripeCheckoutSchema rejects clientIdempotencyToken values that the partition reader would refuse", () => {
  // The partition reader's CLIENT_TOKEN_RE is /^[A-Za-z0-9_-]{8,128}$/.
  // The schema must reject anything outside that shape so a malformed
  // token surfaces as a validation error rather than being silently
  // demoted (which would mask the bug from frontend authors).
  for (const bad of ["short", "has space here", "has/slash/and+plus", "x".repeat(129)]) {
    const r = stripeCheckoutSchema.safeParse({ priceId: "price_abc", clientIdempotencyToken: bad });
    assert.equal(r.success, false, `schema must reject malformed token: ${JSON.stringify(bad)}`);
  }
  // crypto.randomUUID() (what the storefront button mints) must be accepted.
  const uuidLike = "01234567-89ab-cdef-0123-456789abcdef";
  const r = stripeCheckoutSchema.safeParse({ priceId: "price_abc", clientIdempotencyToken: uuidLike });
  assert.equal(r.success, true, "crypto.randomUUID() shape (mounted-button token) must be accepted");
});

test("/api/public/stripe/checkout: cookieless double-click with same body clientIdempotencyToken dedups to one Stripe key", async () => {
  captured.length = 0;
  const { url, close } = await startPublicCheckoutServer();
  try {
    const sharedToken = "client_tok_storefront_button_mount_xyz";
    const body = JSON.stringify({ priceId: "price_pub_test", clientIdempotencyToken: sharedToken });
    const headers = { "content-type": "application/json" };
    // Two parallel POSTs from a fresh visitor — no cookie shared, no
    // session yet. Pre-fix the schema stripped the body field so each
    // request fell back to a fresh anonymous partition (UUID per
    // request) and Stripe got two distinct keys.
    const [a, b] = await Promise.all([
      fetch(`${url}/api/public/stripe/checkout`, { method: "POST", headers, body }),
      fetch(`${url}/api/public/stripe/checkout`, { method: "POST", headers, body }),
    ]);
    assert.equal(a.status, 200, `first request failed: ${await a.text()}`);
    assert.equal(b.status, 200, `second request failed: ${await b.text()}`);
    assert.equal(captured.length, 2, "expected exactly two captured Stripe calls");
    assert.equal(
      captured[0].idempotencyKey,
      captured[1].idempotencyKey,
      "double-click with the same body-level clientIdempotencyToken must produce the SAME Stripe key — " +
      "if this fails, check that stripeCheckoutSchema in server/validation.ts still whitelists `clientIdempotencyToken` " +
      "(Zod's default strip-unknown will drop unlisted fields when validate() does req.body = result.data)",
    );
    // And the partition prefix proves the client-token path was taken
    // (not the cookie/UUID fallback).
    assert.match(
      captured[0].idempotencyKey,
      /pub_anon_tok_/,
      `expected the public-stripe partition to use the anon_tok_ branch (client token), got ${captured[0].idempotencyKey}`,
    );
  } finally { await close(); }
});

test("/api/public/stripe/checkout: two visitors with DIFFERENT body clientIdempotencyTokens stay isolated", async () => {
  captured.length = 0;
  const { url, close } = await startPublicCheckoutServer();
  try {
    const headers = { "content-type": "application/json" };
    const [a, b] = await Promise.all([
      fetch(`${url}/api/public/stripe/checkout`, {
        method: "POST",
        headers,
        body: JSON.stringify({ priceId: "price_pub_test", clientIdempotencyToken: "client_tok_visitor_one_unique_aaaaa" }),
      }),
      fetch(`${url}/api/public/stripe/checkout`, {
        method: "POST",
        headers,
        body: JSON.stringify({ priceId: "price_pub_test", clientIdempotencyToken: "client_tok_visitor_two_unique_bbbbb" }),
      }),
    ]);
    assert.equal(a.status, 200);
    assert.equal(b.status, 200);
    assert.equal(captured.length, 2);
    assert.notEqual(
      captured[0].idempotencyKey,
      captured[1].idempotencyKey,
      "distinct per-button-mount tokens must yield distinct Stripe idempotency keys — otherwise two strangers could share a Checkout Session",
    );
  } finally { await close(); }
});
