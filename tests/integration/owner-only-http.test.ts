import assert from "node:assert/strict";
import test from "node:test";

// Explicit development-only smoke test. Uses the existing owner PIN internally;
// neither the credential, session token, cookies nor CSRF token are logged.
test("staged private app preserves owner PIN/media/logout and rejects other app access", {
  skip: process.env.RUN_OWNER_ONLY_HTTP !== "1", timeout: 45_000,
}, async () => {
  assert.notEqual(process.env.REPLIT_DEPLOYMENT, "1", "Never run against a deployment");
  const domain = process.env.REPLIT_DEV_DOMAIN || "";
  assert.match(domain, /^[a-zA-Z0-9.-]+\.replit\.dev$/);
  assert.ok(process.env.ADMIN_PIN, "Existing owner PIN secret must be configured");
  const base = `https://${domain}`;
  const request = (path: string, init?: RequestInit) => fetch(base + path, {
    ...init, signal: AbortSignal.timeout(12_000), redirect: "manual",
  });
  const status = await (await request("/api/auth/status")).json();
  assert.equal(status.ownerOnly, true, "Refuse to test an open installation");
  const config = await (await request("/api/auth/agentid/config")).json();
  assert.equal(config.enabled, false);
  for (const [method, path] of [
    ["GET", "/api/conversations"], ["GET", "/v1/glasses/tools"],
    ["POST", "/api/tenants/register"], ["POST", "/api/tenants/login"],
    ["POST", "/api/public-chat/fixture/message"],
  ]) assert.equal((await request(path, {method})).status, 403, `${method} ${path}`);
  assert.equal((await request("/api/public/stripe/checkout", {method: "POST"})).status, 404,
    "Isolated staging independently disables payment routes before app authentication");

  let token = "", csrf = "", cookie = "";
  const authorized = (extra: Record<string, string> = {}) => ({Authorization: `Bearer ${token}`, ...extra});
  try {
    const login = await request("/api/auth/login", {
      method: "POST", headers: {"Content-Type": "application/json", Origin: base},
      body: JSON.stringify({pin: process.env.ADMIN_PIN}),
    });
    assert.equal(login.status, 200, "Existing owner PIN must still sign in");
    const identity = await login.json();
    token = identity.token;
    assert.equal(identity.tenantId, 1);
    assert.equal(identity.isAdmin, true);
    assert.ok(/^[a-f0-9]{64}$/.test(token), "Owner session has the expected format");
    const setCookie = login.headers.get("set-cookie") || "";
    assert.ok(/vc_owner_media=/.test(setCookie), "Media credential cookie was issued");
    assert.ok(/HttpOnly/i.test(setCookie), "Media cookie is HttpOnly");
    // The development iframe proxy rewrites Strict to None/Secure. Verify the
    // application declaration separately and never print a raw cookie on fail.
    assert.ok(/SameSite=Strict/i.test(setCookie) || (/SameSite=None/i.test(setCookie) && /;\s*Secure/i.test(setCookie)),
      "Media cookie has explicit SameSite and secure cross-site preview transport");
    cookie = setCookie.split(";")[0];
    assert.equal((await request("/api/tenants/me", {headers: authorized()})).status, 200);
    const missingMedia = `/v/${"a".repeat(32)}.mp4`;
    assert.equal((await request(missingMedia)).status, 403);
    assert.equal((await request(missingMedia, {headers: {Cookie: cookie}})).status, 404,
      "Owner media cookie reaches the real media handler");
    assert.equal((await request("/api/tenants/me", {headers: {Cookie: cookie}})).status, 403,
      "Media cookie cannot authorize APIs");
    assert.equal((await request("/api/auth/logout", {method: "POST", headers: authorized({Origin: base})})).status, 403,
      "Logout must enforce CSRF");
    const csrfResponse = await request("/api/auth/csrf-token", {headers: authorized()});
    assert.equal(csrfResponse.status, 200);
    csrf = (await csrfResponse.json()).csrfToken;
    assert.ok(typeof csrf === "string" && csrf.length > 0);
    const logout = await request("/api/auth/logout", {
      method: "POST", headers: authorized({"X-CSRF-Token": csrf, Origin: base}),
    });
    assert.equal(logout.status, 200);
    assert.ok(/vc_owner_media=;/.test(logout.headers.get("set-cookie") || ""), "Logout clears media cookie");
    assert.equal((await request("/api/tenants/me", {headers: authorized()})).status, 403);
    assert.equal((await request(missingMedia, {headers: {Cookie: cookie}})).status, 403);
    token = "";
  } finally {
    // Remove this development session even when a later assertion fails.
    if (token) {
      if (!csrf) csrf = (await (await request("/api/auth/csrf-token", {headers: authorized()})).json()).csrfToken;
      await request("/api/auth/logout", {method: "POST", headers: authorized({"X-CSRF-Token": csrf, Origin: base})});
    }
  }
});
