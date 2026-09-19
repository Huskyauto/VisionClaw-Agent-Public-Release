BEGIN;

CREATE TABLE IF NOT EXISTS loop_outcome_events (
  id serial PRIMARY KEY,
  tenant_id integer NOT NULL,
  event_key text NOT NULL,
  loop_kind text NOT NULL,
  policy_version text NOT NULL,
  source_type text NOT NULL,
  source_id text NOT NULL,
  task_class text,
  mode text NOT NULL,
  quality double precision NOT NULL,
  cost_usd double precision NOT NULL DEFAULT 0,
  latency_ms integer NOT NULL DEFAULT 0,
  safety_passed boolean NOT NULL,
  safety_evaluated boolean NOT NULL DEFAULT false,
  independently_evaluated boolean NOT NULL,
  persisted_quality double precision,
  exploration_value double precision,
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_loop_outcomes_id_tenant UNIQUE (id, tenant_id),
  CONSTRAINT chk_loop_outcomes_quality CHECK (quality >= 0 AND quality <= 1),
  CONSTRAINT chk_loop_outcomes_cost CHECK (cost_usd >= 0),
  CONSTRAINT chk_loop_outcomes_latency CHECK (latency_ms >= 0),
  CONSTRAINT chk_loop_outcomes_mode CHECK (
    mode IN ('online', 'replay', 'shadow', 'report_only')
  ),
  CONSTRAINT chk_loop_outcomes_persisted CHECK (
    persisted_quality IS NULL OR (persisted_quality >= 0 AND persisted_quality <= 1)
  ),
  CONSTRAINT chk_loop_outcomes_exploration CHECK (
    exploration_value IS NULL OR (exploration_value >= 0 AND exploration_value <= 1)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_loop_outcomes_tenant_event
  ON loop_outcome_events (tenant_id, event_key);
CREATE INDEX IF NOT EXISTS idx_loop_outcomes_tenant_loop_time
  ON loop_outcome_events (tenant_id, loop_kind, occurred_at);
CREATE INDEX IF NOT EXISTS idx_loop_outcomes_tenant_source
  ON loop_outcome_events (tenant_id, source_type, source_id);

CREATE TABLE IF NOT EXISTS loop_graph_edges (
  id serial PRIMARY KEY,
  tenant_id integer NOT NULL,
  edge_key text NOT NULL,
  source_event_id integer NOT NULL,
  target_event_id integer NOT NULL,
  relation text NOT NULL,
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fk_loop_edges_source_tenant
    FOREIGN KEY (source_event_id, tenant_id)
    REFERENCES loop_outcome_events (id, tenant_id)
    ON DELETE RESTRICT,
  CONSTRAINT fk_loop_edges_target_tenant
    FOREIGN KEY (target_event_id, tenant_id)
    REFERENCES loop_outcome_events (id, tenant_id)
    ON DELETE RESTRICT,
  CONSTRAINT chk_loop_edges_relation CHECK (
    relation IN ('succeeded_by', 'derived_from', 'replayed_against', 'crossover_of')
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_loop_edges_tenant_edge
  ON loop_graph_edges (tenant_id, edge_key);
CREATE INDEX IF NOT EXISTS idx_loop_edges_tenant_source
  ON loop_graph_edges (tenant_id, source_event_id);
CREATE INDEX IF NOT EXISTS idx_loop_edges_tenant_target
  ON loop_graph_edges (tenant_id, target_event_id);

COMMIT;