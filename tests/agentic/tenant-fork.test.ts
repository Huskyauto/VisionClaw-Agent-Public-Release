// Pure invariant tests for the tenant config-fork allowlist. No DB: the whole
// safety property of forkTenant is "only the vetted CONFIG tables are ever
// copied, everything else is excluded by default", and that property lives in
// the FORKABLE_CONFIG_TABLES registry — which we can assert without a database.
// (Real copy behavior is verified manually via scripts/fork-tenant.ts against a
// throwaway tenant; DB-touching tests hang the pg pool under run.sh.)
import { test } from "node:test";
import assert from "node:assert/strict";
import { FORKABLE_CONFIG_TABLES } from "../../server/tenant-fork";

const allowed = new Set(FORKABLE_CONFIG_TABLES.map((e) => e.name));

test("allowlist contains exactly the vetted config tables", () => {
  const expected = [
    "tenant_persona_names",
    "tenant_voice_profiles",
    "autonomy_rules",
    "governance_rules",
    "governance_frameworks",
    "tool_policies",
    "briefing_widgets",
    "lead_scoring_rules",
    "department_budgets",
    "heartbeat_tasks",
    "inbox_sender_allowlist",
  ].sort();
  assert.deepEqual([...allowed].sort(), expected);
});

test("FAIL-CLOSED: no data/memory/secret table is ever forkable", () => {
  // These must NEVER appear in the allowlist — copying any of them would bleed
  // one client's data, memory, money, or credentials into another's pod.
  const forbidden = [
    "messages",
    "conversations",
    "memory_entries",
    "conversation_facts",
    "agent_knowledge",
    "doc_chunks",
    "invoices",
    "invoice_items",
    "expenses",
    "customers",
    "leads",
    "audit_leads",
    "archive_rescue_orders",
    "video_jobs",
    "agent_runs",
    "agent_approvals",
    "decline_events",
    "usage_tracking",
    "tenant_provider_keys", // API keys — explicitly excluded
    "custom_tools", // name has a GLOBAL unique constraint — deferred
    "crews", // FK chain — deferred
    "research_schedules", // dangling FK — deferred
    "agent_wake_schedules", // dangling FK — deferred
    "outreach_sequences", // partial-fork risk — deferred
  ];
  for (const t of forbidden) {
    assert.equal(allowed.has(t), false, `${t} must NOT be forkable`);
  }
});

test("every entry is well-formed (name + table + boolean hasSerialId)", () => {
  for (const e of FORKABLE_CONFIG_TABLES) {
    assert.equal(typeof e.name, "string");
    assert.ok(e.name.length > 0);
    assert.ok(e.table, `${e.name} has a table object`);
    assert.equal(typeof e.hasSerialId, "boolean");
  }
});

test("reset functions clear the documented run-state fields", () => {
  const byName = Object.fromEntries(FORKABLE_CONFIG_TABLES.map((e) => [e.name, e]));

  const gov: any = { tenantId: 1, lastTriggeredAt: new Date(), triggerCount: 99 };
  byName["governance_rules"].reset!(gov);
  assert.equal(gov.lastTriggeredAt, null);
  assert.equal(gov.triggerCount, 0);

  const widget: any = { tenantId: 1, lastValue: "x", lastUpdatedAt: new Date() };
  byName["briefing_widgets"].reset!(widget);
  assert.equal(widget.lastValue, null);
  assert.equal(widget.lastUpdatedAt, null);

  const hb: any = { tenantId: 1, lastRunAt: new Date(), nextRunAt: new Date() };
  byName["heartbeat_tasks"].reset!(hb);
  assert.equal(hb.lastRunAt, null);
  assert.equal(hb.nextRunAt, null);
});

test("heartbeat_tasks declares its intra-table self-ref for two-pass copy", () => {
  const hb = FORKABLE_CONFIG_TABLES.find((e) => e.name === "heartbeat_tasks")!;
  assert.equal(hb.selfRefField, "parentTaskId");
});

test("inbox_sender_allowlist has no serial id (composite PK)", () => {
  const al = FORKABLE_CONFIG_TABLES.find((e) => e.name === "inbox_sender_allowlist")!;
  assert.equal(al.hasSerialId, false);
});
