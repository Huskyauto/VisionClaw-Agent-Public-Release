import assert from "node:assert/strict";
import test from "node:test";
import {
  appendLoopGraphEdge,
  appendLoopOutcome,
  listLoopGraph,
  type LoopPortfolioQueryable,
} from "../../server/lib/loop-portfolio-store";

class FakeDb implements LoopPortfolioQueryable {
  calls: Array<{ text: string; values?: readonly unknown[] }> = [];
  responses: Array<{ rows: any[] }> = [];

  async query(text: string, values?: readonly unknown[]) {
    this.calls.push({ text, values });
    return this.responses.shift() ?? { rows: [] };
  }
}

test("loop outcome append is idempotent inside one tenant", async () => {
  const db = new FakeDb();
  db.responses.push(
    { rows: [] },
    { rows: [{ id: 7, event_key: "research:12:complete", tenant_id: 1 }] },
  );

  const result = await appendLoopOutcome(db, {
    tenantId: 1,
    eventKey: "research:12:complete",
    loopKind: "research",
    policyVersion: "balanced-v1",
    sourceType: "research_session",
    sourceId: "12",
    mode: "online",
    quality: 0.8,
    costUsd: 0.02,
    latencyMs: 100,
    safetyPassed: true,
    safetyEvaluated: true,
    independentlyEvaluated: true,
    persistedQuality: 0.75,
    explorationValue: 0.6,
    evidence: { evaluator: "deterministic" },
    occurredAt: "2026-09-18T00:00:00.000Z",
  });

  assert.equal(result.id, 7);
  assert.match(db.calls[0].text, /ON CONFLICT \(tenant_id, event_key\) DO NOTHING/i);
  assert.match(db.calls[1].text, /WHERE tenant_id = \$1 AND event_key = \$2/i);
});

test("loop graph edge fails closed when either endpoint is outside the tenant", async () => {
  const db = new FakeDb();
  db.responses.push({ rows: [] }, { rows: [] });

  await assert.rejects(
    appendLoopGraphEdge(db, {
      tenantId: 2,
      edgeKey: "derived:1:2",
      sourceEventId: 1,
      targetEventId: 2,
      relation: "derived_from",
      evidence: {},
    }),
    /same tenant/,
  );
  assert.match(db.calls[0].text, /source\.tenant_id = \$1/i);
  assert.match(db.calls[0].text, /target\.tenant_id = \$1/i);
});

test("loop graph reads always bind tenant and bounded limit", async () => {
  const db = new FakeDb();
  db.responses.push({ rows: [] }, { rows: [] });

  await listLoopGraph(db, 9, 5_000);

  assert.deepEqual(db.calls[0].values, [9, 500]);
  assert.deepEqual(db.calls[1].values, [9, 500, []]);
  assert.match(db.calls[0].text, /WHERE tenant_id = \$1/i);
  assert.match(db.calls[1].text, /WHERE tenant_id = \$1/i);
  assert.match(db.calls[1].text, /source_event_id = ANY\(\$3::int\[\]\)/i);
});