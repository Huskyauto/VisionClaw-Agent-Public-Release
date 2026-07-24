import { test, after } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { Readable } from "node:stream";
import https from "node:https";

// Regression suite for Task #29: storefront checkout throttle MUST key
// off per-shopper identity (email or visitor partition + sku), NOT off
// `req.socket.remoteAddress`. In production every storefront request
// arrives through Replit's reverse proxy, so a per-IP limiter degenerates
// into a single global bucket — a single attacker can burn the 30/min
// ceiling and lock every real customer out of the Buy button.
//
// What this guards:
//   1. HAPPY PATH. Many distinct shoppers (different emails) sharing the
//      same TCP source must each get their OWN budget. If a future edit
//      brings the per-IP key back, this test starts seeing 429s before
//      the per-shopper budget is spent.
//   2. ABUSE PATH. A single shopper key (same email + same sku) is still
//      capped after the configured number of hits in the window. Without
//      this leg the limiter would silently become a no-op.
//   3. RETRY-AFTER. The 429 still carries a Retry-After header so the
//      client can present an accurate "try again in Ns" message.
//   4. WINDOW SLIDE. After the window passes, the bucket frees up. Locks
//      in that the limiter is a sliding window, not a permanent ban.
//   5. RESTART DURABILITY. The per-process Map this used to be reset to
//      empty on every server restart, so an attacker could just force a
//      deploy churn (or ride one out) to refill their budget. The
//      Postgres-backed store keeps counts across "restarts" — simulated
//      here by re-importing the route module after dropping the in-memory
//      module cache.

after(() => { setTimeout(() => process.exit(process.exitCode ?? 0), 50).unref(); });

// ---------------------------------------------------------------------------
// Step 1: install an https.request interceptor BEFORE the route module
// loads. Stripe's NodeHttpClient calls https.request directly, so patching
// it here captures every Stripe API call without any real network traffic.
// Mirrors the storefront double-click test's interceptor.
// ---------------------------------------------------------------------------

