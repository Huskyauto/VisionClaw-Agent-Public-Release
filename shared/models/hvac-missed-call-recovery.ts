import { sql } from "drizzle-orm";
import { pgTable, serial, text, timestamp, integer, jsonb, varchar, index, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { tenants } from "../schema";

export const hvacMissedCallWorkspaces = pgTable("hvac_missed_call_workspaces", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  idempotencyKey: varchar("idempotency_key", { length: 128 }).notNull(),
  prospectName: varchar("prospect_name", { length: 160 }).notNull(),
  companyName: varchar("company_name", { length: 160 }).notNull(),
  trade: varchar("trade", { length: 32 }).notNull().default("hvac"),
  intake: jsonb("intake").notNull().default(sql`'{}'::jsonb`),
  assumptions: jsonb("assumptions").notNull().default(sql`'{}'::jsonb`),
  estimate: jsonb("estimate").notNull().default(sql`'{}'::jsonb`),
  status: varchar("status", { length: 32 }).notNull().default("discovery"),
  readiness: jsonb("readiness").notNull().default(sql`'{}'::jsonb`),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  updatedAt: timestamp("updated_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
}, (t) => ({
  tenantIdx: index("idx_hvac_missed_call_workspaces_tenant").on(t.tenantId),
  tenantIdempotencyUnique: uniqueIndex("uq_hvac_missed_call_workspaces_tenant_idempotency").on(t.tenantId, t.idempotencyKey),
  tenantStatusIdx: index("idx_hvac_missed_call_workspaces_tenant_status").on(t.tenantId, t.status),
}));
export const insertHvacMissedCallWorkspaceSchema = createInsertSchema(hvacMissedCallWorkspaces).omit({ id: true, createdAt: true, updatedAt: true });
export type HvacMissedCallWorkspace = typeof hvacMissedCallWorkspaces.$inferSelect;
export type InsertHvacMissedCallWorkspace = z.infer<typeof insertHvacMissedCallWorkspaceSchema>;