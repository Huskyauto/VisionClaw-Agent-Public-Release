import assert from "node:assert/strict";
import { test } from "node:test";
import {
  ownerOnlyAccess,
  tenantAccessAllowed,
  classifyPrivateRequest,
  createOwnerOnlyGate,
} from "../../server/lib/owner-only-access";

test("private access is default and only the exact operator opt-out reopens tenants", () => {
  for (const mode of [undefined, "", "owner-only", "false", "0", "MULTI-TENANT"]) {
    assert.equal(ownerOnlyAccess({ APP_ACCESS_MODE: mode }), true);
  }
  assert.equal(ownerOnlyAccess({ APP_ACCESS_MODE: "multi-tenant" }), false);
  for (const tenant of [undefined, null, 0, -1, "1", 2, NaN]) {
    assert.equal(tenantAccessAllowed(tenant, true), false);
  }
  assert.equal(tenantAccessAllowed(1, true), true);
  assert.equal(tenantAccessAllowed(2, false), true);
});

test("private ingress distinguishes information, explicit service auth and app operations", () => {
  const kind = (method: string, path: string) => classifyPrivateRequest(method, path);
  for (const path of ["/", "/landing", "/login", "/assets/app.js", "/healthz"]) {
    assert.equal(kind("GET", path), "public", path);
  }
  for (const path of ["/api/public/site-config", "/api/auth/status", "/api/login", "/api/callback"]) {
    assert.equal(kind("GET", path), "public", path);
  }
  for (const path of ["/api/tenants/register", "/API/tenants/login/", "/api/public-chat/token/messages",
    "/api/auth/agentid/login", "/api/mcp/sse"]) {
    assert.equal(kind("POST", path), "closed", path);
  }
  for (const path of ["/api/conversations", "/api/public/search", "/api/store/checkout",
    "/api/public/stripe/checkout", "/api/auth/user", "/uploads/file.pdf", "/play/token", "/v1/glasses/tools"]) {
    assert.equal(kind("GET", path), "owner", path);
  }
  assert.equal(kind("POST", "/api/auth/login"), "public");
  assert.equal(kind("POST", "/api/stripe/webhook"), "service");
  assert.equal(kind("GET", "/api/stripe/webhook"), "owner");
  assert.equal(kind("POST", "/api/stripe/webhook/extra"), "owner");
  assert.equal(kind("POST", "/api/webhooks/agentmail"), "service");
  assert.equal(kind("POST", "/mcp"), "service");
  assert.equal(kind("POST", "/token"), "service");
  assert.equal(kind("POST", "/some-new-action"), "owner");
  for (const path of ["/%61pi/conversations", "/api%2fconversations", "/api/%252e%252e/public",
    "/api/../public", "//api/conversations", "/api/%00", "/api/%zz"]) {
    assert.equal(kind("GET", path), "invalid", path);
  }
});

test("gate blocks anonymous/customer requests before handlers and fails closed on lookup errors", async () => {
  const request = {method: "POST", originalUrl: "/api/conversations", headers: {}} as any;
  for (const allowed of [false, true, "throws"]) {
    let continued = false;
    let status = 200;
    let body: any;
    const response = {
      status(code: number) {status = code; return this;},
      setHeader() {},
      json(value: unknown) {body = value; return this;},
    } as any;
    await createOwnerOnlyGate(async () => {
      if (allowed === "throws") throw new Error("private database failure");
      return allowed === true;
    }, () => true)(request, response, () => {continued = true;});
    assert.equal(continued, allowed === true);
    if (allowed !== true) {
      assert.equal(status, 403);
      assert.equal(body.code, "OWNER_ONLY");
      assert.ok(!JSON.stringify(body).includes("database failure"));
    }
  }
});
