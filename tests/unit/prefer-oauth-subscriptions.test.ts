/**
 * tests/unit/prefer-oauth-subscriptions.test.ts — OAuth-subscription routing flag
 *
 * Covers the reversible PREFER_OAUTH_SUBSCRIPTIONS gate that decides whether
 * getClientForModel tries Bob's flat-rate subscription ABOVE the metered API-key
 * lanes. Pure env logic — no DB / pg pool (node:test DB-pool-hang lesson). The
 * providers module import is verified to be side-effect-light (no pool opened).
 *
 * Run: node --import tsx --test tests/unit/prefer-oauth-subscriptions.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import { preferOAuthSubscriptions } from "../../server/providers";

const KEY = "PREFER_OAUTH_SUBSCRIPTIONS";

function withEnv(value: string | undefined, fn: () => void) {
  const prev = process.env[KEY];
  try {
    if (value === undefined) delete process.env[KEY];
    else process.env[KEY] = value;
    fn();
  } finally {
    if (prev === undefined) delete process.env[KEY];
    else process.env[KEY] = prev;
  }
}

test("defaults ON when unset (subscription preferred over metered keys)", () => {
  withEnv(undefined, () => assert.equal(preferOAuthSubscriptions(), true));
});

test("blank / whitespace-only is treated as unset → ON", () => {
  withEnv("", () => assert.equal(preferOAuthSubscriptions(), true));
  withEnv("   ", () => assert.equal(preferOAuthSubscriptions(), true));
});

test("explicit falsey values turn it OFF (restores metered-key-first order)", () => {
  for (const v of ["false", "0", "no", "off", "FALSE", "Off", " No "]) {
    withEnv(v, () =>
      assert.equal(preferOAuthSubscriptions(), false, `"${v}" should disable`),
    );
  }
});

test("any other value stays ON (fail-safe toward the cheaper subscription path)", () => {
  for (const v of ["true", "1", "yes", "on", "garbage"]) {
    withEnv(v, () =>
      assert.equal(preferOAuthSubscriptions(), true, `"${v}" should stay enabled`),
    );
  }
});
