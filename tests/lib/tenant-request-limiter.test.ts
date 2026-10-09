import { test } from "node:test";
import assert from "node:assert/strict";
import { createTenantRequestLimiter } from "../../server/lib/tenant-request-limiter";

function fixture() {
  let allowed = false;
  const headers = new Map<string, unknown>();
  const res = {
    statusCode: 200, body: undefined as unknown,
    setHeader(key: string, value: unknown) { headers.set(key, value); },
    status(code: number) { this.statusCode = code; return this; },
    json(body: unknown) { this.body = body; return this; },
  };
  const req = { ip: "fixture-ip", socket: {}, headers: { authorization: "Bearer fixture-session" } };
  return { req, res, headers, next: () => { allowed = true; }, allowed: () => allowed };
}

test("verified password sessions receive the existing account budget before route auth runs", async () => {
  const limiter = createTenantRequestLimiter({
    knownTenant: () => null,
    sessionTenant: async () => 731,
  });
  for (let i = 0; i < 120; i++) {
    const f = fixture();
    await limiter(f.req as any, f.res as any, f.next);
    assert.equal(f.allowed(), true, `authenticated request ${i + 1}`);
    assert.equal(f.headers.get("X-RateLimit-Limit"), 120);
    assert.equal((f.req as any).tenantId, undefined, "limiter must not grant identity");
  }
  const denied = fixture();
  await limiter(denied.req as any, denied.res as any, denied.next);
  assert.equal(denied.res.statusCode, 429);
  assert.equal(denied.allowed(), false);
});

test("invalid sessions retain the guest cap and all identity probes are bounded", async () => {
  let lookups = 0;
  const limiter = createTenantRequestLimiter({
    knownTenant: () => null, sessionTenant: async () => { lookups++; return null; },
  });
  for (let i = 0; i < 140; i++) {
    const f = fixture();
    await limiter(f.req as any, f.res as any, f.next);
    assert.equal(f.allowed(), i < 30);
  }
  assert.equal(lookups, 120);
});

test("a thrown session lookup fails closed without stamping request authority", async () => {
  const limiter = createTenantRequestLimiter({
    knownTenant: () => null, sessionTenant: async () => { throw new Error("fixture DB failure"); },
  });
  const f = fixture();
  await limiter(f.req as any, f.res as any, f.next);
  assert.equal(f.res.statusCode, 503);
  assert.equal(f.allowed(), false);
  assert.equal((f.req as any).tenantId, undefined);
});

test("API keys cannot borrow session attribution and oversized tokens never trigger lookups", async () => {
  let lookups = 0;
  const limiter = createTenantRequestLimiter({
    knownTenant: () => null, sessionTenant: async () => { lookups++; return 1; },
  });
  for (const token of ["vc_fixture", "x".repeat(257)]) {
    const f = fixture(); f.req.headers.authorization = `Bearer ${token}`;
    await limiter(f.req as any, f.res as any, f.next);
    assert.equal(f.headers.get("X-RateLimit-Limit"), 30);
  }
  assert.equal(lookups, 0);
});

test("saturated buckets fail closed and expired capacity recovers", async () => {
  let time = 0;
  const limiter = createTenantRequestLimiter({
    knownTenant: () => null, sessionTenant: async () => null,
    maxBuckets: 1, now: () => time,
  });
  const first = fixture(); first.req.headers.authorization = "";
  await limiter(first.req as any, first.res as any, first.next);
  const other = fixture(); other.req.ip = "other-ip"; other.req.headers.authorization = "";
  await limiter(other.req as any, other.res as any, other.next);
  assert.equal(other.res.statusCode, 429);
  assert.equal(other.allowed(), false);
  time = 60_001;
  const recovered = fixture(); recovered.req.ip = "other-ip"; recovered.req.headers.authorization = "";
  await limiter(recovered.req as any, recovered.res as any, recovered.next);
  assert.equal(recovered.allowed(), true);
});

test("changing IPs cannot multiply one verified account's request budget", async () => {
  const limiter = createTenantRequestLimiter({
    knownTenant: () => null, sessionTenant: async () => 731,
  });
  for (let i = 0; i <= 120; i++) {
    const f = fixture(); f.req.ip = `fixture-ip-${i % 2}`;
    await limiter(f.req as any, f.res as any, f.next);
    assert.equal(f.allowed(), i < 120);
  }
});

test("exhausting the guest budget does not misclassify a genuine session on that IP", async () => {
  const limiter = createTenantRequestLimiter({
    knownTenant: () => null, sessionTenant: async () => 731,
  });
  for (let i = 0; i <= 30; i++) {
    const f = fixture(); f.req.headers.authorization = "";
    await limiter(f.req as any, f.res as any, f.next);
    assert.equal(f.allowed(), i < 30);
  }
  const signedIn = fixture();
  await limiter(signedIn.req as any, signedIn.res as any, signedIn.next);
  assert.equal(signedIn.allowed(), true);
  assert.equal(signedIn.headers.get("X-RateLimit-Limit"), 120);
});

test("overlapping slow identity checks cannot exceed bounded lookup admission", async () => {
  let finish!: () => void;
  let calls = 0;
  const gate = new Promise<void>(resolve => { finish = resolve; });
  const limiter = createTenantRequestLimiter({
    knownTenant: () => null,
    sessionTenant: async () => { calls++; await gate; return 731; },
  });
  const pending = Array.from({ length: 120 }, () => {
    const f = fixture();
    return limiter(f.req as any, f.res as any, f.next);
  });
  const refused = fixture();
  await limiter(refused.req as any, refused.res as any, refused.next);
  assert.equal(calls, 120);
  assert.equal(refused.allowed(), false);
  assert.equal(refused.res.statusCode, 429);
  finish();
  await Promise.all(pending);
});