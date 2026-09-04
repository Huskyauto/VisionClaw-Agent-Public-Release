import { test, after } from "node:test";
import assert from "node:assert/strict";

after(() => { setTimeout(() => process.exit(process.exitCode ?? 0), 50).unref(); });

// R125+37 — generate_design_doc (URL → semantic DESIGN.md) contract tests.
//
// NETWORK-FREE: every assertion exercises a path that short-circuits to a
// structured error BEFORE any real network fetch — either a missing arg or a
// URL the SSRF jail rejects pre-fetch (bad protocol, blocked hostname, or a
// private/metadata IP literal that matches the regex before DNS). Proves:
//   1. The handler NEVER throws — returns { ok:false, error } so the agent
//      loop can recover instead of surfacing a raw stack trace.
//   2. LLM/user-controlled URLs cannot reach internal/metadata/private hosts
//      (SSRF jail enforced on EVERY outbound fetch — there is no allowlist).
//   3. The dispatch is wired: executeTool routes the name to the real handler,
//      not the "Unknown tool" default.

test("generateDesignDoc requires a url (structured error, never throws)", async () => {
  const { generateDesignDoc } = await import("../../server/design-doc-tool");
  for (const args of [{}, { url: "" }, { url: "   " }, { persist: true }]) {
    const r = await generateDesignDoc(args as any);
    assert.equal(r.ok, false, `args=${JSON.stringify(args)} must be rejected`);
    if (!r.ok) assert.match(r.error, /url is required/i);
  }
});

test("generateDesignDoc rejects SSRF / internal / non-https URLs pre-fetch", async () => {
  const { generateDesignDoc } = await import("../../server/design-doc-tool");
  const attacks = [
    "http://example.com/",                  // non-https protocol
    "ftp://internal/resource",              // non-https protocol
    "file:///etc/passwd",                   // non-https protocol
    "https://169.254.169.254/latest/meta",  // cloud metadata IP
    "https://10.0.0.1/",                    // RFC1918
    "https://192.168.0.1/",                 // RFC1918
    "https://127.0.0.1/",                   // loopback
    "https://localhost/",                   // blocked hostname
    "https://metadata.google.internal/",    // blocked hostname (+ .internal suffix)
    "not-a-valid-url",                       // unparseable
  ];
  for (const url of attacks) {
    const r = await generateDesignDoc({ url });
    assert.equal(r.ok, false, `url="${url}" must be rejected`);
    if (!r.ok) assert.match(r.error, /could not fetch page|url is required/i);
  }
});

test("ssrf jail blocks the full fe80::/10 IPv6 link-local range pre-fetch", async () => {
  // Regression: the private-IP check used to match only `fe80:`, letting
  // fe90/fea0/febf literals (still fe80::/10 link-local) bypass the jail. The
  // literal-IP classifier runs BEFORE DNS, so these hosts are deterministic +
  // network-free. (Deeper coverage in tests/security/ssrf-ip-classifier.test.ts.)
  const { ssrfSafeUrl } = await import("../../server/lib/ssrf-jail");
  for (const url of ["https://[fe80::1]/", "https://[fe90::1]/", "https://[fea0::1]/", "https://[febf::dead]/"]) {
    const r = await ssrfSafeUrl(url);
    assert.equal(r.ok, false, `url="${url}" must be rejected as link-local`);
  }
  const blocked = await ssrfSafeUrl("https://[fe80::1]/");
  if (!blocked.ok) assert.match(blocked.reason, /private\/reserved IP/i);
});

test("executeTool dispatches generate_design_doc (not 'Unknown tool')", async () => {
  const { executeTool } = await import("../../server/tools");
  // Internal IP so the SSRF jail returns the tool's own structured error before
  // any network call — we only assert the dispatch did not fall through.
  const r = await executeTool("generate_design_doc", { url: "https://10.0.0.1/" });
  assert.equal(typeof r, "object");
  assert.equal(r.ok, false);
  assert.ok(!/[Uu]nknown tool/.test(r?.error || ""), "must route to the real handler, not the unknown-tool default");
});
