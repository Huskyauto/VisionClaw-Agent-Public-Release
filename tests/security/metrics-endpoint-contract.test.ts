/**
 * /metrics response contract (R125+132 architect finding lock-in):
 *   - METRICS_TOKEN unset  => 404 (endpoint does not exist)
 *   - bad/missing Bearer   => 404 (NEVER 401 — a 401 confirms the endpoint exists)
 *   - good token           => 200 path exists (static assertion only; behavioral
 *     200 test would open the pg pool and hang the runner)
 *
 * Behavioral cases run the real handler via a fake app/req/res — no express
 * listener, no DB (both 404 branches return before the dynamic ../db import).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { registerMetricsEndpoint } from "../../server/routes/metrics";

type Handler = (req: any, res: any) => Promise<any> | any;

function captureHandler(): Handler {
  let handler: Handler | undefined;
  const fakeApp = {
    get(route: string, h: Handler) {
      if (route === "/metrics") handler = h;
    },
  };
  registerMetricsEndpoint(fakeApp as any);
  if (!handler) throw new Error("registerMetricsEndpoint did not register GET /metrics");
  return handler;
}

function fakeRes() {
  const state = { statusCode: 0, body: "", ended: false, contentType: "" };
  const res: any = {
    status(code: number) {
      state.statusCode = code;
      return res;
    },
    type(t: string) {
      state.contentType = t;
      return res;
    },
    send(b: string) {
      state.body = b;
      state.ended = true;
      return res;
    },
    end() {
      state.ended = true;
      return res;
    },
  };
  return { res, state };
}

test("METRICS_TOKEN unset => 404, no body", async () => {
  const prev = process.env.METRICS_TOKEN;
  delete process.env.METRICS_TOKEN;
  try {
    const handler = captureHandler();
    const { res, state } = fakeRes();
    await handler({ headers: {} }, res);
    assert.equal(state.statusCode, 404);
    assert.equal(state.ended, true);
    assert.equal(state.body, "");
  } finally {
    if (prev !== undefined) process.env.METRICS_TOKEN = prev;
  }
});

test("bad Bearer token => 404 (never 401)", async () => {
  const prev = process.env.METRICS_TOKEN;
  process.env.METRICS_TOKEN = "test-metrics-token-contract";
  try {
    const handler = captureHandler();

    for (const authorization of [
      "Bearer wrong-token",
      "Bearer ",
      "Basic dXNlcjpwYXNz",
      undefined,
    ]) {
      const { res, state } = fakeRes();
      await handler({ headers: authorization ? { authorization } : {} }, res);
      assert.equal(state.statusCode, 404, `auth=${JSON.stringify(authorization)} must 404`);
      assert.notEqual(state.statusCode, 401);
    }
  } finally {
    if (prev !== undefined) process.env.METRICS_TOKEN = prev;
    else delete process.env.METRICS_TOKEN;
  }
});

test("source contract: no 401 anywhere, timing-safe compare, 200 success path present", () => {
  const src = readFileSync(path.resolve("server/routes/metrics.ts"), "utf8");
  assert.ok(!/\b401\b/.test(src.replace(/\/\/[^\n]*/g, "")), "metrics.ts must never emit 401");
  assert.ok(src.includes("timingSafeEqual"), "token compare must be timing-safe");
  assert.ok(src.includes("status(200)"), "success path must exist");
  assert.ok(!/status\(500\)/.test(src), "scrape must never 500 (degraded counter instead)");
});

test("mount order: registerMetricsEndpoint called in routes.ts before session/CSRF setup", () => {
  const src = readFileSync(path.resolve("server/routes.ts"), "utf8");
  const mountIdx = src.indexOf("registerMetricsEndpoint(app)");
  assert.ok(mountIdx > 0, "routes.ts must mount the metrics endpoint");
  // Anchor on the actual CSRF wiring (app.use), not the import line at the top.
  const csrfIdx = src.search(/app\.use\(\s*["']\/api["']\s*,\s*csrfMiddleware/);
  if (csrfIdx > 0) {
    assert.ok(mountIdx < csrfIdx, "metrics must be mounted before CSRF middleware");
  }
});
