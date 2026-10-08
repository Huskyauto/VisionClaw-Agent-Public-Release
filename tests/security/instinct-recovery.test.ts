import assert from "node:assert/strict";
import { after, test } from "node:test";
import { db } from "../../server/db";
import { ownerTenantId } from "../../server/agentic/autonomous-budget";
import {
  acknowledgeInstinctFailureAsOwner, acknowledgeInstinctFailureFromDesignatedLogin, resumeInstinctFailedTurn,
} from "../../server/lib/instinct-recovery";
import { sql } from "drizzle-orm";
import { claimApiV1FollowUp } from "../../server/spark-line";

after(() => { setTimeout(() => process.exit(process.exitCode ?? 0), 50).unref(); });

test("recovery storage failure propagates rather than claiming successful recovery", async () => {
  await assert.rejects(resumeInstinctFailedTurn(ownerTenantId(), 2147480000,
    "2026-10-01T06:36:45.572Z", ownerTenantId(), {
      transaction: async () => { throw new Error("recovery storage unavailable"); },
    } as any), /recovery storage unavailable/);
});

test("transactional acknowledgement retains failed receipts, audits once, rejects stale and uncertain turns, and rolls back on failure", async () => {
  const tenantId = ownerTenantId();
  const failedAt = "2026-10-01T06:36:45.572Z";
  const rollback = new Error("test fixture rollback");
  await assert.rejects(db.transaction(async tx => {
    // Entire fixture lives in a rolled-back transaction. Existing owner thread
    // binding is never changed for other connections or left changed after tests.
    const inserted: any = await tx.execute(sql`
      INSERT INTO conversations (tenant_id, title, persona_id)
      VALUES (${tenantId}, 'Instinct recovery test fixture', 2) RETURNING id
    `);
    const conversationId = inserted.rows[0].id as number;
    await tx.execute(sql`
      INSERT INTO instinct_web_threads (tenant_id, state, conversation_id, status_url)
      VALUES (${tenantId}, 'ready', ${conversationId}, '/test-only')
      ON CONFLICT (tenant_id) DO UPDATE SET state='ready', conversation_id=${conversationId}
    `);
    await tx.execute(sql`
      INSERT INTO api_v1_conversation_runs (tenant_id, conversation_id, status, failure_reason, failed_at)
      VALUES (${tenantId}, ${conversationId}, 'failed', 'expert_provider_rejected', ${failedAt}::timestamp)
    `);
    await tx.execute(sql`
      INSERT INTO instinct_web_submissions (tenant_id, conversation_id, token_hash, client_key, message, state, request_id)
      VALUES (${tenantId}, ${conversationId}, ${`test-${conversationId}`}, 'test-key', 'Review business.', 'failed', 'test-request')
    `);
    const recover = (time = failedAt, tenant = tenantId, id = conversationId) =>
      resumeInstinctFailedTurn(tenant, id, time, tenantId, tx as any);
    assert.equal(await recover("2026-10-01T06:36:44.572Z"), "blocked");
    assert.equal(await recover(failedAt, tenantId + 1), "blocked");
    assert.equal(await recover(failedAt, tenantId, conversationId + 1), "blocked");
    await assert.rejects(resumeInstinctFailedTurn(tenantId, conversationId, failedAt, tenantId, {
      transaction: async (body: any) => tx.transaction(async inner => {
        await body(inner);
        throw new Error("commit failed");
      }),
    } as any), /commit failed/);
    const stillFailed: any = await tx.execute(sql`
      SELECT status FROM api_v1_conversation_runs WHERE tenant_id=${tenantId} AND conversation_id=${conversationId}
    `);
    assert.equal(stillFailed.rows[0].status, "failed", "failed commit cannot leave the run resumed");
    for (const reason of ["timeout", "processing_error", "missing_reply", "unrecognized",
      "expert_provider_uncertain", "expert_provider_unavailable", "expert_context_limit"]) {
      await tx.execute(sql`UPDATE api_v1_conversation_runs SET failure_reason=${reason}
        WHERE tenant_id=${tenantId} AND conversation_id=${conversationId}`);
      assert.equal(await recover(), "blocked");
    }
    await tx.execute(sql`UPDATE api_v1_conversation_runs SET failure_reason='expert_provider_rejected'
      WHERE tenant_id=${tenantId} AND conversation_id=${conversationId}`);
    await tx.execute(sql`UPDATE instinct_web_submissions SET state='running'
      WHERE tenant_id=${tenantId} AND conversation_id=${conversationId}`);
    assert.equal(await recover(), "blocked");
    await tx.execute(sql`UPDATE instinct_web_submissions SET state='failed'
      WHERE tenant_id=${tenantId} AND conversation_id=${conversationId}`);
    await tx.execute(sql`
      INSERT INTO instinct_web_submissions (tenant_id, conversation_id, token_hash, client_key, message, state, request_id)
      VALUES (${tenantId}, ${conversationId}, ${`blocked-${conversationId}`}, 'blocked-key', 'Unlaunched stale form.', 'blocked', 'blocked-request')
    `);
    assert.equal(await recover(), "resumed");
    assert.equal(await recover(), "duplicate");
    const stored: any = await tx.execute(sql`
      SELECT r.status, s.state, s.message, r.completed_reply
      FROM api_v1_conversation_runs r JOIN instinct_web_submissions s
        ON s.tenant_id=r.tenant_id AND s.conversation_id=r.conversation_id
      WHERE r.tenant_id=${tenantId} AND r.conversation_id=${conversationId} AND s.request_id='test-request'
    `);
    assert.deepEqual(stored.rows.map((row: any) => [row.status, row.state, row.message, row.completed_reply]),
      [["idle", "failed", "Review business.", null]]);
    const audits: any = await tx.execute(sql`SELECT count(*)::int AS n FROM activity_log
      WHERE tenant_id=${tenantId} AND action='instinct_failure_acknowledged'
        AND resource_id=${String(conversationId)}`);
    assert.equal(audits.rows[0].n, 1);
    // Legacy/uncertain failures need independently authenticated owner review;
    // this is acknowledgement, not a paid retry or a release of budget claims.
    await tx.execute(sql`UPDATE api_v1_conversation_runs SET status='failed', failure_reason='expert_provider_uncertain',
      failed_at='2026-10-01T06:40:00.000Z'::timestamp
      WHERE tenant_id=${tenantId} AND conversation_id=${conversationId}`);
    const uncertainAt = "2026-10-01T06:40:00.000Z";
    assert.equal(await recover(uncertainAt), "blocked");
    assert.equal(await acknowledgeInstinctFailureAsOwner({ tenantId, isAdmin: false },
      conversationId, uncertainAt, tx as any), "blocked");
    assert.equal(await acknowledgeInstinctFailureAsOwner({ tenantId: tenantId + 1, isAdmin: true },
      conversationId, uncertainAt, tx as any), "blocked");
    assert.equal(await acknowledgeInstinctFailureAsOwner({ tenantId, isAdmin: true },
      conversationId, uncertainAt, tx as any), "resumed");
    await tx.execute(sql`UPDATE api_v1_conversation_runs SET status='failed', failure_reason='timeout',
      failed_at='2026-10-01T06:41:00.000Z'::timestamp
      WHERE tenant_id=${tenantId} AND conversation_id=${conversationId}`);
    const timeoutAt = "2026-10-01T06:41:00.000Z";
    const freshClaim = () => claimApiV1FollowUp(tenantId, conversationId, "fresh-after-review",
      "New coordination question; do not retry the failed request.", "fresh-reviewed-request", true, tx as any);
    assert.equal((await freshClaim()).outcome, "busy", "an unacknowledged timeout remains fenced");
    assert.equal(await acknowledgeInstinctFailureAsOwner({ tenantId, isAdmin: true },
      conversationId, timeoutAt, tx as any), "resumed");
    assert.equal((await freshClaim()).outcome, "claimed", "reviewed idle permits a fresh turn, not a replay");
    assert.equal((await freshClaim()).outcome, "duplicate", "fresh request remains idempotent");
    await tx.execute(sql`UPDATE api_v1_conversation_runs SET status='running'
      WHERE tenant_id=${tenantId} AND conversation_id=${conversationId}`);
    assert.equal(await recover(), "blocked", "old form cannot clear a later turn");
    throw rollback;
  }), error => error === rollback);
});

