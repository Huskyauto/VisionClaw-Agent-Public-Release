import { test, after } from "node:test";
import assert from "node:assert/strict";
import { isAdminRequest } from "../../server/auth";

// server/auth.ts transitively imports server/db.ts, which opens a Postgres
// pool at module load. That keeps the event loop alive after tests finish,
// so we force-exit once the suite is done.
after(() => { setTimeout(() => process.exit(process.exitCode ?? 0), 50).unref(); });

// Build a minimal Request-shaped object — we only exercise the branches
// isAdminRequest actually inspects, so a partial mock is enough.
function mkReq(opts: { headers?: Record<string, string>; settings?: any; cookies?: any } = {}): any {
  return {
    headers: opts.headers || {},
    cookies: opts.cookies || {},
    _settingsCache: opts.settings,
    get(name: string) { return this.headers[name.toLowerCase()]; },
  };
}

test("isAdminRequest: anonymous request with NO settings cache → not admin", () => {
  const req = mkReq();
  assert.equal(isAdminRequest(req), false);
});

test("isAdminRequest: anonymous request even when no PIN configured → not admin (Round 14 fix)", () => {
  // Pre-Round-14, this branch returned `tenantId === ADMIN_TENANT_ID` from a
  // header-derived tenant id, which let unauthenticated callers slip through
  // on fresh deployments. The fix removed that anonymous bypass.
  const req = mkReq({ settings: { accessPin: null } });
  assert.equal(isAdminRequest(req), false);
});

test("isAdminRequest: bogus bearer token → not admin", () => {
  const req = mkReq({ headers: { authorization: "Bearer not-a-real-session-token" } });
  assert.equal(isAdminRequest(req), false);
});

test("isAdminRequest: empty string bearer → not admin", () => {
  const req = mkReq({ headers: { authorization: "Bearer " } });
  assert.equal(isAdminRequest(req), false);
});
