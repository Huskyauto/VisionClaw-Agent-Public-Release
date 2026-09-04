import { test, after } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { Readable } from "node:stream";
import https from "node:https";

// Regression suite for the SERVICE-PRODUCT branch of POST /api/store/checkout
// (server/routes/store-checkout.ts ~line 122). That branch:
//   1. Rejects service SKUs with no `intake` payload.
//   2. Rejects service SKUs whose `intake` is missing a required field.
//   3. Forwards every accepted intake answer to Stripe as
//      `metadata.intake_<key>`, truncated to the per-field cap (or 500
//      chars, whichever is smaller — Stripe's hard limit on metadata
//      values).
//
// The sibling test tests/security/storefront-checkout-double-click.test.ts
// only exercises the static SKU `sample-test-sku-050`, so the entire service
// branch could regress unnoticed. A future refactor that drops a required
// field, mis-prefixes the metadata key, or removes the 500-char truncation
// would silently ship to production and the webhook-driven delivery
// pipeline would receive an order it cannot fulfil. These tests catch
// every one of those regressions before the change leaves CI.
//
// Mirrors the node:https interceptor pattern used by
// tests/security/storefront-checkout-double-click.test.ts so we read the
// exact metadata the route hands to Stripe without any real network
// traffic.

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
        id: `cs_test_intake_${captured.length}`,
        object: "checkout.session",
        url: `https://stripe.example/c/intake/${captured.length}`,
      });
      const res: any = new Readable({
        read() {
          this.push(fakeBody);
          this.push(null);
        },
      });
      res.statusCode = 200;
      res.headers = { "content-type": "application/json", "request-id": "req_fake_intake" };
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
process.env.STRIPE_LIVE_SECRET_KEY = process.env.STRIPE_LIVE_SECRET_KEY || "sk_test_fake_for_intake_test";
process.env.STRIPE_LIVE_PUBLISHABLE_KEY = process.env.STRIPE_LIVE_PUBLISHABLE_KEY || "pk_test_fake_for_intake_test";

// ---------------------------------------------------------------------------
// Step 3: mount the REAL /api/store/checkout handler via
// registerStoreCheckoutRoutes. Same pattern as the double-click test —
// no DB, no integrations, just the production code path under a fresh
// Express server.
// ---------------------------------------------------------------------------

const express = (await import("express")).default;
const sessionMod = (await import("express-session")).default;
const { registerStoreCheckoutRoutes } = await import("../../server/routes/store-checkout");
const { lookupProduct } = await import("../../server/product-catalog");

// `sample-test-service-sku-001` is the canonical service SKU in the catalog
// and the only one with `kind === 'service'` at the time of writing. It
// has one required field (`topic`, maxLength 400) plus three optional
// fields (`audience`, `focus`, `depth`). If a future refactor renames or
// removes this SKU, pick another `kind === 'service'` SKU with at least
// one required field — the assertions below derive everything from the
// catalog so the test doesn't hard-code specific keys.
const SERVICE_SKU = "sample-test-service-sku-001";
const SERVICE_PRODUCT = lookupProduct(SERVICE_SKU);
assert.ok(SERVICE_PRODUCT, `catalog must still expose ${SERVICE_SKU}`);
assert.equal(SERVICE_PRODUCT!.kind, "service", `${SERVICE_SKU} must still be kind='service'`);
const REQUIRED_FIELDS = (SERVICE_PRODUCT!.intakeFields || []).filter(f => f.required);
assert.ok(REQUIRED_FIELDS.length > 0, `${SERVICE_SKU} must still expose at least one required intake field`);

