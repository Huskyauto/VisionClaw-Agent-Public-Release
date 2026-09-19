import { test } from "node:test";
import assert from "node:assert/strict";
import { isPrivateIpNormalized } from "../../server/browser-tool";

// Regression: the browser navigate SSRF guard used to block IPv6 link-local
// only via startsWith("fe80"), missing the rest of fe80::/10 (fe90/fea0/febf).
// Now matches /^fe[89ab]/i plus fc00::/7 (ULA) and ff00::/8 (multicast),
// at parity with server/structured-extraction.ts isPrivateIPv6.

test("isPrivateIpNormalized: blocks full fe80::/10 link-local range", () => {
  for (const ip of ["fe80::1", "fe90::1", "fea0::1", "febf::1", "FE80::1", "FEBF::dead"]) {
    assert.equal(isPrivateIpNormalized(ip), true, `expected ${ip} to be blocked (link-local)`);
  }
});

test("isPrivateIpNormalized: blocks ULA (fc00::/7) and multicast (ff00::/8)", () => {
  for (const ip of ["fc00::1", "fd12:3456::1", "ff02::1", "ff05::2"]) {
    assert.equal(isPrivateIpNormalized(ip), true, `expected ${ip} to be blocked`);
  }
});

test("isPrivateIpNormalized: blocks loopback and v4-mapped private", () => {
  assert.equal(isPrivateIpNormalized("::1"), true);
  assert.equal(isPrivateIpNormalized("::ffff:127.0.0.1"), true);
  assert.equal(isPrivateIpNormalized("::ffff:10.0.0.1"), true);
});

test("isPrivateIpNormalized: allows public IPv6 globals", () => {
  for (const ip of ["2606:4700:4700::1111", "2001:4860:4860::8888"]) {
    assert.equal(isPrivateIpNormalized(ip), false, `expected ${ip} to be allowed (public)`);
  }
});

test("isPrivateIpNormalized: IPv4 private vs public", () => {
  for (const ip of ["10.0.0.1", "127.0.0.1", "172.16.0.1", "192.168.1.1", "169.254.169.254", "0.0.0.0"]) {
    assert.equal(isPrivateIpNormalized(ip), true, `expected ${ip} to be blocked`);
  }
  for (const ip of ["8.8.8.8", "1.1.1.1"]) {
    assert.equal(isPrivateIpNormalized(ip), false, `expected ${ip} to be allowed`);
  }
});
