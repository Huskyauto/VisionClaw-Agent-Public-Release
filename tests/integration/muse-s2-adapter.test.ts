import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import crypto from "node:crypto";
import { db, pool } from "../../server/db";
import { sql } from "drizzle-orm";
import { authMiddleware, getTenantFromRequest } from "../../server/auth";
import { registerApiV1Routes } from "../../server/routes/api-v1";

const runTag = `s2-${Date.now().toString(36)}`;
const rows = (r: any) => (r?.rows || r || []) as any[];
let server: any;
let tenantA = 0;
let tenantB = 0;
let keyA = "", keyB = "", keyAId = 0;
let sourceGood = 0, sourceOtherKey = 0, sourceIncomplete = 0, sourceLive = 0, sourceOtherTenant = 0;
const mission = {
  name: "Bounded setup", hypothesis: "Local firms pay", idealCustomer: "Owners",
  painStatement: "Slow leads", offer: "One workflow", priceUsd: 500,
  acquisitionChannel: "email", successCriteria: "Intent", killCriteria: "No fit",
};
const body = (sourceRunId: number, extra: any = {}) => ({ sourceRunId, mission, ...extra });

async function makeTenant(suffix: string) {
  return Number(rows(await db.execute(sql`
    INSERT INTO tenants (email, name, plan) VALUES (${`${runTag}-${suffix}@test.invalid`}, ${suffix}, 'trial') RETURNING id
  `))[0].id);
}
async function makeKey(tenantId: number, scopes: string[], suffix: string) {
  const raw = `vc_${runTag}_${suffix}_${crypto.randomBytes(8).toString("hex")}`;
  const pgScopes = `{${scopes.join(",")}}`;
  const id = Number(rows(await db.execute(sql`
    INSERT INTO api_keys (tenant_id, name, key_hash, key_prefix, scopes)
    VALUES (${tenantId}, ${suffix}, ${crypto.createHash("sha256").update(raw).digest("hex")}, ${raw.slice(0, 12)}, ${pgScopes}::text[])
    RETURNING id
  `))[0].id);
  return { raw, id };
}
async function makeRun(tenantId: number, apiId: number, status: string, dryRun: boolean) {
  return Number(rows(await db.execute(sql`
    INSERT INTO agent_runs (tenant_id, run_type, goal, status, state, steps)
    VALUES (${tenantId}, 'muse_revenue_dry_run', 'S2 test', ${status},
      ${JSON.stringify({ apiKeyId: apiId, dryRun })}::jsonb, '[]'::jsonb) RETURNING id
  `))[0].id);
}
async function request(path: string, method: string, token: string, payload?: any) {
  return fetch(`http://127.0.0.1:${server.address().port}${path}`, {
    method, headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: payload === undefined ? undefined : JSON.stringify(payload),
  });
}

