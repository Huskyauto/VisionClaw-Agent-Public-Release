/**
 * Action Ledger S3 — Stripe idempotency-key threading (feature contract:
 * data/feature-contracts/action-ledger/ — spec.md + plan.md § S3).
 *
 * Two layers:
 *  1. Unit tests of `withLedgerIdempotency()` precedence rules:
 *     explicit key ALWAYS wins → ALS ledger key when inside a ledgered
 *     dispatch → untouched options otherwise (never invent a key).
 *  2. A fail-closed STATIC guard: today no Stripe mutation executes under
 *     ledgered tool dispatch (all live callsites are HTTP-route checkout /
 *     catalog / Connect-onboarding flows). The guard ensures the FIRST future
 *     money-movement Stripe callsite (payouts, transfers, refunds, charges,
 *     paymentIntents, …) cannot ship without threading an idempotency key —
 *     either `withLedgerIdempotency(...)` or an explicit `idempotencyKey`.
 *     Non-money-movement callsites are grandfathered by EXACT (file, call)
 *     pair; money-movement resources can never be grandfathered.
 *
 * No DB, no network — safe under the node:test runner (no pg pool).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import { withLedgerIdempotency } from "../../server/stripeClient";
import { runWithLedgerAttempt } from "../../server/lib/action-ledger-context";

const ATTEMPT = {
  attemptId: 42,
  idempotencyKey: "vc-al1-testkey",
  tenantId: 1,
  toolName: "test_tool",
};

test("withLedgerIdempotency: outside a ledgered dispatch returns options untouched (never invents a key)", () => {
  const opts = withLedgerIdempotency();
  assert.equal(opts.idempotencyKey, undefined);

  const passthrough = { maxNetworkRetries: 2 } as any;
  assert.equal(withLedgerIdempotency(passthrough), passthrough);
});

test("withLedgerIdempotency: inside a ledgered dispatch injects the ALS attempt key", () => {
  runWithLedgerAttempt(ATTEMPT, () => {
    const opts = withLedgerIdempotency();
    assert.equal(opts.idempotencyKey, "vc-al1-testkey");
  });
});

test("withLedgerIdempotency: an explicitly supplied key ALWAYS wins over the ALS key", () => {
  runWithLedgerAttempt(ATTEMPT, () => {
    const explicit = { idempotencyKey: "vc_checkout_managed_1_abc" };
    const opts = withLedgerIdempotency(explicit);
    assert.equal(opts.idempotencyKey, "vc_checkout_managed_1_abc");
    assert.equal(opts, explicit, "explicit-key options object must pass through unmodified");
  });
});

test("withLedgerIdempotency: merge preserves sibling request options", () => {
  runWithLedgerAttempt(ATTEMPT, () => {
    const opts = withLedgerIdempotency({ maxNetworkRetries: 3 } as any);
    assert.equal((opts as any).maxNetworkRetries, 3);
    assert.equal(opts.idempotencyKey, "vc-al1-testkey");
  });
});

test("withLedgerIdempotency: context does not leak outside runWithLedgerAttempt", () => {
  runWithLedgerAttempt(ATTEMPT, () => {});
  assert.equal(withLedgerIdempotency().idempotencyKey, undefined);
});

// ─── Static guard ────────────────────────────────────────────────────────────

const SERVER_ROOT = path.join(process.cwd(), "server");

// Resources whose mutations move money or create financial liabilities.
// These may NEVER be grandfathered — every callsite must thread a key.
const MONEY_MOVEMENT = new Set([
  "payouts",
  "transfers",
  "refunds",
  "charges",
  "paymentintents",
  "invoices",
  "invoiceitems",
  "paymentlinks",
  "setupintents",
  "subscriptions",
  "checkout.sessions", // NOT billingPortal.sessions (portal link, no money moves)
]);

// Exact grandfathered non-money-movement callsites (catalog + Connect
// onboarding route flows — benign duplicates, no financial side effect).
// Adding a NEW entry here requires the same review as a policy change.
const GRANDFATHERED = new Set([
  "routes/stripe-checkout.ts::products.create",
  "routes/stripe-checkout.ts::prices.create",
  "routes/billing.ts::products.create",
  "routes/billing.ts::prices.create",
  "routes/stripe-tenant-billing.ts::products.create",
  "routes/stripe-tenant-billing.ts::prices.create",
  "routes/stripe-tenant-billing.ts::billingPortal.sessions.create", // portal link, no charge
  "stripe-connect.ts::accounts.create",
  "stripe-connect.ts::accountLinks.create",
  "index.ts::webhookEndpoints.create", // boot infra: URL-matched before create (idempotent by design)
  "index.ts::webhookEndpoints.update",
]);

const MUTATION_CALL =
  /\b(\w*[sS]tripe\w*)\s*\.\s*([A-Za-z_]+)(?:\s*\.\s*([A-Za-z_]+))?\s*\.\s*(create|update|cancel|capture|confirm|del|pay|finalizeInvoice|voidInvoice|sendInvoice)\s*\(/g;

function stripComments(src: string): string {
  // Remove block comments and line comments so documented EXAMPLES of the
  // API (e.g. the usage snippet in stripeClient.ts) don't trip the guard.
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

function* walk(dir: string): Generator<string> {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules") continue;
      yield* walk(full);
    } else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts")) {
      yield full;
    }
  }
}

test("static guard: every Stripe mutation callsite threads an idempotency key (or is an exact grandfathered non-money callsite)", () => {
  const violations: string[] = [];

  for (const file of walk(SERVER_ROOT)) {
    const rel = path.relative(SERVER_ROOT, file);
    const src = stripComments(fs.readFileSync(file, "utf8"));

    MUTATION_CALL.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = MUTATION_CALL.exec(src)) !== null) {
      const [, receiver, first, second, method] = m;
      if (receiver === "stripeSync") continue; // sync library, not the SDK client
      const resourcePath = second ? `${first}.${second}` : first;
      const resource = resourcePath.toLowerCase();
      const callId = `${rel}::${resourcePath}.${method}`;

      // Window after the match: the argument list, where an options object
      // with idempotencyKey / withLedgerIdempotency(...) would appear.
      const windowText = src.slice(m.index, m.index + 600);
      const hasKey =
        windowText.includes("idempotencyKey") ||
        windowText.includes("withLedgerIdempotency(");

      if (hasKey) continue;

      if (MONEY_MOVEMENT.has(resource)) {
        violations.push(
          `${callId} — money-movement Stripe mutation with NO idempotency key; ` +
            `wrap options with withLedgerIdempotency() (server/stripeClient.ts) or pass an explicit key`,
        );
        continue;
      }

      if (!GRANDFATHERED.has(callId)) {
        violations.push(
          `${callId} — new Stripe mutation without an idempotency key and not grandfathered; ` +
            `thread withLedgerIdempotency() or add an explicit key`,
        );
      }
    }
  }

  assert.deepEqual(violations, [], `Stripe idempotency guard violations:\n${violations.join("\n")}`);
});

test("static guard sanity: the scan actually sees the known checkout callsites", () => {
  // Guard-of-the-guard: if the regex or walk silently breaks, this fails
  // instead of the main test passing vacuously on zero matches.
  let matches = 0;
  for (const file of walk(SERVER_ROOT)) {
    const src = stripComments(fs.readFileSync(file, "utf8"));
    MUTATION_CALL.lastIndex = 0;
    while (MUTATION_CALL.exec(src) !== null) matches++;
  }
  assert.ok(matches >= 8, `expected >=8 Stripe mutation callsites in server/, saw ${matches}`);
});
