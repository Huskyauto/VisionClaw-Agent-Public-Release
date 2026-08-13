import { test } from "node:test";
import assert from "node:assert/strict";
import { ssrfSafeFetchBytes } from "../../server/lib/ssrf-jail";

// Regression for the DNS-rebinding TOCTOU fix on the FETCH path. ssrfSafeUrl()
// already validates the resolved IPs; this asserts ssrfSafeFetchBytes() actually
// pins the socket to them (undici dispatcher) AND keeps redirect:"error". Network-
// free: global.fetch is stubbed to capture the options it was called with. A public
// IPv4 literal is used so ssrfSafeUrl() passes without live DNS (dns.lookup of a
// numeric literal returns it verbatim). If a future refactor drops the dispatcher
// or relaxes the redirect mode, the rebinding/redirect window reopens — this fails.

test("ssrfSafeFetchBytes pins a dispatcher and refuses redirects", async () => {
  const realFetch = globalThis.fetch;
  let captured: any = null;
  globalThis.fetch = (async (_url: any, opts: any) => {
    captured = opts;
    return new Response(Buffer.from("ok"), {
      status: 200,
      headers: { "content-type": "text/plain" },
    });
  }) as any;
  try {
    const r = await ssrfSafeFetchBytes("https://1.1.1.1/");
    assert.equal(r.ok, true, "public literal should fetch ok");
    assert.ok(captured, "fetch must have been called");
    assert.ok(captured.dispatcher, "a pinned dispatcher must be attached to the fetch");
    assert.equal(typeof captured.dispatcher.destroy, "function", "dispatcher must be an undici Agent (has destroy())");
    assert.equal(captured.redirect, "error", "redirect bypass defense must stay 'error'");
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("ssrfSafeFetchBytes rejects a blocked host before any fetch", async () => {
  const realFetch = globalThis.fetch;
  let called = false;
  globalThis.fetch = (async () => { called = true; return new Response(Buffer.from(""), { status: 200 }); }) as any;
  try {
    const r = await ssrfSafeFetchBytes("https://169.254.169.254/");
    assert.equal(r.ok, false, "cloud-metadata link-local must be refused");
    assert.equal(called, false, "fetch must never run for a blocked host");
  } finally {
    globalThis.fetch = realFetch;
  }
});
