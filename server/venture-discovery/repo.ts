// ─────────────────────────────────────────────────────────────────────────────
// Venture Discovery Loop — tenant-scoped data access (2026-06-17).
//
// Every function takes tenantId FIRST and filters on tenant_id (the platform's
// tenant-isolation bedrock). Kept in a cohesive feature module rather than
// bloating IStorage; the discipline is identical — no query crosses tenants.
// ─────────────────────────────────────────────────────────────────────────────

import { db } from "../db";
import { and, eq, desc } from "drizzle-orm";
import {
  ventureDiscoveryRuns,
  ventureIdeas,
  ventureScores,
  syntheticCustomers,
  validationRuns,
  mvpBriefs,
  financialModels,
  legalRiskReviews,
  ventureDecisions,
  ventureArtifacts,
  type VentureDiscoveryRun,
  type InsertVentureDiscoveryRun,
  type InsertVentureIdea,
  type InsertVentureScore,
  type InsertSyntheticCustomer,
  type InsertValidationRun,
  type InsertMvpBrief,
  type InsertFinancialModel,
  type InsertLegalRiskReview,
  type InsertVentureDecision,
  type InsertVentureArtifact,
} from "@shared/schema";

export async function createRun(row: InsertVentureDiscoveryRun): Promise<VentureDiscoveryRun> {
  const [created] = await db.insert(ventureDiscoveryRuns).values(row).returning();
  return created;
}

export async function getRun(tenantId: number, id: number): Promise<VentureDiscoveryRun | undefined> {
  const [row] = await db
    .select()
    .from(ventureDiscoveryRuns)
    .where(and(eq(ventureDiscoveryRuns.id, id), eq(ventureDiscoveryRuns.tenantId, tenantId)))
    .limit(1);
  return row;
}

export async function listRuns(tenantId: number, limit = 50): Promise<VentureDiscoveryRun[]> {
  return db
    .select()
    .from(ventureDiscoveryRuns)
    .where(eq(ventureDiscoveryRuns.tenantId, tenantId))
    .orderBy(desc(ventureDiscoveryRuns.createdAt))
    .limit(limit);
}

export async function updateRun(
  tenantId: number,
  id: number,
  patch: Partial<Pick<VentureDiscoveryRun, "status" | "currentStage" | "completedStages" | "lastError">>,
): Promise<VentureDiscoveryRun | undefined> {
  const [row] = await db
    .update(ventureDiscoveryRuns)
    .set({ ...patch, updatedAt: new Date() })
    .where(and(eq(ventureDiscoveryRuns.id, id), eq(ventureDiscoveryRuns.tenantId, tenantId)))
    .returning();
  return row;
}

/**
 * Atomic compare-and-set claim of a run for stage execution. Transitions the row
 * to `running` ONLY if it is still at the EXACT (status, stage) the caller
 * observed — so two concurrent `approveNextStage` calls can never both execute
 * the same stage (which would double the budget reservation + duplicate rows).
 * Returns the claimed row, or `undefined` if another caller already advanced it.
 */
export async function claimRunForStage(
  tenantId: number,
  id: number,
  expectedStatus: string,
  expectedStage: string,
): Promise<VentureDiscoveryRun | undefined> {
  const [row] = await db
    .update(ventureDiscoveryRuns)
    .set({ status: "running", updatedAt: new Date() })
    .where(
      and(
        eq(ventureDiscoveryRuns.id, id),
        eq(ventureDiscoveryRuns.tenantId, tenantId),
        eq(ventureDiscoveryRuns.status, expectedStatus),
        eq(ventureDiscoveryRuns.currentStage, expectedStage),
      ),
    )
    .returning();
  return row;
}

export async function addIdeas(rows: InsertVentureIdea[]) {
  if (!rows.length) return [];
  return db.insert(ventureIdeas).values(rows).returning();
}
export async function addScores(rows: InsertVentureScore[]) {
  if (!rows.length) return [];
  return db.insert(ventureScores).values(rows).returning();
}
export async function addSyntheticCustomers(rows: InsertSyntheticCustomer[]) {
  if (!rows.length) return [];
  return db.insert(syntheticCustomers).values(rows).returning();
}
export async function addValidationRuns(rows: InsertValidationRun[]) {
  if (!rows.length) return [];
  return db.insert(validationRuns).values(rows).returning();
}
export async function addMvpBriefs(rows: InsertMvpBrief[]) {
  if (!rows.length) return [];
  return db.insert(mvpBriefs).values(rows).returning();
}
export async function addFinancialModels(rows: InsertFinancialModel[]) {
  if (!rows.length) return [];
  return db.insert(financialModels).values(rows).returning();
}
export async function addLegalRiskReviews(rows: InsertLegalRiskReview[]) {
  if (!rows.length) return [];
  return db.insert(legalRiskReviews).values(rows).returning();
}
export async function addVentureDecision(row: InsertVentureDecision) {
  const [created] = await db.insert(ventureDecisions).values(row).returning();
  return created;
}
export async function addArtifact(row: InsertVentureArtifact) {
  const [created] = await db.insert(ventureArtifacts).values(row).returning();
  return created;
}

export interface VentureRunResults {
  run: VentureDiscoveryRun;
  ideas: any[];
  scores: any[];
  syntheticCustomers: any[];
  validations: any[];
  mvpBriefs: any[];
  financialModels: any[];
  legalRiskReviews: any[];
  decisions: any[];
  artifacts: any[];
}

export async function getRunResults(tenantId: number, runId: number): Promise<VentureRunResults | undefined> {
  const run = await getRun(tenantId, runId);
  if (!run) return undefined;
  const scope = (table: any) => and(eq(table.runId, runId), eq(table.tenantId, tenantId));
  const [ideas, scores, sc, validations, briefs, fin, legal, decisions, artifacts] = await Promise.all([
    db.select().from(ventureIdeas).where(scope(ventureIdeas)),
    db.select().from(ventureScores).where(scope(ventureScores)),
    db.select().from(syntheticCustomers).where(scope(syntheticCustomers)),
    db.select().from(validationRuns).where(scope(validationRuns)),
    db.select().from(mvpBriefs).where(scope(mvpBriefs)),
    db.select().from(financialModels).where(scope(financialModels)),
    db.select().from(legalRiskReviews).where(scope(legalRiskReviews)),
    db.select().from(ventureDecisions).where(scope(ventureDecisions)),
    db.select().from(ventureArtifacts).where(scope(ventureArtifacts)),
  ]);
  return {
    run,
    ideas,
    scores,
    syntheticCustomers: sc,
    validations,
    mvpBriefs: briefs,
    financialModels: fin,
    legalRiskReviews: legal,
    decisions,
    artifacts,
  };
}
