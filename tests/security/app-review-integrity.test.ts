import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import { transformSync } from "esbuild";
import { PgDialect } from "drizzle-orm/pg-core";
import * as orm from "drizzle-orm";

const localRequire = createRequire(import.meta.url);
const dialect = new PgDialect();
function load(file: string, dependencies: Record<string, unknown>, suffix = "") {
  const source = (readFileSync(new URL(`../../${file}`, import.meta.url), "utf8") + suffix)
    .replace(/await import\((["'][^"']+["'])\)/g, "await Promise.resolve(require($1))");
  const module = { exports: {} as Record<string, any> };
  vm.runInNewContext(transformSync(source, { loader: "ts", format: "cjs" }).code, {
    module, exports: module.exports, Date, URL, process: { cwd: () => "/fixture" },
    console: { log() {}, warn() {}, error() {} },
    require(name: string) {
      if (Object.hasOwn(dependencies, name)) return dependencies[name];
      if (["drizzle-orm", "drizzle-orm/pg-core", "fs", "path", "zod"].includes(name)) return localRequire(name);
      throw new Error(`Unexpected dependency in isolated fixture: ${name}`);
    },
  });
  return module.exports;
}
function capturePost(register: (app: any) => void, path: string) {
  let handler: any;
  register({ post(route: string, ...handlers: any[]) { if (route === path) handler = handlers.at(-1); }, get() {} });
  assert.equal(typeof handler, "function");
  return async (body: unknown, params: Record<string, string> = {}) => {
    const result = { status: 200, body: undefined as any };
    const response: any = {
      status(code: number) { result.status = code; return response; },
      json(value: unknown) { result.body = value; return response; },
    };
    await handler({ body, params }, response);
    return result;
  };
}
const paidSession = () => ({
  id: "cs_fixture", status: "complete", payment_status: "paid", mode: "subscription",
  subscription: "sub_fixture", customer: "cus_fixture", metadata: { tenantId: "42", plan: "pro" },
});
const subscription = () => ({
  id: "sub_fixture", status: "active", customer: "cus_fixture", metadata: { tenantId: "42", plan: "pro" },
  items: { data: [{ quantity: 1, price: { unit_amount: 9900, currency: "usd", recurring: { interval: "month", interval_count: 1 } } }] },
});
function billingFixture(session = paidSession(), sub = subscription()) {
  const writes: unknown[] = [];
  const routes = load("server/routes/billing.ts", {
    "../db": { db: { async execute(query: any) { writes.push(dialect.sqlToQuery(query)); return { rows: [{ id: 42 }] }; } } },
    "../storage": { storage: { async getTenant() { return { id: 42, stripeCustomerId: "cus_fixture" }; } } },
    "../stripeClient": { async getUncachableStripeClient() {
      return { checkout: { sessions: { async retrieve() { return session; } } }, subscriptions: { async retrieve() { return sub; } } };
    } },
    "../lib/subscription-entitlement": (() => {
      try { return load("server/lib/subscription-entitlement.ts", {}); }
      catch (error: any) { if (error.code === "ENOENT") return {}; throw error; }
    })(),
  });
  const request = capturePost(app => routes.registerBillingRoutes(app, {
    getTenantFromRequest: () => 42, mutateLimiter() {},
  }), "/api/subscribe/activate");
  return { writes, request: () => request({ plan: "pro", sessionId: "cs_fixture" }) };
}

test("activation cannot replay a historically paid checkout after subscription cancellation", async () => {
  const sub = subscription();
  sub.status = "canceled";
  const fixture = billingFixture(paidSession(), sub);
  const response = await fixture.request();
  assert.equal(response.status, 402);
  assert.equal(fixture.writes.length, 0, "no entitlement write after cancellation");
});

