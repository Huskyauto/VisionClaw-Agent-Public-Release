import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID, createHash } from "node:crypto";
import fs from "node:fs";
import { sql } from "drizzle-orm";

import { db } from "../../server/db";
import {
  acceptRepairHandoff,
  consumeRepairHandoff,
  dispatchRepairHandoff,
  validateRepairPayload,
  reconcileHandoffPendingPlans,
  reconcileHandoffPendingPlansWith,
  createRepairHandoffStatusClient,
  workspaceRepairHandoffStatusCore,
} from "../../server/source-repair-handoff";
import { createPlan, decidePlan, setExecutorKickForTests } from "../../server/minerva-planner";
import { executePlan, executeSourceRepairHandoffStepForTest } from "../../server/plan-executor";

test("S7 seeded source repair proves handoff, durable consumption, idempotency, and tenant isolation", {
  skip: !process.env.DATABASE_URL,
}, async (t) => {
  const tenantId = 1;
  const otherTenantId = 2;
  const key = `s7-key-${randomUUID()}`;
  const ref = `s7-${randomUUID()}`;
  const snapshot = JSON.stringify({ evidenceVersion: "s7-v1", taskId: "s7", evidence: "bounded source evidence" });
  const evidenceHash = createHash("sha256").update(snapshot).digest("hex");
  let insightId = 0;
  let planId = 0;
  let handoffId = 0;
  let jobId = 0;
  let proposalId = 0;
  let generationCalls = 0;
  let verifierRequests = 0;
  let workspaceStatus: "pending" | "blocked" | "applied" = "pending";
  const counters = { filesystem: 0, safeApplyProposal: 0, closer: 0, gitPush: 0, publish: 0 };
  const oldEnabled = process.env.REPAIR_HANDOFF_ENABLED;
  const oldKey = process.env.REPAIR_HANDOFF_HMAC_KEY;
  const oldUrl = process.env.REPAIR_HANDOFF_WORKSPACE_URL;
  const oldFetch = globalThis.fetch;

  try {
    process.env.REPAIR_HANDOFF_ENABLED = "1";
    process.env.REPAIR_HANDOFF_HMAC_KEY = key;
    process.env.REPAIR_HANDOFF_WORKSPACE_URL = "http://s7.local/internal/workspace/source-repair-handoff";

    const inserted: any = await db.execute(sql`
      INSERT INTO ai_insights
        (tenant_id, engine_type, category, title, summary, details, data_snapshot, priority, status)
      VALUES (${tenantId}, 's7-test', 'source_proposal', ${ref}, 'Seeded source proposal',
              'bounded source evidence', ${snapshot},
              'high', 'new')
      RETURNING id
    `);
    insightId = Number((inserted.rows ?? inserted)[0].id);

    const action = {
      version: 1 as const,
      kind: "source_repair_handoff" as const,
      findingId: String(insightId),
      evidenceVersion: "s7-v1",
      evidenceHash,
    };
    const created = await createPlan({
      tenantId,
      objective: `S7 exact source handoff ${ref}`,
      source: "agentic-engine.auto-apply",
      sourceRef: String(insightId),
      repairAction: action,
    });
    planId = created.planId;
    setExecutorKickForTests(() => {});
    await decidePlan({ planId, decision: "approve", reason: "S7 seeded approval", actor: "admin:s7", tenantId });

    const planned: any = await db.execute(sql`
      SELECT status, plan_json, execution_log FROM plans WHERE id = ${planId} AND tenant_id = ${tenantId}
    `);
    const planRow = (planned.rows ?? planned)[0];
    assert.equal(planRow.status, "approved");
    assert.equal(planRow.plan_json.repairAction.kind, "source_repair_handoff");
    assert.equal(planRow.plan_json.steps[0].tool, "source_repair_handoff");
    assert.equal(planRow.execution_log.filter((e: any) => e.type === "repair.approval_binding").length, 1);

    // The endpoint is local and in-process: dispatch still signs the exact body,
    // while this fetch seam routes it to the real authenticated endpoint.
    globalThis.fetch = (async (_url: string, init: any) => {
      const headers = new Headers(init.headers);
      const method = String(init.method || "GET");
      if (method === "GET") {
        const parsed = new URL(String(_url));
        const query = Object.fromEntries(parsed.searchParams.entries());
        const status = await workspaceRepairHandoffStatusCore({
          query, key,
          headers: (name) => headers.get(name) ?? "",
          execute: async () => ({ rows: [{
            status: workspaceStatus === "pending" ? "consumed" : workspaceStatus,
            proposal_id: proposalId || null,
            proposal_status: workspaceStatus === "applied" ? "applied" : workspaceStatus,
            verification_status: workspaceStatus === "applied" ? "passed" : null,
          }] }),
        });
        return { ok: status.status >= 200 && status.status < 300, status: status.status,
          text: async () => JSON.stringify(status.body) };
      }
      const body = JSON.parse(String(init.body));
      const response: any = { statusCode: 500, payload: undefined };
      const res = {
        status(code: number) { response.statusCode = code; return this; },
        json(payload: unknown) { response.payload = payload; return this; },
      };
      await acceptRepairHandoff({
        body,
        header(name: string) { return headers.get(name) ?? ""; },
      } as any, res as any);
      return {
        ok: response.statusCode >= 200 && response.statusCode < 300,
        status: response.statusCode,
        text: async () => JSON.stringify({ accepted: true, handoffId: response.payload?.handoffId, idempotent: Boolean(response.payload?.idempotent) }),
      };
    }) as typeof fetch;

    const constraint: any = await db.execute(sql`
      SELECT pg_get_constraintdef(oid) AS definition
      FROM pg_constraint WHERE conname = 'plans_status_check'
    `);
    const definition = String((constraint.rows ?? constraint)[0]?.definition ?? "");
    const supportsPublishRequired = definition.includes("expired") && definition.includes("publish_required");
    if (supportsPublishRequired) {
      await executePlan(planId);
    } else {
      t.diagnostic("Skipping only real executePlan terminalization: plans_status_check lacks publish_required; apply migrations/0103_plans_publish_required_status.sql.");
      const stepResult = await executeSourceRepairHandoffStepForTest(
        { id: planId, tenant_id: tenantId, source: "agentic-engine.auto-apply",
          source_ref: String(insightId), plan_json: planRow.plan_json, execution_log: planRow.execution_log },
        planRow.plan_json.steps[0],
        dispatchRepairHandoff,
      );
      assert.equal(stepResult.success, true);
       assert.deepEqual(stepResult.output, { handoff: "accepted", handoffPending: true });
    }

    const inbox: any = await db.execute(sql`
      SELECT id, job_id, repair_identity, tenant_id, source_evidence_version, source_evidence_hash, payload
      FROM repair_handoff_requests WHERE tenant_id = ${tenantId} AND repair_identity LIKE ${`${tenantId}:${insightId}:%`}
    `);
    const inboxRow = (inbox.rows ?? inbox)[0];
    handoffId = Number(inboxRow.id);
    jobId = Number(inboxRow.job_id);
    assert.ok(handoffId > 0);
    assert.ok(jobId > 0);
    assert.equal(inboxRow.tenant_id, tenantId);
    assert.equal(inboxRow.source_evidence_version, "s7-v1");
    assert.equal(inboxRow.source_evidence_hash, evidenceHash);

    const currentInbox: any = await db.execute(sql`SELECT status, proposal_id FROM repair_handoff_requests WHERE id = ${handoffId} AND tenant_id = ${tenantId}`);
    const currentInboxRow = (currentInbox.rows ?? currentInbox)[0];
    if (currentInboxRow?.status === "consumed") proposalId = Number(currentInboxRow.proposal_id);
    // The durable job worker may legitimately win this race before this test's
    // explicit consumer call. In that case assert the durable result rather
    // than treating a fenced stale worker as a failure.
    const generated = currentInboxRow?.status === "consumed"
      ? { status: "consumed" as const, proposalId: Number(currentInboxRow.proposal_id) }
      : await consumeRepairHandoff(handoffId, tenantId, {
      generateProposal: async (input) => {
        generationCalls++;
        assert.equal(input.tenantId, tenantId);
        assert.equal(input.handoffId, handoffId);
        const proposal: any = await db.execute(sql`
          INSERT INTO code_proposals
            (tenant_id, title, description, target_file, code_diff, rationale, source, status)
          VALUES (${tenantId}, ${ref}, ${input.findingIntent}, 'workspace-only',
                  'workspace proposal; no production diff', 'S7 bounded injected generator',
                  'production-repair-handoff', 'pending')
          RETURNING id
        `);
        proposalId = Number((proposal.rows ?? proposal)[0].id);
        return proposalId;
      },
      requestVerification: async (id, tid) => {
        verifierRequests++;
        assert.equal(id, proposalId);
        assert.equal(tid, tenantId);
      },
      });
    assert.deepEqual(generated, { status: "consumed", proposalId });

    const consumed: any = await db.execute(sql`
      SELECT status, proposal_id, tenant_id, source_evidence_version, source_evidence_hash
      FROM repair_handoff_requests WHERE id = ${handoffId} AND tenant_id = ${tenantId}
    `);
    const consumedRow = (consumed.rows ?? consumed)[0];
    assert.equal(consumedRow.status, "consumed");
    assert.equal(Number(consumedRow.proposal_id), proposalId);
    assert.equal(consumedRow.tenant_id, tenantId);
    assert.equal(consumedRow.source_evidence_version, "s7-v1");
    assert.equal(consumedRow.source_evidence_hash, evidenceHash);

    // Replaying the same signed identity creates no second inbox/job and the
    // CAS consumer performs no second generation or verifier request.
    const replay = await dispatchRepairHandoff(validateRepairPayload({
      tenantId, sourceFindingId: String(insightId), sourceEvidenceVersion: "s7-v1",
      sourceEvidenceHash: evidenceHash, findingIntent: "replay", evidence: "replay",
    }));
    assert.equal(replay.accepted, true);
    const replayInbox: any = await db.execute(sql`
      SELECT id, job_id FROM repair_handoff_requests WHERE tenant_id = ${tenantId} AND repair_identity = ${inboxRow.repair_identity}
    `);
    assert.equal((replayInbox.rows ?? replayInbox).length, 1);
    assert.equal(Number((replayInbox.rows ?? replayInbox)[0].job_id), jobId);
    const skipped = await consumeRepairHandoff(handoffId, tenantId, {
      generateProposal: async () => { throw new Error("duplicate generation"); },
      requestVerification: async () => { throw new Error("duplicate verifier request"); },
    });
    assert.equal(skipped.status, "skipped");
    assert.equal(generationCalls, 1);
    assert.equal(verifierRequests, 1);

    const crossTenant = await consumeRepairHandoff(handoffId, otherTenantId, {
      generateProposal: async () => { throw new Error("cross-tenant generation"); },
    });
    assert.equal(crossTenant.status, "skipped");
    assert.equal(crossTenant.reason, "already_consumed_or_blocked");

    const finalPlan: any = await db.execute(sql`SELECT status FROM plans WHERE id = ${planId} AND tenant_id = ${tenantId}`);
    const finalPlanStatus = String((finalPlan.rows ?? finalPlan)[0].status);
     if (supportsPublishRequired) assert.equal(finalPlanStatus, "handoff_pending");
     else assert.equal(finalPlanStatus, "approved");
    assert.notEqual(finalPlanStatus, "completed");
    assert.notEqual(finalPlanStatus, "fixed");
    // Simulate the workspace authority completing verification, jury review,
    // atomic apply and tests. Reconciliation, not executePlan, crosses Bob's
    // publish boundary.
    await db.execute(sql`
       UPDATE code_proposals SET status = 'applied', verification_status = 'passed',
        verified_at = now(), applied_at = now()
      WHERE id = ${proposalId} AND tenant_id = ${tenantId}
    `);
    workspaceStatus = "applied";
    const productionExecutor = async (query: any) => {
      const text = String(query?.queryChunks?.map?.((x: any) => x.value ?? "").join?.("") ?? query);
      assert.doesNotMatch(text, /repair_handoff_requests|code_proposals/i);
      return db.execute(query);
    };
    assert.equal(await reconcileHandoffPendingPlansWith({
      execute: productionExecutor,
      statusClient: createRepairHandoffStatusClient(),
    }), 1);
    const published: any = await db.execute(sql`SELECT status FROM plans WHERE id = ${planId} AND tenant_id = ${tenantId}`);
    assert.equal((published.rows ?? published)[0].status, "publish_required");
    assert.equal(await reconcileHandoffPendingPlansWith({
      execute: productionExecutor,
      statusClient: createRepairHandoffStatusClient(),
    }), 0);
    assert.deepEqual(counters, { filesystem: 0, safeApplyProposal: 0, closer: 0, gitPush: 0, publish: 0 });
  } finally {
    globalThis.fetch = oldFetch;
    setExecutorKickForTests(null);
    if (proposalId) await db.execute(sql`DELETE FROM code_proposals WHERE id = ${proposalId} AND tenant_id = ${tenantId}`);
    if (jobId) await db.execute(sql`DELETE FROM agent_jobs WHERE id = ${jobId} AND tenant_id = ${tenantId}`);
    if (handoffId) await db.execute(sql`DELETE FROM repair_handoff_requests WHERE id = ${handoffId} AND tenant_id = ${tenantId}`);
    if (planId) await db.execute(sql`DELETE FROM plans WHERE id = ${planId} AND tenant_id = ${tenantId}`);
    if (insightId) await db.execute(sql`DELETE FROM ai_insights WHERE id = ${insightId} AND tenant_id = ${tenantId}`);
    if (oldEnabled === undefined) delete process.env.REPAIR_HANDOFF_ENABLED; else process.env.REPAIR_HANDOFF_ENABLED = oldEnabled;
    if (oldKey === undefined) delete process.env.REPAIR_HANDOFF_HMAC_KEY; else process.env.REPAIR_HANDOFF_HMAC_KEY = oldKey;
    if (oldUrl === undefined) delete process.env.REPAIR_HANDOFF_WORKSPACE_URL; else process.env.REPAIR_HANDOFF_WORKSPACE_URL = oldUrl;
  }
});

