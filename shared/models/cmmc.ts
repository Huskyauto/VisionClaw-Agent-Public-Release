// CMMC Level 1 / FCI customer report flow. Extracted mechanically from
// shared/schema.ts; its re-export there preserves every consumer import path.
import { sql } from "drizzle-orm";
import { pgTable, serial, text, timestamp, integer, jsonb, varchar, index, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { tenants, customers } from "../schema";

// Assessment state is tenant-scoped and retained for six years. Submitted
// snapshots are immutable; report exports point at one exact snapshot so the
// PDF and DOCX can never silently drift apart.
// Rollback: DROP TABLE cmmc_report_exports; DROP TABLE cmmc_assessment_snapshots;
// DROP TABLE cmmc_assessment_invitations; DROP TABLE cmmc_assessments;
export const cmmcAssessments = pgTable("cmmc_assessments", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  customerId: integer("customer_id").references(() => customers.id, { onDelete: "set null" }),
  companyName: varchar("company_name", { length: 255 }).notNull(),
  customerName: varchar("customer_name", { length: 255 }).notNull(),
  customerEmail: varchar("customer_email", { length: 320 }).notNull(),
  status: text("status").notNull().default("draft"),
  draft: jsonb("draft").notNull().default(sql`'{}'::jsonb`),
  submittedRevision: integer("submitted_revision"),
  submittedAt: timestamp("submitted_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
  retentionUntil: timestamp("retention_until").notNull().default(sql`CURRENT_TIMESTAMP + interval '6 years'`),
}, (t) => ({
  tenantIdx: index("idx_cmmc_assessments_tenant").on(t.tenantId),
  customerIdx: index("idx_cmmc_assessments_customer").on(t.tenantId, t.customerId),
  statusIdx: index("idx_cmmc_assessments_status").on(t.tenantId, t.status),
}));
export const insertCmmcAssessmentSchema = createInsertSchema(cmmcAssessments).omit({ id: true, createdAt: true, updatedAt: true });
export type CmmcAssessment = typeof cmmcAssessments.$inferSelect;
export type InsertCmmcAssessment = z.infer<typeof insertCmmcAssessmentSchema>;

export const cmmcAssessmentInvitations = pgTable("cmmc_assessment_invitations", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  assessmentId: integer("assessment_id").notNull().references(() => cmmcAssessments.id, { onDelete: "cascade" }),
  tokenHash: varchar("token_hash", { length: 64 }).notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  revokedAt: timestamp("revoked_at"),
  lastUsedAt: timestamp("last_used_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => ({
  tenantTokenUq: uniqueIndex("uq_cmmc_invites_tenant_token_hash").on(t.tenantId, t.tokenHash),
  assessmentIdx: index("idx_cmmc_invites_assessment").on(t.tenantId, t.assessmentId),
  expiryIdx: index("idx_cmmc_invites_expiry").on(t.expiresAt),
}));
export const insertCmmcAssessmentInvitationSchema = createInsertSchema(cmmcAssessmentInvitations).omit({ id: true, createdAt: true });
export type CmmcAssessmentInvitation = typeof cmmcAssessmentInvitations.$inferSelect;
export type InsertCmmcAssessmentInvitation = z.infer<typeof insertCmmcAssessmentInvitationSchema>;

export const cmmcAssessmentSnapshots = pgTable("cmmc_assessment_snapshots", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  assessmentId: integer("assessment_id").notNull().references(() => cmmcAssessments.id, { onDelete: "cascade" }),
  revision: integer("revision").notNull(),
  catalogVersion: varchar("catalog_version", { length: 80 }).notNull(),
  answerHash: varchar("answer_hash", { length: 64 }).notNull(),
  snapshot: jsonb("snapshot").notNull(),
  authorizedOfficialName: varchar("authorized_official_name", { length: 200 }).notNull(),
  authorizedOfficialTitle: varchar("authorized_official_title", { length: 200 }).notNull(),
  authorizedOfficialEmail: varchar("authorized_official_email", { length: 320 }).notNull(),
  typedSignature: varchar("typed_signature", { length: 200 }).notNull(),
  signedAt: timestamp("signed_at").notNull(),
  submittedAt: timestamp("submitted_at").notNull().defaultNow(),
  retentionUntil: timestamp("retention_until").notNull().default(sql`CURRENT_TIMESTAMP + interval '6 years'`),
}, (t) => ({
  tenantAssessmentRevisionUq: uniqueIndex("uq_cmmc_snapshots_tenant_assessment_revision").on(t.tenantId, t.assessmentId, t.revision),
  tenantHashIdx: index("idx_cmmc_snapshots_tenant_hash").on(t.tenantId, t.answerHash),
  assessmentIdx: index("idx_cmmc_snapshots_assessment").on(t.tenantId, t.assessmentId),
}));
export const insertCmmcAssessmentSnapshotSchema = createInsertSchema(cmmcAssessmentSnapshots).omit({ id: true, submittedAt: true });
export type CmmcAssessmentSnapshot = typeof cmmcAssessmentSnapshots.$inferSelect;
export type InsertCmmcAssessmentSnapshot = z.infer<typeof insertCmmcAssessmentSnapshotSchema>;

export const cmmcReportExports = pgTable("cmmc_report_exports", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  assessmentId: integer("assessment_id").notNull().references(() => cmmcAssessments.id, { onDelete: "cascade" }),
  snapshotId: integer("snapshot_id").notNull().references(() => cmmcAssessmentSnapshots.id, { onDelete: "cascade" }),
  revision: integer("revision").notNull(),
  snapshotHash: varchar("snapshot_hash", { length: 64 }).notNull(),
  idempotencyKey: varchar("idempotency_key", { length: 255 }).notNull(),
  status: text("status").notNull().default("pending"),
  pdfPath: text("pdf_path"),
  docxPath: text("docx_path"),
  pdfArtifactKey: text("pdf_artifact_key"),
  docxArtifactKey: text("docx_artifact_key"),
  pdfSha256: varchar("pdf_sha256", { length: 64 }),
  docxSha256: varchar("docx_sha256", { length: 64 }),
  pdfSize: integer("pdf_size"),
  docxSize: integer("docx_size"),
  pdfDriveFileId: text("pdf_drive_file_id"),
  docxDriveFileId: text("docx_drive_file_id"),
  driveFolderId: text("drive_folder_id"),
  deliveryLogId: integer("delivery_log_id"),
  reviewedAt: timestamp("reviewed_at"),
  reviewedBy: text("reviewed_by"),
  approvedAt: timestamp("approved_at"),
  deliveredAt: timestamp("delivered_at"),
  errorMessage: text("error_message"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (t) => ({
  tenantIdempotencyUq: uniqueIndex("uq_cmmc_exports_tenant_idempotency").on(t.tenantId, t.idempotencyKey),
  tenantAssessmentIdx: index("idx_cmmc_exports_tenant_assessment").on(t.tenantId, t.assessmentId),
  tenantStatusIdx: index("idx_cmmc_exports_tenant_status").on(t.tenantId, t.status),
}));
export const insertCmmcReportExportSchema = createInsertSchema(cmmcReportExports).omit({ id: true, createdAt: true, updatedAt: true });
export type CmmcReportExport = typeof cmmcReportExports.$inferSelect;
export type InsertCmmcReportExport = z.infer<typeof insertCmmcReportExportSchema>;