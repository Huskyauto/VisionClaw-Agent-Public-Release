import { test } from "node:test";
import assert from "node:assert/strict";
import { ssrfSafeUrl } from "../../server/lib/ssrf-jail";

// Regression for the DNS-rebinding TOCTOU fix (audit wedge). ssrfSafeUrl() must
// surface the exact validated IP literals in `addresses` so the caller can pin
// the connection to them (server/audit-engine.ts pinnedDispatcher). If this
// contract regresses, the pin silently falls back to re-resolution and the
// rebinding window reopens. IP literals are used so no live DNS is required:
// dns.lookup() of a numeric literal returns it verbatim.

test("ssrfSafeUrl returns the validated address for a public IPv4 literal", async () => {
  const r = await ssrfSafeUrl("https://1.1.1.1/");
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.ok(Array.isArray(r.addresses), "addresses must be an array");
    assert.ok(r.addresses.includes("1.1.1.1"), "must include the validated IP");
    assert.ok(r.addresses.length >= 1, "must not be empty (pin would have nothing to bind to)");
  }
});

test("ssrfSafeUrl returns the validated address for a public IPv6 literal", async () => {
  const r = await ssrfSafeUrl("https://[2606:4700:4700::1111]/");
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.ok(r.addresses.length >= 1);
    assert.ok(r.addresses.some((a) => a.includes(":")), "must surface an IPv6 literal");
  }
});

test("ssrfSafeUrl blocks loopback (no addresses leaked on the failure path)", async () => {
  const r = await ssrfSafeUrl("https://127.0.0.1/");
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.reason, /loopback|blocked/i);
});

test("ssrfSafeUrl blocks the cloud-metadata link-local address", async () => {
  const r = await ssrfSafeUrl("https://169.254.169.254/");
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.reason, /link-local|blocked/i);
});

test("ssrfSafeUrl rejects non-https even for a public literal", async () => {
  const r = await ssrfSafeUrl("http://1.1.1.1/");
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.reason, /https/i);
});