test("activation accepts only a matching live subscription at the correct monthly price", async () => {
  const good = billingFixture();
  assert.equal((await good.request()).status, 200);
  assert.equal(good.writes.length, 1);
  const cases = [
    (s: any) => { s.status = "past_due"; },
    (s: any) => { s.customer = "cus_foreign"; },
    (s: any) => { s.metadata.tenantId = "43"; },
    (s: any) => { s.metadata.plan = "starter"; },
    (s: any) => { s.items.data[0].price.unit_amount = 1; },
    (s: any) => { s.items.data[0].price.currency = "eur"; },
    (s: any) => { s.items.data[0].price.recurring.interval_count = 12; },
    (s: any) => { s.items.data[0].quantity = 0; },
  ];
  for (const change of cases) {
    const sub = subscription();
    change(sub);
    const bad = billingFixture(paidSession(), sub);
    assert.equal((await bad.request()).status, 402);
    assert.equal(bad.writes.length, 0);
  }
});

test("force-cancel cannot change completed video jobs or remove their playback links", async () => {
  const row = { jobId: "vj_fixture123", tenantId: 42, status: "done", finalFilePath: "/private/video.mp4" };
  let predicate: any;
  const routes = load("server/routes/video-jobs.ts", {
    "../db": { db: { update() { return { set(patch: any) { return {
      where(where: any) { predicate = dialect.sqlToQuery(where); return {
        async returning() {
          if (predicate.params.includes("done")) Object.assign(row, patch);
          // Without a status predicate the old route also mutates completed rows.
          else if (!predicate.sql.includes('"status"')) Object.assign(row, patch);
          return row.status === "done" ? [] : [{ jobId: row.jobId }];
        },
      }; },
    }; } }; } } },
    "@shared/schema": { videoJobs: {
      jobId: orm.sql.raw('"job_id"'), tenantId: orm.sql.raw('"tenant_id"'), status: orm.sql.raw('"status"'),
    } },
    "../video-job-runner": { requestCancel() { throw new Error("not used"); } },
    "../upload-signing": { signVideoDownloadUrl: () => "/signed-fixture", verifyVideoDownloadSig: () => false },
    "../lib/silent-catch": { logSilentCatch() {} },
  });
  const cancel = capturePost(app => routes.registerVideoJobRoutes(app, {
    authMiddleware() {}, getTenantFromRequest: () => 42,
  }), "/api/video-jobs/:jobId/force-cancel");
  const result = await cancel({}, { jobId: row.jobId });
  assert.equal(result.status, 404);
  assert.equal(row.status, "done");
  assert.equal(routes.toClientRow(row, 42).finalWatchUrl, "/signed-fixture");
  assert.match(predicate.sql, /"status" in/);
  assert.ok(predicate.params.includes(42), "write must remain tenant scoped");
  assert.ok(!predicate.params.includes("done") && !predicate.params.includes("failed"));
});

test("memory supersession commits replacement and successor link together, or preserves the old fact", async () => {
  const { persistMemorySupersession } = load("server/storage-helpers/memory-supersession.ts", {});
  for (const failure of ["insert", "link", "none", "foreign"] as const) {
    const state = { active: true, replacement: false, successor: null as number | null };
    const queries: any[] = [];
    const db = {
      async transaction(run: (tx: any) => Promise<unknown>) {
        const before = { ...state };
        const tx = { async execute(query: any) {
          const compiled = dialect.sqlToQuery(query);
          queries.push(compiled);
          assert.ok(compiled.params.includes(42), "every query must bind tenant");
          if (compiled.sql.includes("SELECT")) return { rows: failure === "foreign" ? [] : [
            { id: 7, fact: "Original fact.", category: "preference", persona_id: 3 },
          ] };
          if (failure === "link") throw new Error("fixture link failed");
          assert.equal(state.replacement, true, "replacement must exist before status change");
          state.active = false;
          state.successor = 8;
          return { rows: [{ id: 7 }] };
        } };
        try { return await run(tx); }
        catch (error) { Object.assign(state, before); throw error; }
      },
    };
    const create = async (input: any, tx: any) => {
      assert.ok(tx);
      assert.equal(input.tenantId, 42);
      assert.equal(input.personaId, 3, "keep the owned old fact's persona");
      if (failure === "insert") throw new Error("fixture insert failed");
      state.replacement = true;
      return { id: 8 };
    };
    const operation = () => persistMemorySupersession(db, create, 7, {
      tenantId: 42, fact: "Replacement fact.", category: "preference", confidence: 0.9, source: "mcp_supersede",
    });
    if (failure === "insert" || failure === "link") {
      await assert.rejects(operation, /fixture/);
      assert.deepEqual(state, { active: true, replacement: false, successor: null });
    } else if (failure === "foreign") {
      assert.equal(await operation(), undefined);
      assert.deepEqual(state, { active: true, replacement: false, successor: null });
    } else {
      assert.equal((await operation()).id, 8);
      assert.equal(state.active, false);
      assert.equal(state.successor, 8);
      assert.match(queries[0].sql, /FOR UPDATE/);
      assert.match(queries[1].sql, /succeeded_by_id/);
      assert.match(queries[1].sql, /valid_until/);
    }
  }
});