test("designated account may explicitly acknowledge only its current terminal legacy failure and audit its real authority", async () => {
  const tenantId = ownerTenantId();
  const loginTenantId = 8;
  const failedAt = "2026-10-01T06:36:45.572Z";
  const rollback = new Error("designated-login fixture rollback");
  const previousBinding = process.env.INSTINCT_OWNER_LOGIN_TENANT_ID;
  process.env.INSTINCT_OWNER_LOGIN_TENANT_ID = String(loginTenantId);
  try {
    await assert.rejects(db.transaction(async tx => {
      const inserted: any = await tx.execute(sql`
        INSERT INTO conversations (tenant_id, title, persona_id)
        VALUES (${tenantId}, 'Instinct designated recovery test fixture', 2) RETURNING id
      `);
      const conversationId = inserted.rows[0].id as number;
      await tx.execute(sql`
        INSERT INTO instinct_web_threads (tenant_id, state, conversation_id, status_url)
        VALUES (${tenantId}, 'ready', ${conversationId}, '/test-only')
        ON CONFLICT (tenant_id) DO UPDATE SET state='ready', conversation_id=${conversationId}
      `);
      await tx.execute(sql`
        INSERT INTO api_v1_conversation_runs (tenant_id, conversation_id, status, failure_reason, failed_at)
        VALUES (${tenantId}, ${conversationId}, 'failed', 'expert_provider_unavailable', ${failedAt}::timestamp)
      `);
      await tx.execute(sql`
        INSERT INTO instinct_web_submissions (tenant_id, conversation_id, token_hash, client_key, message, state, request_id)
        VALUES (${tenantId}, ${conversationId}, ${`designated-${conversationId}`}, 'designated-key',
          'Review the saved legacy failure.', 'failed', 'designated-request')
      `);
      const review = (principalId: number, time = failedAt, id = conversationId) =>
        acknowledgeInstinctFailureFromDesignatedLogin(tenantId, principalId, id, time, tx as any);
      assert.equal(await resumeInstinctFailedTurn(tenantId, conversationId, failedAt, loginTenantId, tx as any),
        "blocked", "ordinary settled recovery remains restricted");
      assert.equal(await acknowledgeInstinctFailureAsOwner({ tenantId: loginTenantId, isAdmin: false },
        conversationId, failedAt, tx as any), "blocked", "the former admin helper still denies the nonadmin login");
      assert.equal(await acknowledgeInstinctFailureAsOwner({ tenantId: loginTenantId, isAdmin: true },
        conversationId, failedAt, tx as any), "blocked", "tenant 8 is not the platform-owner tenant");
      assert.equal(await review(loginTenantId + 1), "blocked", "wrong principal is not designated");
      assert.equal(await review(loginTenantId, "2026-10-01T06:37:00.000Z"), "blocked", "stale timestamp is rejected");
      assert.equal(await review(loginTenantId, failedAt, conversationId + 1), "blocked", "replacement thread is rejected");

      await tx.execute(sql`
        INSERT INTO instinct_web_submissions (tenant_id, conversation_id, token_hash, client_key, message, state, request_id)
        VALUES (${tenantId}, ${conversationId}, ${`later-blocked-${conversationId}`}, 'later-blocked-key',
          'A later nonterminal receipt.', 'blocked', 'later-blocked-request')
      `);
      assert.equal(await review(loginTenantId), "blocked", "review requires the latest saved receipt to be failed");
      await tx.execute(sql`DELETE FROM instinct_web_submissions
        WHERE tenant_id=${tenantId} AND token_hash=${`later-blocked-${conversationId}`}`);
      await tx.execute(sql`UPDATE instinct_web_submissions SET state='accepted'
        WHERE tenant_id=${tenantId} AND conversation_id=${conversationId}`);
      assert.equal(await review(loginTenantId), "blocked", "accepted local work blocks review");
      await tx.execute(sql`UPDATE instinct_web_submissions SET state='running'
        WHERE tenant_id=${tenantId} AND conversation_id=${conversationId}`);
      assert.equal(await review(loginTenantId), "blocked", "active receipt blocks review");
      await tx.execute(sql`UPDATE instinct_web_submissions SET state='failed'
        WHERE tenant_id=${tenantId} AND conversation_id=${conversationId}`);
      await tx.execute(sql`UPDATE api_v1_conversation_runs SET status='running'
        WHERE tenant_id=${tenantId} AND conversation_id=${conversationId}`);
      assert.equal(await review(loginTenantId), "blocked", "running run blocks review");
      await tx.execute(sql`UPDATE api_v1_conversation_runs SET status='unknown'
        WHERE tenant_id=${tenantId} AND conversation_id=${conversationId}`);
      assert.equal(await review(loginTenantId), "blocked", "unknown run blocks review");
      await tx.execute(sql`UPDATE api_v1_conversation_runs SET status='failed'
        WHERE tenant_id=${tenantId} AND conversation_id=${conversationId}`);
      const commitFailure = new Error("delegated acknowledgement commit failed");
      await assert.rejects(acknowledgeInstinctFailureFromDesignatedLogin(
        tenantId, loginTenantId, conversationId, failedAt, {
          transaction: async (body: any) => tx.transaction(async inner => {
            await body(inner);
            throw commitFailure;
          }),
        } as any), error => error === commitFailure);
      const afterRollback: any = await tx.execute(sql`
        SELECT status FROM api_v1_conversation_runs
        WHERE tenant_id=${tenantId} AND conversation_id=${conversationId}`);
      assert.equal(afterRollback.rows[0].status, "failed", "failed delegated commit does not reopen the run");
      assert.equal(await review(loginTenantId), "resumed");
      assert.equal(await review(loginTenantId), "duplicate");

      const audited: any = await tx.execute(sql`
        SELECT actor_name, metadata FROM activity_log
        WHERE tenant_id=${tenantId} AND action='instinct_failure_acknowledged'
          AND resource_id=${String(conversationId)}
      `);
      assert.equal(audited.rows.length, 1);
      assert.equal(audited.rows[0].metadata.principalTenantId, loginTenantId);
      assert.equal(audited.rows[0].metadata.reviewAuthority, "designated_channel_operator");
      assert.equal(audited.rows[0].metadata.remoteUncertaintyAcknowledged, true);
      assert.notEqual(audited.rows[0].metadata.reviewAuthority, "platform_owner_admin");
      assert.match(audited.rows[0].actor_name, /8/);
      const retained: any = await tx.execute(sql`
        SELECT r.status, s.state, s.message FROM api_v1_conversation_runs r
        JOIN instinct_web_submissions s ON s.tenant_id=r.tenant_id AND s.conversation_id=r.conversation_id
        WHERE r.tenant_id=${tenantId} AND r.conversation_id=${conversationId}
      `);
      assert.deepEqual(retained.rows.map((row: any) => [row.status, row.state, row.message]),
        [["idle", "failed", "Review the saved legacy failure."]]);
      const freshClaim = () => claimApiV1FollowUp(tenantId, conversationId, "fresh-after-designated-review",
        "A new message, not the failed request.", "fresh-designated-request", true, tx as any);
      assert.equal((await freshClaim()).outcome, "claimed", "delegated acknowledgement permits a fresh turn");
      assert.equal((await freshClaim()).outcome, "duplicate", "fresh turn remains idempotent");
      assert.equal(await review(loginTenantId), "blocked", "old review cannot clear the new turn");
      throw rollback;
    }), error => error === rollback);

    for (const raw of ["", "8tail", "8.0", "9007199254740992"]) {
      process.env.INSTINCT_OWNER_LOGIN_TENANT_ID = raw;
      assert.equal(await acknowledgeInstinctFailureFromDesignatedLogin(tenantId, loginTenantId,
        2147480000, failedAt, { transaction: async () => { throw new Error("malformed binding must block before DB"); } } as any),
      "blocked", raw);
    }
    delete process.env.INSTINCT_OWNER_LOGIN_TENANT_ID;
    assert.equal(await acknowledgeInstinctFailureFromDesignatedLogin(tenantId, loginTenantId,
      2147480000, failedAt, { transaction: async () => { throw new Error("unset binding must block before DB"); } } as any),
    "blocked", "unset binding falls back to owner, not tenant 8");
  } finally {
    if (previousBinding === undefined) delete process.env.INSTINCT_OWNER_LOGIN_TENANT_ID;
    else process.env.INSTINCT_OWNER_LOGIN_TENANT_ID = previousBinding;
  }
});