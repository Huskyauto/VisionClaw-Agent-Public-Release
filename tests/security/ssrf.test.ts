import { test } from "node:test";
import assert from "node:assert/strict";
import { isSafeUrl, isSafeDns } from "../../server/structured-extraction";

test("isSafeUrl: rejects non-http(s) schemes", () => {
  for (const u of ["file:///etc/passwd", "ftp://example.com", "gopher://x", "javascript:alert(1)"]) {
    const r = isSafeUrl(u);
    assert.equal(r.ok, false, `expected ${u} to be rejected`);
  }
});

test("isSafeUrl: rejects internal hostnames", () => {
  for (const u of [
    "http://localhost/admin",
    "http://metadata.google.internal/computeMetadata/v1/",
    "http://foo.internal/",
    "http://printer.local/",
  ]) {
    const r = isSafeUrl(u);
    assert.equal(r.ok, false, `expected ${u} to be rejected`);
  }
});

test("isSafeUrl: rejects literal private IPv4", () => {
  for (const u of [
    "http://10.0.0.1/",
    "http://127.0.0.1/",
    "http://169.254.169.254/latest/meta-data/", // AWS IMDSv1
    "http://172.16.0.1/",
    "http://192.168.1.1/",
    "http://0.0.0.0/",
  ]) {
    const r = isSafeUrl(u);
    assert.equal(r.ok, false, `expected ${u} to be rejected: got ${JSON.stringify(r)}`);
  }
});

test("isSafeUrl: rejects private IPv6", () => {
  for (const u of [
    "http://[::1]/",
    "http://[fc00::1]/",
    "http://[fe80::1]/",
  ]) {
    const r = isSafeUrl(u);
    assert.equal(r.ok, false, `expected ${u} to be rejected`);
  }
});

test("isSafeUrl: allows ordinary public URLs", () => {
  for (const u of ["https://example.com/page", "http://news.ycombinator.com/", "https://en.wikipedia.org/wiki/AI"]) {
    const r = isSafeUrl(u);
    assert.equal(r.ok, true, `expected ${u} to be allowed: got ${JSON.stringify(r)}`);
  }
});

test("isSafeDns: rejects DNS-rebinding (hostname resolving to loopback)", async () => {
  // localtest.me is a public DNS record that resolves to 127.0.0.1.
  // This is exactly the bypass we shipped in Round 14.
  const r = await isSafeDns("localtest.me");
  assert.equal(r.ok, false, "localtest.me should be rejected (resolves to 127.0.0.1)");
  assert.match(r.reason || "", /private/i);
});

test("isSafeDns: skips literal IP hostnames (covered by isSafeUrl)", async () => {
  const r = await isSafeDns("8.8.8.8");
  assert.equal(r.ok, true);
});
