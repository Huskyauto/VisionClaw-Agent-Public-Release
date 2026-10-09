import assert from "node:assert/strict";
import test from "node:test";
import { ownerTenantId } from "../../server/agentic/autonomous-budget";
import { invokeApiV1Process } from "../../server/api-v1-dispatch";
import { db } from "../../server/db";
import { readStoredIncomeOpportunities } from "../../server/lib/income-opportunities";
import { OWNER_SERVICE_OFFERINGS } from "../../server/lib/owner-service-offerings";
import { sql } from "drizzle-orm";
import { instinctToolBlocked, withInstinctReadDraft } from "../../server/lib/instinct-read-draft";
import { executeTool, getAllToolDefinitions } from "../../server/tools";
import { filterSparkLineTools, routeTools } from "../../server/tool-router";
import "../../server/tools/domains/income-opportunities";
import { getMigratedHandler } from "../../server/tools/registry";

test("Instinct's server-owned marker survives async processing and is not inherited by other Felix turns", async () => {
  assert.equal(instinctToolBlocked("opportunity_bank_file"), false);
  const seen: boolean[] = [];
  const process = async (_id: number, _message: string, opts: { tenantId: number; source: string }) => {
    assert.equal(opts.tenantId, ownerTenantId());
    assert.equal(opts.source, "api-v1");
    await Promise.resolve();
    seen.push(instinctToolBlocked("opportunity_bank_file"));
    return {} as any;
  };
  await invokeApiV1Process(process as any, ownerTenantId(), 42, "review", true);
  await invokeApiV1Process(process as any, ownerTenantId(), 42, "review");
  assert.deepEqual(seen, [true, false]);
  assert.equal(instinctToolBlocked("opportunity_bank_file"), false);
});

test("Instinct's tool boundary permits owner overview and private replies only, regardless of model-supplied arguments", async () => {
  assert.equal(instinctToolBlocked("opportunity_bank_file"), false);
  await withInstinctReadDraft(async () => {
    assert.equal(instinctToolBlocked("owner_business_overview"), false);
    assert.equal(instinctToolBlocked("instinct_send_message"), false);
    for (const name of ["opportunity_bank_file", "product_listing_create", "create_payment_link", "delegate_task", "exec", "grok_send_message", "spark_send_message", "decide_approval", "unknown_tool"]) {
      const result = await executeTool(name, { _tenantId: ownerTenantId(), _personaId: 2, _channel: "admin" });
      assert.match(result.error, /Instinct can review/);
    }
  });
});

test("Owner overview rejects missing tenant, other tenants and non-Felix personas before a database read", async () => {
  const handler = getMigratedHandler("owner_business_overview");
  assert.ok(handler);
  const owner = ownerTenantId();
  for (const ctx of [{ personaId: 2 }, { tenantId: owner + 1, personaId: 2 }, { tenantId: owner, personaId: 3 }]) {
    const result = await handler!({}, ctx);
    assert.ok("error" in result);
  }
});

test("Instinct sees owner overview and its own private reply tool, but no business writes or delegation", async () => {
  const owner = ownerTenantId();
  const definitions = await getAllToolDefinitions();
  assert.ok(definitions.some(tool => tool.function.name === "owner_business_overview"));
  assert.equal(filterSparkLineTools(definitions, 2, owner + 1).some(tool => tool.function.name === "owner_business_overview"), false);
  await withInstinctReadDraft(async () => {
    const menu = await routeTools(definitions, [{ role: "user", content: "Review my products and ideas" }], { personaId: 2, tenantId: owner });
    assert.deepEqual(menu.tools.map(tool => tool.function.name).sort(), ["instinct_send_message", "owner_business_overview"]);
    assert.match(menu.contrastiveNote!, /Do not request approval again/);
    assert.match(menu.contrastiveNote!, /never as an automatic echo or reply loop/);
    const unauthorized = await routeTools(definitions, [{ role: "user", content: "Review my products" }], { personaId: 2, tenantId: owner + 1 });
    assert.deepEqual(unauthorized.tools, []);
    const otherPersona = await routeTools(definitions, [{ role: "user", content: "Send Instinct a reply" }], { personaId: 3, tenantId: owner });
    assert.deepEqual(otherPersona.tools, []);
  });
});

test("Reviewing an unseeded Opportunity Bank never creates built-in rows", async () => {
  const unusedTenant = 2147480000;
  const count = async () => {
    const result = await db.execute(sql`SELECT count(*)::int AS n FROM income_opportunities WHERE tenant_id = ${unusedTenant}`);
    return Number(result.rows[0]?.n);
  };
  const before = await count();
  const ideas = await readStoredIncomeOpportunities(unusedTenant);
  assert.deepEqual(ideas, []);
  assert.equal(await count(), before);
});

test("Service overview lists offer descriptions without exposing order or payment administration", () => {
  const names = OWNER_SERVICE_OFFERINGS.map(offer => offer.name);
  assert.ok(names.includes("Website Audit"));
  assert.ok(names.includes("Company Reports"));
  assert.ok(names.includes("Smart Leads"));
  assert.ok(names.includes("Archive Rescue"));
  assert.equal(new Set(names).size, names.length);
  for (const offer of OWNER_SERVICE_OFFERINGS) {
    assert.match(offer.path, /^\//);
    assert.ok(offer.summary.length > 20);
    assert.doesNotMatch(offer.path, /service-orders|payment-links|revenue-missions|admin\/archive-rescue/);
    assert.doesNotMatch(JSON.stringify(offer), /customer_id|order_id|payment_link_url|priceCents/);
  }
});