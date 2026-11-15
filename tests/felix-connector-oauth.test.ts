import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { FelixOAuthProvider, type OAuthRecord, type OAuthRecordStore } from "../server/felix-connector/oauth";

function fixture() {
  const rows = new Map<string, OAuthRecord>();
  let chain = Promise.resolve();
  const store: OAuthRecordStore = {
    transaction: (fn) => {
      const run = chain.then(() => fn({
        async get(id) { return rows.get(id); },
        async put(record) { if (rows.has(record.id)) throw new Error("duplicate"); rows.set(record.id, record); },
        async remove(id) { rows.delete(id); },
        async removeClient(clientId) { for (const [id, row] of rows) if (row.clientId === clientId && row.kind !== "client") rows.delete(id); },
        async countClients() { return [...rows.values()].filter(r => r.kind === "client").length; },
        async prepareClient() {},
      }));
      chain = run.then(() => {}, () => {});
      return run;
    },
  };
  const provider = new FelixOAuthProvider(store, new URL("https://example.test"), () => 1);
  return { provider, rows };
}
async function authorize(provider: FelixOAuthProvider, scopes = ["felix:read", "felix:write"]) {
  const client = await provider.clientsStore.registerClient!({
    redirect_uris: ["https://claude.ai/api/mcp/auth_callback"], token_endpoint_auth_method: "none",
  });
  const verifier = "a".repeat(64);
  let redirect = "";
  await provider.authorize(client, {
    codeChallenge: createHash("sha256").update(verifier).digest("base64url"),
    scopes, redirectUri: client.redirect_uris[0], state: "opaque-state", resource: new URL("https://example.test/mcp"),
  }, { redirect(url: string) { redirect = url; } } as any);
  const pending = new URL(redirect, "https://example.test").searchParams.get("request")!;
  return { client, verifier, pending };
}
test("owner consent, PKCE, one-use code, resource and client binding", async () => {
  const {provider, rows} = fixture();
  const {client, verifier, pending} = await authorize(provider);
  await assert.rejects(() => provider.consent(pending, 2), /owner/);
  const location = await provider.consent(pending, 1);
  const url = new URL(location);
  assert.equal(url.searchParams.get("state"), "opaque-state");
  const code = url.searchParams.get("code")!;
  await assert.rejects(() => provider.exchangeAuthorizationCode(client, code, "wrong", client.redirect_uris[0]), /PKCE/);
  await assert.rejects(() => provider.exchangeAuthorizationCode(client, code, verifier, "https://claude.ai/wrong"), /redirect/);
  const tokens = await provider.exchangeAuthorizationCode(client, code, verifier, client.redirect_uris[0], new URL("https://example.test/mcp"));
  await assert.rejects(() => provider.exchangeAuthorizationCode(client, code, verifier, client.redirect_uris[0]), /invalid|expired/);
  const auth = await provider.verifyAccessToken(tokens.access_token);
  assert.equal(auth.clientId, client.client_id);
  assert.equal(auth.extra?.tenantId, 1);
  assert.equal(tokens.expires_in, 3600);
  assert.ok(!JSON.stringify([...rows.keys()]).includes(tokens.access_token));
  await assert.rejects(() => provider.exchangeRefreshToken(client, tokens.refresh_token!, ["*"]), /scope/);
  await assert.rejects(() => provider.exchangeRefreshToken(client, tokens.refresh_token!, undefined, new URL("https://evil.test/mcp")), /resource/);
  const refreshed = await provider.exchangeRefreshToken(client, tokens.refresh_token!);
  await assert.rejects(() => provider.exchangeRefreshToken(client, tokens.refresh_token!), /invalid|expired/);
  await provider.revokeClient(client.client_id);
  await assert.rejects(() => provider.verifyAccessToken(refreshed.access_token), /invalid|expired/);
  await assert.rejects(() => provider.verifyAccessToken(tokens.access_token), /invalid|expired/);
});
test("read-only scopes cannot escalate on refresh and consent is one-use", async () => {
  const {provider} = fixture();
  const {client, verifier, pending} = await authorize(provider, ["felix:read"]);
  const code = new URL(await provider.consent(pending, 1)).searchParams.get("code")!;
  await assert.rejects(() => provider.consent(pending, 1), /invalid|expired/);
  const tokens = await provider.exchangeAuthorizationCode(client, code, verifier, client.redirect_uris[0]);
  await assert.rejects(() => provider.exchangeRefreshToken(client, tokens.refresh_token!, ["felix:write"]), /scope/);
});
