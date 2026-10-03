import assert from "node:assert/strict";
import test from "node:test";
import { registerLoopPortfolioRoutes } from "../../server/routes/loop-portfolio";
import type { LoopPortfolioQueryable } from "../../server/lib/loop-portfolio-store";

class FakeDb implements LoopPortfolioQueryable {
  calls: Array<{ text: string; values?: readonly unknown[] }> = [];
  responses: Array<{ rows: any[] }> = [];
  async query(text: string, values?: readonly unknown[]) {
    this.calls.push({ text, values });
    return this.responses.shift() ?? { rows: [] };
  }
}

function harness(input: { tenantId: number | null; admin: boolean; db: FakeDb }) {
  const routes: Record<string, any[]> = {};
  const app = {
    get(path: string, ...handlers: any[]) { routes[`GET ${path}`] = handlers; },
    post(path: string, ...handlers: any[]) { routes[`POST ${path}`] = handlers; },
  };
  registerLoopPortfolioRoutes(app as any, {
    authMiddleware: (_req: any, _res: any, next: any) => next(),
    mutateLimiter: (_req: any, _res: any, next: any) => next(),
    getTenantFromRequest: () => input.tenantId,
    isAdminRequest: () => input.admin,
    ADMIN_TENANT_ID: 1,
    db: input.db,
  });
  return routes;
}

function response() {
  return {
    statusCode: 200,
    body: null as any,
    status(code: number) { this.statusCode = code; return this; },
    json(body: any) { this.body = body; return this; },
  };
}

test("loop portfolio report rejects a non-admin without reading the database", async () => {
  const db = new FakeDb();
  const routes = harness({ tenantId: 2, admin: false, db });
  const res = response();
  await routes["GET /api/admin/loop-portfolio"].at(-1)({ query: {} }, res);
  assert.equal(res.statusCode, 403);
  assert.equal(db.calls.length, 0);
});

test("loop portfolio report derives the database tenant from authenticated context", async () => {
  const db = new FakeDb();
  db.responses.push({ rows: [] }, { rows: [] });
  const routes = harness({ tenantId: 1, admin: true, db });
  const res = response();
  await routes["GET /api/admin/loop-portfolio"].at(-1)({ query: { limit: "10" } }, res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(db.calls[0].values, [1, 10]);
  assert.deepEqual(db.calls[1].values, [1, 10, []]);
});

test("Dream replay rejects the exact-off flag before any database read", async () => {
  const previous = process.env.DREAM_RSI_REPORT_ONLY_ENABLED;
  process.env.DREAM_RSI_REPORT_ONLY_ENABLED = "true";
  try {
    const db = new FakeDb();
    const routes = harness({ tenantId: 1, admin: true, db });
    const res = response();
    await routes["POST /api/admin/loop-portfolio/dream-replay"].at(-1)(
      { body: { programId: 1 } },
      res,
    );
    assert.equal(res.statusCode, 409);
    assert.equal(db.calls.length, 0);
  } finally {
    if (previous === undefined) delete process.env.DREAM_RSI_REPORT_ONLY_ENABLED;
    else process.env.DREAM_RSI_REPORT_ONLY_ENABLED = previous;
  }
});

test("Dream replay persists a known safety regression even with incomplete safety coverage", async () => {
  const previous = process.env.DREAM_RSI_REPORT_ONLY_ENABLED;
  process.env.DREAM_RSI_REPORT_ONLY_ENABLED = "1";
  try {
    const db = new FakeDb();
    db.responses.push(
      {
        rows: [
          {
            id: 1,
            parent_experiment_id: null,
            hypothesis: "first",
            approach: "fixed",
            metric_value: "8",
            verification_status: "verified",
            verification_details: "independent_evaluator safety_failed",
          },
          {
            id: 2,
            parent_experiment_id: null,
            hypothesis: "second",
            approach: "fixed",
            metric_value: "7",
            verification_status: "verified",
            verification_details: "independent_evaluator",
          },
        ],
      },
      { rows: [{ id: 10 }] },
      { rows: [{ id: 11 }] },
      { rows: [{ id: 12 }] },
      { rows: [{ id: 20 }] },
      { rows: [{ id: 21 }] },
    );
    const routes = harness({ tenantId: 1, admin: true, db });
    const res = response();
    await routes["POST /api/admin/loop-portfolio/dream-replay"].at(-1)(
      { body: { programId: 1, maxRounds: 2, batchSize: 2 } },
      res,
    );
    assert.equal(res.statusCode, 200);
    const outcomeInserts = db.calls.filter((call) =>
      call.text.includes("INSERT INTO loop_outcome_events"),
    );
    assert.equal(outcomeInserts.length, 3);
    for (const call of outcomeInserts) {
      assert.equal(call.values?.[11], false, "aggregate records the known safety failure");
      assert.equal(call.values?.[12], true, "known regression counts as evaluated safety");
      assert.equal(call.values?.[13], true, "quality evidence remains independently evaluated");
    }
  } finally {
    if (previous === undefined) delete process.env.DREAM_RSI_REPORT_ONLY_ENABLED;
    else process.env.DREAM_RSI_REPORT_ONLY_ENABLED = previous;
  }
});