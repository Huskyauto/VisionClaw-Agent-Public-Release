import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { createServer } from "node:http";
import { createHash } from "node:crypto";
import { mcpAuthRouter } from "@modelcontextprotocol/sdk/server/auth/router.js";
import { FelixOAuthProvider, type OAuthRecord } from "../server/felix-connector/oauth";

test("real SDK token handler exchanges a valid PKCE code without stripping provider verification", async () => {
  const app = express(), http = createServer(app), records = new Map<string, OAuthRecord>();
  await new Promise<void>(resolve => http.listen(0, "127.0.0.1", resolve));
  const address = http.address() as {port:number};
  const origin = new URL(`http://127.0.0.1:${address.port}`);
  const provider = new FelixOAuthProvider({transaction: async fn => fn({
    async get(id) {return records.get(id);},
    async put(row) {records.set(row.id,row);},
    async remove(id) {records.delete(id);},
    async removeClient(clientId) {for(const [id,row] of records) if(row.clientId===clientId && row.kind!=="client") records.delete(id);},
    async countClients() {return records.size;},
    async prepareClient() {},
  })},origin,()=>1);
  app.use(mcpAuthRouter({provider,issuerUrl:origin,resourceServerUrl:new URL("/mcp",origin)}));
  try {
    const client = await provider.clientsStore.registerClient({redirect_uris:["https://claude.ai/api/mcp/auth_callback"],token_endpoint_auth_method:"none"});
    const verifier = "v".repeat(64);
    let pending = "";
    await provider.authorize(client,{scopes:["felix:read"],redirectUri:client.redirect_uris[0],
      codeChallenge:createHash("sha256").update(verifier).digest("base64url")},
      {redirect(location:string) {pending=new URL(location,origin).searchParams.get("request")!;}} as any);
    const callback = new URL(await provider.consent(pending,1));
    const exchange = (value:string) => fetch(new URL("/token",origin),{method:"POST",
      headers:{"Content-Type":"application/x-www-form-urlencoded"},body:new URLSearchParams({
        grant_type:"authorization_code",client_id:client.client_id,code:callback.searchParams.get("code")!,
        code_verifier:value,redirect_uri:client.redirect_uris[0],
      })});
    assert.equal((await exchange("w".repeat(64))).status,400,"bad verifier must fail without consuming valid code");
    const response = await exchange(verifier);
    assert.equal(response.status,200,"SDK must forward verifier to the provider's mandatory atomic validation");
    const tokens:any = await response.json();
    assert.equal(tokens.expires_in,3600);
    assert.deepEqual((await provider.verifyAccessToken(tokens.access_token)).scopes,["felix:read"]);
    assert.equal((await exchange(verifier)).status,400,"one-use code");
  } finally {
    http.closeAllConnections();
    await new Promise<void>((resolve,reject)=>http.close(err=>err?reject(err):resolve()));
  }
});
