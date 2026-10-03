/**
 * tests/unit/self-health.test.ts — Bob 2026-06-03
 *
 * Regression coverage for the web-server self-health primitives. These exist
 * because an agent asked to "test all the systems" could not confirm THIS app's
 * own server was up — it improvised localhost probes (browser/exec/execute_code)
 * that all hit guardrails, then gave up. `probeWebServer` gives check_system_status
 * a first-class "is the site up?" answer; `isLoopbackUrl` lets the browser tool
 * redirect a blocked self-probe to check_system_status.
 *
 * Run: node --import tsx --test tests/unit/self-health.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import { isLoopbackUrl, probeWebServer } from "../../server/lib/self-health";

// --- isLoopbackUrl -------------------------------------------------------

test("isLoopbackUrl: localhost variants are loopback", () => {
  assert.equal(isLoopbackUrl("http://localhost:5000"), true);
  assert.equal(isLoopbackUrl("http://localhost:5000/"), true);
  assert.equal(isLoopbackUrl("https://localhost"), true);
});

test("isLoopbackUrl: 127.0.0.0/8 block is loopback (not just 127.0.0.1)", () => {
  assert.equal(isLoopbackUrl("http://127.0.0.1:5000"), true);
  assert.equal(isLoopbackUrl("http://127.0.0.1:5000/health"), true);
  assert.equal(isLoopbackUrl("http://127.1.2.3:8080"), true);
});

test("isLoopbackUrl: 0.0.0.0 and IPv6 loopback are loopback", () => {
  assert.equal(isLoopbackUrl("http://0.0.0.0:5000"), true);
  assert.equal(isLoopbackUrl("http://[::1]:5000"), true);
  assert.equal(isLoopbackUrl("http://[::ffff:127.0.0.1]:5000"), true);
});

test("isLoopbackUrl: public URLs are NOT loopback", () => {
  assert.equal(isLoopbackUrl("https://agenticcorporation.net"), false);
  assert.equal(isLoopbackUrl("https://example.com/127.0.0.1"), false); // path-only mention
  assert.equal(isLoopbackUrl("https://my-localhost-site.com"), false); // substring, not host
  assert.equal(isLoopbackUrl(""), false);
});

// --- probeWebServer (injectable fetch — hermetic) ------------------------

test("probeWebServer: any HTTP response (even 404) counts as reachable", async () => {
  const fakeFetch = (async () => ({ status: 404 })) as unknown as typeof fetch;
  const r = await probeWebServer(5000, fakeFetch);
  assert.equal(r.reachable, true);
  assert.equal(r.httpStatus, 404);
  assert.equal(r.port, 5000);
  assert.equal(typeof r.responseMs, "number");
});

test("probeWebServer: 200 is reachable", async () => {
  const fakeFetch = (async () => ({ status: 200 })) as unknown as typeof fetch;
  const r = await probeWebServer(5000, fakeFetch);
  assert.equal(r.reachable, true);
  assert.equal(r.httpStatus, 200);
});

test("probeWebServer: connection refused = NOT reachable, error surfaced", async () => {
  const fakeFetch = (async () => {
    throw new Error("connect ECONNREFUSED 127.0.0.1:5000");
  }) as unknown as typeof fetch;
  const r = await probeWebServer(5000, fakeFetch);
  assert.equal(r.reachable, false);
  assert.match(String(r.error), /ECONNREFUSED/);
});

test("probeWebServer: timeout (AbortError) reported as timeout", async () => {
  const fakeFetch = (async () => {
    const e: any = new Error("aborted");
    e.name = "AbortError";
    throw e;
  }) as unknown as typeof fetch;
  const r = await probeWebServer(5000, fakeFetch, 10);
  assert.equal(r.reachable, false);
  assert.match(String(r.error), /timeout/);
});
