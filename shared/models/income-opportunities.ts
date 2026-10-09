import { sql } from "drizzle-orm";
import { pgTable, serial, integer, text, boolean, timestamp, index, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const incomeOpportunities = pgTable("income_opportunities", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull(),
  slug: text("slug").notNull(),
  name: text("name").notNull(),
  category: text("category").notNull(),
  evidence: text("evidence").notNull().default("Idea"),
  buyer: text("buyer").notNull(),
  problem: text("problem").notNull(),
  entryOffer: text("entry_offer").notNull(),
  price: text("price").notNull().default("Not yet validated"),
  expansion: text("expansion").notNull().default("Not yet defined"),
  nextStep: text("next_step").notNull(),
  featured: boolean("featured").notNull().default(false),
  actionPath: text("action_path"),
  source: text("source").notNull().default("felix"),
  createdAt: timestamp("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (t) => ({
  tenantIdx: index("idx_income_opportunities_tenant").on(t.tenantId),
  tenantSlugUnique: uniqueIndex("income_opportunities_tenant_slug_unique").on(t.tenantId, t.slug),
}));

export const insertIncomeOpportunitySchema = createInsertSchema(incomeOpportunities).omit({ id: true, createdAt: true });
export type IncomeOpportunityRow = typeof incomeOpportunities.$inferSelect;
export type InsertIncomeOpportunity = z.infer<typeof insertIncomeOpportunitySchema>;

export const fileIncomeOpportunitySchema = z.object({
  name: z.string().trim().min(3).max(160),
  category: z.enum(["Assessment", "Monitoring", "Implementation", "Partner", "Education"]),
  buyer: z.string().trim().min(3).max(1000),
  problem: z.string().trim().min(3).max(2000),
  entryOffer: z.string().trim().min(3).max(2000),
  price: z.string().trim().min(1).max(200).optional(),
  expansion: z.string().trim().min(1).max(1000).optional(),
  nextStep: z.string().trim().min(3).max(1000),
}).strict();