let stripeCallCount = 0;
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

  const req: any = new EventEmitter();
  req.setTimeout = () => req;
  req.setNoDelay = () => req;
  req.setSocketKeepAlive = () => req;
  req.destroy = () => req;
  req.write = () => true;
  req.end = function () {
    stripeCallCount++;
    setImmediate(() => {
      const fakeBody = JSON.stringify({
        id: `cs_test_rate_${stripeCallCount}`,
        object: "checkout.session",
        url: `https://stripe.example/c/rate/${stripeCallCount}`,
      });
      const res: any = new Readable({
        read() {
          this.push(fakeBody);
          this.push(null);
        },
      });
      res.statusCode = 200;
      res.headers = { "content-type": "application/json", "request-id": "req_fake_rate" };
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
process.env.STRIPE_LIVE_SECRET_KEY = process.env.STRIPE_LIVE_SECRET_KEY || "sk_test_fake_for_rate_test";
process.env.STRIPE_LIVE_PUBLISHABLE_KEY = process.env.STRIPE_LIVE_PUBLISHABLE_KEY || "pk_test_fake_for_rate_test";

// ---------------------------------------------------------------------------
// Step 3: build a minimal Express app that mounts the REAL handler.
// Same registrar pattern as storefront-checkout-double-click.test.ts.
// ---------------------------------------------------------------------------

const express = (await import("express")).default;
const sessionMod = (await import("express-session")).default;
const { registerStoreCheckoutRoutes } = await import("../../server/routes/store-checkout");
const { __resetStorefrontRateLimitForTests } = await import("../../server/storefront-rate-limit-store");

function startServer(): Promise<{ url: string; close: () => Promise<void> }> {
  const app = express();
  app.set("trust proxy", true);
  app.use(express.json());
  app.use(sessionMod({
    secret: "test-secret-storefront-rate-limit",
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

const SAMPLE_SKU = "sample-test-sku-050";

// Tight test override so we don't burn 30 fake Stripe sessions per case
// and don't have to wait a real 60-second window. The route honours these
// headers only when NODE_ENV !== 'production' (see resolveRateLimitConfig).
const TEST_LIMIT = 5;
const TEST_WINDOW_MS = 1500;
const TEST_HEADERS: Record<string, string> = {
  "content-type": "application/json",
  "x-test-rate-limit": String(TEST_LIMIT),
  "x-test-rate-window-ms": String(TEST_WINDOW_MS),
};

async function postCheckout(
  url: string,
  body: Record<string, unknown>,
  extraHeaders: Record<string, string> = {},
): Promise<{ status: number; json: any; retryAfter: string | null }> {
  const r = await fetch(`${url}/api/store/checkout`, {
    method: "POST",
    headers: { ...TEST_HEADERS, ...extraHeaders },
    body: JSON.stringify(body),
  });
  let json: any = null;
  try { json = await r.json(); } catch { /* not all bodies are json */ }
  return { status: r.status, json, retryAfter: r.headers.get("retry-after") };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test("storefront throttle: many distinct shoppers from one TCP source each get their OWN budget (the per-IP regression)", async () => {
  // This is the Replit-proxy scenario: every shopper hits Express from
  // the same TCP source (here, the test's loopback fetch). Under the old
  // per-IP keying, the (TEST_LIMIT*2)+1-th request would have hit 429
  // even though no single shopper sent more than one. Under per-shopper
  // keying, every distinct email gets its own bucket and ALL succeed.
  await __resetStorefrontRateLimitForTests();
  const { url, close } = await startServer();
  try {
    const distinctShoppers = TEST_LIMIT * 2 + 1; // intentionally over the per-key cap
    const results = await Promise.all(
      Array.from({ length: distinctShoppers }, (_, i) =>
        postCheckout(url, {
          sku: SAMPLE_SKU,
          customerEmail: `shopper-${i}@example.com`,
          // Distinct per-mount tokens so even the visitor-fallback branch
          // would partition them apart — defense in depth.
          clientIdempotencyToken: `client_tok_shopper_${i}_aaaa1111`,
        }),
      ),
    );
    const blocked = results.filter(r => r.status === 429);
    const okCount = results.filter(r => r.status === 200).length;
    assert.equal(
      blocked.length,
      0,
      `${blocked.length} of ${distinctShoppers} legitimate shoppers were 429'd. ` +
      "If this fails the storefront throttle is keying off something shared across shoppers " +
      "(req.ip / req.socket.remoteAddress / a global counter) and a single attacker behind " +
      "the same proxy can lock every real customer out of the Buy button.",
    );
    assert.equal(okCount, distinctShoppers, "every distinct shopper should reach Stripe");
  } finally { await close(); }
});

test("storefront throttle: a single shopper hammering the same email+sku is still capped (abuse path)", async () => {
  await __resetStorefrontRateLimitForTests();
  const { url, close } = await startServer();
  try {
    const body = {
      sku: SAMPLE_SKU,
      customerEmail: "attacker@example.com",
      clientIdempotencyToken: "client_tok_attacker_zzzz9999",
    };
    let okCount = 0;
    let blockedCount = 0;
    let firstRetryAfter: string | null = null;
    // Fire TEST_LIMIT + 2 sequentially so the count is deterministic.
    // Parallel fan-out works too but sequential makes the assertion text
    // unambiguous about WHICH request 429'd.
    for (let i = 0; i < TEST_LIMIT + 2; i++) {
      const r = await postCheckout(url, body);
      if (r.status === 200) okCount++;
      else if (r.status === 429) {
        blockedCount++;
        if (firstRetryAfter === null) firstRetryAfter = r.retryAfter;
      } else {
        assert.fail(`unexpected status ${r.status} body=${JSON.stringify(r.json)}`);
      }
    }
    assert.equal(okCount, TEST_LIMIT, `expected exactly ${TEST_LIMIT} successes (limit), got ${okCount}`);
    assert.equal(blockedCount, 2, `expected 2 throttled, got ${blockedCount}`);
    assert.ok(
      firstRetryAfter && Number(firstRetryAfter) > 0,
      `429 response must include a positive Retry-After header so the client can show a useful message. got: ${firstRetryAfter}`,
    );
    assert.ok(
      Number(firstRetryAfter) <= Math.ceil(TEST_WINDOW_MS / 1000) + 1,
      `Retry-After (${firstRetryAfter}s) must be bounded by the window (${TEST_WINDOW_MS}ms) — ` +
      "if it's much larger the client will give up and never retry.",
    );
  } finally { await close(); }
});

test("storefront throttle: window slides — after waiting, the bucket frees up", async () => {
  await __resetStorefrontRateLimitForTests();
  const { url, close } = await startServer();
  try {
    const body = {
      sku: SAMPLE_SKU,
      customerEmail: "slider@example.com",
      clientIdempotencyToken: "client_tok_slider_aaaa1234",
    };
    // Burn the budget.
    for (let i = 0; i < TEST_LIMIT; i++) {
      const r = await postCheckout(url, body);
      assert.equal(r.status, 200, `setup hit ${i + 1} should succeed`);
    }
    // Confirm we ARE throttled.
    const blocked = await postCheckout(url, body);
    assert.equal(blocked.status, 429, "expected throttle to engage at limit+1");
    // Wait out the window with a small buffer.
    await new Promise((r) => setTimeout(r, TEST_WINDOW_MS + 200));
    // Now the bucket should be empty again.
    const afterWait = await postCheckout(url, body);
    assert.equal(
      afterWait.status,
      200,
      `after window slid, request must succeed again — got ${afterWait.status} body=${JSON.stringify(afterWait.json)}. ` +
      "If this fails the limiter is using a permanent ban or the window is being reset incorrectly.",
    );
  } finally { await close(); }
});

test("storefront throttle: anonymous (no email) callers are throttled per-visitor, not against the shared proxy IP", async () => {
  // The email branch is the happy path. This case proves the FALLBACK
  // (visitor-partition) branch also avoids the shared-IP regression.
  // Two anonymous requests from the same TCP source but with DIFFERENT
  // per-mount client idempotency tokens must end up in separate buckets.
  // Each missing-email request still 400s on validation, but the 400
  // happens AFTER the limiter records the hit, so we can still observe
  // the bucketing by exhausting one token's budget and confirming the
  // OTHER token isn't collateral-throttled.
  await __resetStorefrontRateLimitForTests();
  const { url, close } = await startServer();
  try {
    const tokenA = "client_tok_anon_visitor_A_aaaa1111";
    const tokenB = "client_tok_anon_visitor_B_bbbb2222";
    // Burn visitor A's budget. Each request 400s (missing email) but
    // the limiter still counts the hit.
    for (let i = 0; i < TEST_LIMIT; i++) {
      const r = await postCheckout(url, {
        sku: SAMPLE_SKU,
        clientIdempotencyToken: tokenA,
      });
      assert.equal(r.status, 400, `visitor A hit ${i + 1} should 400 (missing email) before throttle`);
    }
    // The next A-request should be throttled (429), NOT pass validation again.
    const aBlocked = await postCheckout(url, {
      sku: SAMPLE_SKU,
      clientIdempotencyToken: tokenA,
    });
    assert.equal(aBlocked.status, 429, "visitor A should be throttled at limit+1");
    // Visitor B (different token, same TCP source) MUST still get through.
    const bOk = await postCheckout(url, {
      sku: SAMPLE_SKU,
      clientIdempotencyToken: tokenB,
    });
    assert.equal(
      bOk.status,
      400,
      `visitor B with a distinct token must NOT be collateral-throttled by visitor A's exhaustion. got ${bOk.status}. ` +
      "If this fails the visitor-fallback branch has degraded back to a shared key (req.ip / global).",
    );
  } finally { await close(); }
});

test("storefront throttle: state survives a simulated process restart (Postgres-backed durability)", async () => {
  // The previous in-memory Map reset on every server restart, so an
  // attacker could just force a deploy churn (or wait for one) to refill
  // their budget. We simulate a restart by booting a fresh Express app
  // (and therefore a fresh in-memory caller of the store module) AFTER
  // burning the budget on the first one. The second app must still see
  // the prior shopper as throttled because the counts live in Postgres,
  // not in this process's heap. If a future edit moves the bookkeeping
  // back to a per-process Map, this test will fail with a 200 on the
  // post-"restart" request.
  await __resetStorefrontRateLimitForTests();
  const restartShopperEmail = "restart-shopper@example.com";
  const body = {
    sku: SAMPLE_SKU,
    customerEmail: restartShopperEmail,
    clientIdempotencyToken: "client_tok_restart_zzzz7777",
  };
  // Use a generous window for THIS test specifically: spawning a fresh
  // tsx child process easily takes a couple seconds, and we don't want
  // the Phase 1 hits to age out of the bucket before the child probe
  // even reaches the route. Both phases must agree on the window so the
  // expires_at the route writes in Phase 1 is the same one read in
  // Phase 2.
  const RESTART_LIMIT = 3;
  const RESTART_WINDOW_MS = 30_000;
  const restartHeaders = {
    "x-test-rate-limit": String(RESTART_LIMIT),
    "x-test-rate-window-ms": String(RESTART_WINDOW_MS),
  };

  // Phase 1: spin up server #1, fully exhaust the per-shopper budget,
  // and confirm the cap engages.
  {
    const { url, close } = await startServer();
    try {
      for (let i = 0; i < RESTART_LIMIT; i++) {
        const r = await postCheckout(url, body, restartHeaders);
        assert.equal(r.status, 200, `pre-restart hit ${i + 1} must succeed`);
      }
      const blocked = await postCheckout(url, body, restartHeaders);
      assert.equal(blocked.status, 429, "pre-restart cap must engage at limit+1");
    } finally { await close(); }
  }

  // Phase 2: spawn a TRUE fresh process (child_process.spawnSync running
  // tsx on a probe script). This is the part that enforces real
  // module-load freshness — a mere second-server-in-the-same-process
  // would still pass even if a regression moved the bookkeeping back
  // into a module-scoped Map, because Node's module cache would hand the
  // child the same already-populated module instance. By forking, we
  // guarantee the probe loads server/storefront-rate-limit-store.ts
  // fresh from disk, with an empty heap, and can only "see" the prior
  // hits via Postgres.
  {
    const { spawnSync } = await import("node:child_process");
    const path = await import("node:path");
    const probePath = path.resolve("tests/security/_storefront-restart-probe.ts");
    const spec = JSON.stringify({
      body,
      expectedStatus: 429,
      testLimit: RESTART_LIMIT,
      testWindowMs: RESTART_WINDOW_MS,
    });
    const result = spawnSync("npx", ["tsx", probePath, spec], {
      env: { ...process.env, NODE_ENV: "test" },
      encoding: "utf8",
      timeout: 30_000,
    });
    assert.equal(
      result.status,
      0,
      `post-restart probe (true fresh process) MUST observe a 429 for the prior shopper. ` +
      `exit=${result.status} stdout=${result.stdout} stderr=${result.stderr}. ` +
      "If this fails the limiter has reverted to per-process in-memory state and an attacker can refill their budget by triggering a deploy.",
    );
    const parsed = JSON.parse(result.stdout || "{}");
    assert.equal(parsed.status, 429, "probe stdout must report a 429 status");
    assert.ok(
      parsed.retryAfter && Number(parsed.retryAfter) > 0,
      "post-restart 429 must still carry a positive Retry-After (proves the row's expires_at is being read from Postgres)",
    );
  }
});
