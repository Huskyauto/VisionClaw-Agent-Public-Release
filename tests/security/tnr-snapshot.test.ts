// R100 — Transactional No-Regression unit tests (node:test runner).
//
// Coverage:
//  1. registry sanity — all 3 documented snapshot kinds load
//  2. captureSnapshot writes a row + returns actionId
//  3. restoreLastAction undoes scheduled_message_cancel (real DB roundtrip)
//  4. double-undo on same actionId rejected
//  5. expired snapshots rejected
//  6. cross-tenant isolation (tenant B cannot undo tenant A snapshot)
//  7. capture refuses without tenant context
//  8. custom_tool_delete restore conflict guard fires when name re-exists

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { sql } from "drizzle-orm";
import { db, pool } from "../../server/db";
import {
  captureSnapshot,
  restoreLastAction,
  getAdapter,
  SNAPSHOT_KINDS,
} from "../../server/safety/transactional-snapshot";

const TENANT_A = 9_900_000 + Math.floor(Math.random() * 90_000);
const TENANT_B = TENANT_A + 1;

let SCHED_MSG_ID = 0;

before(async () => {
  const r: any = await db.execute(sql`
    INSERT INTO agent_knowledge (tenant_id, title, category, content, source, created_at, updated_at)
    VALUES (${TENANT_A}, 'tnr-test', 'recurring_message_cancelled', '{"cron":"0 9 * * *","prompt":"tnr-test"}', 'test', NOW(), NOW())
    RETURNING id
  `);
  SCHED_MSG_ID = (r.rows || r)[0].id;
});

after(async () => {
  await pool.query(`DELETE FROM action_snapshots WHERE tenant_id IN ($1, $2)`, [TENANT_A, TENANT_B]).catch(() => {});
  await pool.query(`DELETE FROM agent_knowledge WHERE tenant_id IN ($1, $2)`, [TENANT_A, TENANT_B]).catch(() => {});
  await pool.query(`DELETE FROM custom_tools WHERE tenant_id IN ($1, $2)`, [TENANT_A, TENANT_B]).catch(() => {});
  await pool.end().catch(() => {});
});

test("R100 registry: all 3 documented snapshot kinds present", () => {
  assert.deepEqual(
    [...SNAPSHOT_KINDS].sort(),
    ["custom_tool_delete", "scheduled_message_cancel", "scraped_pages_delete"],
  );
  assert.ok(getAdapter("scheduled_message_cancel"));
  assert.ok(getAdapter("custom_tool_delete"));
  assert.ok(getAdapter("scraped_pages_delete"));
});

test("R100 capture+restore roundtrip — scheduled_message_cancel", async () => {
  await pool.query(`UPDATE agent_knowledge SET category='recurring_message' WHERE id=$1 AND tenant_id=$2`, [SCHED_MSG_ID, TENANT_A]);

  const cap = await captureSnapshot(
    "cancel_scheduled_message",
    "scheduled_message_cancel",
    30,
    { id: SCHED_MSG_ID },
    { tenantId: TENANT_A, personaId: 2 },
  );
  assert.match(cap.actionId, /^[0-9a-f-]{36}$/i);
  assert.ok(cap.expiresAt.getTime() > Date.now());

  // Simulate the actual cancel happening AFTER the snapshot.
  await pool.query(
    `UPDATE agent_knowledge SET category='recurring_message_cancelled' WHERE id=$1 AND tenant_id=$2`,
    [SCHED_MSG_ID, TENANT_A],
  );

  const r = await restoreLastAction({ tenantId: TENANT_A, personaId: 2 }, { actionId: cap.actionId });
  assert.equal(r.success, true, `restore failed: ${r.error}`);
  assert.equal(r.restored, 1);

  const after: any = await pool.query(`SELECT category FROM agent_knowledge WHERE id=$1`, [SCHED_MSG_ID]);
  assert.equal(after.rows[0].category, "recurring_message");
});

test("R100 double-undo on same actionId is rejected", async () => {
  await pool.query(`UPDATE agent_knowledge SET category='recurring_message' WHERE id=$1`, [SCHED_MSG_ID]);
  const cap = await captureSnapshot(
    "cancel_scheduled_message",
    "scheduled_message_cancel",
    30,
    { id: SCHED_MSG_ID },
    { tenantId: TENANT_A },
  );
  await pool.query(`UPDATE agent_knowledge SET category='recurring_message_cancelled' WHERE id=$1`, [SCHED_MSG_ID]);

  const r1 = await restoreLastAction({ tenantId: TENANT_A }, { actionId: cap.actionId });
  assert.equal(r1.success, true);

  const r2 = await restoreLastAction({ tenantId: TENANT_A }, { actionId: cap.actionId });
  assert.equal(r2.success, false);
  assert.match(String(r2.error || ""), /already undone|already claimed/i);
});

test("R100 expired snapshots rejected", async () => {
  await pool.query(`UPDATE agent_knowledge SET category='recurring_message' WHERE id=$1`, [SCHED_MSG_ID]);
  const cap = await captureSnapshot(
    "cancel_scheduled_message",
    "scheduled_message_cancel",
    30,
    { id: SCHED_MSG_ID },
    { tenantId: TENANT_A },
  );
  await pool.query(`UPDATE action_snapshots SET expires_at = NOW() - INTERVAL '1 hour' WHERE action_id=$1`, [cap.actionId]);
  await pool.query(`UPDATE agent_knowledge SET category='recurring_message_cancelled' WHERE id=$1`, [SCHED_MSG_ID]);

  const r = await restoreLastAction({ tenantId: TENANT_A }, { actionId: cap.actionId });
  assert.equal(r.success, false);
  assert.match(String(r.error || ""), /expired|no eligible/i);
});

test("R100 cross-tenant isolation — tenant B cannot undo tenant A snapshot", async () => {
  await pool.query(`UPDATE agent_knowledge SET category='recurring_message' WHERE id=$1`, [SCHED_MSG_ID]);
  const cap = await captureSnapshot(
    "cancel_scheduled_message",
    "scheduled_message_cancel",
    30,
    { id: SCHED_MSG_ID },
    { tenantId: TENANT_A },
  );
  const r = await restoreLastAction({ tenantId: TENANT_B }, { actionId: cap.actionId });
  assert.equal(r.success, false);
  assert.match(String(r.error || ""), /no eligible/i);
});

test("R100 capture refuses without tenant context", async () => {
  await assert.rejects(
    () => captureSnapshot("cancel_scheduled_message", "scheduled_message_cancel", 30, { id: SCHED_MSG_ID }, { tenantId: 0 as any }),
    /tenantId required/i,
  );
});

test("R100 custom_tool_delete restore refuses to overwrite a re-created tool", async () => {
  const NAME = `tnr_test_tool_${Date.now()}_${Math.floor(Math.random() * 9999)}`;
  await pool.query(
    `INSERT INTO custom_tools (name, description, parameters, implementation, created_by, is_active, usage_count, tenant_id)
     VALUES ($1, 'orig', '[]'::jsonb, 'return 1;', 'test', true, 0, $2)`,
    [NAME, TENANT_A],
  );
  const cap = await captureSnapshot(
    "delete_custom_tool",
    "custom_tool_delete",
    60,
    { name: NAME },
    { tenantId: TENANT_A },
  );
  // Don't actually delete — leave the row in place. Restore must refuse (conflict).
  const r = await restoreLastAction({ tenantId: TENANT_A }, { actionId: cap.actionId });
  assert.equal(r.success, false);
  assert.match(String(r.error || ""), /already exists|overwrite/i);
});