test("both subscription webhook paths reject a canceled live subscription before upgrading", async () => {
  let writes = 0;
  const sub = subscription();
  sub.status = "canceled";
  const hooks = load("server/webhookHandlers.ts", {
    "./stripeClient": {
      getStripeSync() {},
      async getUncachableStripeClient() { return { subscriptions: { async retrieve() { return sub; } } }; },
    },
    "./delivery-pipeline": {},
    "./storage": { storage: { async getTenant() { return { stripeCustomerId: "cus_fixture" }; } } },
    "./db": { db: { async execute() { writes++; return { rows: [] }; } } },
    "./email-notifications": { async sendPlanUpgradeEmail() { throw new Error("must not notify"); } },
    "./webhook-dedupe": {},
    "./lib/subscription-entitlement": load("server/lib/subscription-entitlement.ts", {}),
  });
  await hooks.WebhookHandlers.handleSubscriptionActivation(paidSession());
  await hooks.WebhookHandlers.handleSubscriptionUpdated({ ...subscription(), status: "active" });
  assert.equal(writes, 0);
});

test("MCP memory supersede waits for durable storage and catalog uses the real active column", async () => {
  const tools = new Map<string, any>();
  let writeOutcome = "ok";
  let writes = 0;
  let query = "";
  const routes = load("server/routes/mcp-server.ts", {
    "@modelcontextprotocol/sdk/server/mcp.js": { McpServer: class {
      registerTool(name: string, _schema: unknown, handler: any) { tools.set(name, handler); }
    } },
    "@modelcontextprotocol/sdk/server/streamableHttp.js": {},
    "../db": { db: { async execute(q: any) {
      query = dialect.sqlToQuery(q).sql;
      return { rows: [{ id: 7, category: "preference", persona_id: 3 }] };
    } } },
    "../lib/scheduled-post-runner": {}, "../lib/mcp-api-keys": {}, "../lib/output-skills": {},
    "../lib/mcp-project-briefs": {}, "../validation": {}, "../felix-connector/routes": {},
    "../lib/memory-queue": { getMemoryQueueConfig: () => ({ confidenceThreshold: 0.7 }) },
    "../lib/quality-score": { computeQualityScore: () => ({ score: 0.8 }) },
    "../storage": { storage: { async supersedeMemoryEntry(id: number, data: any) {
      writes++;
      assert.equal(id, 7);
      assert.equal(data.tenantId, 42);
      if (writeOutcome === "failed") throw new Error("fixture commit failure");
      return { id: 8 };
    } } },
  }, "\nexport { buildMcpServer };");
  routes.buildMcpServer({ tenantId: 42, keyId: 99, scopes: ["catalog:read", "memory:write"] });
  await tools.get("list_personas")({});
  assert.match(query, /WHERE is_active = TRUE/);
  const call = async (confidence: number) => JSON.parse((await tools.get("memory_supersede")({
    oldId: 7, newFact: "A replacement fact.", confidence,
  })).content[0].text);
  assert.equal((await call(0.1)).ok, false);
  assert.equal(writes, 0);
  writeOutcome = "failed";
  assert.equal((await call(0.9)).ok, false);
  writeOutcome = "ok";
  const result = await call(0.9);
  assert.equal(result.ok, true);
  assert.equal(result.newFactPersisted, true);
  assert.equal(result.replacementId, 8);
  assert.equal(result.newFactEnqueued, undefined, "never label volatile queue acceptance as completion");
});
