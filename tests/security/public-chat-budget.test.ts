import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { claimPublicChatAdmission, publicChatDailyLimits, PUBLIC_CHAT_BUDGET_LABEL } from "../../server/public-chat-budget";

const budgetSource = fs.readFileSync("server/public-chat-budget.ts", "utf8");

test("autonomous reservation cleanup and spend totals cannot consume dedicated daily claims", () => {
  const autonomousSource = fs.readFileSync("server/agentic/autonomous-budget.ts", "utf8");
  assert.match(autonomousSource, /DELETE FROM autonomous_budget_claims[\s\S]*?AND label IS DISTINCT FROM \$\{PUBLIC_CHAT_BUDGET_LABEL\}/);
  assert.match(autonomousSource, /SELECT SUM\(estimated_usd\) FROM autonomous_budget_claims[\s\S]*?AND label IS DISTINCT FROM \$\{PUBLIC_CHAT_BUDGET_LABEL\}/);
  assert.match(autonomousSource, /DELETE FROM autonomous_budget_claims[\s\S]*?AND label IS DISTINCT FROM \$\{FELIX_GROK_CLAIM_LABEL\}/);
  assert.match(autonomousSource, /SELECT SUM\(estimated_usd\) FROM autonomous_budget_claims[\s\S]*?AND label IS DISTINCT FROM \$\{FELIX_GROK_CLAIM_LABEL\}/);
});

test("public chat daily limits default to 40 per tenant and 200 globally", () => {
  assert.deepEqual(publicChatDailyLimits({}), { tenant: 40, global: 200 });
});

test("public chat daily limits accept configured nonnegative integers including zero", () => {
  assert.deepEqual(publicChatDailyLimits({
    PUBLIC_CHAT_DAILY_TENANT_LIMIT: "0",
    PUBLIC_CHAT_DAILY_GLOBAL_LIMIT: "17",
  }), { tenant: 0, global: 17 });
});

test("invalid public chat daily limits fail closed", () => {
  for (const value of ["-1", "1.5", "NaN", ""]) {
    assert.throws(() => publicChatDailyLimits({
      PUBLIC_CHAT_DAILY_TENANT_LIMIT: value,
    }), /nonnegative integer/);
  }
});

test("durable admission counts only this label for the UTC day under transactional locks", () => {
  assert.match(budgetSource, /pg_advisory_xact_lock\(hashtext\('public-chat-daily-admission'\), 0\)/);
  assert.match(budgetSource, /pg_advisory_xact_lock\(hashtext\('public-chat-daily-admission'\), \$\{tenantId\}\)/);
  assert.match(budgetSource, /DELETE FROM autonomous_budget_claims[\s\S]*?WHERE label = \$\{PUBLIC_CHAT_BUDGET_LABEL\}[\s\S]*?created_at </);
  assert.match(budgetSource, /date_trunc\('day', now\(\) AT TIME ZONE 'UTC'\)/);
  assert.match(budgetSource, /COUNT\(\*\) FILTER \(WHERE tenant_id = \$\{tenantId\}\)::int AS tenant_count/);
  assert.match(budgetSource, /INSERT INTO autonomous_budget_claims \(tenant_id, label, estimated_usd, created_at\)/);
});