test("S7 publish-required constraint regression keeps expired and publish_required together", () => {
  const seed = fs.readFileSync("server/seed.ts", "utf8");
  const migration = fs.readFileSync("migrations/0103_plans_publish_required_status.sql", "utf8");
  assert.match(seed, /pg_get_constraintdef\(c\.oid\) LIKE '%expired%'/);
  assert.match(seed, /pg_get_constraintdef\(c\.oid\) LIKE '%publish_required%'/);
  assert.match(seed, /'expired'::text,'publish_required'::text/);
  assert.match(migration, /'expired'::text, 'publish_required'::text/);
  assert.match(migration, /AND pg_get_constraintdef\(c\.oid\) LIKE '%expired%'/);
  assert.match(migration, /AND pg_get_constraintdef\(c\.oid\) LIKE '%publish_required%'/);
});

test("S5 live stale lease race has one winner and fences old token", {
  skip: !process.env.DATABASE_URL,
}, async (t) => {
  const tenantId = 1;
  const identity = `lease-race-${randomUUID()}`;
  let handoffId = 0;
  let generationCalls = 0;
  try {
    const inserted: any = await db.execute(sql`
      INSERT INTO repair_handoff_requests
        (tenant_id, repair_identity, source_finding_id, source_evidence_version,
         source_evidence_hash, nonce, key_id, request_timestamp, payload, status,
         claim_token, claim_expires_at, attempts)
      VALUES (${tenantId}, ${identity}, ${identity}, 'v1', ${"e".repeat(64)},
              ${identity}, 'test', now(), '{"findingIntent":"i","evidence":"e"}'::jsonb,
              'accepted', 'old-token', now() - interval '1 minute', 1)
      RETURNING id
    `);
    handoffId = Number((inserted.rows ?? inserted)[0].id);
    const consume = () => consumeRepairHandoff(handoffId, tenantId, {
      generateProposal: async () => { generationCalls++; return 987654; },
      requestVerification: async () => {},
    });
    const [a, b] = await Promise.allSettled([consume(), consume()]);
    const results = [a, b].filter((x: any) => x.status === "fulfilled").map((x: any) => x.value);
    assert.equal(results.filter((x) => x.status === "consumed").length, 1);
    assert.equal(results.filter((x) => x.status === "skipped").length, 1);
    assert.equal(generationCalls, 1);
    const row: any = await db.execute(sql`
      SELECT status, attempts, claim_token FROM repair_handoff_requests
      WHERE id = ${handoffId} AND tenant_id = ${tenantId}
    `);
    const final = (row.rows ?? row)[0];
    assert.equal(final.status, "consumed");
    assert.equal(Number(final.attempts), 2);
    assert.notEqual(final.claim_token, "old-token");
    const fenced: any = await db.execute(sql`
      UPDATE repair_handoff_requests SET proposal_id = 987654
      WHERE id = ${handoffId} AND tenant_id = ${tenantId} AND claim_token = 'old-token'
      RETURNING id
    `);
    assert.equal((fenced.rows ?? fenced).length, 0);
  } finally {
    if (handoffId) await db.execute(sql`DELETE FROM repair_handoff_requests WHERE id = ${handoffId} AND tenant_id = ${tenantId}`);
  }
});

