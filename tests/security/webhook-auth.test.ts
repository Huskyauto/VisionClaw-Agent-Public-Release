import { test, after } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { configureWebhooks, registerWebhookRoutes } from "../../server/webhooks";

after(() => { setTimeout(() => process.exit(process.exitCode ?? 0), 50).unref(); });

// Boots the webhook router on an ephemeral port and asserts that the
// /api/hooks/agent and /api/hooks/wake endpoints reject every flavor of
// missing/bogus credential. These endpoints kick off LLM work in a
// setImmediate background — a single auth bypass would let an unauthenticated
// caller drain the owner's provider budget.

function startServer(): Promise<{ url: string; close: () => Promise<void> }> {
  const app = express();
  app.use(express.json());
  registerWebhookRoutes(app);
  return new Promise((resolve) => {
    const srv = app.listen(0, "127.0.0.1", () => {
      const port = (srv.address() as any).port;
      resolve({
        url: `http://127.0.0.1:${port}`,
        close: () => new Promise<void>((r) => srv.close(() => r())),
      });
    });
  });
}

test("agent webhook: rejects with no auth header → 401", async () => {
  configureWebhooks({ enabled: true, token: "real-secret-token" });
  const { url, close } = await startServer();
  try {
    const r = await fetch(`${url}/api/hooks/agent`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message: "should never run" }),
    });
    assert.equal(r.status, 401);
  } finally { await close(); }
});

test("agent webhook: rejects bogus bearer token → 401", async () => {
  configureWebhooks({ enabled: true, token: "real-secret-token" });
  const { url, close } = await startServer();
  try {
    const r = await fetch(`${url}/api/hooks/agent`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer wrong-token" },
      body: JSON.stringify({ message: "should never run" }),
    });
    assert.equal(r.status, 401);
  } finally { await close(); }
});

test("agent webhook: rejects when disabled even with the right token → 401", async () => {
  // Defense-in-depth: if the operator turns webhooks off, no token suffices.
  configureWebhooks({ enabled: false, token: "real-secret-token" });
  const { url, close } = await startServer();
  try {
    const r = await fetch(`${url}/api/hooks/agent`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer real-secret-token" },
      body: JSON.stringify({ message: "should never run" }),
    });
    assert.equal(r.status, 401);
  } finally { await close(); }
});

test("wake webhook: rejects empty x-visionclaw-token → 401", async () => {
  configureWebhooks({ enabled: true, token: "real-secret-token" });
  const { url, close } = await startServer();
  try {
    const r = await fetch(`${url}/api/hooks/wake`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-visionclaw-token": "" },
      body: JSON.stringify({ text: "should never run" }),
    });
    assert.equal(r.status, 401);
  } finally { await close(); }
});
