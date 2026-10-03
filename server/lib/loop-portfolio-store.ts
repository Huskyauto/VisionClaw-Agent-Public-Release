export interface LoopPortfolioQueryable {
  query(text: string, values?: readonly unknown[]): Promise<{ rows: any[] }>;
}

export interface AppendLoopOutcomeInput {
  tenantId: number;
  eventKey: string;
  loopKind: string;
  policyVersion: string;
  sourceType: string;
  sourceId: string;
  taskClass?: string | null;
  mode: "online" | "replay" | "shadow" | "report_only";
  quality: number;
  costUsd: number;
  latencyMs: number;
  safetyPassed: boolean;
  safetyEvaluated: boolean;
  independentlyEvaluated: boolean;
  persistedQuality: number | null;
  explorationValue: number | null;
  evidence: Record<string, unknown>;
  occurredAt: string;
}

export interface AppendLoopGraphEdgeInput {
  tenantId: number;
  edgeKey: string;
  sourceEventId: number;
  targetEventId: number;
  relation: "succeeded_by" | "derived_from" | "replayed_against" | "crossover_of";
  evidence: Record<string, unknown>;
}

const MAX_EVIDENCE_BYTES = 8_000;

function boundedText(name: string, value: string, max: number): string {
  const normalized = value.trim();
  if (!normalized || normalized.length > max) {
    throw new Error(`${name} must contain 1-${max} characters`);
  }
  return normalized;
}

function tenantId(value: number): number {
  if (!Number.isInteger(value) || value < 1) throw new Error("tenantId must be a positive integer");
  return value;
}

function unit(name: string, value: number | null): number | null {
  if (value === null) return null;
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error(`${name} must be between 0 and 1`);
  }
  return value;
}

function boundedEvidence(evidence: Record<string, unknown>): string {
  const serialized = JSON.stringify(evidence ?? {});
  if (Buffer.byteLength(serialized, "utf8") > MAX_EVIDENCE_BYTES) {
    throw new Error(`evidence exceeds ${MAX_EVIDENCE_BYTES} bytes`);
  }
  return serialized;
}

export async function appendLoopOutcome(
  db: LoopPortfolioQueryable,
  input: AppendLoopOutcomeInput,
): Promise<any> {
  const tid = tenantId(input.tenantId);
  const occurredAt = new Date(input.occurredAt);
  if (!Number.isFinite(occurredAt.getTime())) throw new Error("occurredAt must be a valid timestamp");
  if (!Number.isFinite(input.costUsd) || input.costUsd < 0) throw new Error("costUsd must be non-negative");
  if (!Number.isInteger(input.latencyMs) || input.latencyMs < 0) {
    throw new Error("latencyMs must be a non-negative integer");
  }
  const values = [
    tid,
    boundedText("eventKey", input.eventKey, 200),
    boundedText("loopKind", input.loopKind, 80),
    boundedText("policyVersion", input.policyVersion, 80),
    boundedText("sourceType", input.sourceType, 80),
    boundedText("sourceId", input.sourceId, 160),
    input.taskClass ? boundedText("taskClass", input.taskClass, 120) : null,
    input.mode,
    unit("quality", input.quality),
    input.costUsd,
    input.latencyMs,
    input.safetyPassed,
    input.safetyEvaluated,
    input.independentlyEvaluated,
    unit("persistedQuality", input.persistedQuality),
    unit("explorationValue", input.explorationValue),
    boundedEvidence(input.evidence),
    occurredAt.toISOString(),
  ];
  const inserted = await db.query(
    `INSERT INTO loop_outcome_events
       (tenant_id, event_key, loop_kind, policy_version, source_type, source_id,
        task_class, mode, quality, cost_usd, latency_ms, safety_passed,
        safety_evaluated, independently_evaluated, persisted_quality, exploration_value, evidence, occurred_at)
     VALUES
       ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17::jsonb, $18)
     ON CONFLICT (tenant_id, event_key) DO NOTHING
     RETURNING *`,
    values,
  );
  if (inserted.rows[0]) return inserted.rows[0];
  const existing = await db.query(
    `SELECT * FROM loop_outcome_events
     WHERE tenant_id = $1 AND event_key = $2
     LIMIT 1`,
    [tid, values[1]],
  );
  if (!existing.rows[0]) throw new Error("loop outcome idempotency lookup failed");
  return existing.rows[0];
}

export async function appendLoopGraphEdge(
  db: LoopPortfolioQueryable,
  input: AppendLoopGraphEdgeInput,
): Promise<any> {
  const tid = tenantId(input.tenantId);
  if (!Number.isInteger(input.sourceEventId) || input.sourceEventId < 1) {
    throw new Error("sourceEventId must be a positive integer");
  }
  if (!Number.isInteger(input.targetEventId) || input.targetEventId < 1) {
    throw new Error("targetEventId must be a positive integer");
  }
  const edgeKey = boundedText("edgeKey", input.edgeKey, 200);
  const inserted = await db.query(
    `INSERT INTO loop_graph_edges
       (tenant_id, edge_key, source_event_id, target_event_id, relation, evidence)
     SELECT $1, $2, $3, $4, $5, $6::jsonb
     WHERE EXISTS (
       SELECT 1 FROM loop_outcome_events source
       WHERE source.tenant_id = $1 AND source.id = $3
     )
       AND EXISTS (
         SELECT 1 FROM loop_outcome_events target
         WHERE target.tenant_id = $1 AND target.id = $4
       )
     ON CONFLICT (tenant_id, edge_key) DO NOTHING
     RETURNING *`,
    [
      tid,
      edgeKey,
      input.sourceEventId,
      input.targetEventId,
      input.relation,
      boundedEvidence(input.evidence),
    ],
  );
  if (inserted.rows[0]) return inserted.rows[0];
  const existing = await db.query(
    `SELECT * FROM loop_graph_edges
     WHERE tenant_id = $1 AND edge_key = $2
     LIMIT 1`,
    [tid, edgeKey],
  );
  if (!existing.rows[0]) {
    throw new Error("loop graph endpoints must exist in the same tenant");
  }
  return existing.rows[0];
}

export async function listLoopGraph(
  db: LoopPortfolioQueryable,
  inputTenantId: number,
  requestedLimit = 200,
): Promise<{ nodes: any[]; edges: any[] }> {
  const tid = tenantId(inputTenantId);
  const limit = Math.min(500, Math.max(1, Math.floor(requestedLimit)));
  const nodes = await db.query(
    `SELECT id, event_key, loop_kind, policy_version, source_type, source_id,
            task_class, mode, quality, cost_usd, latency_ms, safety_passed,
            safety_evaluated, independently_evaluated, persisted_quality, exploration_value,
            evidence, occurred_at, created_at
     FROM loop_outcome_events
     WHERE tenant_id = $1
     ORDER BY occurred_at DESC, id DESC
     LIMIT $2`,
    [tid, limit],
  );
  const edges = await db.query(
    `SELECT id, edge_key, source_event_id, target_event_id, relation, evidence, created_at
     FROM loop_graph_edges
     WHERE tenant_id = $1
       AND source_event_id = ANY($3::int[])
       AND target_event_id = ANY($3::int[])
     ORDER BY id DESC
     LIMIT $2`,
    [tid, limit, nodes.rows.map((row) => Number(row.id))],
  );
  return { nodes: nodes.rows, edges: edges.rows };
}