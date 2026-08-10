/**
 * Request-correlation invariants for the structured logger spine.
 *
 * These cover the two surfaces the architect flagged as worth pinning:
 *   1. `sanitizeRequestId` — the ONLY caller-supplied input (inbound
 *      `x-request-id`). It must strip log/header-injection vectors (CR/LF),
 *      drop disallowed characters, cap length, and signal "generate a fresh
 *      id" via null — without ever throwing.
 *   2. `runWithRequestId` / `currentRequestId` — the AsyncLocalStorage scope
 *      must make the id available to downstream work, INCLUDING across an
 *      async hop (this is what lets `res.on('finish')` access logging and any
 *      handler correlate to the same request).
 *
 * No DB access — the pg pool in server/db is lazy (constructed, never queried
 * here), so this file exits cleanly under the per-file node:test runner.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  sanitizeRequestId,
  runWithRequestId,
  currentRequestId,
} from "../../server/lib/logger";

test("sanitizeRequestId: passes through an RFC-safe id unchanged", () => {
  assert.equal(sanitizeRequestId("abc-123_def.456:7"), "abc-123_def.456:7");
  assert.equal(
    sanitizeRequestId("550e8400-e29b-41d4-a716-446655440000"),
    "550e8400-e29b-41d4-a716-446655440000",
  );
});

test("sanitizeRequestId: strips CR/LF and other injection bytes", () => {
  // Classic log/header forging payload — newline + injected line.
  assert.equal(
    sanitizeRequestId("good\r\nhttp_access fake-status=200"),
    "goodhttp_accessfake-status200",
  );
  assert.equal(sanitizeRequestId("a\nb\tc d"), "abcd");
});

test("sanitizeRequestId: drops disallowed chars but keeps the safe ones", () => {
  assert.equal(sanitizeRequestId("a/b\\c<d>e\"f'g"), "abcdefg");
});

test("sanitizeRequestId: caps length at 200 chars", () => {
  const out = sanitizeRequestId("x".repeat(5000));
  assert.equal(out?.length, 200);
});

test("sanitizeRequestId: returns null for unusable / non-string input", () => {
  assert.equal(sanitizeRequestId(""), null);
  assert.equal(sanitizeRequestId("   "), null); // whitespace stripped → empty
  assert.equal(sanitizeRequestId("\r\n"), null);
  assert.equal(sanitizeRequestId(undefined), null);
  assert.equal(sanitizeRequestId(null), null);
  assert.equal(sanitizeRequestId(12345), null);
  assert.equal(sanitizeRequestId(["a"]), null);
});

test("currentRequestId: null outside any request scope (never throws)", () => {
  assert.equal(currentRequestId(), null);
});

test("runWithRequestId: id is visible synchronously inside the scope", () => {
  runWithRequestId("req-sync-1", () => {
    assert.equal(currentRequestId(), "req-sync-1");
  });
  // ...and gone again once the scope closes.
  assert.equal(currentRequestId(), null);
});

test("runWithRequestId: id propagates across an async hop", async () => {
  await runWithRequestId("req-async-1", async () => {
    assert.equal(currentRequestId(), "req-async-1");
    await new Promise((r) => setTimeout(r, 5));
    // The whole point: the id survives the await — this is what makes
    // res.on('finish') access logging correlate to the right request.
    assert.equal(currentRequestId(), "req-async-1");
  });
  assert.equal(currentRequestId(), null);
});

test("runWithRequestId: concurrent scopes do not bleed into each other", async () => {
  const seen: Record<string, string | null> = {};
  await Promise.all([
    runWithRequestId("req-A", async () => {
      await new Promise((r) => setTimeout(r, 10));
      seen.A = currentRequestId();
    }),
    runWithRequestId("req-B", async () => {
      await new Promise((r) => setTimeout(r, 2));
      seen.B = currentRequestId();
    }),
  ]);
  assert.equal(seen.A, "req-A");
  assert.equal(seen.B, "req-B");
});