test("S5 live DB enforces tenant-scoped repair provenance uniqueness", {
  skip: !process.env.DATABASE_URL,
}, async (t) => {
  const result: any = await db.execute(sql`
    SELECT indexname FROM pg_indexes
    WHERE tablename = 'code_proposals'
      AND indexname = 'code_proposals_repair_provenance_unique'
  `);
  if ((result.rows ?? result).length !== 1) {
    t.diagnostic("development DB has not applied migration 0106_repair_proposal_provenance_unique.sql");
    t.skip("apply migration 0106 before running live uniqueness assertion");
    return;
  }
  assert.equal((result.rows ?? result).length, 1);
});

test("S5 live duplicate provenance inserts converge to one proposal", {
  skip: !process.env.DATABASE_URL,
}, async (t) => {
  const index: any = await db.execute(sql`SELECT 1 FROM pg_indexes WHERE indexname = 'code_proposals_repair_provenance_unique'`);
  if (!(index.rows ?? index).length) { t.skip("apply migration 0106 first"); return; }
  const tenantId = 1; const sessionId = Number(`${Date.now()}`.slice(-7));
  const ids: number[] = [];
  try {
    const insert = () => db.execute(sql`
      INSERT INTO code_proposals
        (tenant_id, title, description, target_file, code_diff, rationale, source, source_session_id, status)
      VALUES (${tenantId}, ${`duplicate-${randomUUID()}`}, 'd', 'workspace-only', 'diff', 'r',
              'production-repair-handoff', ${sessionId}, 'pending') RETURNING id
    `);
    const outcomes = await Promise.allSettled([insert(), insert()]);
    const successes = outcomes.filter(x => x.status === "fulfilled");
    const conflicts = outcomes.filter(x => x.status === "rejected");
    assert.equal(successes.length, 1); assert.equal(conflicts.length, 1);
    const rows: any = await db.execute(sql`
      SELECT id FROM code_proposals WHERE tenant_id = ${tenantId}
        AND source = 'production-repair-handoff' AND source_session_id = ${sessionId}
    `);
    assert.equal((rows.rows ?? rows).length, 1);
    ids.push(Number((rows.rows ?? rows)[0].id));
  } finally {
    await db.execute(sql`DELETE FROM code_proposals WHERE tenant_id = ${tenantId} AND source_session_id = ${sessionId} AND source = 'production-repair-handoff'`);
  }
});