before(async () => {
  tenantA = await makeTenant("a"); tenantB = await makeTenant("b");
  const a = await makeKey(tenantA, ["chat"], "chat");
  keyA = a.raw; keyAId = a.id;
  keyB = (await makeKey(tenantB, ["chat"], "other")).raw;
  sourceGood = await makeRun(tenantA, keyAId, "completed", true);
  sourceOtherKey = await makeRun(tenantA, keyAId + 999999, "completed", true);
  sourceIncomplete = await makeRun(tenantA, keyAId, "running", true);
  sourceLive = await makeRun(tenantA, keyAId, "completed", false);
  sourceOtherTenant = await makeRun(tenantB, (await makeKey(tenantB, ["chat"], "source")).id, "completed", true);
  const app = express();
  app.use(express.json());
  registerApiV1Routes(app, { authMiddleware, getTenantFromRequest });
  server = await new Promise<any>((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  process.env.MUSE_REVENUE_ORCHESTRATOR_ENABLED = "1";
});

after(async () => {
  try {
    if (tenantA) {
      await db.execute(sql`DELETE FROM revenue_orchestrator_mission_links WHERE tenant_id IN (${tenantA}, ${tenantB})`);
      await db.execute(sql`DELETE FROM revenue_missions WHERE tenant_id IN (${tenantA}, ${tenantB})`);
      await db.execute(sql`DELETE FROM agent_runs WHERE tenant_id IN (${tenantA}, ${tenantB})`);
      await db.execute(sql`DELETE FROM api_keys WHERE tenant_id IN (${tenantA}, ${tenantB})`);
      await db.execute(sql`DELETE FROM tenants WHERE id IN (${tenantA}, ${tenantB})`);
    }
  } finally {
    await new Promise<void>((resolve) => server?.close(() => resolve()));
    await pool.end().catch(() => {});
  }
});

test("S2 adapter integration covers authorization, normalization, isolation, conflicts, concurrency and no side effects", async () => {
  const readKey = (await makeKey(tenantA, ["read"], "read")).raw;
  assert.equal((await request("/api/v1/revenue-orchestrator/missions", "POST", readKey, body(sourceGood))).status, 403);
  assert.equal((await request(`/api/v1/revenue-orchestrator/missions/${sourceGood}`, "GET", readKey)).status, 404);
  assert.equal((await request(`/api/v1/revenue-orchestrator/missions/${sourceGood}`, "GET", keyA)).status, 404);
  process.env.MUSE_REVENUE_ORCHESTRATOR_ENABLED = "0";
  assert.equal((await request("/api/v1/revenue-orchestrator/missions", "POST", keyA, body(sourceGood))).status, 503);
  process.env.MUSE_REVENUE_ORCHESTRATOR_ENABLED = "1";

  for (const id of [999999999, sourceOtherKey, sourceOtherTenant]) assert.equal((await request("/api/v1/revenue-orchestrator/missions", "POST", keyA, body(id))).status, 404);
  for (const id of [sourceIncomplete, sourceLive]) assert.equal((await request("/api/v1/revenue-orchestrator/missions", "POST", keyA, body(id))).status, 422);
  for (const [key, value] of [["maxCashAtRiskUsd", 26], ["maxProspects", 26], ["maxContactsPerProspect", 4]]) {
    assert.equal((await request("/api/v1/revenue-orchestrator/missions", "POST", keyA, body(sourceGood, { caps: { [key]: value } }))).status, 422);
  }

  const trust = body(sourceGood, {
    mission: { ...mission, stage: "scale_ready", autonomyLevel: 6, tenantId: tenantB, unknown: "ignored" },
    stage: "scale_ready",
    autonomyLevel: 6,
    tenantId: tenantB,
    unknown: "ignored",
  });
  const first = await request("/api/v1/revenue-orchestrator/missions", "POST", keyA, trust);
  assert.equal(first.status, 201);
  const created = await first.json() as any;
  assert.equal(created.stage, "hypothesis");
  assert.equal("apiKeyId" in created, false);
  const getChat = await request(`/api/v1/revenue-orchestrator/missions/${created.missionId}`, "GET", keyA);
  assert.equal(getChat.status, 200);
  const getChatBody = await getChat.json() as any;
  assert.equal("apiKeyId" in getChatBody, false);
  assert.equal(getChatBody.notes, `[s2-adapter run:${sourceGood}]`);
  assert.equal(Number(getChatBody.tenant_id), tenantA);
  assert.equal(Number(getChatBody.autonomy_level), 0);
  assert.equal(getChatBody.stage, "hypothesis");
  const get = await request(`/api/v1/revenue-orchestrator/missions/${created.missionId}`, "GET", readKey);
  assert.equal(get.status, 404); // creator-key scoping is intentional
  const replay = await request("/api/v1/revenue-orchestrator/missions", "POST", keyA, body(sourceGood, { caps: { maxCashAtRiskUsd: 25, maxProspects: 25, maxContactsPerProspect: 3 } }));
  assert.equal(replay.status, 200); assert.equal((await replay.json() as any).reused, true);
  assert.equal(rows(await db.execute(sql`SELECT id FROM revenue_missions WHERE id = ${created.missionId}`)).length, 1);
  const conflict = await request("/api/v1/revenue-orchestrator/missions", "POST", keyA, body(sourceGood, { mission: { ...mission, priceUsd: 501 } }));
  assert.equal(conflict.status, 409);

  const source2 = await makeRun(tenantA, keyAId, "completed", true);
  const concurrent = await Promise.all(Array.from({ length: 5 }, () => request("/api/v1/revenue-orchestrator/missions", "POST", keyA, body(source2))));
  assert.equal(concurrent.filter(r => r.status === 201).length, 1);
  assert.equal(concurrent.filter(r => r.status === 200).length, 4);
  assert.equal(rows(await db.execute(sql`SELECT id FROM revenue_orchestrator_mission_links WHERE tenant_id = ${tenantA} AND source_run_id = ${source2}`)).length, 1);
  const source3 = await makeRun(tenantA, keyAId, "completed", true);
  const mixed = await Promise.all([1, 2, 3, 4].map((n) => request("/api/v1/revenue-orchestrator/missions", "POST", keyA, body(source3, { mission: { ...mission, priceUsd: n } }))));
  assert.equal(rows(await db.execute(sql`SELECT m.id FROM revenue_missions m JOIN revenue_orchestrator_mission_links l ON l.mission_id=m.id WHERE l.source_run_id=${source3}`)).length, 1);
  assert.equal(mixed.filter(r => r.status === 201).length, 1);
  assert.equal(mixed.filter(r => r.status === 409).length, 3);
  assert.equal(mixed.filter(r => r.status === 200).length, 0);
  assert.equal(rows(await db.execute(sql`SELECT id FROM mission_experiments WHERE tenant_id=${tenantA} AND mission_id=${created.missionId}`)).length, 0);
  assert.equal(rows(await db.execute(sql`SELECT spend_usd_cents FROM revenue_missions WHERE id=${created.missionId}`))[0].spend_usd_cents, 0);
  await assert.rejects(
    db.execute(sql`
      INSERT INTO revenue_orchestrator_mission_links (tenant_id, api_key_id, source_run_id, mission_id, input_hash)
      VALUES (${tenantB}, ${keyAId}, ${sourceGood}, ${created.missionId}, 'cross-tenant')
    `),
    (error: any) => error?.cause?.code === "23503",
  );
});