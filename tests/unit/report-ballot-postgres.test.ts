import test from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { sql } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { advanceBusinessReportReview, initialBusinessReportReview } from "../../server/lib/business-report-review";
import { callReportGemini } from "../../server/lib/business-report-gemini";
import { reserveReportCompiler } from "../../server/lib/business-report-compiler-budget";

test("real PostgreSQL retains attempt events across the jury-to-compiler checkpoint and fences lost leases", {
  skip: process.env.REPORT_POSTGRES_TEST !== "1",
}, async () => {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    await client.query("BEGIN");
    await client.query(`CREATE TEMP TABLE agent_jobs (
      id integer, tenant_id integer, kind text, status text, payload jsonb,
      attempts integer, max_attempts integer, lease_until timestamptz,
      next_run_at timestamptz, error text
    ) ON COMMIT DROP`);
    const db = drizzle(client);
    const input: any = { tenantId: 1, orderId: "fixture", kind: "readiness",
      customerEmail: "", modelId: "fixture", intake: { company: "Fixture" },
      evidence: { sources: [] }, sections: [{ heading: "Summary", body: "Retained report fixture." }] };
    const payload = { input, state: initialBusinessReportReview(input) };
    await client.query(`INSERT INTO agent_jobs(id,tenant_id,kind,status,payload,attempts,max_attempts,lease_until)
      VALUES (10,1,'business_report_review','running',$1,1,100,NOW()+INTERVAL '5 minutes')`,
      [JSON.stringify(payload)]);
    let audit: any;
    let interleaved = false;
    const dialect = new PgDialect();
    await advanceBusinessReportReview({ id: 10, tenantId: 1, attempts: 1, payload } as any, {
      db: { execute: async query => {
        if (/jsonb_build_object/.test(dialect.sqlToQuery(query).sql) && !interleaved) {
          interleaved = true;
          await audit.record({ index: 0, spec: { modelId: "fixture" }, stage: "late", at: new Date().toISOString() });
        }
        return db.execute(query);
      } }, ownerTenantId: () => 1,
      deferJob: async (_id, _attempt, _tenant, saved) => {
        await db.execute(sql`UPDATE agent_jobs SET payload=${JSON.stringify(saved)}::jsonb WHERE id=10 AND tenant_id=1`);
        return true;
      },
      juryTriage: async options => {
        audit = options.reportBallotAudit!;
        await audit.assertLive();
        await audit.record({ index: 0, spec: { modelId: "fixture" }, stage: "started", at: new Date().toISOString() });
        await audit.record({ index: 0, spec: { modelId: "fixture" }, stage: "settled", at: new Date().toISOString(),
          result: { modelId: "fixture", provider: "fixture", ok: false, latencyMs: 1 } });
        return { verdict: "FIX", majority: 3, shouldEscalate: false, votes: [],
          aggregatorAnswer: "", concordance: null, totalLatencyMs: 1 };
      },
    });
    const row = (await client.query("SELECT payload FROM agent_jobs WHERE id=10 AND tenant_id=1")).rows[0];
    assert.equal(row.payload.state.phase, "wait_muse");
    const runs: any[] = Object.values(row.payload.reportJuryRuns);
    assert.deepEqual(runs[0].events.map((event: any) => event.stage), ["started", "settled", "late"]);
    assert.equal(interleaved, true, "late append raced the stale checkpoint payload");
    await client.query("UPDATE agent_jobs SET lease_until=NOW()-INTERVAL '1 second' WHERE id=10 AND tenant_id=1");
    await assert.rejects(audit.assertLive, /fenced subject/);
    await assert.rejects(() => audit.record({ index: 1, spec: { modelId: "next" },
      stage: "started", at: new Date().toISOString() }), /fence lost/);
    await audit.record({ index: 0, spec: { modelId: "fixture" }, stage: "late", at: new Date().toISOString() });
    const late = (await client.query("SELECT payload FROM agent_jobs WHERE id=10 AND tenant_id=1")).rows[0];
    assert.equal((Object.values(late.payload.reportJuryRuns)[0] as any).events.at(-1).stage, "late");
    assert.equal(late.payload.state.phase, "wait_muse", "late accounting cannot change the workflow");

    const expiredPayload = { input, state: initialBusinessReportReview(input) };
    await client.query(`INSERT INTO agent_jobs(id,tenant_id,kind,status,payload,attempts,max_attempts,lease_until)
      VALUES (11,1,'business_report_review','running',$1,1,100,NOW()+INTERVAL '5 minutes')`, [JSON.stringify(expiredPayload)]);
    await assert.rejects(() => advanceBusinessReportReview({ id: 11, tenantId: 1, attempts: 1, payload: expiredPayload } as any, {
      db, ownerTenantId: () => 1, deferJob: async () => true,
      juryTriage: async () => {
        await client.query("UPDATE agent_jobs SET lease_until=NOW()-INTERVAL '1 second' WHERE id=11");
        return { verdict: "ESCALATE", majority: 0, shouldEscalate: true, votes: [],
          aggregatorAnswer: "", concordance: null, totalLatencyMs: 1 };
      },
    }), /stop lost its fenced subject/);
    const expired = (await client.query("SELECT payload,max_attempts FROM agent_jobs WHERE id=11")).rows[0];
    assert.equal(expired.payload.state.phase, "jury_started");
    assert.equal(expired.max_attempts, 100, "expired workers cannot terminalize a job");

    const packageInput = { ...input, orderId: "company-package:20:readiness" };
    const packagePayload = { input: packageInput, state: initialBusinessReportReview(packageInput) };
    await client.query(`INSERT INTO agent_jobs(id,tenant_id,kind,status,payload,attempts,max_attempts,lease_until)
      VALUES (12,1,'business_report_review','running',$1,1,100,NOW()+INTERVAL '5 minutes'),
             (20,1,'company_report_package','pending',$2,1,100,NULL)`,
      [JSON.stringify(packagePayload), JSON.stringify({ tenantId: 1,
        state: { phase: "reviewing", reports: { readiness: { jobId: 12, status: "pending" } } } })]);
    let dispatched = 0;
    await assert.rejects(() => advanceBusinessReportReview({ id: 12, tenantId: 1, attempts: 1, payload: packagePayload } as any, {
      db, ownerTenantId: () => 1, deferJob: async () => true,
      juryTriage: async options => {
        await client.query(`UPDATE agent_jobs SET payload=jsonb_set(payload,'{state,phase}','"blocked"') WHERE id=20`);
        await options.reportBallotAudit!.assertLive();
        dispatched++;
        throw new Error("must not dispatch");
      },
    }), /Report jury execution failed/);
    assert.equal(dispatched, 0, "parent stop is rechecked immediately before transport");
  } finally {
    await client.query("ROLLBACK");
    await client.end();
  }
});

