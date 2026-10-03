import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import express from "express";
import { calculateHvacOpportunity, hvacWorkspaceRequestSchema } from "../server/lib/hvac-missed-call-recovery";
import { registerAdminHvacMissedCallRoutes } from "../server/routes/admin-hvac-missed-call";

const requestBody = {
  idempotencyKey: "hvac-12345678",
  prospectName: "Maria",
  companyName: "Lopez Air",
  trade: "hvac" as const,
  intake: { contactRole: "owner" },
  assumptions: {
    monthlyInboundCalls: 100,
    missedCallRatePercent: 25,
    bookingRatePercent: 20,
    averageJobValueUsd: 1000,
  },
  status: "discovery" as const,
  readiness: {},
};

const persistedRow = {
  id: 7,
  tenant_id: 41,
  idempotency_key: requestBody.idempotencyKey,
  prospect_name: requestBody.prospectName,
  company_name: requestBody.companyName,
  trade: requestBody.trade,
  intake: requestBody.intake,
  assumptions: requestBody.assumptions,
  estimate: calculateHvacOpportunity(requestBody.assumptions),
  status: requestBody.status,
  readiness: requestBody.readiness,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
};

async function withRoute(
  options: {
    tenantId?: number | null;
    admin?: boolean;
    execute: (query: unknown) => Promise<{ rows: any[] }>;
  },
  run: (baseUrl: string) => Promise<void>,
) {
  const app = express();
  app.use(express.json());
  registerAdminHvacMissedCallRoutes(app, {
    authMiddleware: (_req: unknown, _res: unknown, next: () => void) => next(),
    getTenantFromRequest: () => options.tenantId ?? null,
    isAdminRequest: () => options.admin ?? false,
    execute: options.execute as any,
  });
  const server = app.listen(0);
  try {
    const address = server.address();
    assert.ok(address && typeof address === "object");
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
}

test("calculator clamps non-finite and out-of-range assumptions", () => {
  const result = calculateHvacOpportunity({ monthlyInboundCalls: Infinity, missedCallRatePercent: -4, bookingRatePercent: 120, averageJobValueUsd: NaN });
  assert.equal(result.monthlyInboundCalls, 0);
  assert.equal(result.missedCallRatePercent, 0);
  assert.equal(result.bookingRatePercent, 100);
  assert.equal(result.averageJobValueUsd, 0);
  assert.equal(result.disclaimer, "estimate_only_not_verified_revenue");
});

test("request shape rejects unknown fields and excessive intake keys", () => {
  const valid = { idempotencyKey: "workspace-123", prospectName: "A", companyName: "B", trade: "hvac" as const,
    intake: { contactRole: "owner" }, assumptions: { monthlyInboundCalls: 10, missedCallRatePercent: 20, bookingRatePercent: 10, averageJobValueUsd: 100 },
    status: "discovery" as const, readiness: {} };
  assert.equal(hvacWorkspaceRequestSchema.safeParse(valid).success, true);
  assert.equal(hvacWorkspaceRequestSchema.safeParse({ ...valid, unexpected: true }).success, false);
  assert.equal(hvacWorkspaceRequestSchema.safeParse({ ...valid, intake: { unknown: "no" } }).success, false);
});

test("route contract is tenant scoped, idempotent, kill-switchable, and side-effect free", () => {
  const source = fs.readFileSync(new URL("../server/routes/admin-hvac-missed-call.ts", import.meta.url), "utf8");
  assert.match(source, /tenant_id=\$\{tenantId\}/);
  assert.match(source, /WHERE id=\$\{id\} AND tenant_id=\$\{tenantId\}/);
  assert.match(source, /reused: true/);
  assert.match(source, /status\(409\)/);
  assert.match(source, /HVAC_MISSED_CALL_PRODUCT_ENABLED/);
  assert.doesNotMatch(source, /\b(fetch|sendMail|sendSms|stripe|twilio|call\()\b/i);
});

test("route refuses non-admin access before touching persistence", async () => {
  let executed = false;
  await withRoute({
    tenantId: 41,
    admin: false,
    execute: async () => {
      executed = true;
      return { rows: [] };
    },
  }, async baseUrl => {
    const response = await fetch(`${baseUrl}/api/admin/missed-call-recovery/workspaces`);
    assert.equal(response.status, 403);
  });
  assert.equal(executed, false);
});

test("route returns an exact idempotent retry and rejects a changed payload", async () => {
  await withRoute({
    tenantId: 41,
    admin: true,
    execute: async () => ({ rows: [persistedRow] }),
  }, async baseUrl => {
    const exact = await fetch(`${baseUrl}/api/admin/missed-call-recovery/workspaces`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(requestBody),
    });
    assert.equal(exact.status, 200);
    assert.equal((await exact.json()).reused, true);

    const changed = await fetch(`${baseUrl}/api/admin/missed-call-recovery/workspaces`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ...requestBody,
        assumptions: { ...requestBody.assumptions, averageJobValueUsd: 2500 },
      }),
    });
    assert.equal(changed.status, 409);
  });
});

test("route reconciles the durable winner of a concurrent create race", async () => {
  const results = [[], [], [persistedRow]];
  await withRoute({
    tenantId: 41,
    admin: true,
    execute: async () => ({ rows: results.shift() || [] }),
  }, async baseUrl => {
    const response = await fetch(`${baseUrl}/api/admin/missed-call-recovery/workspaces`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(requestBody),
    });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).reused, true);
  });
  assert.equal(results.length, 0);
});

test("tenant-scoped update returns not found instead of exposing another tenant's row", async () => {
  await withRoute({
    tenantId: 99,
    admin: true,
    execute: async () => ({ rows: [] }),
  }, async baseUrl => {
    const response = await fetch(`${baseUrl}/api/admin/missed-call-recovery/workspaces/7`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status: "proposal" }),
    });
    assert.equal(response.status, 404);
  });
});

test("route fails closed when disabled", async () => {
  const previous = process.env.HVAC_MISSED_CALL_PRODUCT_ENABLED;
  process.env.HVAC_MISSED_CALL_PRODUCT_ENABLED = "0";
  try {
    await withRoute({
      tenantId: 41,
      admin: true,
      execute: async () => {
        throw new Error("disabled route must not query");
      },
    }, async baseUrl => {
      const response = await fetch(`${baseUrl}/api/admin/missed-call-recovery/workspaces`);
      assert.equal(response.status, 404);
    });
  } finally {
    if (previous === undefined) delete process.env.HVAC_MISSED_CALL_PRODUCT_ENABLED;
    else process.env.HVAC_MISSED_CALL_PRODUCT_ENABLED = previous;
  }
});