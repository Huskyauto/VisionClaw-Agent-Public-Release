/**
 * tests/unit/blackboard-slots.test.ts
 *
 * Covers the R125+15 blackboard layer on the parallel findings bus
 * (server/lib/parallel-findings-bus.ts). The findings bus is an append-only
 * discovery log; the blackboard adds KEYED shared-state slots (latest-wins
 * reads) plus atomic work-claims (one winner per tenant+job+slot, backed by the
 * partial unique index idx_pjf_claim). This pins: a slot read returns the LATEST
 * write, readBoard returns one row per slot, only the FIRST claimer wins (so two
 * chunks never duplicate a unit), claims and slot values are isolated from the
 * append-only findings read, and everything is tenant-scoped.
 *
 * Run: node --import tsx --test tests/unit/blackboard-slots.test.ts
 * Skips automatically when DATABASE_URL is absent.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";

const HAS_DB = !!process.env.DATABASE_URL;
const TEST_TENANT = 990003;
const OTHER_TENANT = 990004;
const TOOL_TENANT = 990005;
const JOB = "blackboard-test-job";

let mod: typeof import("../../server/lib/parallel-findings-bus");
let executeTool: typeof import("../../server/tools").executeTool;
let db: typeof import("../../server/db").db;
let sql: typeof import("drizzle-orm").sql;

before(async () => {
  if (!HAS_DB) return;
  mod = await import("../../server/lib/parallel-findings-bus");
  ({ executeTool } = await import("../../server/tools"));
  ({ db } = await import("../../server/db"));
  ({ sql } = await import("drizzle-orm"));
  await db.execute(sql`DELETE FROM parallel_job_findings WHERE tenant_id IN (${TEST_TENANT}, ${OTHER_TENANT}, ${TOOL_TENANT})`).catch(() => {});
});

after(async () => {
  if (HAS_DB && db && sql) {
    await db.execute(sql`DELETE FROM parallel_job_findings WHERE tenant_id IN (${TEST_TENANT}, ${OTHER_TENANT}, ${TOOL_TENANT})`).catch(() => {});
  }
  setTimeout(() => process.exit(process.exitCode ?? 0), 50).unref();
});

test("a slot read returns the LATEST written value (latest-wins)", { skip: !HAS_DB }, async () => {
  await mod.publishFinding({ tenantId: TEST_TENANT, jobId: JOB, subtaskId: "chunk-1", finding: { v: "first" }, slotKey: "outline" });
  await mod.publishFinding({ tenantId: TEST_TENANT, jobId: JOB, subtaskId: "chunk-2", finding: { v: "second" }, slotKey: "outline" });
  const slot = await mod.readSlot({ tenantId: TEST_TENANT, jobId: JOB, slotKey: "outline" });
  assert.ok(slot);
  assert.equal(slot!.value.v, "second");
  assert.equal(slot!.postedBy, "chunk-2");
});

test("an unset slot reads as null", { skip: !HAS_DB }, async () => {
  const slot = await mod.readSlot({ tenantId: TEST_TENANT, jobId: JOB, slotKey: "does-not-exist" });
  assert.equal(slot, null);
});

test("readBoard returns one row per distinct slot, each at its latest value", { skip: !HAS_DB }, async () => {
  await mod.publishFinding({ tenantId: TEST_TENANT, jobId: JOB, subtaskId: "chunk-3", finding: { v: "palette-v1" }, slotKey: "palette" });
  const board = await mod.readBoard({ tenantId: TEST_TENANT, jobId: JOB });
  const keys = board.map((s) => s.slotKey).sort();
  assert.deepEqual(keys, ["outline", "palette"]);
  const outline = board.find((s) => s.slotKey === "outline");
  assert.equal(outline!.value.v, "second"); // still latest-wins inside the board read
});

test("only the FIRST claimer wins a slot; later claimers see the owner", { skip: !HAS_DB }, async () => {
  const a = await mod.claimSlot({ tenantId: TEST_TENANT, jobId: JOB, subtaskId: "chunk-A", slotKey: "section-3" });
  const b = await mod.claimSlot({ tenantId: TEST_TENANT, jobId: JOB, subtaskId: "chunk-B", slotKey: "section-3" });
  assert.equal(a.won, true);
  assert.equal(a.owner, "chunk-A");
  assert.equal(b.won, false);
  assert.equal(b.owner, "chunk-A");
});

test("claims do NOT leak into the append-only discovery read", { skip: !HAS_DB }, async () => {
  // section-3 was claimed above; a sibling reading the discovery log must not see claim rows.
  const rows = await mod.readFindings({ tenantId: TEST_TENANT, jobId: JOB, minConfidence: 0 });
  assert.equal(rows.some((r) => r.slotKey === "section-3"), false);
});

test("blackboard state is tenant-isolated", { skip: !HAS_DB }, async () => {
  // Same job id, different tenant — must not see TEST_TENANT's slots, and can win its own claim.
  const slot = await mod.readSlot({ tenantId: OTHER_TENANT, jobId: JOB, slotKey: "outline" });
  assert.equal(slot, null);
  const board = await mod.readBoard({ tenantId: OTHER_TENANT, jobId: JOB });
  assert.equal(board.length, 0);
  const claim = await mod.claimSlot({ tenantId: OTHER_TENANT, jobId: JOB, subtaskId: "other-1", slotKey: "section-3" });
  assert.equal(claim.won, true); // different tenant, independent claim space
});

test("a slot post still survives the discovery read path as a normal finding row", { skip: !HAS_DB }, async () => {
  // Backward-compat: slot posts are real rows; default findings_read excludes only by confidence/caller, not by slot.
  const rows = await mod.readFindings({ tenantId: TEST_TENANT, jobId: JOB, minConfidence: 0 });
  assert.ok(rows.some((r) => r.slotKey === "outline"));
});

// ---- Tool-surface coverage (findings_publish) — guards the contract the architect flagged ----

test("TOOL: claim:true succeeds WITHOUT a finding payload", { skip: !HAS_DB }, async () => {
  const r = await executeTool("findings_publish", {
    _tenantId: TOOL_TENANT, job_id: JOB, subtask_id: "tool-A", slot_key: "task-1", claim: true,
  });
  assert.equal(r.ok, true);
  assert.equal(r.claimed, true);
  assert.equal(r.owner, "tool-A");
});

test("TOOL: a second claim on the same slot loses and reports the owner", { skip: !HAS_DB }, async () => {
  const r = await executeTool("findings_publish", {
    _tenantId: TOOL_TENANT, job_id: JOB, subtask_id: "tool-B", slot_key: "task-1", claim: true,
  });
  assert.equal(r.ok, true);
  assert.equal(r.claimed, false);
  assert.equal(r.owner, "tool-A");
});

test("TOOL: claim:true WITHOUT slot_key is rejected", { skip: !HAS_DB }, async () => {
  const r = await executeTool("findings_publish", {
    _tenantId: TOOL_TENANT, job_id: JOB, subtask_id: "tool-C", claim: true,
  });
  assert.ok(r.error);
});

test("TOOL: a non-claim publish WITHOUT finding is rejected (backward-compat guard)", { skip: !HAS_DB }, async () => {
  const r = await executeTool("findings_publish", {
    _tenantId: TOOL_TENANT, job_id: JOB, subtask_id: "tool-D",
  });
  assert.ok(r.error);
});

test("TOOL: a slot write + board read round-trips through the tool surface", { skip: !HAS_DB }, async () => {
  const w = await executeTool("findings_publish", {
    _tenantId: TOOL_TENANT, job_id: JOB, subtask_id: "tool-E", slot_key: "outline", finding: { v: "tool-outline" },
  });
  assert.equal(w.ok, true);
  const board = await executeTool("findings_read", {
    _tenantId: TOOL_TENANT, job_id: JOB, mode: "board",
  });
  const slots = (board.slots ?? board.findings ?? board) as any[];
  assert.ok(Array.isArray(slots));
  assert.ok(slots.some((s: any) => s.slotKey === "outline" && s.value?.v === "tool-outline"));
});
