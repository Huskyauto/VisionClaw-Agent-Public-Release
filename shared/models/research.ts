// Extracted from shared/schema.ts (girth-gate slice, mechanical move — no
// behavior change): autoresearch program/session/experiment/schedule tables.
import { pgTable, serial, integer, text, boolean, real, timestamp } from "drizzle-orm/pg-core";

export const researchPrograms = pgTable("research_programs", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull(),
  personaId: integer("persona_id"),
  name: text("name").notNull(),
  objective: text("objective").notNull(),
  constraints: text("constraints").notNull().default(""),
  metrics: text("metrics").notNull().default(""),
  explorationStrategy: text("exploration_strategy").notNull().default("balanced"),
  model: text("model").default("deepseek/deepseek-v3.2"),
  maxExperimentsPerSession: integer("max_experiments_per_session").default(20),
  isActive: boolean("is_active").notNull().default(true),
  baselineMetricValue: real("baseline_metric_value"),
  baselineLabel: text("baseline_label"),
  evalType: text("eval_type").default("judge"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const researchSessions = pgTable("research_sessions", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull(),
  programId: integer("program_id").notNull(),
  status: text("status").notNull().default("running"),
  startedAt: timestamp("started_at").defaultNow().notNull(),
  endedAt: timestamp("ended_at"),
  totalExperiments: integer("total_experiments").default(0),
  experimentsKept: integer("experiments_kept").default(0),
  experimentsDiscarded: integer("experiments_discarded").default(0),
  experimentsCrashed: integer("experiments_crashed").default(0),
  totalTokensUsed: integer("total_tokens_used").default(0),
  summary: text("summary"),
  model: text("model"),
});

export const researchExperiments = pgTable("research_experiments", {
  id: serial("id").primaryKey(),
  sessionId: integer("session_id").notNull(),
  tenantId: integer("tenant_id").notNull(),
  programId: integer("program_id").notNull(),
  hypothesis: text("hypothesis").notNull(),
  approach: text("approach").notNull().default(""),
  result: text("result"),
  metric: text("metric"),
  metricValue: text("metric_value"),
  numericMetricValue: real("numeric_metric_value"),
  metricDeltaPct: real("metric_delta_pct"),
  verificationStatus: text("verification_status").default("unverified"),
  verificationDetails: text("verification_details"),
  status: text("status").notNull().default("running"),
  parentExperimentId: integer("parent_experiment_id"),
  tokensUsed: integer("tokens_used").default(0),
  durationMs: integer("duration_ms"),
  model: text("model"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const researchSchedules = pgTable("research_schedules", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull(),
  programId: integer("program_id"),
  name: text("name").notNull(),
  cronExpression: text("cron_expression").notNull().default("0 2 * * *"),
  timezone: text("timezone").notNull().default("America/Chicago"),
  isEnabled: boolean("is_enabled").notNull().default(true),
  runAll: boolean("run_all").notNull().default(false),
  lastRunAt: timestamp("last_run_at"),
  nextRunAt: timestamp("next_run_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