test("real PostgreSQL compiler recovery renews its claim and preserves both response and uncertain prior accounting", {
  skip: process.env.REPORT_POSTGRES_TEST !== "1",
}, async () => {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    await client.query("BEGIN");
    await client.query(`CREATE TEMP TABLE agent_jobs (
      id integer,tenant_id integer,kind text,status text,payload jsonb,attempts integer,max_attempts integer,
      lease_until timestamptz,next_run_at timestamptz,error text
    ) ON COMMIT DROP`);
    const db = drizzle(client);
    const input: any = { tenantId: 1, orderId: "fixture", kind: "readiness", reportOnly: true,
      customerEmail: "", modelId: "fixture", intake: { company: "Fixture" },
      evidence: { sources: [] }, sections: [{ heading: "Summary", body: "Retained fixture." }] };
    const grantId = "fd5ba6b5-564c-4422-af36-215bba4035f2";
    const state: any = { ...initialBusinessReportReview(input), phase: "wait_muse", compilerRecoveryId: grantId };
    const base = `compiler:1:${state.requestId}`;
    const original = { reservedMicros: 980000, status: "claimed", requestId: state.requestId, digest: state.digest };
    const payload: any = { input, state, compilerRuns: { [base]: original },
      reportJuryRuns: { retained: { events: [] } },
      compilerRecoveryGrants: { [grantId]: { jobId: 30, tenantId: 1, requestId: state.requestId,
        digest: state.digest, round: 1, priorKey: base, authorizedAt: new Date().toISOString(),
        maxAdditionalMicros: 1050000 } } };
    await client.query(`INSERT INTO agent_jobs VALUES
      (30,1,'business_report_review','running',$1,7,100,NOW()+INTERVAL '20 seconds',NOW(),NULL)`, [JSON.stringify(payload)]);
    let dispatched = 0, ledgerKey: string | undefined;
    const result = await advanceBusinessReportReview({ id: 30, tenantId: 1, attempts: 7, payload } as any, {
      db, ownerTenantId: () => 1, deferJob: async () => { throw new Error("atomic checkpoint required"); },
      reserveCompiler: async (i,s,id,attempt,amount) => reserveReportCompiler(i,s,id,attempt,amount,
        { transaction: async (fn: any) => fn(db) } as any),
      compile: async (tenant,prompt,schema,deps) => callReportGemini(tenant,prompt,schema,{
        ...deps, record: async entry => { ledgerKey=entry.idempotencyKey; return true; },
        request: async () => {
          dispatched++;
          const lease = (await client.query("SELECT lease_until>NOW()+INTERVAL '4 minutes' AS renewed FROM agent_jobs WHERE id=30")).rows[0];
          assert.equal(lease.renewed, true, "production SQL must renew, not merely assert a mocked lease");
          return { modelVersion: "gemini-4-argon", usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 200 },
            candidates: [{ finishReason: "STOP", content: { parts: [{ text: JSON.stringify({
              requestId: state.requestId, digest: state.digest, report: { sections: [{ heading: "Summary",
                blocks: [{ type: "recommendation", text: "Pilot the documented workflow with an assigned owner and a measured weekly outcome. ".repeat(4), sourceIds: [] }] }],
                unknowns: [] } }) }] } }] };
        },
      }),
    });
    assert.equal(result.deferred, true);
    const saved = (await client.query("SELECT payload,status FROM agent_jobs WHERE id=30")).rows[0];
    assert.equal(saved.status, "pending");
    assert.equal(saved.payload.state.phase, "wait_muse");
    assert.equal(saved.payload.state.compilerRecoveryId, undefined);
    assert.deepEqual(saved.payload.compilerRuns[base], original);
    const recovered = saved.payload.compilerRuns[`${base}:recovery:${grantId}`];
    assert.equal(recovered.status, "completed");
    assert.ok(recovered.response.rawBody && recovered.candidate && recovered.receipt);
    assert.equal(ledgerKey, `report-compiler:30:${base}:recovery:${grantId}`);
    assert.equal(dispatched, 1);
  } finally { await client.query("ROLLBACK"); await client.end(); }
});
