import test from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { sql } from "drizzle-orm";
import { reservePaidReportJury, ALDON_JURY_BATCH, ALDON_COMPLETION_BATCH, ALDON_RERUN_BATCH, ALDON_RECOVERY_BATCH } from "../../server/lib/business-report-paid-budget";
import { persistPaidReportJuryAudit } from "../../server/lib/business-report-paid-jury";
import { runPaidReportJury } from "../../server/lib/business-report-paid-jury";
import { executeBoundedReportSeat } from "../../server/moa";
import { readFileSync } from "node:fs";
import { resumeUnspentPaidReport } from "../../server/lib/business-report-recovery";

test("fresh $6 completion reservations cannot consume or reset the prior Aldon batch", {
  skip: process.env.REPORT_POSTGRES_TEST !== "1",
}, async () => {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    await client.query("BEGIN");
    await client.query(`CREATE TEMP TABLE agent_jobs (
      id serial, kind text, tenant_id integer, status text, payload jsonb,
      attempts integer, max_attempts integer, completed_at timestamptz, lease_until timestamptz
    ) ON COMMIT DROP`);
    const db = drizzle(client);
    const deps = { db: { transaction: async (fn: any) => fn(db) } as any };
    const makeInput = (batch: string, kind: "executive" | "readiness") => ({
      tenantId: 1, kind, operatorJobId: `${batch}-${kind}`, paidJuryBatch: batch,
      intake: { company: "Aldon Company", website: "https://www.aldonco.com/", focus: "full" },
    });
    const old = makeInput(ALDON_JURY_BATCH, "executive");
    const fresh = makeInput(ALDON_COMPLETION_BATCH, "executive");
    const readiness = makeInput(ALDON_COMPLETION_BATCH, "readiness");
    const rerun = makeInput(ALDON_RERUN_BATCH, "executive");
    const rerunReadiness = makeInput(ALDON_RERUN_BATCH, "readiness");
    const recovery = makeInput(ALDON_RECOVERY_BATCH, "executive");
    const recoveryReadiness = makeInput(ALDON_RECOVERY_BATCH, "readiness");
    for (const [id, input] of [[12, old], [13, fresh], [14, readiness], [15, rerun], [16, rerunReadiness],
      [17, recovery], [18, recoveryReadiness]] as const) {
      await client.query(`INSERT INTO agent_jobs(id,kind,tenant_id,status,payload,attempts,lease_until)
        VALUES($1,'business_report_review',1,'running',$2,1,NOW()+INTERVAL '10 minutes')`,
      [id, JSON.stringify({ input, state: { phase: "jury_started", juryFrom: "initial_jury", round: 1, requestId: "revision" } })]);
    }
    await reservePaidReportJury(old, 12, 1, "initial_jury:1:revision", "old", 2, deps);
    await reservePaidReportJury(fresh, 13, 1, "initial_jury:1:revision", "new", 3, deps);
    await reservePaidReportJury(readiness, 14, 1, "initial_jury:1:revision", "new", 3, deps);
    await reservePaidReportJury(rerun, 15, 1, "initial_jury:1:revision", "new", 3, deps);
    await reservePaidReportJury(rerunReadiness, 16, 1, "initial_jury:1:revision", "new", 3, deps);
    await reservePaidReportJury(recovery, 17, 1, "initial_jury:1:revision", "new", 3, deps);
    await reservePaidReportJury(recoveryReadiness, 18, 1, "initial_jury:1:revision", "new", 3, deps);
    await assert.rejects(reservePaidReportJury(recovery, 15, 1, "initial_jury:1:revision", "cross-batch", 0.1, deps), /binding/);
    await assert.rejects(reservePaidReportJury(recovery, 17, 1, "initial_jury:1:revision", "over", 0.000001, deps), /ceiling/);
    await assert.rejects(reservePaidReportJury(rerun, 13, 1, "initial_jury:1:revision", "cross-batch", 0.1, deps), /binding/);
    await assert.rejects(reservePaidReportJury(rerun, 15, 1, "initial_jury:1:revision", "over", 0.000001, deps), /ceiling/);
    await assert.rejects(reservePaidReportJury(fresh, 12, 1, "initial_jury:1:revision", "cross-batch", 0.1, deps), /binding/);
    await assert.rejects(reservePaidReportJury(fresh, 13, 1, "initial_jury:1:revision", "over", 0.01, deps), /ceiling/);
    const result = await client.query("SELECT payload FROM agent_jobs WHERE kind='business_report_jury_budget'");
    assert.equal(result.rows.length, 4);
    const prior = result.rows.find(row => row.payload.batch === ALDON_JURY_BATCH).payload;
    const next = result.rows.find(row => row.payload.batch === ALDON_COMPLETION_BATCH).payload;
    assert.equal(prior.allocations.executive.reservedMicros, 2_000_000);
    assert.equal(next.allocations.executive.reservedMicros + next.allocations.readiness.reservedMicros, 6_000_000);
    const rerunRecord = result.rows.find(row => row.payload.batch === ALDON_RERUN_BATCH).payload;
    assert.equal(rerunRecord.allocations.executive.reservedMicros + rerunRecord.allocations.readiness.reservedMicros, 6_000_000);
    const recoveryRecord = result.rows.find(row => row.payload.batch === ALDON_RECOVERY_BATCH).payload;
    assert.equal(recoveryRecord.allocations.executive.reservedMicros + recoveryRecord.allocations.readiness.reservedMicros, 6_000_000);
  } finally {
    await client.query("ROLLBACK");
    await client.end();
  }
});

