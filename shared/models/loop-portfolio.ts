// ============================================================
// LOOP PORTFOLIO GRAPH
// Contract: data/feature-contracts/loop-portfolio-graph/
// Append-only, tenant-scoped evidence. No allocation/promotion state.
// ============================================================
import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  doublePrecision,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  serial,
  text,
  timestamp,
  unique,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const loopOutcomeEvents = pgTable("loop_outcome_events", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull(),
  eventKey: text("event_key").notNull(),
  loopKind: text("loop_kind").notNull(),
  policyVersion: text("policy_version").notNull(),
  sourceType: text("source_type").notNull(),
  sourceId: text("source_id").notNull(),
  taskClass: text("task_class"),
  mode: text("mode").notNull(), // online | replay | shadow | report_only
  quality: doublePrecision("quality").notNull(),
  costUsd: doublePrecision("cost_usd").notNull().default(0),
  latencyMs: integer("latency_ms").notNull().default(0),
  safetyPassed: boolean("safety_passed").notNull(),
  safetyEvaluated: boolean("safety_evaluated").notNull().default(false),
  independentlyEvaluated: boolean("independently_evaluated").notNull(),
  persistedQuality: doublePrecision("persisted_quality"),
  explorationValue: doublePrecision("exploration_value"),
  evidence: jsonb("evidence").notNull().default({}),
  occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).default(sql`now()`).notNull(),
}, (t) => ({
  tenantEventUq: uniqueIndex("uq_loop_outcomes_tenant_event").on(t.tenantId, t.eventKey),
  idTenantUq: unique("uq_loop_outcomes_id_tenant").on(t.id, t.tenantId),
  tenantLoopTimeIdx: index("idx_loop_outcomes_tenant_loop_time")
    .on(t.tenantId, t.loopKind, t.occurredAt),
  tenantSourceIdx: index("idx_loop_outcomes_tenant_source")
    .on(t.tenantId, t.sourceType, t.sourceId),
  qualityCheck: check("chk_loop_outcomes_quality", sql`${t.quality} >= 0 AND ${t.quality} <= 1`),
  costCheck: check("chk_loop_outcomes_cost", sql`${t.costUsd} >= 0`),
  latencyCheck: check("chk_loop_outcomes_latency", sql`${t.latencyMs} >= 0`),
  persistedCheck: check(
    "chk_loop_outcomes_persisted",
    sql`${t.persistedQuality} IS NULL OR (${t.persistedQuality} >= 0 AND ${t.persistedQuality} <= 1)`,
  ),
  explorationCheck: check(
    "chk_loop_outcomes_exploration",
    sql`${t.explorationValue} IS NULL OR (${t.explorationValue} >= 0 AND ${t.explorationValue} <= 1)`,
  ),
  modeCheck: check(
    "chk_loop_outcomes_mode",
    sql`${t.mode} IN ('online', 'replay', 'shadow', 'report_only')`,
  ),
}));

export const loopGraphEdges = pgTable("loop_graph_edges", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull(),
  edgeKey: text("edge_key").notNull(),
  sourceEventId: integer("source_event_id").notNull(),
  targetEventId: integer("target_event_id").notNull(),
  relation: text("relation").notNull(), // succeeded_by | derived_from | replayed_against | crossover_of
  evidence: jsonb("evidence").notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).default(sql`now()`).notNull(),
}, (t) => ({
  tenantEdgeUq: uniqueIndex("uq_loop_edges_tenant_edge").on(t.tenantId, t.edgeKey),
  tenantSourceIdx: index("idx_loop_edges_tenant_source").on(t.tenantId, t.sourceEventId),
  tenantTargetIdx: index("idx_loop_edges_tenant_target").on(t.tenantId, t.targetEventId),
  sourceTenantFk: foreignKey({
    columns: [t.sourceEventId, t.tenantId],
    foreignColumns: [loopOutcomeEvents.id, loopOutcomeEvents.tenantId],
    name: "fk_loop_edges_source_tenant",
  }).onDelete("restrict"),
  targetTenantFk: foreignKey({
    columns: [t.targetEventId, t.tenantId],
    foreignColumns: [loopOutcomeEvents.id, loopOutcomeEvents.tenantId],
    name: "fk_loop_edges_target_tenant",
  }).onDelete("restrict"),
  relationCheck: check(
    "chk_loop_edges_relation",
    sql`${t.relation} IN ('succeeded_by', 'derived_from', 'replayed_against', 'crossover_of')`,
  ),
}));

export const insertLoopOutcomeEventSchema = createInsertSchema(loopOutcomeEvents).omit({
  id: true,
  createdAt: true,
});
export type InsertLoopOutcomeEvent = z.infer<typeof insertLoopOutcomeEventSchema>;
export type LoopOutcomeEvent = typeof loopOutcomeEvents.$inferSelect;

export const insertLoopGraphEdgeSchema = createInsertSchema(loopGraphEdges).omit({
  id: true,
  createdAt: true,
});
export type InsertLoopGraphEdge = z.infer<typeof insertLoopGraphEdgeSchema>;
export type LoopGraphEdge = typeof loopGraphEdges.$inferSelect;