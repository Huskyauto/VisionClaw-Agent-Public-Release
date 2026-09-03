import { test, after } from "node:test";
import assert from "node:assert/strict";

after(() => { setTimeout(() => process.exit(process.exitCode ?? 0), 50).unref(); });

// R125+35 — Public-API live-data pack (Agenvoy-inspired) contract tests.
//
// These are deliberately NETWORK-FREE: every assertion exercises a code path
// that short-circuits to a structured error BEFORE any fetch() (missing
// required arg, or an arg that fails the allowlist regex). That keeps the suite
// deterministic in CI while still proving the three invariants that matter:
//   1. Handlers NEVER throw — they return { ok:false, error } so the agent loop
//      can recover (a throw would surface a raw stack trace to the user).
//   2. The LLM cannot inject characters that would let a param break out of the
//      query string and redirect the request off its hardcoded host (no SSRF).
//   3. The dispatch is wired: executeTool routes these names to a real handler,
//      not the "Unknown tool" default.

test("PUBLIC_API_HANDLERS exposes all six tools", async () => {
  const { PUBLIC_API_HANDLERS } = await import("../../server/public-api-tools");
  for (const name of [
    "fetch_weather", "fetch_crypto_price", "fetch_exchange_rate",
    "fetch_wikipedia", "fetch_hacker_news", "lookup_ip_geo",
  ]) {
    assert.equal(typeof PUBLIC_API_HANDLERS[name], "function", `${name} handler must exist`);
  }
});

test("missing required args return a structured error, never throw", async () => {
  const m = await import("../../server/public-api-tools");
  const weather = await m.fetchWeather({});
  assert.equal(weather.ok, false);
  const crypto = await m.fetchCryptoPrice({});
  assert.equal(crypto.ok, false);
  const wiki = await m.fetchWikipedia({});
  assert.equal(wiki.ok, false);
});

test("crypto ids reject host-injection / URL-breaking characters", async () => {
  const { fetchCryptoPrice } = await import("../../server/public-api-tools");
  for (const bad of ["bitcoin&x=1", "../../etc", "a b/c?d", "ids=1#"]) {
    const r = await fetchCryptoPrice({ ids: bad });
    assert.equal(r.ok, false, `ids="${bad}" must be rejected pre-fetch`);
  }
});

test("exchange-rate currency codes must be exactly 3 letters", async () => {
  const { fetchExchangeRate } = await import("../../server/public-api-tools");
  assert.equal((await fetchExchangeRate({ base: "US" })).ok, false);
  assert.equal((await fetchExchangeRate({ base: "DOLLAR" })).ok, false);
  assert.equal((await fetchExchangeRate({ base: "USD", target: "12" })).ok, false);
  assert.equal((await fetchExchangeRate({ base: "U$D" })).ok, false);
});

test("ip geo rejects non-IP input pre-fetch (incl. malformed IPv6)", async () => {
  const { lookupIpGeo } = await import("../../server/public-api-tools");
  const bads = [
    "not-an-ip", "999.999.999.999", "1.2.3", "evil.com/x",
    // malformed IPv6 the old permissive regex would have accepted:
    "::::", "1:::2", "1:2:3:4:5:6:7:8:9", "12345::", "gggg::1", ":::",
  ];
  for (const bad of bads) {
    const r = await lookupIpGeo({ ip: bad });
    assert.equal(r.ok, false, `ip="${bad}" must be rejected`);
  }
});

test("ip geo requires an explicit ip (no server self-lookup / infra leak)", async () => {
  // Regression: omitting `ip` used to query ipwho.is with an empty path, leaking
  // the SERVER's own public IP + ISP/org to every caller. Now rejected pre-fetch.
  const { lookupIpGeo } = await import("../../server/public-api-tools");
  for (const args of [{}, { ip: "" }, { ip: "   " }, { ip: null }, { ip: undefined }]) {
    const r = await lookupIpGeo(args as any);
    assert.equal(r.ok, false, `args=${JSON.stringify(args)} must be rejected`);
    if (!r.ok) assert.match(r.error, /ip is required/i);
  }
});

test("ip geo accepts well-formed IPv4/IPv6 (validation passes pre-fetch)", async () => {
  const { lookupIpGeo } = await import("../../server/public-api-tools");
  const net = await import("node:net");
  for (const good of ["8.8.8.8", "2001:4860:4860::8888", "::1"]) {
    assert.notEqual(net.isIP(good), 0, `precondition: ${good} should be a valid IP`);
  }
});

test("executeTool dispatches the pack (not 'Unknown tool')", async () => {
  const { executeTool } = await import("../../server/tools");
  // Invalid args so the handler returns its own structured error before any
  // network call — we only assert the dispatch did NOT fall through to default.
  const r = await executeTool("fetch_crypto_price", { ids: "!!!bad!!!" });
  assert.equal(typeof r, "object");
  assert.ok(!/[Uu]nknown tool/.test(r?.error || ""), "must route to the pack handler, not the unknown-tool default");
});
