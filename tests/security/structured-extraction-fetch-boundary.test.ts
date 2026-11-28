import test from "node:test";
import assert from "node:assert/strict";
import { readabilityExtract } from "../../server/structured-extraction";

test("the real extraction path pins its connection and refuses redirects before fetching", async () => {
  const original = globalThis.fetch;
  let options: any;
  globalThis.fetch = (async (_url: unknown, init: any) => {
    options = init;
    return new Response("<html><head><title>Fixture</title></head><body><article><p>" +
      "A synthetic public article with sufficient readable source text. ".repeat(30) +
      "</p></article></body></html>", { headers: { "content-type": "text/html" } });
  }) as typeof fetch;
  try {
    const result = await readabilityExtract("https://1.1.1.1/article");
    assert.equal(result.success, true);
    assert.equal(options.redirect, "error", "redirect targets must never be contacted automatically");
    assert.equal(typeof options.dispatcher?.destroy, "function", "use the DNS-pinned dispatcher");
  } finally {
    globalThis.fetch = original;
  }
});

test("private destinations and plaintext HTTP are rejected before any request", async () => {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (async () => {
    calls++;
    throw new Error("network must not be reached");
  }) as typeof fetch;
  try {
    for (const url of ["https://169.254.169.254/", "https://[::1]/", "http://1.1.1.1/"]) {
      const result = await readabilityExtract(url);
      assert.equal(result.success, false);
    }
    assert.equal(calls, 0);
  } finally {
    globalThis.fetch = original;
  }
});

test("a public redirect toward private space is never followed by extraction", async () => {
  const original = globalThis.fetch;
  const calls: unknown[] = [];
  globalThis.fetch = (async (url: unknown, init: any) => {
    calls.push(url);
    assert.equal(init.redirect, "error");
    return new Response(null, { status: 302, headers: { location: "https://169.254.169.254/" } });
  }) as typeof fetch;
  try {
    const result = await readabilityExtract("https://1.1.1.1/redirect");
    assert.equal(result.success, false);
    assert.equal(calls.length, 1, "only the approved public destination may be contacted");
    assert.match(result.error || "", /HTTP 302/);
  } finally {
    globalThis.fetch = original;
  }
});
