import test from "node:test";
import assert from "node:assert/strict";
import { validateMcpServerUrl, fetchMcpEndpoint } from "../../server/lib/mcp-network-boundary";

test("MCP refuses private, plaintext, credential-bearing and ambiguous URLs", async () => {
  for (const url of ["http://127.0.0.1", "https://127.0.0.1", "https://169.254.169.254",
    "https://[::1]", "https://user:secret@example.com", "https://example.com/?token=secret"]) {
    await assert.rejects(validateMcpServerUrl(url));
  }
  await assert.rejects(validateMcpServerUrl("https://example.com", async () =>
    ({ ok: false, reason: "DNS points to private network" })), /private/i);
});

test("MCP pins validated DNS answers and refuses redirects before credentials can move hosts", async () => {
  const calls: any[] = [];
  let closed = false;
  const dispatcher = { close: async () => { closed = true; } };
  const response = await fetchMcpEndpoint("https://example.com/mcp/", "tools/list", {
    headers: { Authorization: "Bearer synthetic" }, body: "{}",
  }, {
    check: async () => ({ ok: true, addresses: ["93.184.216.34"], url: new URL("https://example.com") }),
    dispatcher: addresses => { assert.deepEqual(addresses, ["93.184.216.34"]); return dispatcher as any; },
    fetch: (async (url: any, init: any) => {
      calls.push({ url, init });
      return new Response("{}", { status: 200 });
    }) as typeof fetch,
  });
  assert.equal(response.status, 200);
  assert.equal(calls[0].url, "https://example.com/mcp/tools/list");
  assert.equal(calls[0].init.redirect, "error");
  assert.equal(calls[0].init.dispatcher, dispatcher);
  assert.equal(closed, true);
});
