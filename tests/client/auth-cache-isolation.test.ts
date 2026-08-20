import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import {
  apiRequest,
  getAuthHeaders,
  queryClient,
  setAuthToken,
} from "../../client/src/lib/queryClient";
import { beginAuthIdentityRequest, transitionTenantIdentity } from "../../client/src/lib/auth";
import { QueryObserver } from "@tanstack/react-query";

const authSource = fs.readFileSync(path.resolve("client/src/lib/auth.tsx"), "utf8");

test("identity transition atomically removes tenant-owned data and replaces the request credential", async () => {
  setAuthToken("tenant-a-token");
  queryClient.setQueryData(["/api/conversations"], [{ id: 41, tenantId: 41 }]);
  queryClient.setQueryData(["/api/tenants/me"], { id: 41, name: "Tenant A" });

  await transitionTenantIdentity("tenant-b-token");

  assert.equal(queryClient.getQueryData(["/api/conversations"]), undefined);
  assert.equal(queryClient.getQueryData(["/api/tenants/me"]), undefined);
  assert.deepEqual(getAuthHeaders(), { Authorization: "Bearer tenant-b-token" });
});

test("every auth identity transition clears stale data before exposing the new principal", () => {
  const calls = authSource.match(/await transitionTenantIdentity\(/g) || [];
  assert.ok(
    calls.length >= 6,
    "custom login/register/logout plus Replit-auth and expired-session paths must transition atomically",
  );
  assert.match(
    fs.readFileSync(path.resolve("client/src/lib/queryClient.ts"), "utf8"),
    /async \(\{ queryKey, signal \}\)[\s\S]*signal,/,
    "query functions must accept React Query's abort signal so old-tenant requests cannot repopulate the cache",
  );
});

test("Replit authentication clears the prior identity before setting tenant state", () => {
  const replitBlockStart = authSource.indexOf("if (data && data.id) {");
  const replitBlockEnd = authSource.indexOf("return true;", replitBlockStart);
  const replitBlock = authSource.slice(replitBlockStart, replitBlockEnd);

  assert.ok(replitBlockStart >= 0 && replitBlockEnd > replitBlockStart);
  assert.ok(
    replitBlock.indexOf("await transitionTenantIdentity(null);") <
      replitBlock.indexOf("setTenant(data.tenant);"),
    "Replit tenant state must not be exposed before old requests/cache are cleared",
  );
});

test("a canceled custom query cannot repopulate the next tenant cache when it ignores abort", async () => {
  let resolveOldQuery!: (value: { tenant: string }) => void;
  const observer = new QueryObserver(queryClient, {
    queryKey: ["identity-bound-custom-query"],
    queryFn: () => new Promise<{ tenant: string }>((resolve) => {
      resolveOldQuery = resolve;
    }),
  });
  const unsubscribe = observer.subscribe(() => {});
  void observer.refetch();
  await new Promise((resolve) => setTimeout(resolve, 0));

  await transitionTenantIdentity("tenant-b-token");
  resolveOldQuery({ tenant: "tenant-a" });
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(queryClient.getQueryData(["identity-bound-custom-query"]), undefined);
  assert.equal(observer.getCurrentResult().data, undefined);
  unsubscribe();
});

test("a CSRF bootstrap from the prior identity cannot send a stale mutation", async () => {
  const originalFetch = globalThis.fetch;
  let resolveCsrf!: (response: Response) => void;
  let protectedRequestCount = 0;
  globalThis.fetch = ((input: RequestInfo | URL) => {
    if (String(input).includes("/api/auth/csrf-token")) {
      return new Promise<Response>((resolve) => {
        resolveCsrf = resolve;
      });
    }
    protectedRequestCount++;
    return Promise.resolve(new Response("ok", { status: 200 }));
  }) as typeof fetch;

  try {
    setAuthToken("tenant-a-token");
    const request = apiRequest("POST", "/api/protected", { action: "save" });
    await new Promise((resolve) => setTimeout(resolve, 0));

    setAuthToken("tenant-b-token");
    resolveCsrf(new Response(JSON.stringify({ csrfToken: "tenant-a-csrf" }), { status: 200 }));

    await assert.rejects(request, /Authentication identity changed/);
    assert.equal(protectedRequestCount, 0);
  } finally {
    globalThis.fetch = originalFetch;
    setAuthToken(null);
  }
});

test("a delayed platform retry cannot replay a prior tenant mutation after identity change", async () => {
  const originalFetch = globalThis.fetch;
  let protectedRequestCount = 0;
  globalThis.fetch = ((input: RequestInfo | URL) => {
    if (String(input).includes("/api/auth/csrf-token")) {
      return Promise.resolve(new Response(JSON.stringify({ csrfToken: "tenant-a-csrf" }), { status: 200 }));
    }
    protectedRequestCount++;
    return Promise.resolve(new Response("temporary edge failure", { status: 503 }));
  }) as typeof fetch;

  try {
    setAuthToken("tenant-a-token");
    const request = apiRequest("POST", "/api/protected", { action: "save" });
    await new Promise((resolve) => setTimeout(resolve, 20));

    setAuthToken("tenant-b-token");

    await assert.rejects(request, /Authentication identity changed/);
    assert.equal(protectedRequestCount, 1, "identity change must stop the retry before a second request is sent");
  } finally {
    globalThis.fetch = originalFetch;
    setAuthToken(null);
  }
});

test("an in-flight raw AuthProvider identity lookup is aborted and invalidated on transition", async () => {
  const pendingLookup = beginAuthIdentityRequest();
  await transitionTenantIdentity(null);

  assert.equal(pendingLookup.signal.aborted, true);
  assert.equal(pendingLookup.isCurrent(), false);
});

test("AuthProvider only applies raw tenant identity responses while their request remains current", () => {
  const tenantFetchStart = authSource.indexOf("const fetchTenantInfo");
  const tenantFetchEnd = authSource.indexOf("const checkReplitAuth", tenantFetchStart);
  const tenantFetch = authSource.slice(tenantFetchStart, tenantFetchEnd);

  assert.match(tenantFetch, /signal: request\.signal/);
  assert.ok(
    tenantFetch.indexOf("if (!request.isCurrent()) return;") <
      tenantFetch.indexOf("setTenant(data);"),
    "tenant state must not be updated from a stale raw auth fetch",
  );
});

test("a null-to-null Replit session transition invalidates delayed direct API responses", async () => {
  const originalFetch = globalThis.fetch;
  let resolveResponse!: (response: Response) => void;
  globalThis.fetch = (() => new Promise<Response>((resolve) => {
    resolveResponse = resolve;
  })) as typeof fetch;

  try {
    setAuthToken(null);
    const request = apiRequest("GET", "/api/replit-session-bound");
    await new Promise((resolve) => setTimeout(resolve, 0));

    await transitionTenantIdentity(null);
    resolveResponse(new Response(JSON.stringify({ tenant: "prior-cookie-session" }), { status: 200 }));

    await assert.rejects(request, /Authentication identity changed/);
  } finally {
    globalThis.fetch = originalFetch;
    setAuthToken(null);
  }
});

test("a redundant same-token synchronization does not invalidate a valid direct request", async () => {
  const originalFetch = globalThis.fetch;
  let resolveResponse!: (response: Response) => void;
  globalThis.fetch = (() => new Promise<Response>((resolve) => {
    resolveResponse = resolve;
  })) as typeof fetch;

  try {
    setAuthToken("same-identity-token");
    const request = apiRequest("GET", "/api/still-current");
    await new Promise((resolve) => setTimeout(resolve, 0));

    setAuthToken("same-identity-token");
    resolveResponse(new Response(JSON.stringify({ ok: true }), { status: 200 }));

    assert.equal((await request).ok, true);
  } finally {
    globalThis.fetch = originalFetch;
    setAuthToken(null);
  }
});