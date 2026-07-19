// ============================================================
// SIMULATION SANDBOX (feature contract: data/feature-contracts/simulation-sandbox)
// S2 — replay runs + per-item results. Admin-tenant only this round;
// tenant_id NOT NULL with NO default: every INSERT passes it explicitly.
// Extracted from shared/schema.ts (S4, girth guard) — re-exported there,
// same import path for every consumer (`@shared/schema`).
// ============================================================
import { sql } from "drizzle-orm";
import { pgTable, serial, integer, text, jsonb, timestamp, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const sandboxRuns = pgTable("sandbox_runs", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull(),
  corpus: text("corpus").notNull(), // safety | conversation | orchestration
  status: text("status").notNull(), // running | complete | failed
  /** Ephemeral override bundle (intent-gate mode, model tier, persona prompt, tool policy). */
  overrides: jsonb("overrides").notNull(),
  sampleSize: integer("sample_size").notNull(),
  /** Aggregate report: totals, flips, severity counts, stubbed-call rollup. */
  report: jsonb("report"),
  error: text("error"),
  startedAt: timestamp("started_at", { withTimezone: true }).default(sql`now()`).notNull(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
}, (t) => ({
  tenantIdx: index("idx_sandbox_runs_tenant").on(t.tenantId),
}));
export const insertSandboxRunSchema = createInsertSchema(sandboxRuns).omit({ id: true, startedAt: true });
export type SandboxRun = typeof sandboxRuns.$inferSelect;
export type InsertSandboxRun = z.infer<typeof insertSandboxRunSchema>;

export const sandboxResults = pgTable("sandbox_results", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull(),
  runId: integer("run_id").notNull().references(() => sandboxRuns.id, { onDelete: "cascade" }),
  /** Source row reference, e.g. "security_intent_checks:1234". */
  itemRef: text("item_ref").notNull(),
  /** Historical outcome (verdict/action, categories, classifier…). */
  baseline: jsonb("baseline").notNull(),
  /** Replayed outcome under the override bundle. */
  simulated: jsonb("simulated").notNull(),
  /** none | block_to_allow | allow_to_block */
  flip: text("flip").notNull(),
  /** critical | warn | info — block_to_allow is always critical. */
  severity: text("severity").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).default(sql`now()`).notNull(),
}, (t) => ({
  tenantIdx: index("idx_sandbox_results_tenant").on(t.tenantId),
  runIdx: index("idx_sandbox_results_run").on(t.runId),
}));
export const insertSandboxResultSchema = createInsertSchema(sandboxResults).omit({ id: true, createdAt: true });
export type SandboxResult = typeof sandboxResults.$inferSelect;
export type InsertSandboxResult = z.infer<typeof insertSandboxResultSchema>;
