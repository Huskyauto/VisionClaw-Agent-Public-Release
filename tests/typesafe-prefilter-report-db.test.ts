import test from "node:test";
import assert from "node:assert/strict";
import { sql } from "drizzle-orm";
import { db, pool } from "../server/db";
import { factPrefilterReportQuery } from "../server/lib/typesafe-prefilter-report";
import { buildJevDecisionTrace, persistJevDecisionTrace } from "../server/lib/typesafe-decision-trace";

test("report SQL isolates tenants and separates real skips, shadow candidates and failures", async () => {
  await db.transaction(async (tx) => {
    // Connection-local temporary fixture only; no application observations change.
    await tx.execute(sql`CREATE TEMP TABLE typesafe_fact_prefilter_observations (
      tenant_id int, version text, mode text, model text, status text,
      durable_fact_probability real, input_tokens int, output_tokens int,
      extractor_ran boolean, facts_written int, error_class text,
      decision_receipt jsonb, created_at timestamp DEFAULT now()
    ) ON COMMIT DROP`);
    await tx.execute(sql`INSERT INTO pg_temp.typesafe_fact_prefilter_observations
      (tenant_id, version, mode, model, status, durable_fact_probability, input_tokens, output_tokens,
       extractor_ran, facts_written, error_class, decision_receipt)
      VALUES
      (42,'jev-session-fact-prefilter-v2','enforce','fixture','validated',0.01,10,1,false,0,null,'{}'),
      (42,'jev-session-fact-prefilter-v2','shadow','fixture','validated',0.01,10,1,true,0,null,'{}'),
      (42,'jev-session-fact-prefilter-v2','shadow','fixture','validated',0.01,10,1,true,2,null,'{}'),
      (42,'jev-session-fact-prefilter-v2','shadow','fixture','validated',0.01,10,1,true,null,'extractor_failed','{}'),
      (42,'jev-session-fact-prefilter-v1','enforce','fixture','validated',0.01,10,1,false,0,null,null),
      (43,'jev-session-fact-prefilter-v2','enforce','fixture','validated',0.01,9000,9000,false,0,null,'{}')`);
    const rows = (await tx.execute(factPrefilterReportQuery(42, 7))).rows as Record<string, unknown>[];
    assert.equal(rows.length, 2);
    const enforce = rows.find((row) => row.mode === "enforce")!;
    const shadow = rows.find((row) => row.mode === "shadow")!;
    assert.equal(enforce.actual_skipped_calls, 1);
    assert.equal(Number(enforce.jev_input_tokens), 10);
    assert.equal(shadow.actual_skipped_calls, 0);
    assert.equal(shadow.shadow_empty_candidates, 1);
    assert.equal(shadow.shadow_missed_fact_candidates, 1);
    assert.equal(shadow.failed_outcomes, 1);
    assert.equal((await tx.execute(factPrefilterReportQuery(44, 7))).rows.length, 0);
  });
});

test("production audit writer confirms an exact synthetic trace without retaining raw state", async () => {
  const prior = process.env.NODE_ENV;
  process.env.NODE_ENV = "development";
  let id: number | undefined;
  try {
    const trace = buildJevDecisionTrace({
      tenantId: 1, request: { state: "synthetic-private-test-state", questions: {
        test: { type: "noul", instructions: "Is the synthetic fixture complete?" },
      } },
      response: { model: "jev-fixture", usage: { input_tokens: 1, output_tokens: 1 },
        answers: { test: { type: "noul", noul: 0.5 } } },
      output: "synthetic-private-test-output", questionVersion: "fixture-v1",
      latencyMs: 1, policy: { advisoryOnly: true },
    });
    assert.equal((await persistJevDecisionTrace(2, "deliverable", trace)).status, "not_attempted");
    const result = await persistJevDecisionTrace(1, "deliverable", trace);
    id = result.activityId;
    assert.equal(result.status, "persisted");
    assert.ok(id);
    const saved = (await db.execute(sql`SELECT metadata FROM agent_activity
      WHERE tenant_id = 1 AND id = ${id} AND activity_type = 'jev_decision'`)).rows;
    assert.equal(saved.length, 1);
    assert.ok(!JSON.stringify(saved).includes("synthetic-private-test-state"));
    assert.ok(!JSON.stringify(saved).includes("synthetic-private-test-output"));
    assert.equal((saved[0].metadata as any).trace.outputDigest, trace.outputDigest);
  } finally {
    if (id) await db.execute(sql`DELETE FROM agent_activity
      WHERE tenant_id = 1 AND id = ${id} AND activity_type = 'jev_decision'
      AND metadata->'trace'->>'questionVersion' = 'fixture-v1'`);
    if (prior === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = prior;
  }
});

test.after(async () => { await pool.end(); });