function startStorefrontServer(): Promise<{ url: string; close: () => Promise<void> }> {
  const app = express();
  app.set("trust proxy", true);
  app.use(express.json());
  app.use(sessionMod({
    secret: "test-secret-storefront-intake",
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

// Stripe's Node SDK encodes the create-session payload as
// application/x-www-form-urlencoded, with nested objects flattened to
// `metadata[intake_topic]=...`. Pull every metadata[*] entry out so the
// assertions can address them by their unprefixed key.
function parseStripeMetadata(body: string): Record<string, string> {
  const params = new URLSearchParams(body);
  const meta: Record<string, string> = {};
  for (const [k, v] of params.entries()) {
    const m = /^metadata\[([^\]]+)\]$/.exec(k);
    if (m) meta[m[1]] = v;
  }
  return meta;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test("/api/store/checkout: service SKU with NO intake payload is rejected with 400 and never reaches Stripe", async () => {
  captured.length = 0;
  const { url, close } = await startStorefrontServer();
  try {
    const r = await postStoreCheckout(url, {
      sku: SERVICE_SKU,
      customerEmail: "service-buyer@example.com",
      // intake intentionally omitted — handler must refuse before
      // creating a Stripe Checkout Session we cannot fulfil.
    });
    assert.equal(r.status, 400, `expected 400, got ${r.status}: ${JSON.stringify(r.json)}`);
    assert.match(
      String(r.json?.error || ""),
      /intake/i,
      `error message must mention 'intake' so the frontend can surface a useful prompt; got ${JSON.stringify(r.json)}`,
    );
    assert.equal(
      captured.length,
      0,
      "Stripe MUST NOT be called when intake validation fails — otherwise the customer would be charged for an order the webhook cannot fulfil",
    );
  } finally { await close(); }
});

test("/api/store/checkout: service SKU with intake missing a required field is rejected with 400 and never reaches Stripe", async () => {
  captured.length = 0;
  const { url, close } = await startStorefrontServer();
  try {
    const required = REQUIRED_FIELDS[0];
    // Build an intake object that has every OTHER field but omits the
    // required one — proves the per-field check fires even when the
    // intake object itself is non-empty.
    const intake: Record<string, string> = {};
    for (const f of SERVICE_PRODUCT!.intakeFields || []) {
      if (f.key === required.key) continue;
      intake[f.key] = `value-for-${f.key}`;
    }
    const r = await postStoreCheckout(url, {
      sku: SERVICE_SKU,
      customerEmail: "missing-required@example.com",
      intake,
    });
    assert.equal(r.status, 400, `expected 400, got ${r.status}: ${JSON.stringify(r.json)}`);
    assert.match(
      String(r.json?.error || ""),
      new RegExp(`intake\\.${required.key}`, "i"),
      `error must name the missing required field '${required.key}' so the frontend can highlight it; got ${JSON.stringify(r.json)}`,
    );
    assert.equal(
      captured.length,
      0,
      "Stripe MUST NOT be called when a required intake field is missing",
    );
  } finally { await close(); }
});

test("/api/store/checkout: service SKU with required field present-but-blank is rejected with 400", async () => {
  // Whitespace-only and empty-string answers must be rejected exactly
  // like an omitted answer — the route trims before checking, so a
  // future refactor that swaps `String(raw).trim()` for a looser check
  // (e.g. just `String(raw)`) would silently let blank answers through
  // and the agent would receive an unfulfillable order.
  captured.length = 0;
  const { url, close } = await startStorefrontServer();
  try {
    const required = REQUIRED_FIELDS[0];
    const intake: Record<string, string> = { [required.key]: "   " };
    const r = await postStoreCheckout(url, {
      sku: SERVICE_SKU,
      customerEmail: "blank-required@example.com",
      intake,
    });
    assert.equal(r.status, 400, `expected 400, got ${r.status}: ${JSON.stringify(r.json)}`);
    assert.match(
      String(r.json?.error || ""),
      new RegExp(`intake\\.${required.key}`, "i"),
      `whitespace-only required field must be rejected by name; got ${JSON.stringify(r.json)}`,
    );
    assert.equal(captured.length, 0, "Stripe MUST NOT be called for a blank required field");
  } finally { await close(); }
});

test("/api/store/checkout: service SKU with valid intake forwards every answer to Stripe as metadata.intake_<key>", async () => {
  // Happy-path coverage. Builds an intake object with a value for every
  // declared field (required AND optional) and asserts that:
  //   - Each one is forwarded as `metadata[intake_<key>]=<value>`.
  //   - The pre-existing storefront metadata (`bundle_sku`, `source`)
  //     is preserved, so a future refactor that swaps the spread order
  //     can't silently drop the order-routing context.
  //   - No extra `intake_*` keys appear that the handler invented on
  //     its own — anything outside the declared catalog is a regression.
  captured.length = 0;
  const { url, close } = await startStorefrontServer();
  try {
    const intake: Record<string, string> = {};
    const expected: Record<string, string> = {};
    for (const f of SERVICE_PRODUCT!.intakeFields || []) {
      // Use a distinctive marker per key so a swapped-prefix bug (e.g.
      // intake_topic <-> intake_audience) shows up immediately in the
      // assertion diff instead of accidentally matching.
      const v = `answer-for-${f.key}-${f.key.length}`;
      intake[f.key] = v;
      expected[`intake_${f.key}`] = v;
    }
    const r = await postStoreCheckout(url, {
      sku: SERVICE_SKU,
      customerEmail: "happy-path@example.com",
      intake,
    });
    assert.equal(r.status, 200, `expected 200, got ${r.status}: ${JSON.stringify(r.json)}`);
    assert.equal(captured.length, 1, "expected exactly one Stripe call for one POST");

    const meta = parseStripeMetadata(captured[0].body);
    assert.equal(
      meta.bundle_sku,
      SERVICE_SKU,
      "bundle_sku must survive the intake-metadata spread — webhook-side delivery routes off this key",
    );
    assert.equal(
      meta.source,
      "public-storefront",
      "source must survive the intake-metadata spread so the webhook can tell storefront orders from CRM-driven ones",
    );

    for (const [k, v] of Object.entries(expected)) {
      assert.equal(
        meta[k],
        v,
        `metadata.${k} mismatch — if this fails, the intake_<key> prefix or the field-key passthrough has regressed in server/routes/store-checkout.ts`,
      );
    }

    // Catch a regression that ADDS spurious intake_* keys (e.g. a future
    // refactor that walks the entire request body instead of the
    // declared intakeFields). Anything beyond what the catalog declares
    // is unexpected attacker-influenced metadata reaching Stripe.
    const intakeKeysOnSession = Object.keys(meta).filter(k => k.startsWith("intake_"));
    assert.deepEqual(
      intakeKeysOnSession.sort(),
      Object.keys(expected).sort(),
      "Stripe metadata exposed an intake_* key the catalog did not declare — possible body-walk regression",
    );
  } finally { await close(); }
});

test("/api/store/checkout: oversized intake answers are truncated to the per-field cap AND to Stripe's 500-char metadata limit", async () => {
  // Two truncation paths to lock in:
  //   (A) Per-field cap (`field.maxLength`) when it is BELOW Stripe's
  //       500-char ceiling. Today `topic` declares maxLength=400, so a
  //       1000-char answer must be sliced to 400.
  //   (B) Stripe's hard 500-char ceiling when a field declares no cap
  //       (or a cap above 500). Today `depth` has no maxLength, so a
  //       1000-char answer must be sliced to 500.
  //
  // The handler implements this as
  //   value.slice(0, Math.min(field.maxLength || 500, 500))
  // so a regression that drops the `Math.min(..., 500)` clamp would
  // silently let a 600-char `depth` value through and Stripe would
  // 400-error the entire create-session call at runtime — only
  // discovered AFTER the customer clicks Buy.
  captured.length = 0;
  const { url, close } = await startStorefrontServer();
  try {
    const fields = SERVICE_PRODUCT!.intakeFields || [];
    const required = REQUIRED_FIELDS[0];
    assert.ok(
      (required.maxLength || 500) < 500,
      `this test relies on the required field '${required.key}' having a per-field cap BELOW 500 to exercise truncation path (A)`,
    );
    // Find a field with no per-field cap to exercise path (B).
    const uncappedField = fields.find(f => !f.maxLength);
    assert.ok(
      uncappedField,
      "this test relies on at least one intake field with no maxLength so truncation path (B) — the Stripe 500-char clamp — is exercised",
    );

    const longAnswer = "x".repeat(1000);
    const intake: Record<string, string> = {};
    for (const f of fields) intake[f.key] = longAnswer;

    const r = await postStoreCheckout(url, {
      sku: SERVICE_SKU,
      customerEmail: "oversized-intake@example.com",
      intake,
    });
    assert.equal(r.status, 200, `expected 200, got ${r.status}: ${JSON.stringify(r.json)}`);
    assert.equal(captured.length, 1, "expected exactly one Stripe call");

    const meta = parseStripeMetadata(captured[0].body);

    for (const f of fields) {
      const key = `intake_${f.key}`;
      const got = meta[key];
      assert.ok(got != null, `metadata.${key} must be present when intake supplied a value`);
      const expectedCap = Math.min(f.maxLength || 500, 500);
      assert.equal(
        got.length,
        expectedCap,
        `metadata.${key} must be truncated to ${expectedCap} chars (field cap=${f.maxLength ?? "none"}, Stripe cap=500); got length ${got.length}`,
      );
      assert.equal(
        got,
        longAnswer.slice(0, expectedCap),
        `metadata.${key} must contain the FIRST ${expectedCap} chars of the answer (slice from start, not end or middle)`,
      );
      // Hard ceiling — Stripe rejects metadata values >500 chars with
      // a 400 at runtime. Belt-and-braces check separate from the
      // per-field expected cap above so a future refactor that breaks
      // BOTH the `maxLength` lookup AND the `Math.min(..., 500)` clamp
      // still fails this assertion.
      assert.ok(
        got.length <= 500,
        `metadata.${key} length ${got.length} exceeds Stripe's 500-char per-value ceiling — the create-session call would 400 at runtime`,
      );
    }
  } finally { await close(); }
});
