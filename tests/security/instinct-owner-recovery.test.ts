import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import type { Server } from "node:http";
import { createCsrfMiddleware } from "../../server/validation";
import {
  registerInstinctOwnerRecoveryRoutes,
  type InstinctOwnerRecoverySnapshot,
} from "../../server/routes/instinct-owner-recovery";

const failedAt = "2026-10-21T10:11:12.000Z";

async function withRoutes(
  identity: { tenantId: number; isAdmin: boolean },
  run: (baseUrl: string, calls: { snapshot: number; ack: unknown[] }) => Promise<void>,
  enforceCsrf = false,
) {
  const app = express();
  if (enforceCsrf) app.use("/api", createCsrfMiddleware(async () => identity.tenantId));
  app.use(express.json());
  const calls = { snapshot: 0, ack: [] as unknown[] };
  const snapshot: InstinctOwnerRecoverySnapshot = {
    thread: { conversationId: 321, updatedAt: "2026-10-21T10:00:00.000Z" },
    run: { status: "failed", reason: "timeout", failedAt },
    latestFailure: { text: "original request text", requestId: "instinct-request-17", createdAt: failedAt },
    history: [{ id: 8, role: "assistant", content: "Partial work", createdAt: failedAt }],
    outbox: [{ id: 9, message: "Private partial result", createdAt: failedAt }],
  };

  registerInstinctOwnerRecoveryRoutes(app, {
    authMiddleware: (_req, _res, next) => next(),
    getTenantFromRequestAsync: async () => identity.tenantId,
    requirePlatformAdmin: (_req, res) => {
      if (identity.tenantId !== 1 || !identity.isAdmin) {
        res.status(403).json({ error: "Platform admin access required" });
        return false;
      }
      return true;
    },
    isPlatformAdmin: () => identity.tenantId === 1 && identity.isAdmin,
    loadSnapshot: async tenantId => {
      calls.snapshot++;
      assert.equal(tenantId, 1);
      return snapshot;
    },
    acknowledge: async (ownerContext, conversationId, requestedFailedAt) => {
      calls.ack.push({ ownerContext, conversationId, failedAt: requestedFailedAt });
      return requestedFailedAt === failedAt ? "resumed" : "blocked";
    },
  });
  const server: Server = app.listen(0);
  try {
    const address = server.address();
    assert.ok(address && typeof address === "object");
    await run(`http://127.0.0.1:${address.port}`, calls);
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
}

test("mapped Instinct account 8 cannot read owner recovery data or acknowledge", async () => {
  await withRoutes({ tenantId: 8, isAdmin: false }, async (url, calls) => {
    const get = await fetch(`${url}/api/admin/instinct-recovery`);
    assert.equal(get.status, 403);
    const post = await fetch(`${url}/api/admin/instinct-recovery/acknowledge`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ acknowledge: "yes", conversationId: 321, failedAt }),
    });
    assert.equal(post.status, 403);
    assert.equal(calls.snapshot, 0);
    assert.equal(calls.ack.length, 0);
  });
});

test("authenticated platform owner reviews only saved data and acknowledgement uses trusted identity", async () => {
  await withRoutes({ tenantId: 1, isAdmin: true }, async (url, calls) => {
    const get = await fetch(`${url}/api/admin/instinct-recovery?conversationId=999&tenantId=8`);
    assert.equal(get.status, 200);
    const data = await get.json() as any;
    assert.equal(data.thread.conversationId, 321);
    assert.equal(data.latestFailure.requestId, "instinct-request-17");
    assert.deepEqual(data.history, [{ id: 8, role: "assistant", content: "Partial work", createdAt: failedAt }]);

    const post = await fetch(`${url}/api/admin/instinct-recovery/acknowledge`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        acknowledge: "yes",
        conversationId: 321,
        failedAt,
        tenantId: 8,
        isAdmin: false,
      }),
    });
    assert.equal(post.status, 200);
    assert.deepEqual(await post.json(), { result: "resumed" });
    assert.deepEqual(calls.ack, [{
      ownerContext: { tenantId: 1, isAdmin: true },
      conversationId: 321,
      failedAt,
    }]);
  });
});

test("stale failedAt conflict is surfaced and does not replay work", async () => {
  await withRoutes({ tenantId: 1, isAdmin: true }, async (url, calls) => {
    const post = await fetch(`${url}/api/admin/instinct-recovery/acknowledge`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ acknowledge: "yes", conversationId: 321, failedAt: "2026-10-21T10:11:11.000Z" }),
    });
    assert.equal(post.status, 409);
    assert.deepEqual(await post.json(), { error: "The saved failure changed or is not safe to acknowledge." });
    assert.equal(calls.ack.length, 1);
    assert.equal(calls.snapshot, 0);
  });
});

test("owner recovery acknowledgement remains behind the global CSRF middleware", async () => {
  await withRoutes({ tenantId: 1, isAdmin: true }, async (url, calls) => {
    const post = await fetch(`${url}/api/admin/instinct-recovery/acknowledge`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ acknowledge: "yes", conversationId: 321, failedAt }),
    });
    assert.equal(post.status, 403);
    assert.equal(calls.ack.length, 0);
  }, true);
});