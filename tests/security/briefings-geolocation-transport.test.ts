/**
 * tests/security/briefings-geolocation-transport.test.ts
 *
 * Regression for the HIGH finding: briefing geolocation used plaintext
 * http://ip-api.com, leaking the client IP and allowing MITM tampering of the
 * resolved location. Both call sites must use HTTPS, URL-encode the client IP,
 * and bound the request with a timeout. Static-source assertion (query-free, no
 * DB) so it can run anywhere in CI without a pg pool.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("../../server/routes/briefings.ts", import.meta.url), "utf8");

test("briefings geolocation never uses plaintext http", () => {
  assert.ok(!/http:\/\/ip-api\.com/.test(src), "must not call http://ip-api.com");
  assert.ok(!/fetch\(`http:\/\//.test(src), "no plaintext http fetch in briefings");
});

test("both geolocation sites use https + URL-encoded IP + timeout", () => {
  const geoCalls = src.match(
    /fetch\(`https:\/\/ipwho\.is[^`]*`,\s*\{\s*signal:\s*AbortSignal\.timeout\(\d+\)\s*\}\)/g,
  ) || [];
  assert.ok(geoCalls.length >= 2, "both geolocation sites use https ipwho.is bounded by AbortSignal.timeout");
  assert.ok(/encodeURIComponent\(clientIp\)/.test(src), "client IP must be URL-encoded into the geolocation URL");
});
