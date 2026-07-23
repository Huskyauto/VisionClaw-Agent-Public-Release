// ============================================================
// VERIFIED REVENUE MISSIONS (feature contract: data/feature-contracts/revenue-missions)
// S1 — durable business-experiment layer: hypothesis → evidence → offer →
// capped outreach sample → replies → payment → learning, under ONE mission id.
// Success is measured by EXTERNAL evidence rows (replies, payments), never LLM
// forecasts. tenant_id NOT NULL with NO default: every INSERT passes it
// explicitly. Owner-only surface this round; HITL approval required before any
// send. Re-exported from shared/schema.ts (girth guard) — consumers keep
// importing `@shared/schema`.
// ============================================================
import { sql } from "drizzle-orm";
import { pgTable, serial, integer, text, jsonb, timestamp, index, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const MISSION_STAGES = [
  "hypothesis",
  "evidence_gathering",
  "offer_defined",
  "experiment_draft",
  "experiment_awaiting_approval",
  "experiment_live",
  "evaluating",
  "presell",
  "scale_ready",
  "killed",
] as const;
export type MissionStage = (typeof MISSION_STAGES)[number];

export const revenueMissions = pgTable("revenue_missions", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull(),
  name: text("name").notNull(),
  hypothesis: text("hypothesis").notNull(),
  idealCustomer: text("ideal_customer").notNull(),
  painStatement: text("pain_statement"),
  offer: text("offer").notNull(),
  priceUsd: integer("price_usd").notNull().default(0), // whole dollars; 0 = not yet priced
  acquisitionChannel: text("acquisition_channel").notNull().default("email"),
  stage: text("stage").notNull().default("hypothesis"), // MissionStage
  // Budget/risk caps — enforced server-side, never trusted from the client on updates.
  maxCashAtRiskUsd: integer("max_cash_at_risk_usd").notNull().default(25),
  // Autonomy ladder (S5c): 0=propose-only … 6=scale-with-approval. Levels only
  // change via the owner-only route/admin UI (HITL) — never via agent tools.
  autonomyLevel: integer("autonomy_level").notNull().default(0),
  maxProspects: integer("max_prospects").notNull().default(25),
  maxContactsPerProspect: integer("max_contacts_per_prospect").notNull().default(3),
  successCriteria: text("success_criteria"),
  killCriteria: text("kill_criteria"),
  // Evidence rollup counters (denormalized; source of truth = mission_evidence).
  leadsContacted: integer("leads_contacted").notNull().default(0),
  positiveReplies: integer("positive_replies").notNull().default(0),
  negativeReplies: integer("negative_replies").notNull().default(0),
  callsBooked: integer("calls_booked").notNull().default(0),
  paymentsReceived: integer("payments_received").notNull().default(0),
  revenueUsdCents: integer("revenue_usd_cents").notNull().default(0),
  refundsUsdCents: integer("refunds_usd_cents").notNull().default(0),
  spendUsdCents: integer("spend_usd_cents").notNull().default(0),
  // Optional links into the wider platform.
  projectId: integer("project_id"),
  notes: text("notes"),
  killedReason: text("killed_reason"),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  updatedAt: timestamp("updated_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
}, (t) => ({
  tenantIdx: index("idx_revenue_missions_tenant").on(t.tenantId),
  stageIdx: index("idx_revenue_missions_tenant_stage").on(t.tenantId, t.stage),
}));
export const insertRevenueMissionSchema = createInsertSchema(revenueMissions).omit({ id: true, createdAt: true, updatedAt: true });
export type RevenueMission = typeof revenueMissions.$inferSelect;
export type InsertRevenueMission = z.infer<typeof insertRevenueMissionSchema>;

export const MISSION_EVIDENCE_TYPES = [
  "positive_reply",
  "negative_reply",
  "call_booked",
  "checkout_started",
  "payment",
  "refund",
  "complaint_sourced",
  "competitor_found",
  "prospect_agreed_price",
  "other",
] as const;
export type MissionEvidenceType = (typeof MISSION_EVIDENCE_TYPES)[number];

export const missionEvidence = pgTable("mission_evidence", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull(),
  missionId: integer("mission_id").notNull().references(() => revenueMissions.id),
  experimentId: integer("experiment_id"),
  type: text("type").notNull(), // MissionEvidenceType
  summary: text("summary").notNull(),
  // Provenance — evidence must point at something outside the model.
  source: text("source").notNull(), // gmail | stripe | manual | web | crm
  externalRef: text("external_ref"), // gmail message id, stripe payment_intent id, URL…
  amountUsdCents: integer("amount_usd_cents"),
  contactEmail: text("contact_email"),
  raw: jsonb("raw").notNull().default(sql`'{}'::jsonb`),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
}, (t) => ({
  tenantIdx: index("idx_mission_evidence_tenant").on(t.tenantId),
  missionIdx: index("idx_mission_evidence_mission").on(t.missionId),
}));
export const insertMissionEvidenceSchema = createInsertSchema(missionEvidence).omit({ id: true, createdAt: true });
export type MissionEvidence = typeof missionEvidence.$inferSelect;
export type InsertMissionEvidence = z.infer<typeof insertMissionEvidenceSchema>;

export const missionExperiments = pgTable("mission_experiments", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull(),
  missionId: integer("mission_id").notNull().references(() => revenueMissions.id),
  name: text("name").notNull(),
  status: text("status").notNull().default("draft"), // draft | awaiting_approval | approved | live | completed | cancelled
  // The review packet: candidate prospects + message variants, persisted for HITL.
  prospects: jsonb("prospects").notNull().default(sql`'[]'::jsonb`), // [{name,email,whyMatched,lastContactAt?}]
  variants: jsonb("variants").notNull().default(sql`'[]'::jsonb`), // [{label,subject,body}]
  // Caps copied from the mission at draft time and enforced at approve/send time.
  maxProspects: integer("max_prospects").notNull().default(25),
  maxContactsPerProspect: integer("max_contacts_per_prospect").notNull().default(3),
  maxSpendUsdCents: integer("max_spend_usd_cents").notNull().default(2500),
  // HITL — the send path is unreachable until approvedByOwnerAt is set (fail closed).
  approvedByOwnerAt: timestamp("approved_by_owner_at"),
  approvedBy: text("approved_by"),
  sequenceId: integer("sequence_id"), // outreach_sequences.id once approved
  enrolledCount: integer("enrolled_count").notNull().default(0),
  replyToken: text("reply_token"), // unique token embedded in outgoing mail for reply attribution
  resultSummary: text("result_summary"),
  dryRun: boolean("dry_run").notNull().default(true),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  updatedAt: timestamp("updated_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
}, (t) => ({
  tenantIdx: index("idx_mission_experiments_tenant").on(t.tenantId),
  missionIdx: index("idx_mission_experiments_mission").on(t.missionId),
}));
export const insertMissionExperimentSchema = createInsertSchema(missionExperiments).omit({ id: true, createdAt: true, updatedAt: true });
export type MissionExperiment = typeof missionExperiments.$inferSelect;
export type InsertMissionExperiment = z.infer<typeof insertMissionExperimentSchema>;
