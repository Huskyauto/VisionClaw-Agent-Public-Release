import assert from "node:assert/strict";
import test from "node:test";
import { agentIdIdentity, agentIdEnabled, agentIdRedirectUri } from "../../server/lib/agentid-identity";

test("AgentID subject is stable, issuer-namespaced and unrelated to emails", () => {
  const first = agentIdIdentity("agent-one");
  assert.equal(first, agentIdIdentity("agent-one"));
  assert.notEqual(first, agentIdIdentity("agent-two"));
  assert.match(first, /^agentid:[a-f0-9]{64}$/);
  assert.ok(!first.includes("agent-one"));
});

test("malformed and unbounded subjects fail closed", () => {
  for (const sub of [undefined, null, "", " ", 7, {}, "x".repeat(513)]) {
    assert.throws(() => agentIdIdentity(sub), /Invalid AgentID subject/);
  }
});

test("enablement requires exact flag and both secrets", () => {
  const env = { AGENTID_ENABLED: "1", AGENTID_CLIENT_ID: "fixture-id", AGENTID_CLIENT_SECRET: "fixture-secret" };
  assert.equal(agentIdEnabled(env), true);
  for (const flag of [undefined, "", "true", "0", "01"]) {
    assert.equal(agentIdEnabled({ ...env, AGENTID_ENABLED: flag }), false);
  }
  assert.equal(agentIdEnabled({ ...env, AGENTID_CLIENT_SECRET: "" }), false);
  assert.equal(agentIdEnabled({ ...env, AGENTID_CLIENT_ID: "" }), false);
});

test("callback URL is HTTPS, exact-path and has no credentials, query or fragment", () => {
  const url = "https://agenticcorporation.net/api/auth/agentid/callback";
  assert.equal(agentIdRedirectUri({ AGENTID_REDIRECT_URI: url }).href, url);
  for (const value of [
    undefined, "", "http://example.test/api/auth/agentid/callback",
    "https://example.test/wrong", `${url}?next=evil`, `${url}#fragment`,
    "https://user:password@example.test/api/auth/agentid/callback",
  ]) {
    assert.throws(() => agentIdRedirectUri({ AGENTID_REDIRECT_URI: value }), /AgentID callback/);
  }
});
