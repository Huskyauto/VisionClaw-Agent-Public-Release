import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import { createRequire } from "node:module";
import { build } from "esbuild";
import { PgDialect } from "drizzle-orm/pg-core";

/** Execute the real adapter with every DB/credential/global-weight dependency replaced. */
async function fixture() {
  const dialect = new PgDialect();
  const queries: { sql: string; params: unknown[] }[] = [];
  const state = {
    weightReads: 0, fail: false, malformed: false,
    query: async (query: Parameters<PgDialect["sqlToQuery"]>[0]) => {
      const q = dialect.sqlToQuery(query);
      queries.push(q);
      if (state.fail) throw new Error("fixture database unavailable");
      if (q.sql.includes("heartbeat_logs")) return { rows: [{ name: "Revenue Mission Opportunity Scan (weekly)",
        status: "success", created_at: new Date("2026-11-09T14:00:00Z"), output: "no proposal: portfolio at capacity" }] };
      if (q.sql.includes("FROM notifications")) return { rows: [] };
      if (q.sql.includes("FROM projects") && q.sql.includes("'wedge'")) return { rows: [] };
      if (q.sql.includes("count(*)")) return { rows: [{ count: 5 }] };
      if (q.sql.includes("LEFT JOIN projects")) return { rows: [{
        id: 463, created_at: new Date("2026-11-09T13:17:00Z"),
        metadata: { expectedProfitUsd: state.malformed ? "guessed" : 1200, successProbabilityPct: 28, roi: 4.69 },
        winner: "Current fixture winner",
        winner_metadata: { priority: { evidence_confidence: "Low" }, weeklyScenario: { verdict: "Skip", date: "2026-11-09" } },
      }] };
      throw new Error(`Unexpected fixture query: ${q.sql}`);
    },
  };
  const mocks: Record<string, string> = {
    "server/db": "export const db = { execute: q => fixtureState.query(q) };",
    "server/agentic/autonomous-budget": "export const ownerTenantId = () => 1;",
    "server/lib/bwb-weight": "export const getBwbWeight = async () => { fixtureState.weightReads++; return {}; };",
    "server/lib/owner-email": "export const resolveOwnerEmail = () => 'owner@example.test';",
    // The real query-free bounce guard is covered by owner-comms-batch.test.ts.
    "server/lib/outbound-email-preflight": "export const assertEmailRecipientsDeliverable = () => {};",
  };
  const bundle = await build({
    entryPoints: ["server/owner-comms-batch.ts"], bundle: true, write: false,
    platform: "node", format: "cjs", packages: "external",
    plugins: [{
      name: "offline-owner-sources",
      setup(b) {
        b.onResolve({ filter: /^\./ }, args => {
          const key = path.relative(process.cwd(), path.resolve(args.resolveDir, args.path)).replace(/\.ts$/, "");
          if (mocks[key]) return { path: key, namespace: "fixture" };
        });
        b.onLoad({ filter: /.*/, namespace: "fixture" }, args => ({ contents: mocks[args.path], loader: "js" }));
      },
    }],
  });
  const module = { exports: {} as { loadOwnerCommsEvidence: (tenant: number, at: Date) => Promise<unknown>;
    buildOwnerCommsBatch: (job: unknown, at: Date) => Promise<{ text: string }> } };
  new Function("require", "module", "exports", "fixtureState", bundle.outputFiles[0].text)(
    createRequire(import.meta.url), module, module.exports, state);
  return { api: module.exports, state, queries };
}

const at = new Date("2026-11-09T19:00:00Z");
test("real loader scopes all five queries and the winner join; wrong tenants fail before global/private reads", async () => {
  const f = await fixture();
  await assert.rejects(f.api.loadOwnerCommsEvidence(2, at), /owner tenant/i);
  assert.equal(f.state.weightReads, 0);
  assert.equal(f.queries.length, 0);
  const batch = await f.api.buildOwnerCommsBatch({
    id: 2612, tenantId: 1, title: "Owner Communications Batch (Monday 13:00)", source: "cron_scheduler", expandViaPersona: "6",
  }, at);
  assert.match(batch.text, /Current fixture winner/);
  assert.equal(f.queries.length, 5);
  for (const q of f.queries) {
    assert.match(q.sql, /tenant_id\s*=\s*\$\d+/);
    assert.ok(q.params.includes(1));
    assert.ok(q.params.every(p => !Array.isArray(p)), "job names must be individually bound, not malformed Drizzle arrays");
  }
  const weekly = f.queries.find(q => q.sql.includes("LEFT JOIN"))!;
  assert.match(weekly.sql, /w\.tenant_id=r\.tenant_id/);
  assert.ok(weekly.params.includes("2026-11-09"));
});

test("real adapter never turns source failures or malformed report metrics into a successful batch", async () => {
  const f = await fixture();
  f.state.fail = true;
  await assert.rejects(f.api.loadOwnerCommsEvidence(1, at), /database unavailable/);
  f.state.fail = false;
  f.state.malformed = true;
  await assert.rejects(f.api.loadOwnerCommsEvidence(1, at), /invalid numeric evidence/);
});
