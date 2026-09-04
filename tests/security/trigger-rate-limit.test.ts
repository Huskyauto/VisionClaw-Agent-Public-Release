import { test, after } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import rateLimit from "express-rate-limit";

after(() => { setTimeout(() => process.exit(process.exitCode ?? 0), 50).unref(); });

// Contract test for the trigger rate-limiter shape used by the
// /api/trigger/:key endpoint. The endpoint is intentionally
// unauthenticated (the 128-bit webhook key acts as the secret), so the
// limiter is the last line of defense against budget drain if a key
// ever leaks. We mirror the production limiter's config and assert
// the cap actually fires.

function startServer(): Promise<{ url: string; close: () => Promise<void> }> {
  const app = express();
  app.use(express.json());
  const limiter = rateLimit({
    windowMs: 60 * 1000,
    max: 60,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => (req.socket?.remoteAddress || "unknown"),
    message: { error: "Too many trigger requests, please slow down" },
  });
  app.post("/api/trigger/:key", limiter, (_req, res) => res.json({ ok: true }));
  return new Promise((resolve) => {
    const srv = app.listen(0, "127.0.0.1", () => {
      const port = (srv.address() as any).port;
      resolve({ url: `http://127.0.0.1:${port}`, close: () => new Promise<void>((r) => srv.close(() => r())) });
    });
  });
}

test("trigger limiter: blocks after 60 requests in a minute", async () => {
  const { url, close } = await startServer();
  try {
    // Fire 65 requests sequentially from the same source.
    let allowed = 0;
    let blocked = 0;
    for (let i = 0; i < 65; i++) {
      const r = await fetch(`${url}/api/trigger/abc`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
      if (r.status === 200) allowed++;
      else if (r.status === 429) blocked++;
    }
    assert.equal(allowed, 60, `expected exactly 60 allowed, got ${allowed}`);
    assert.equal(blocked, 5, `expected 5 blocked, got ${blocked}`);
  } finally { await close(); }
});