test("report reservation executes on PostgreSQL before any paid dispatch", {
  skip: process.env.REPORT_POSTGRES_TEST !== "1",
}, async () => {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    await client.query("BEGIN");
    // Connection-local table: no application rows, sequences or production data touched.
    await client.query(`CREATE TEMP TABLE agent_jobs (
      id serial, kind text, tenant_id integer,
      status text CHECK (status IN ('pending','running','succeeded','failed','failed_terminal','cancelled')),
      payload jsonb,
      attempts integer, max_attempts integer, completed_at timestamptz, lease_until timestamptz,
      error text, failure_class text, next_run_at timestamptz
    ) ON COMMIT DROP`);
    const input: any = { tenantId: 1, kind: "executive", operatorJobId: "postgres-fixture",
      paidJuryBatch: ALDON_JURY_BATCH, intake: {
        company: "Aldon Company", website: "https://www.aldonco.com/", focus: "full",
      } };
    const payload = { input, state: { phase: "jury_started", juryFrom: "initial_jury",
      round: 1, requestId: "revision" } };
    await client.query(`INSERT INTO agent_jobs(id,kind,tenant_id,status,payload,attempts,lease_until)
      VALUES(12,'business_report_review',1,'running',$1,1,NOW()+INTERVAL '10 minutes')`, [JSON.stringify(payload)]);
    const db = drizzle(client);
    await reservePaidReportJury(input, 12, 1, "initial_jury:1:revision", "fixture-seat", 0.25, {
      db: { transaction: async (fn: any) => fn(db) } as any,
    });
    const result = await db.execute(sql`SELECT payload FROM agent_jobs WHERE kind='business_report_jury_budget'`);
    assert.equal((result.rows[0].payload as any).allocations.executive.reservedMicros, 250_000);
    await persistPaidReportJuryAudit({
      question: "Review the retained snapshot", tenantId: 1, proposers: [],
      aggregated: "No paid dispatch: PostgreSQL fixture", aggregatorModel: "fixture",
      totalLatencyMs: 0, concordance: null, shouldEscalate: true,
    }, input, 12, 1, "initial_jury:1:revision", db);
    const audit = await db.execute(sql`SELECT payload->'paidJuryRuns' AS audit FROM agent_jobs WHERE id=12`);
    assert.ok((audit.rows[0].audit as any)["initial_jury:1:revision"]);
    {
      const retained = process.env.REPORT_RETAINED_FIXTURE
        ? JSON.parse(readFileSync(process.env.REPORT_RETAINED_FIXTURE, "utf8"))
        : { evidence: { sources: [{ id: "S1", text: "Public business context. ".repeat(1500) }] },
          sections: [{ heading: "Summary", body: "Measure a bounded pilot before rollout." }] };
      const snapshot = JSON.stringify({ evidence: retained.evidence, sections: retained.sections });
      const previous = process.env.OWNER_JURY_DIRECT_API_ENABLED;
      process.env.OWNER_JURY_DIRECT_API_ENABLED = "1";
      try {
        let dispatches = 0;
        const review = await runPaidReportJury({
          tenantId: 1, question: "Review this company report", invokedVia: "business-report-evidence-review",
          collectProposerEvidence: async spec => ({ seatId: spec.modelId, runId: spec.modelId,
            actor: "server-owned-juror-evidence-runner", receipts: [{
              id: `${spec.modelId}:snapshot`, runId: spec.modelId, tool: "report_snapshot_read",
              ok: true, startedAt: new Date().toISOString(), completedAt: new Date().toISOString(),
              excerpt: snapshot,
            }] }),
        }, input, 12, 1, "initial_jury:1:revision", {
          reserve: (i, j, a, p, m, usd) => reservePaidReportJury(i, j, a, p, m, usd,
            { db: { transaction: async (fn: any) => fn(db) } as any }),
          call: (spec, prompt, tenant, reserve) => executeBoundedReportSeat(spec, prompt, tenant, reserve, {
            dispatch: async () => {
              dispatches++;
              return { modelId: spec.modelId, provider: spec.providerLane!, ok: true,
                answer: "VERDICT: REJECT", latencyMs: 0 };
            },
          }),
          audit: r => persistPaidReportJuryAudit(r, input, 12, 1, "initial_jury:1:revision", db),
        });
        assert.deepEqual(review.proposers.map(p => p.error ?? "ok"), ["ok", "ok", "ok"]);
        assert.equal(dispatches, 3);
      } finally {
        if (previous === undefined) delete process.env.OWNER_JURY_DIRECT_API_ENABLED;
        else process.env.OWNER_JURY_DIRECT_API_ENABLED = previous;
      }
    }
    const recoveryId = "294a157b-f21d-4d3d-926e-cb7adf7eff17";
    const recoveryPayload = { input: { ...input, kind: "readiness", operatorJobId: recoveryId },
      state: { phase: "blocked", juryFrom: "initial_jury", juryHistory: [],
        expiresAt: new Date(Date.now() + 3600_000).toISOString() } };
    await client.query(`INSERT INTO agent_jobs(id,kind,tenant_id,status,payload,attempts,max_attempts)
      VALUES(13,'business_report_review',1,'failed_terminal',$1,1,1)`, [JSON.stringify(recoveryPayload)]);
    const recoveryDb = { transaction: async (fn: any) => fn(db) } as any;
    await assert.rejects(resumeUnspentPaidReport(2, recoveryId, recoveryDb), /Owner/);
    for (const changes of [
      { paidJuryRuns: {} }, { unspentRecovery: {} }, { assemblyStarted: {} },
      { state: { ...recoveryPayload.state, juryHistory: [{ verdict: "FIX" }] } },
      { state: { ...recoveryPayload.state, expiresAt: "invalid" } },
      { state: { ...recoveryPayload.state, expiresAt: "2020-01-01T00:00:00Z" } },
      { state: { ...recoveryPayload.state, juryFrom: "final_jury" } },
    ]) {
      await client.query("UPDATE agent_jobs SET payload=$1 WHERE id=13",
        [JSON.stringify({ ...recoveryPayload, ...changes })]);
      await assert.rejects(resumeUnspentPaidReport(1, recoveryId, recoveryDb), /eligible/);
    }
    await client.query("UPDATE agent_jobs SET payload=$1 WHERE id=13", [JSON.stringify(recoveryPayload)]);
    const resumed = await resumeUnspentPaidReport(1, recoveryId, recoveryDb);
    assert.equal(resumed.evidenceReviewJobId, 13);
    await assert.rejects(resumeUnspentPaidReport(1, recoveryId, recoveryDb), /eligible/);
    // A reserved kind may never be reset, even with a terminal, otherwise eligible draft.
    const reservedId = "f5600b9b-ac7e-44f3-b8d7-7bb56d1b5604";
    await client.query(`INSERT INTO agent_jobs(id,kind,tenant_id,status,payload,attempts,max_attempts)
      VALUES(14,'business_report_review',1,'failed_terminal',$1,1,1)`, [JSON.stringify({
        ...recoveryPayload, input: { ...input, operatorJobId: reservedId },
      })]);
    await assert.rejects(resumeUnspentPaidReport(1, reservedId, recoveryDb), /reservation exists/);
  } finally {
    await client.query("ROLLBACK");
    await client.end();
  }
});
