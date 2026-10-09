import { pgTable, uuid, integer, text, jsonb, boolean, timestamp, index, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { tenants } from "../schema";
export const treasuryPaperRuns = pgTable("treasury_paper_runs", {
  id: uuid("id").primaryKey(), tenantId: integer("tenant_id").notNull().references(() => tenants.id),
  requestKey: uuid("request_key").notNull(), requestDigest: text("request_digest").notNull(),
  status: text("status").notNull().default("running"), options: jsonb("options").notNull(),
  sourceBars: jsonb("source_bars"), result: jsonb("result"), error: text("error"),
  reviewing: boolean("reviewing").notNull().default(false), review: jsonb("review"),
  reviewError: text("review_error"), reviewAttemptedAt: timestamp("review_attempted_at", { withTimezone:true }),
  leaseUntil: timestamp("lease_until", { withTimezone:true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone:true }).notNull().defaultNow(),
  finishedAt: timestamp("finished_at", { withTimezone:true }),
}, t => [
  uniqueIndex("treasury_paper_request_idx").on(t.tenantId,t.requestKey),
  index("treasury_paper_tenant_created_idx").on(t.tenantId,t.createdAt),
  index("treasury_paper_lease_idx").on(t.tenantId,t.status,t.leaseUntil),
]);
export const insertTreasuryPaperRunSchema = createInsertSchema(treasuryPaperRuns).omit({createdAt:true});
export type TreasuryPaperRunRecord = typeof treasuryPaperRuns.$inferSelect;
export type InsertTreasuryPaperRun = typeof treasuryPaperRuns.$inferInsert;
