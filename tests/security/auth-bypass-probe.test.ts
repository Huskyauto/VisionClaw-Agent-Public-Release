import { test, after } from "node:test";
import assert from "node:assert/strict";
import {
  detectAuthBypassProbe,
  getAuthBypassProbeCounts,
  _resetAuthBypassProbeCountsForTests,
  authBypassProbeMiddleware,
} from "../../server/lib/auth-bypass-detector";

// Pure-function tests — no DB, no Express boot. Force-exit after suite in
// case any transitive import opens a pool (mirrors admin-gate.test.ts pattern).
after(() => { setTimeout(() => process.exit(process.exitCode ?? 0), 50).unref(); });

function mkReq(opts: { headers?: Record<string, string>; method?: string; url?: string } = {}): any {
  return {
    headers: opts.headers || {},
    method: opts.method || "GET",
    originalUrl: opts.url || "/api/health",
    url: opts.url || "/api/health",
  };
}

// ============ NEGATIVE CASES — must NOT trip the detector ============

test("clean request: no headers, no funny path → not detected", () => {
  const r = detectAuthBypassProbe(mkReq({ url: "/api/admin/users" }));
  assert.equal(r.detected, false);
  assert.deepEqual(r.signals, []);
});

test("normal X-Forwarded-For from edge proxy (public IP) → not detected", () => {
  const r = detectAuthBypassProbe(mkReq({
    headers: { "x-forwarded-for": "203.0.113.42, 198.51.100.7" },
    url: "/api/admin/users",
  }));
  assert.equal(r.detected, false);
});

test("normal trailing-slash on a public surface → not detected", () => {
  // /uploads/foo. is fine on a public file route — only sensitive paths flag mutation
  const r = detectAuthBypassProbe(mkReq({ url: "/uploads/file..png" }));
  assert.equal(r.detected, false);
});

// ============ POSITIVE CASES — must trip the detector ============

test("X-Original-URL header (Apache mod_rewrite trick) → detected", () => {
  const r = detectAuthBypassProbe(mkReq({
    headers: { "x-original-url": "/admin/users" },
    url: "/api/health",
  }));
  assert.equal(r.detected, true);
  assert.ok(r.signals.some(s => s.includes("url-rewrite:x-original-url")));
});

test("X-Rewrite-URL header → detected", () => {
  const r = detectAuthBypassProbe(mkReq({ headers: { "x-rewrite-url": "/admin" } }));
  assert.equal(r.detected, true);
});

test("X-HTTP-Method-Override header → detected", () => {
  const r = detectAuthBypassProbe(mkReq({
    headers: { "x-http-method-override": "DELETE" },
  }));
  assert.equal(r.detected, true);
  assert.ok(r.signals.some(s => s.includes("method-override")));
});

test("X-Forwarded-For: 127.0.0.1 (localhost spoof) → detected", () => {
  const r = detectAuthBypassProbe(mkReq({
    headers: { "x-forwarded-for": "127.0.0.1" },
    url: "/api/admin/users",
  }));
  assert.equal(r.detected, true);
  assert.ok(r.signals.some(s => s.startsWith("ip-spoof:")));
});

test("X-Real-IP: ::1 (IPv6 localhost) → detected", () => {
  const r = detectAuthBypassProbe(mkReq({
    headers: { "x-real-ip": "::1" },
  }));
  assert.equal(r.detected, true);
});

test("X-Forwarded-Host: localhost → detected", () => {
  const r = detectAuthBypassProbe(mkReq({
    headers: { "x-forwarded-host": "localhost" },
  }));
  assert.equal(r.detected, true);
  assert.ok(r.signals.some(s => s.startsWith("host-spoof:")));
});

test("path mutation /api/admin..;/foo on sensitive prefix → detected + sensitive", () => {
  const r = detectAuthBypassProbe(mkReq({ url: "/api/admin..;/users" }));
  assert.equal(r.detected, true);
  assert.equal(r.sensitive, true);
  assert.ok(r.signals.some(s => s.startsWith("path-mutation:")));
});

test("path mutation /api/admin/%2e%2e/etc on sensitive prefix → detected", () => {
  const r = detectAuthBypassProbe(mkReq({ url: "/api/admin/%2e%2e/users" }));
  assert.equal(r.detected, true);
  assert.equal(r.sensitive, true);
});

test("double slash /api/admin//users on sensitive prefix → detected", () => {
  const r = detectAuthBypassProbe(mkReq({ url: "/api/admin//users" }));
  assert.equal(r.detected, true);
});

test("trusted-only tool path /api/tools/exec_sql is sensitive", () => {
  const r = detectAuthBypassProbe(mkReq({ url: "/api/tools/exec_sql/x..;y" }));
  assert.equal(r.sensitive, true);
  assert.equal(r.detected, true);
});

test("172.16.x.x (RFC1918 private range, R110.11.6 LOW#2) → detected", () => {
  const r = detectAuthBypassProbe(mkReq({
    headers: { "x-forwarded-for": "172.16.5.10" },
  }));
  assert.equal(r.detected, true);
});

test("172.32.x.x (NOT in RFC1918 range) → not detected", () => {
  const r = detectAuthBypassProbe(mkReq({
    headers: { "x-forwarded-for": "172.32.5.10" },
  }));
  assert.equal(r.detected, false);
});

test("127.0.0.1.evil.com (boundary trick, R110.11.6 LOW#1) → not detected", () => {
  const r = detectAuthBypassProbe(mkReq({
    headers: { "x-forwarded-for": "127.0.0.1.evil.com" },
  }));
  assert.equal(r.detected, false, "trailing-extension boundary must not match");
});

test("multiple signals stack: rewrite + spoof + mutation in same request", () => {
  const r = detectAuthBypassProbe(mkReq({
    headers: {
      "x-original-url": "/admin",
      "x-forwarded-for": "127.0.0.1",
      "x-http-method-override": "PUT",
    },
    url: "/api/admin..;/users",
  }));
  assert.equal(r.detected, true);
  assert.ok(r.signals.length >= 4, `expected 4+ signals, got ${r.signals.length}: ${r.signals.join("|")}`);
});

// ============ Middleware contract — never short-circuits ============

test("middleware always calls next() even on detection", () => {
  _resetAuthBypassProbeCountsForTests();
  const mw = authBypassProbeMiddleware();
  let nextCalled = false;
  const req: any = mkReq({ headers: { "x-original-url": "/admin" } });
  const res: any = {};
  mw(req, res, () => { nextCalled = true; });
  assert.equal(nextCalled, true, "next() must be called even when probe detected");
  assert.equal(req._bypassProbeFlag, true);
});

test("middleware fail-open: detector throw never breaks pipeline", () => {
  const mw = authBypassProbeMiddleware();
  let nextCalled = false;
  // Pass a req shape that will likely throw inside header iteration
  const req: any = { headers: null, method: "GET", originalUrl: "/api/admin/x" };
  const res: any = {};
  mw(req, res, () => { nextCalled = true; });
  assert.equal(nextCalled, true, "fail-open: next() must run even on detector error");
});

test("counter increments on detection (sensitive vs total)", () => {
  _resetAuthBypassProbeCountsForTests();
  const mw = authBypassProbeMiddleware();
  // 1 sensitive + 1 non-sensitive
  mw(mkReq({ headers: { "x-original-url": "/admin" }, url: "/api/admin/users" }) as any, {} as any, () => {});
  mw(mkReq({ headers: { "x-original-url": "/admin" }, url: "/api/health" }) as any, {} as any, () => {});
  const c = getAuthBypassProbeCounts();
  assert.equal(c.total, 2);
  assert.equal(c.sensitive, 1);
});