test("concurrent admissions survive autonomous cleanup and do not consume autonomous spend", { skip: !process.env.DATABASE_URL }, async () => {
  const { db } = await import("../../server/db");
  const { sql } = await import("drizzle-orm");
  const { claimAutonomousBudget } = await import("../../server/agentic/autonomous-budget");
  const name = `public-quota-${Date.now()}`;
  const created: any = await db.execute(sql`
    INSERT INTO tenants (name, email, password_hash)
    VALUES (${name}, ${name + "@quota.test"}, 'x') RETURNING id
  `);
  const tenantId = Number((created.rows || created)[0].id);
  const previousTenantLimit = process.env.PUBLIC_CHAT_DAILY_TENANT_LIMIT;
  const previousGlobalLimit = process.env.PUBLIC_CHAT_DAILY_GLOBAL_LIMIT;
  try {
    process.env.PUBLIC_CHAT_DAILY_TENANT_LIMIT = "2";
    process.env.PUBLIC_CHAT_DAILY_GLOBAL_LIMIT = "200";
    const decisions = await Promise.all(Array.from({ length: 5 }, () => claimPublicChatAdmission(tenantId)));
    assert.equal(decisions.filter((decision) => decision.admitted).length, 2);
    const autonomous = await claimAutonomousBudget({
      tenantId, estimatedUsd: 0.01, capUsd: 0.5, label: "public-quota-test-autonomous", ttlMinutes: 0.000001,
    });
    assert.equal(autonomous.ok, true, "public admissions must not spend autonomous dollars");
    assert.equal((await claimPublicChatAdmission(tenantId)).admitted, false,
      "short autonomous TTL must not erase today's public admission count");
    const counted: any = await db.execute(sql`
      SELECT COUNT(*)::int AS total FROM autonomous_budget_claims
      WHERE tenant_id = ${tenantId} AND label = ${PUBLIC_CHAT_BUDGET_LABEL}
    `);
    assert.equal(Number((counted.rows || counted)[0].total), 2);
  } finally {
    if (previousTenantLimit === undefined) delete process.env.PUBLIC_CHAT_DAILY_TENANT_LIMIT;
    else process.env.PUBLIC_CHAT_DAILY_TENANT_LIMIT = previousTenantLimit;
    if (previousGlobalLimit === undefined) delete process.env.PUBLIC_CHAT_DAILY_GLOBAL_LIMIT;
    else process.env.PUBLIC_CHAT_DAILY_GLOBAL_LIMIT = previousGlobalLimit;
    await db.execute(sql`DELETE FROM autonomous_budget_claims WHERE tenant_id = ${tenantId}`);
    await db.execute(sql`DELETE FROM tenants WHERE id = ${tenantId}`);
  }
});

test("a global cap applies across tenants and expires at the UTC day boundary", { skip: !process.env.DATABASE_URL }, async () => {
  const { db } = await import("../../server/db");
  const { sql } = await import("drizzle-orm");
  const ids: number[] = [];
  const previousTenantLimit = process.env.PUBLIC_CHAT_DAILY_TENANT_LIMIT;
  const previousGlobalLimit = process.env.PUBLIC_CHAT_DAILY_GLOBAL_LIMIT;
  try {
    for (let i = 0; i < 2; i++) {
      const name = `global-public-quota-${Date.now()}-${i}`;
      const created: any = await db.execute(sql`
        INSERT INTO tenants (name, email, password_hash)
        VALUES (${name}, ${name + "@quota.test"}, 'x') RETURNING id
      `);
      ids.push(Number((created.rows || created)[0].id));
    }
    process.env.PUBLIC_CHAT_DAILY_TENANT_LIMIT = "10";
    process.env.PUBLIC_CHAT_DAILY_GLOBAL_LIMIT = "3";
    await db.execute(sql`
      INSERT INTO autonomous_budget_claims (tenant_id, label, estimated_usd, created_at)
      VALUES (${ids[0]}, ${PUBLIC_CHAT_BUDGET_LABEL}, 1,
        date_trunc('day', now() AT TIME ZONE 'UTC') - interval '1 second')
    `);
    const decisions = await Promise.all(
      Array.from({ length: 6 }, (_, index) => claimPublicChatAdmission(ids[index % 2])),
    );
    assert.equal(decisions.filter((decision) => decision.admitted).length, 3);
    assert.equal((await claimPublicChatAdmission(ids[0])).admitted, false);
    assert.equal((await claimPublicChatAdmission(ids[1])).admitted, false);
    const counted: any = await db.execute(sql`
      SELECT COUNT(*)::int AS total FROM autonomous_budget_claims
      WHERE label = ${PUBLIC_CHAT_BUDGET_LABEL} AND tenant_id IN (${ids[0]}, ${ids[1]})
    `);
    assert.equal(Number((counted.rows || counted)[0].total), 3, "yesterday's claim is pruned");
  } finally {
    if (previousTenantLimit === undefined) delete process.env.PUBLIC_CHAT_DAILY_TENANT_LIMIT;
    else process.env.PUBLIC_CHAT_DAILY_TENANT_LIMIT = previousTenantLimit;
    if (previousGlobalLimit === undefined) delete process.env.PUBLIC_CHAT_DAILY_GLOBAL_LIMIT;
    else process.env.PUBLIC_CHAT_DAILY_GLOBAL_LIMIT = previousGlobalLimit;
    for (const id of ids) {
      await db.execute(sql`DELETE FROM autonomous_budget_claims WHERE tenant_id = ${id}`);
      await db.execute(sql`DELETE FROM tenants WHERE id = ${id}`);
    }
  }
});