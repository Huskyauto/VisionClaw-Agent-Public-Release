import { test, expect, request as pwRequest } from "@playwright/test";

// Real-browser regression for the storefront Buy button's per-mount
// idempotency token (Task #28).
//
// What this guards (frontend half — the server-side equivalent lives at
// tests/security/storefront-checkout-double-click.test.ts):
//   1. Two near-simultaneous Buy clicks on the SAME mounted ProductCard
//      MUST send the SAME, non-empty `clientIdempotencyToken` in the
//      POST /api/store/checkout body. If a future edit removes
//      `idempotencyTokenRef` from client/src/pages/store.tsx, or
//      regenerates it on every render / every click, the two clicks
//      would carry distinct tokens and the server's anonymous-visitor
//      partition could create two Stripe Checkout Sessions for one
//      shopper — the exact bug the matching server test was added to
//      detect on the wire.
//   2. The token must match the server's accepted shape
//      `/^[A-Za-z0-9_-]{8,128}$/` (CLIENT_TOKEN_RE in server/validation.ts).
//      Otherwise the route's Zod schema strips it and the partition
//      silently degrades.
//   3. A FRESH page mount (full reload) must mint a NEW token. This
//      proves the token storage is per-mount (`useRef` scoped to
//      ProductCard), not module-scope or window-global.
//
// We talk to the running dev server at STORE_E2E_BASE_URL (default
// http://127.0.0.1:5000). The route under test (POST /api/store/checkout)
// is INTERCEPTED at the Playwright network layer and stubbed with a 500
// response, so this test never hits Stripe and never creates a real
// Checkout Session — it only verifies what the browser SENDS.
//
// Why intercept with a 500 instead of trying to fire two clicks before
// React re-renders the disabled button: handleBuy() flips loading=true
// (which disables the button) before the fetch starts. A genuine
// double-click before the disabled state propagates is racy and brittle
// in a real browser. Instead, we let the FIRST click resolve to a
// controlled error so the catch-branch runs setLoading(false) and the
// button becomes clickable again — then we click a SECOND time. Both
// clicks share the same ProductCard mount and therefore the same
// useRef-stored token, which is exactly the invariant we need to lock
// in. The "true double-click" scenario is structurally equivalent: it
// also relies on the same useRef token surviving across two onClick
// calls within one mount.

const BASE_URL = process.env.STORE_E2E_BASE_URL || "http://127.0.0.1:5000";
const SAMPLE_SKU = "sample-test-sku-050";
const TOKEN_RE = /^[A-Za-z0-9_-]{8,128}$/;

async function ensureDevServerUp() {
  const ctx = await pwRequest.newContext();
  try {
    const r = await ctx.get(`${BASE_URL}/api/store/catalog`, { timeout: 5000 });
    if (!r.ok()) throw new Error(`catalog returned ${r.status()}`);
    const body = await r.json();
    const found = (body.products || []).some((p: any) => p.sku === SAMPLE_SKU);
    if (!found) throw new Error(`sample SKU ${SAMPLE_SKU} missing from catalog`);
  } finally {
    await ctx.dispose();
  }
}

test.beforeAll(async () => {
  await ensureDevServerUp();
});

test("storefront Buy button: two clicks on the same mount send the SAME clientIdempotencyToken; a remount mints a NEW one", async ({ browser }) => {
  const context = await browser.newContext();
  const page = await context.newPage();

  const captured: Array<{ sku?: string; customerEmail?: string; clientIdempotencyToken?: string }> = [];

  // Intercept BEFORE navigation so the very first POST is captured.
  await page.route("**/api/store/checkout", async (route) => {
    let parsed: any = {};
    try {
      const raw = route.request().postData();
      if (raw) parsed = JSON.parse(raw);
    } catch {
      // Non-JSON bodies are not expected on this route; fall through with empty parsed.
    }
    captured.push({
      sku: parsed?.sku,
      customerEmail: parsed?.customerEmail,
      clientIdempotencyToken: parsed?.clientIdempotencyToken,
    });
    await route.fulfill({
      status: 500,
      contentType: "application/json",
      body: JSON.stringify({ error: "intercepted-by-test" }),
    });
  });

  await page.goto(`${BASE_URL}/store`, { waitUntil: "domcontentloaded" });

  const card = page.getByTestId(`card-product-${SAMPLE_SKU}`);
  await expect(card).toBeVisible({ timeout: 15000 });

  const emailInput = page.getByTestId(`input-email-${SAMPLE_SKU}`);
  const buyButton = page.getByTestId(`button-buy-${SAMPLE_SKU}`);
  const email = `shopper-${Date.now().toString(36)}@example.com`;
  await emailInput.fill(email);

  // First click. The 500 response triggers the catch branch which sets
  // loading=false, re-enabling the button for the second click.
  await buyButton.click();
  await expect.poll(() => captured.length, { timeout: 10000 }).toBe(1);
  await expect(buyButton).toBeEnabled({ timeout: 10000 });

  // Second click on the SAME mount. Must reuse the same useRef token.
  await buyButton.click();
  await expect.poll(() => captured.length, { timeout: 10000 }).toBe(2);

  // ---- Same-mount invariants ----
  expect(captured[0].sku).toBe(SAMPLE_SKU);
  expect(captured[0].customerEmail).toBe(email);
  expect(captured[1].sku).toBe(SAMPLE_SKU);
  expect(captured[1].customerEmail).toBe(email);
  expect(captured[0].clientIdempotencyToken, "first click must carry a non-empty token").toBeTruthy();
  expect(
    captured[0].clientIdempotencyToken,
    "two clicks on the same Buy button mount MUST send the SAME clientIdempotencyToken — " +
      "if this fails, idempotencyTokenRef in client/src/pages/store.tsx has been removed, " +
      "regenerated per click, or rebuilt on every render, and a real customer's double-click " +
      "could create two Stripe Checkout Sessions.",
  ).toBe(captured[1].clientIdempotencyToken);
  expect(
    captured[0].clientIdempotencyToken!,
    `token must match server's CLIENT_TOKEN_RE ${TOKEN_RE} — got "${captured[0].clientIdempotencyToken}". ` +
      "If the token shape changes, the server's Zod schema strips the field and the partition silently degrades.",
  ).toMatch(TOKEN_RE);

  const TOKEN_FIRST_MOUNT = captured[0].clientIdempotencyToken!;

  // ---- Cross-mount invariant: a fresh page mount mints a NEW token ----
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.getByTestId(`card-product-${SAMPLE_SKU}`)).toBeVisible({ timeout: 15000 });
  await page.getByTestId(`input-email-${SAMPLE_SKU}`).fill(email);
  await page.getByTestId(`button-buy-${SAMPLE_SKU}`).click();
  await expect.poll(() => captured.length, { timeout: 10000 }).toBe(3);

  expect(captured[2].clientIdempotencyToken, "reload click must carry a non-empty token").toBeTruthy();
  expect(captured[2].clientIdempotencyToken!).toMatch(TOKEN_RE);
  expect(
    captured[2].clientIdempotencyToken,
    "a fresh page mount MUST mint a NEW idempotency token — if equal to the first mount's token, " +
      "the token is being stored in module scope or a window-global rather than per-component-mount " +
      "(useRef inside ProductCard).",
  ).not.toBe(TOKEN_FIRST_MOUNT);

  await context.close();
});
